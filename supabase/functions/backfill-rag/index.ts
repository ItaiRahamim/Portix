// Supabase Edge Function: backfill-rag
// Runtime: Deno
//
// ONE-OFF backfill: walks portix.documents for rows where ai_data IS NOT NULL
// but no chunks exist yet in portix.document_chunks, chunks the text with
// the same logic as the live ingestion pipeline, calls Gemini's
// text-embedding-004 model directly, and inserts the chunks into
// portix.document_chunks via the service-role client.
//
// Earlier version delegated to the embed-document Edge Function via an
// internal fetch — that consistently 401'd because Supabase's API gateway
// rejects unverified-JWT inter-function calls. Doing the work inline bypasses
// the gateway entirely.
//
// Invoke via curl (no auth required — see warning below):
//   curl -X POST "$SUPABASE_URL/functions/v1/backfill-rag" \
//        -H "Content-Type: application/json" \
//        -d '{ "limit": 500, "batchSize": 5, "dryRun": false }'
//
// Body params (all optional):
//   limit      — cap on the number of documents to process this run (default 200)
//   batchSize  — concurrent embed-document calls per batch (default 5)
//   dryRun     — when true, return the candidate list without invoking embeddings
//
// !!! TEMP — AUTH DISABLED !!!
// The Authorization header check is intentionally removed to make the
// one-off backfill easier to trigger. Anyone hitting this URL can burn our
// Gemini quota by spamming requests. **Re-enable auth OR delete this
// function immediately after backfill completes** — see git history
// (commit "feat(rag): one-off backfill...") for the original auth gate.
//
// IMPORTANT — Supabase's gateway still rejects requests without a JWT by
// default. To make the function actually publicly callable, deploy with:
//   npx supabase functions deploy backfill-rag --no-verify-jwt
// Without that flag, callers will get a 401 from the gateway BEFORE our
// handler runs, regardless of the code-level check being removed.
//
// Env vars:
//   SUPABASE_URL              (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY (auto-injected)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── CORS ─────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─── Admin client ─────────────────────────────────────────────────────────────

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const supabaseAdmin = createClient(
  SUPABASE_URL,
  SERVICE_KEY,
  { db: { schema: "portix" }, auth: { persistSession: false } },
);

// ─── RAG text synthesis ──────────────────────────────────────────────────────
// Keep VERBATIM in sync with the helper in
//   supabase/functions/classify-documents/index.ts
// so the backfill produces identical chunk text to the live upload pipeline.

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildRagText(doc: any): string {
  const lines: string[] = [];
  if (doc?.document_type)   lines.push(`Document Type: ${String(doc.document_type).replace(/_/g, " ")}`);
  if (doc?.document_number) lines.push(`Document Number: ${doc.document_number}`);
  if (doc?.container_number) lines.push(`Container Number: ${doc.container_number}`);
  if (doc?.carrier)          lines.push(`Carrier: ${doc.carrier}`);
  if (doc?.extractedData) {
    flattenForRag("", doc.extractedData, lines);
  } else {
    // ai_data on legacy rows may store the flat extraction directly, with no
    // nested `extractedData` key. Flatten everything except the meta fields
    // we already promoted to header lines.
    const meta = new Set(["document_type", "document_number", "container_number", "carrier"]);
    for (const [k, v] of Object.entries(doc ?? {})) {
      if (!meta.has(k)) flattenForRag(k, v, lines);
    }
  }
  return lines.join("\n\n");
}

// ─── Inline embedding pipeline ───────────────────────────────────────────────
// We previously called the embed-document Edge Function via internal fetch,
// but Supabase's gateway 401s those internal requests (even with service-role
// bearer). Doing the chunk → Gemini embed → insert work directly here
// sidesteps the gateway entirely.
//
// chunkText, embedChunk, and the insert payload shape are kept verbatim
// in sync with supabase/functions/embed-document/index.ts.

