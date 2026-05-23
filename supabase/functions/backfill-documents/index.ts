// Supabase Edge Function: backfill-documents
// Runtime: Deno
//
// ONE-OFF backfill that gives every existing document a fresh RAG chunk
// set built from the FULL PDF text — not just the high-level metadata
// the original ingestion captured.
//
// Pipeline per document:
//   1. Pull portix.documents rows with storage_path IS NOT NULL.
//   2. Download the file from the `documents` Storage bucket.
//   3. Send the file (base64 inlineData) to Gemini with an "extract verbatim
//      text" prompt. Returns the full readable text of the PDF.
//   4. Build a RAG text blob: meta header (document type, number, container,
//      carrier) + ai_data leaves + the new full-text body.
//   5. Chunk → embed (gemini-embedding-2, taskType RETRIEVAL_DOCUMENT, 768d).
//   6. Delete any prior chunks for this document_id (idempotency) and
//      insert the new rows using the service_role client.
//
// Invoke (no auth — deploy with --no-verify-jwt; **delete this function
// after the backfill completes** to stop Gemini quota abuse):
//   curl -X POST "$SUPABASE_URL/functions/v1/backfill-documents" \
//        -H "Content-Type: application/json" \
//        -d '{ "limit": 200, "batchSize": 3, "dryRun": false }'

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── CORS ─────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─── Env + clients ────────────────────────────────────────────────────────────

const SUPABASE_URL   = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY    =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Deno.env.get("SUPABASE_SERVICE_KEY") ||
  Deno.env.get("SERVICE_ROLE_KEY") ||
  "";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";

if (!SERVICE_KEY) {
  console.error("[backfill-documents] No service role key in env (tried SUPABASE_SERVICE_ROLE_KEY, SUPABASE_SERVICE_KEY, SERVICE_ROLE_KEY).");
} else {
  console.log(`[backfill-documents] service_role key loaded (len=${SERVICE_KEY.length})`);
}

const supabaseAdmin = createClient(
  SUPABASE_URL,
  SERVICE_KEY,
  {
    db:   { schema: "portix" },
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        apikey:        SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
    },
  },
);

// ─── Gemini REST: full-text extraction + embedding ───────────────────────────

const GEMINI_BASE   = "https://generativelanguage.googleapis.com/v1beta/models";
const TEXT_MODEL    = "gemini-2.5-flash";
const EMBED_MODEL   = "gemini-embedding-2";
const EMBED_OUT_DIM = 768;
const RETRIABLE     = new Set([429, 503]);

const EXTRACT_PROMPT =
  "Extract the FULL readable text of this PDF verbatim. Include every line of every page: headers, tables (flatten row by row), descriptions, numbers, units, weights, prices, addresses, dates, signatures, and footers. Do NOT summarize. Do NOT skip anything. Preserve line breaks between distinct lines. Return RAW TEXT ONLY — no JSON, no markdown, no commentary.";

async function fetchWithRetry(url: string, init: RequestInit, maxRetries = 2): Promise<Response> {
  let lastRes!: Response;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = Math.pow(2, attempt - 1) * 600;
      await new Promise((r) => setTimeout(r, delay));
    }
    lastRes = await fetch(url, init);
    if (lastRes.ok || !RETRIABLE.has(lastRes.status)) break;
  }
  return lastRes;
}

