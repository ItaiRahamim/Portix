// Supabase Edge Function: backfill-rag
// Runtime: Deno
//
// ONE-OFF backfill: walks portix.documents for rows where ai_data IS NOT NULL
// but no chunks exist yet in portix.document_chunks, then invokes the
// embed-document Edge Function for each so they become RAG-searchable.
//
// Invoke via curl with the service-role key:
//   curl -X POST "$SUPABASE_URL/functions/v1/backfill-rag" \
//        -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
//        -H "Content-Type: application/json" \
//        -d '{ "limit": 500, "batchSize": 5, "dryRun": false }'
//
// Body params (all optional):
//   limit      — cap on the number of documents to process this run (default 200)
//   batchSize  — concurrent embed-document calls per batch (default 5)
//   dryRun     — when true, return the candidate list without invoking embeddings
//
// Auth: requires service_role bearer in the Authorization header. We do NOT
// gate on user JWT — this is an admin tool.
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

// ─── Embed-document invocation (service-role bypass of RLS) ───────────────────

async function invokeEmbedDocument(
  containerId: string,
  documentId: string,
  text: string,
): Promise<{ ok: boolean; chunks: number; error?: string }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/embed-document`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:  `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({
        container_id: containerId,
        document_id:  documentId,
        text,
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || !payload?.ok) {
      return { ok: false, chunks: 0, error: payload?.error ?? `HTTP ${res.status}` };
    }
    return { ok: true, chunks: payload?.chunks_inserted ?? 0 };
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

  // Service-role auth gate
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ") ||
      authHeader.slice(7).trim() !== SERVICE_KEY) {
    return new Response("Unauthorized — service role required", {
      status: 401,
      headers: corsHeaders,
    });
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
        const text = buildRagText(doc.ai_data ?? {});
        if (!text) {
          return { id: doc.id, ok: false, error: "buildRagText produced empty text" };
        }
        const r = await invokeEmbedDocument(doc.container_id, doc.id, text);
        return { id: doc.id, ok: r.ok, error: r.error, chunks: r.chunks };
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