const GEMINI_EMBED_MODEL = "text-embedding-004";
const GEMINI_EMBED_URL   =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBED_MODEL}:embedContent`;
const RETRIABLE = new Set([429, 503]);
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";

async function fetchWithRetry(url: string, init: RequestInit, maxRetries = 2): Promise<Response> {
  let lastRes!: Response;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = Math.pow(2, attempt - 1) * 500;
      await new Promise((r) => setTimeout(r, delay));
    }
    lastRes = await fetch(url, init);
    if (lastRes.ok || !RETRIABLE.has(lastRes.status)) break;
  }
  return lastRes;
}

async function embedChunk(text: string): Promise<number[]> {
  const res = await fetchWithRetry(`${GEMINI_EMBED_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${GEMINI_EMBED_MODEL}`,
      content: { parts: [{ text }] },
      taskType: "RETRIEVAL_DOCUMENT",
    }),
  }, 2);

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini embed HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = (await res.json()) as any;
  const values: number[] | undefined = json?.embedding?.values;
  if (!Array.isArray(values) || values.length !== 768) {
    throw new Error(`unexpected embedding shape (len=${values?.length ?? "n/a"})`);
  }
  return values;
}

function chunkText(raw: string, maxLength = 800): string[] {
  const text = (raw ?? "").trim();
  if (!text) return [];

  const paragraphs = text
    .split(/\n{2,}/g)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

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
          for (let i = 0; i < s.length; i += maxLength) {
            chunks.push(s.slice(i, i + maxLength));
          }
          continue;
        }
        if (sbuf.length + s.length + 1 > maxLength) {
          chunks.push(sbuf);
          sbuf = s;
        } else {
          sbuf = sbuf ? `${sbuf} ${s}` : s;
        }
      }
      if (sbuf) chunks.push(sbuf);
      continue;
    }

    if (buf.length + p.length + 2 > maxLength) {
      chunks.push(buf);
      buf = p;
    } else {
      buf = buf ? `${buf}\n\n${p}` : p;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

/**
 * Chunk → embed → insert. Replaces the previous fetch('embed-document').
 * Returns { ok, chunks, error } so the batch loop can tally outcomes.
 */
async function embedAndInsertDocument(
  containerId: string,
  documentId: string,
  text: string,
): Promise<{ ok: boolean; chunks: number; error?: string }> {
  try {
    const chunks = chunkText(text, 800);
    if (chunks.length === 0) {
      return { ok: true, chunks: 0, error: "empty text" };
    }

    // Idempotency: drop any prior chunks for this document so re-runs replace cleanly
    {
      const { error: delErr } = await supabaseAdmin
        .from("document_chunks")
        .delete()
        .eq("document_id", documentId);
      if (delErr) console.warn(`[backfill-rag] prior-chunk delete failed (${documentId}): ${delErr.message}`);
    }

    const rows: Array<{
      container_id: string;
      document_id:  string;
      content:      string;
      embedding:    number[];
      chunk_index:  number;
      token_count:  number | null;
    }> = [];

    // Sequential per-chunk embedding to stay under the Gemini per-minute cap.
    // (Document-level parallelism still happens via the outer batch.)
    for (let i = 0; i < chunks.length; i++) {
      try {
        const embedding = await embedChunk(chunks[i]);
        rows.push({
          container_id: containerId,
          document_id:  documentId,
          content:      chunks[i],
          embedding,
          chunk_index:  i,
          token_count:  null,
        });
      } catch (e) {
        console.error(`[backfill-rag] chunk ${i} embed failed (${documentId}):`, (e as Error).message);
        // skip this chunk; partial ingestion is better than total failure
      }
    }

    if (rows.length === 0) {
      return { ok: false, chunks: 0, error: "all chunks failed to embed" };
    }

    const { error: insErr } = await supabaseAdmin
      .from("document_chunks")
      .insert(rows);

    if (insErr) {
      return { ok: false, chunks: 0, error: `insert failed: ${insErr.message}` };
    }

    return { ok: true, chunks: rows.length };
  } catch (e) {
    return { ok: false, chunks: 0, error: (e as Error).message };
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

interface BackfillBody {
  limit?: number;
  batchSize?: number;
  dryRun?: boolean;
}

interface DocumentRow {
  id: string;
  container_id: string;
  document_type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ai_data: Record<string, any> | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // ⚠️ AUTH TEMPORARILY DISABLED — see header comment.
  // Re-add this block (or delete the function) right after backfill is done:
  //   const authHeader = req.headers.get("Authorization") ?? "";
  //   if (!authHeader.toLowerCase().startsWith("bearer ") ||
  //       authHeader.slice(7).trim() !== SERVICE_KEY) {
  //     return new Response("Unauthorized — service role required", {
  //       status: 401, headers: corsHeaders,
  //     });
  //   }

  if (!GEMINI_API_KEY) {
    return new Response(
      JSON.stringify({ ok: false, error: "GEMINI_API_KEY secret is not set" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let body: BackfillBody = {};
  try {
    body = await req.json();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (_) {
    // empty body is fine — use defaults
  }

  const limit     = Math.max(1, Math.min(body.limit ?? 200, 5000));
  const batchSize = Math.max(1, Math.min(body.batchSize ?? 5, 20));
  const dryRun    = body.dryRun === true;

  // 1. Pull candidate documents (ai_data populated)
  const { data: docs, error: docsErr } = await supabaseAdmin
    .from("documents")
    .select("id, container_id, document_type, ai_data")
    .not("ai_data", "is", null)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (docsErr) {
    return new Response(
      JSON.stringify({ ok: false, error: `documents query failed: ${docsErr.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const candidates = (docs ?? []) as DocumentRow[];

  // 2. Filter out docs that already have chunks (skip redundant work)
  const candidateIds = candidates.map((d) => d.id);
  let alreadyEmbedded = new Set<string>();
  if (candidateIds.length > 0) {
    const { data: existing, error: chunkErr } = await supabaseAdmin
      .from("document_chunks")
      .select("document_id")
      .in("document_id", candidateIds);

    if (chunkErr) {
      console.warn(`[backfill-rag] existing-chunks query failed: ${chunkErr.message}`);
    } else {
      alreadyEmbedded = new Set(
        (existing ?? [])
          .map((r: { document_id: string | null }) => r.document_id)
          .filter((id): id is string => !!id),
      );
    }
  }

  const todo = candidates.filter((d) => !alreadyEmbedded.has(d.id));

  console.log(
    `[backfill-rag] candidates=${candidates.length} already=${alreadyEmbedded.size} todo=${todo.length} dryRun=${dryRun}`,
  );

  if (dryRun) {
    return new Response(
      JSON.stringify({
        ok: true,
        dryRun: true,
        processedCount: 0,
        candidateCount: candidates.length,
        alreadyEmbeddedCount: alreadyEmbedded.size,
        todoCount: todo.length,
        sample: todo.slice(0, 5).map((d) => ({
          document_id:   d.id,
          container_id:  d.container_id,
          document_type: d.document_type,
        })),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // 3. Process in batches
  let successCount = 0;
  let errorCount   = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const errors: Array<{ document_id: string; error: string }> = [];

  for (let i = 0; i < todo.length; i += batchSize) {
    const batch = todo.slice(i, i + batchSize);

    const results = await Promise.all(
      batch.map(async (doc) => {
        try {
          const text = buildRagText(doc.ai_data ?? {});
          if (!text) {
            return { id: doc.id, ok: false, error: "buildRagText produced empty text" };
          }
          const r = await embedAndInsertDocument(doc.container_id, doc.id, text);
          return { id: doc.id, ok: r.ok, error: r.error, chunks: r.chunks };
        } catch (e) {
          // Belt-and-suspenders: never let one bad doc kill the whole batch
          return { id: doc.id, ok: false, error: (e as Error).message };
        }
      }),
    );

    for (const r of results) {
      if (r.ok) {
        successCount++;
      } else {
        errorCount++;
        errors.push({ document_id: r.id, error: r.error ?? "unknown" });
      }
    }

    console.log(`[backfill-rag] processed ${Math.min(i + batchSize, todo.length)}/${todo.length}`);
  }

  return new Response(
    JSON.stringify({
      ok: true,
      processedCount: todo.length,
      successCount,
      errorCount,
      candidateCount: candidates.length,
      alreadyEmbeddedCount: alreadyEmbedded.size,
      errors: errors.slice(0, 50), // cap response size
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