function toBase64(bytes: Uint8Array): string {
  // Chunked base64 to avoid call-stack blowup on big files
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

async function extractFullText(
  bytes: Uint8Array,
  mimeType: string,
): Promise<string> {
  const url = `${GEMINI_BASE}/${TEXT_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetchWithRetry(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inlineData: { mimeType, data: toBase64(bytes) } },
          { text: EXTRACT_PROMPT },
        ],
      }],
      generationConfig: {
        maxOutputTokens: 8192,
        temperature:     0.0, // verbatim extraction — no creativity
      },
    }),
  }, 2);

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`extract HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = (await res.json()) as any;
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof text === "string" ? text.trim() : "";
}

async function embedChunk(text: string): Promise<number[]> {
  const url = `${GEMINI_BASE}/${EMBED_MODEL}:embedContent?key=${GEMINI_API_KEY}`;
  const res = await fetchWithRetry(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model:                `models/${EMBED_MODEL}`,
      content:              { parts: [{ text }] },
      taskType:             "RETRIEVAL_DOCUMENT",
      outputDimensionality: EMBED_OUT_DIM,
    }),
  }, 2);

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`embed HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = (await res.json()) as any;
  const values: number[] | undefined = json?.embedding?.values;
  if (!Array.isArray(values) || values.length !== EMBED_OUT_DIM) {
    throw new Error(`unexpected embedding shape (len=${values?.length ?? "n/a"})`);
  }
  return values;
}

// ─── Chunking + RAG text synthesis ───────────────────────────────────────────
// Mirror of the helpers in classify-documents + embed-document — kept in sync
// because Deno edge functions can't share modules.

function chunkText(raw: string, maxLength = 800): string[] {
  const text = (raw ?? "").trim();
  if (!text) return [];
  const paragraphs = text.split(/\n{2,}/g).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let buf = "";
  for (const p of paragraphs) {
    if (p.length > maxLength) {
      if (buf) { chunks.push(buf); buf = ""; }
      const sentences = p.split(/(?<=[.!?])\s+/g);
      let sbuf = "";
      for (const s of sentences) {
        if (s.length > maxLength) {
          if (sbuf) { chunks.push(sbuf); sbuf = ""; }
          for (let i = 0; i < s.length; i += maxLength) chunks.push(s.slice(i, i + maxLength));
          continue;
        }
        if (sbuf.length + s.length + 1 > maxLength) { chunks.push(sbuf); sbuf = s; }
        else                                          { sbuf = sbuf ? `${sbuf} ${s}` : s; }
      }
      if (sbuf) chunks.push(sbuf);
      continue;
    }
    if (buf.length + p.length + 2 > maxLength) { chunks.push(buf); buf = p; }
    else                                        { buf = buf ? `${buf}\n\n${p}` : p; }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function flattenForRag(prefix: string, value: any, lines: string[]): void {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    const v = value.trim();
    if (v) lines.push(`${prefix}: ${v}`);
    return;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    lines.push(`${prefix}: ${String(value)}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, idx) => flattenForRag(`${prefix}[${idx}]`, item, lines));
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      flattenForRag(prefix ? `${prefix}.${k}` : k, v, lines);
    }
  }
}

function buildRagText(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta: any,
  fullText: string,
): string {
  const lines: string[] = [];
  if (meta?.document_type)   lines.push(`Document Type: ${String(meta.document_type).replace(/_/g, " ")}`);
  if (meta?.document_number) lines.push(`Document Number: ${meta.document_number}`);
  if (meta?.container_number) lines.push(`Container Number: ${meta.container_number}`);
  if (meta?.carrier)          lines.push(`Carrier: ${meta.carrier}`);
  if (meta?.extractedData) {
    flattenForRag("", meta.extractedData, lines);
  } else if (meta && typeof meta === "object") {
    const promoted = new Set(["document_type", "document_number", "container_number", "carrier"]);
    for (const [k, v] of Object.entries(meta)) {
      if (!promoted.has(k)) flattenForRag(k, v, lines);
    }
  }
  if (fullText.trim()) {
    lines.push("--- FULL DOCUMENT TEXT ---");
    lines.push(fullText.trim());
  }
  return lines.join("\n\n");
}

// ─── Per-document worker ─────────────────────────────────────────────────────

interface DocRow {
  id: string;
  container_id: string;
  document_type: string;
  storage_path: string;
  mime_type: string | null;
  file_name: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ai_data: Record<string, any> | null;
}

