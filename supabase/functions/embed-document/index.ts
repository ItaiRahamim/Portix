// Supabase Edge Function: embed-document
// Runtime: Deno
//
// Chunks document text, generates 768-dim embeddings via Gemini's
// gemini-embedding-2 model (truncated to 768 dims), and inserts rows into
// portix.document_chunks.
//
// Called by:
//   - classify-documents (fire-and-forget after ai_data is written)
//   - lib/embeddings.ts → generateAndSaveEmbeddings() (frontend backfill trigger)
//
// Request body:
//   { container_id: UUID, document_id: UUID, text: string }
//
// Response:
//   { ok: true, chunks_inserted: number }
//
// Env vars:
//   SUPABASE_URL              (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY (auto-injected — bypasses RLS for inserts)
//   GEMINI_API_KEY            Set in Dashboard → Edge Functions → Secrets

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── CORS ─────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Supabase admin client ────────────────────────────────────────────────────

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { db: { schema: "portix" }, auth: { persistSession: false } },
);

// ─── Gemini REST ──────────────────────────────────────────────────────────────

const EMBED_MODEL = "gemini-embedding-2";
// gemini-embedding-2 defaults to 3072-dim output. We pin 768 so the result
// fits portix.document_chunks.embedding (vector(768)) — change both the
// outputDimensionality below AND the column type if you want higher fidelity.
const EMBED_OUTPUT_DIM = 768;
const GEMINI_URL  = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent`;
const RETRIABLE = new Set([429, 503]);

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

async function embedChunk(text: string, apiKey: string): Promise<number[]> {
  const res = await fetchWithRetry(`${GEMINI_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      // model field required by the embedContent endpoint
      model: `models/${EMBED_MODEL}`,
      content: { parts: [{ text }] },
      // RETRIEVAL_DOCUMENT optimizes the vector for storage-side use
      // (paired with RETRIEVAL_QUERY at search time).
      taskType: "RETRIEVAL_DOCUMENT",
      outputDimensionality: EMBED_OUTPUT_DIM,
    }),
  }, 2);

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini embed HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = (await res.json()) as any;
  const values: number[] | undefined = json?.embedding?.values;
  if (!Array.isArray(values) || values.length !== EMBED_OUTPUT_DIM) {
    throw new Error(`Gemini returned unexpected embedding shape (len=${values?.length ?? "n/a"})`);
  }
  return values;
}

// ─── Chunking (mirror of lib/embeddings.ts → chunkText) ───────────────────────
// Split by paragraph (double newline). Group greedy up to maxLength chars.
// Single paragraphs longer than maxLength are hard-split on sentence boundary,
// falling back to character split as a last resort.

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
    // Hard-split paragraphs too big to fit
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

// ─── Handler ──────────────────────────────────────────────────────────────────

interface RequestBody {
  container_id?: string;
  document_id?: string;
  text?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({})) as RequestBody;
    const containerId = body.container_id;
    const documentId  = body.document_id;
    const rawText     = body.text;

    if (!containerId || !rawText?.trim()) {
      return new Response(
        JSON.stringify({ ok: false, error: "container_id and non-empty text are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
    if (!apiKey) throw new Error("GEMINI_API_KEY secret is not set");

    const chunks = chunkText(rawText, 800);
    if (chunks.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, chunks_inserted: 0, message: "No content to embed" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`[embed-document] Container ${containerId} doc ${documentId ?? "—"} → ${chunks.length} chunks`);

    // Idempotency: clear prior chunks for this document so re-uploads replace cleanly.
    if (documentId) {
      const { error: delErr } = await supabaseAdmin
        .from("document_chunks")
        .delete()
        .eq("document_id", documentId);
      if (delErr) console.warn(`[embed-document] prior-chunk delete failed: ${delErr.message}`);
    }

    // Sequential embedding to stay under Gemini per-minute quota.
    // Parallel batch would be faster but risks 429s.
    const rows: Array<{
      container_id: string;
      document_id: string | null;
      content: string;
      embedding: number[];
      chunk_index: number;
      token_count: number | null;
    }> = [];

    for (let i = 0; i < chunks.length; i++) {
      try {
        const embedding = await embedChunk(chunks[i], apiKey);
        rows.push({
          container_id: containerId,
          document_id:  documentId ?? null,
          content:      chunks[i],
          embedding,
          chunk_index:  i,
          token_count:  null,
        });
      } catch (err) {
        console.error(`[embed-document] chunk ${i} embed failed:`, (err as Error).message);
        // Skip this chunk; partial ingestion is better than total failure
      }
    }

    if (rows.length === 0) {
      return new Response(
        JSON.stringify({ ok: false, error: "All chunks failed to embed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { error: insertErr } = await supabaseAdmin
      .from("document_chunks")
      .insert(rows);

    if (insertErr) {
      throw new Error(`Insert failed: ${insertErr.message}`);
    }

    console.log(`[embed-document] Inserted ${rows.length} chunks for ${containerId}`);

    return new Response(
      JSON.stringify({ ok: true, chunks_inserted: rows.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[embed-document] Fatal:", message);
    return new Response(
      JSON.stringify({ ok: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