async function processOne(
  doc: DocRow,
): Promise<{ id: string; ok: boolean; chunks: number; error?: string }> {
  try {
    // 1. Download the file from Storage
    const { data: blob, error: dlErr } = await supabaseAdmin.storage
      .from("documents")
      .download(doc.storage_path);

    if (dlErr || !blob) {
      return { id: doc.id, ok: false, chunks: 0, error: `download: ${dlErr?.message ?? "no blob"}` };
    }

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const mime  = doc.mime_type || "application/pdf";

    // 2. Extract full text via Gemini
    const fullText = await extractFullText(bytes, mime);
    if (!fullText) {
      return { id: doc.id, ok: false, chunks: 0, error: "extractFullText returned empty" };
    }

    // 3. Build RAG text (meta + full text)
    const ragText = buildRagText(doc.ai_data ?? {}, fullText);
    const chunks  = chunkText(ragText, 800);
    if (chunks.length === 0) {
      return { id: doc.id, ok: false, chunks: 0, error: "no chunks built" };
    }

    // 4. Embed each chunk
    const rows: Array<{
      container_id: string;
      document_id:  string;
      content:      string;
      embedding:    number[];
      chunk_index:  number;
      token_count:  number | null;
    }> = [];

    for (let i = 0; i < chunks.length; i++) {
      try {
        const embedding = await embedChunk(chunks[i]);
        rows.push({
          container_id: doc.container_id,
          document_id:  doc.id,
          content:      chunks[i],
          embedding,
          chunk_index:  i,
          token_count:  null,
        });
      } catch (e) {
        console.error(`[backfill-documents] chunk ${i} embed failed (${doc.id}):`, (e as Error).message);
        // continue — partial > total failure
      }
    }

    if (rows.length === 0) {
      return { id: doc.id, ok: false, chunks: 0, error: "all chunks failed to embed" };
    }

    // 5. Idempotent insert — drop prior chunks for this document, then insert
    {
      const { error: delErr } = await supabaseAdmin
        .from("document_chunks")
        .delete()
        .eq("document_id", doc.id);
      if (delErr) console.warn(`[backfill-documents] prior-chunk delete failed (${doc.id}): ${delErr.message}`);
    }

    const { error: insErr } = await supabaseAdmin
      .from("document_chunks")
      .insert(rows);

    if (insErr) {
      return { id: doc.id, ok: false, chunks: 0, error: `insert: ${insErr.message}` };
    }

    return { id: doc.id, ok: true, chunks: rows.length };
  } catch (e) {
    return { id: doc.id, ok: false, chunks: 0, error: (e as Error).message };
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

interface BackfillBody {
  limit?:     number;
  batchSize?: number;
  dryRun?:    boolean;
  force?:     boolean;      // bypass the "skip done docs" filter
  documentIds?: string[];   // optional: target specific docs only
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!GEMINI_API_KEY) {
    return new Response(
      JSON.stringify({ ok: false, error: "GEMINI_API_KEY not set" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  if (!SERVICE_KEY) {
    return new Response(
      JSON.stringify({ ok: false, error: "Service role key not in env. Set SERVICE_ROLE_KEY." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let body: BackfillBody = {};
  try { body = await req.json(); } catch { /* defaults */ }

  const limit       = Math.max(1, Math.min(body.limit ?? 100, 2000));
  const batchSize   = Math.max(1, Math.min(body.batchSize ?? 3, 10));
  const dryRun      = body.dryRun === true;
  const force       = body.force === true;
  const targetIds   = Array.isArray(body.documentIds) ? body.documentIds : null;

  // Stop the loop a few seconds short of the 150s edge-function timeout so
  // we can return a clean response with progress stats instead of being
  // killed mid-batch. Caller just re-invokes — already-backfilled docs are
  // skipped on the next pass.
  const startedAt    = Date.now();
  const TIMEOUT_MS   = 140_000;

  // 1. Pull candidate documents — only those with a file in Storage that
  //    HAVEN'T already been backfilled with full text.
  //    A document is considered "done" once any of its chunks contains the
  //    "--- FULL DOCUMENT TEXT ---" marker (written by buildRagText below).
  let q = supabaseAdmin
    .from("documents")
    .select("id, container_id, document_type, storage_path, mime_type, file_name, ai_data")
    .not("storage_path", "is", null)
    .order("created_at", { ascending: true })
    .limit(Math.max(limit, 500));   // overfetch — filter narrows it down

  if (targetIds && targetIds.length > 0) q = q.in("id", targetIds);

  const { data: docs, error: docsErr } = await q;
  if (docsErr) {
    return new Response(
      JSON.stringify({ ok: false, error: `documents query failed: ${docsErr.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  const allCandidates = (docs ?? []) as DocRow[];

  // Find document_ids that already have a full-text chunk. ilike + DISTINCT
  // would be ideal but PostgREST doesn't support DISTINCT directly, so we
  // pull matching rows and dedupe in memory.
  //
  // When force=true we skip this query entirely and reprocess every candidate.
  // Safe to do because processOne is idempotent (delete-then-insert per
  // document_id) — re-running just rebuilds the chunks with the latest text
  // extraction + the current container_id linkage from portix.documents.
  const FULL_TEXT_MARKER = "--- FULL DOCUMENT TEXT ---";
  let alreadyDone = new Set<string>();
  if (!force && allCandidates.length > 0) {
    const ids = allCandidates.map((d) => d.id);
    const { data: doneChunks, error: chunkErr } = await supabaseAdmin
      .from("document_chunks")
      .select("document_id")
      .in("document_id", ids)
      .ilike("content", `%${FULL_TEXT_MARKER}%`);
    if (chunkErr) {
      console.warn(`[backfill-documents] done-chunks query failed: ${chunkErr.message}`);
    } else {
      alreadyDone = new Set(
        (doneChunks ?? [])
          .map((r: { document_id: string | null }) => r.document_id)
          .filter((id): id is string => !!id),
      );
    }
  }

  // Filter + cap by requested limit. When force=true the alreadyDone set
  // stays empty so every candidate is reprocessed.
  const candidates = force
    ? allCandidates.slice(0, limit)
    : allCandidates.filter((d) => !alreadyDone.has(d.id)).slice(0, limit);

  console.log(
    `[backfill-documents] fetched=${allCandidates.length} alreadyDone=${alreadyDone.size} ` +
    `toProcess=${candidates.length} batchSize=${batchSize} dryRun=${dryRun} force=${force}`,
  );

  if (dryRun) {
    return new Response(
      JSON.stringify({
        ok: true, dryRun: true,
        fetchedCount:     allCandidates.length,
        alreadyDoneCount: alreadyDone.size,
        toProcessCount:   candidates.length,
        sample: candidates.slice(0, 10).map((d) => ({
          id:            d.id,
          document_type: d.document_type,
          storage_path:  d.storage_path,
          file_name:     d.file_name,
        })),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // 2. Process in batches with a runtime guard.
  //    processOne already inserts per-document inside the loop, so partial
  //    progress is durable even if we bail out before the loop finishes.
  let successCount = 0;
  let errorCount   = 0;
  let timedOut     = false;
  let processed    = 0;
  const errors: Array<{ document_id: string; error: string }> = [];

  for (let i = 0; i < candidates.length; i += batchSize) {
    // Time guard — leave headroom for response serialization
    if (Date.now() - startedAt > TIMEOUT_MS) {
      timedOut = true;
      console.warn(`[backfill-documents] approaching timeout — stopping at ${processed}/${candidates.length}`);
      break;
    }

    const batch = candidates.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(processOne));
    for (const r of results) {
      processed++;
      if (r.ok) successCount++;
      else {
        errorCount++;
        errors.push({ document_id: r.id, error: r.error ?? "unknown" });
      }
    }
    console.log(`[backfill-documents] processed ${processed}/${candidates.length}`);
  }

  return new Response(
    JSON.stringify({
      ok: true,
      processedCount: processed,
      successCount,
      errorCount,
      remainingCount: Math.max(0, candidates.length - processed),
      timedOut,
      elapsedMs:      Date.now() - startedAt,
      hint: timedOut
        ? "Edge function ran out of time. Re-invoke — already-backfilled docs are skipped automatically."
        : undefined,
      errors: errors.slice(0, 50),
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
