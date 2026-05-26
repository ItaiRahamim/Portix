// Supabase Edge Function: global-copilot
// Runtime: Deno
//
// "Porty" — the floating AI assistant available in every dashboard screen.
// Streams Gemini's text generation back to the browser as plain text deltas
// so it pairs cleanly with @ai-sdk/react useChat + TextStreamChatTransport.
//
// Architecture: AGENTIC RAG via Gemini function calling.
//   • Phase 1 (non-streaming :generateContent, up to 3 rounds): the model
//     decides whether to call get_live_containers_summary and/or
//     search_container_documents. We execute the calls and feed results
//     back as functionResponse parts until the model produces final text.
//   • Phase 2 (:streamGenerateContent?alt=sse): the same conversation
//     including all tool calls + responses is re-sent for streaming,
//     so the answer streams to the UI under the same plain-text contract
//     TextStreamChatTransport already expects.
//
// Request body:
//   { messages: [{ role: 'user' | 'assistant' | 'system', content?: string,
//                  parts?: [{ type: 'text', text: string }] }] }
//
// Auth: must include Authorization: Bearer <supabase_user_jwt> so anonymous
//       callers can't burn our Gemini quota.
//
// Env vars:
//   SUPABASE_URL                (auto-injected)
//   SUPABASE_ANON_KEY           (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY   (auto-injected)
//   GEMINI_API_KEY              Set in Dashboard → Edge Functions → Secrets

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── CORS ─────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─── System prompt (Porty persona, tool-using mode) ──────────────────────────

const PORTY_SYSTEM_PROMPT = `You are "Porty", a helpful, friendly, and hyper-knowledgeable animated shipping container. You are an expert in global supply chain, freight forwarding, Israeli customs regulations, Incoterms, and import logistics. Answer concisely. Be professional but slightly playful.

STRICT RULES — VIOLATING ANY OF THESE IS A SEVERE ERROR:
1. NEVER mention internal database IDs, UUIDs (e.g. "e2dc0f20-1234-..."), 8-character hex tokens, document_id values, or any system metadata tag. Refer to containers only by their real ISO 6346 number (4 letters + 7 digits, e.g. MAEU1234567).
2. When the user asks about a SPECIFIC container number, only quote data from chunks whose Container Number matches that one (or "ALL" for shipment-wide chunks).
3. If you are unsure whether a piece of information belongs to the requested container, DO NOT GUESS. Say you don't know.
4. For generic logistics / Incoterms / customs questions that don't reference the user's data, answer directly from your general knowledge — no tool call needed.

TOOL USE — you have two tools available:

• get_live_containers_summary — call FIRST whenever the question involves counting, listing, filtering, status overviews, vessels, ETAs, ports, importers, suppliers, or anything about the user's container fleet at a high level. Returns every container the caller can see, with product / vessel / status / ETA / ETD / ports / importer name / supplier name. Counting, listing and filtering MUST be answered from this tool's output — never from document chunks (chunks are incomplete).

• search_container_documents — call when the user asks about granular document content: cargo weights, tare weights, gross weights, carton/pallet counts, supplier names, HS codes, invoice amounts, seal numbers, certificate dates, missing documents, or any specific fact extracted from PDFs. Pass container_numbers to scope to one or more ISO codes. Omit container_numbers for fleet-wide semantic search.

CONTEXTUAL DEDUCTION — never blindly translate or guess at product/commodity names. When the user asks about a product (in any language, slang, or abbreviation), ALWAYS call get_live_containers_summary FIRST to see the exact product names that exist in the database. Use your native trade knowledge and linguistic intelligence to map the user's informal term to the closest matching database value. Only then call search_container_documents with the correct canonical term you observed in the live data.

ZOOM OUT FALLBACK — if your first specific search_query (e.g., "net weight", "N.W") yields chunks that do not contain the answer, do NOT just try more synonyms. Instead, zoom out: your next search_query should name the TYPE of document where this data lives (e.g., search_query: "Bill of Lading, Packing List, Commercial Invoice"). This retrieves raw document chunks so you can scan them directly for the missing value. One specific attempt + one zoom-out attempt is sufficient before stopping.

FAIL-SAFE — if you cannot find the exact requested data after the zoom-out scan, stop searching. Politely inform the user that you scanned the relevant documents (name the document types you checked, e.g., "I scanned the Packing Lists and Bill of Lading") but the specific data point is missing or not legible in the uploaded documents. Never invent numbers.

Hybrid questions ("list my red onion containers and their tare weights") require TWO calls: first get_live_containers_summary to identify which containers match, then search_container_documents with those container_numbers to get the weights.

If a tool returns { "error": "No visible containers ..." } or { "error": "No documents found ..." }, surface that message verbatim to the user — do not invent data and do not fall back to general knowledge for that specific container.

Never emit UUIDs, document_ids, shipment_ids, or any 8-character hex prefix. Refer to containers only by their ISO 6346 number.`;

// ─── ID scrub + container helpers ────────────────────────────────────────────

const UUID_RE         = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const BARE_HEX_RE     = /\b[a-f0-9]{8}\b/g;
const CONTAINER_NUM_RE = /\b[A-Z]{4}\d{7}\b/g;

function scrubIdentifiers(text: string): string {
  return text
    .replace(UUID_RE, "")
    .replace(BARE_HEX_RE, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +(\n)/g, "$1");
}

/** Pull every ISO 6346 container number out of arbitrary text. */
function findContainerNumbers(text: string): string[] {
  return [...new Set((text.toUpperCase().match(CONTAINER_NUM_RE) ?? []))];
}

/**
 * Extract meaningful keywords from a search_query for the relational pull
 * ilike filter. Returns at most 5 tokens (stop-words stripped). Used to
 * prioritise chunks that actually contain the answer over T&C boilerplate.
 */
function extractRelKeywords(query: string): string[] {
  const STOP = new Set([
    "the", "and", "for", "what", "this", "that", "with", "from", "are",
    "have", "its", "per", "how", "much", "many", "can", "you", "show",
    "tell", "give", "get", "all", "any", "whats", "please",
  ]);
  const tokens = query
    .toLowerCase()
    .split(/[\s,./\\()\[\]{}:;'"!?]+/)
    .filter((t) => t.length > 2 && !STOP.has(t))
    .slice(0, 5);
  return [...new Set(tokens)];
}

/** Extract the first Container Number declared inside a chunk body. */
function chunkContainerNumber(content: string): string | null {
  const upper = content.toUpperCase().replace(/[ \t]+/g, " ");
  const compact = upper.replace(/(?<=[A-Z])\s+(?=\d)/g, "");
  const m = compact.match(/CONTAINER\s*(?:NUMBER|NO\.?|#)\s*:?\s*([A-Z]{4}\d{7}|ALL)/);
  return m ? m[1] : null;
}

/** Stream a fixed text response (used for handler-level error fallbacks). */
function streamFixedText(text: string): Response {
  const encoder = new TextEncoder();
  const stream  = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(encoder.encode(text)); c.close(); },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type":      "text/plain; charset=utf-8",
      "Cache-Control":     "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

// ─── Gemini endpoints + embedding ────────────────────────────────────────────

const GEMINI_MODEL      = "gemini-2.5-flash";
const GEMINI_STREAM_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse`;
const GEMINI_NONSTREAM_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const EMBED_MODEL      = "gemini-embedding-2";
const EMBED_OUTPUT_DIM = 768;
const EMBED_URL        =
  `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent`;

async function embedQuery(text: string, apiKey: string): Promise<number[] | null> {
  try {
    const res = await fetch(`${EMBED_URL}?key=${apiKey}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        model:   `models/${EMBED_MODEL}`,
        content: { parts: [{ text }] },
        taskType: "RETRIEVAL_QUERY",
        outputDimensionality: EMBED_OUTPUT_DIM,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[global-copilot] embed HTTP ${res.status}: ${body.slice(0, 200)}`);
      return null;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = (await res.json()) as any;
    const values: number[] | undefined = json?.embedding?.values;
    if (!Array.isArray(values) || values.length !== EMBED_OUTPUT_DIM) return null;
    return values;
  } catch (e) {
    console.error("[global-copilot] embed failed:", (e as Error).message);
    return null;
  }
}

// ─── Message normalization ────────────────────────────────────────────────────

interface ClientMessage {
  role: "user" | "assistant" | "system";
  content?: string;
  parts?: Array<{ type: string; text?: string }>;
}

function messageText(m: ClientMessage): string {
  if (typeof m.content === "string" && m.content.trim()) return m.content;
  if (Array.isArray(m.parts)) {
    return m.parts
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("");
  }
  return "";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GeminiPart = { text?: string; functionCall?: { name: string; args?: any }; functionResponse?: { name: string; response: any } };
type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

function toGeminiContents(messages: ClientMessage[]): GeminiContent[] {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: (m.role === "assistant" ? "model" : "user") as "user" | "model",
      parts: [{ text: messageText(m) }] as GeminiPart[],
    }))
    .filter((c) => (c.parts[0].text ?? "").trim().length > 0);
}

// ─── SSE delta extractor (phase 2 only — pure text) ──────────────────────────

function extractDelta(sseLine: string): string {
  if (!sseLine.startsWith("data:")) return "";
  const payload = sseLine.slice(5).trim();
  if (!payload || payload === "[DONE]") return "";
  try {
    const obj = JSON.parse(payload);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const candidates = (obj as any)?.candidates;
    if (!Array.isArray(candidates) || candidates.length === 0) return "";
    const parts = candidates[0]?.content?.parts;
    if (!Array.isArray(parts)) return "";
    return parts
      .map((p: { text?: string }) => p?.text ?? "")
      .join("");
  } catch {
    return "";
  }
}

// ─── Tool declarations (sent to Gemini, drive function calling) ──────────────

const TOOL_DECLARATIONS = {
  functionDeclarations: [
    {
      name: "get_live_containers_summary",
      description:
        "Use this FIRST for any question about how many containers, which containers, status overviews, vessels, ETAs, ports, importers, suppliers, or anything that asks about the user's container fleet as a whole. Returns ALL containers the caller can see. Counting / listing / filtering MUST be answered from this data — never from document chunks.",
      parameters: {
        type: "OBJECT",
        properties: {},
        required: [] as string[],
      },
    },
    {
      name: "search_container_documents",
      description:
        "Use this for granular document-level details: cargo weights, tare/gross weights, carton or pallet counts, supplier names, HS codes, invoice amounts, seal numbers, certificate dates, missing documents, or any specific fact extracted from PDFs. Pass container_numbers to scope to specific ISO codes (recommended whenever the user named a container). Omit container_numbers for fleet-wide semantic search. Use your trade expertise to formulate the best search_query — shipping documents use varied terminology and abbreviations, so include synonyms and alternate forms to maximise recall.",
      parameters: {
        type: "OBJECT",
        properties: {
          search_query: {
            type: "STRING",
            description:
              "Natural-language question / topic to retrieve. Used both for vector search and as the user-intent anchor.",
          },
          container_numbers: {
            type: "ARRAY",
            items: { type: "STRING" },
            description:
              "Optional. ISO 6346 codes (4 letters + 7 digits) to restrict the search. If empty/omitted, search spans every container the caller can see.",
          },
        },
        required: ["search_query"],
      },
    },
  ],
};

// ─── Tool runners ─────────────────────────────────────────────────────────────

async function toolGetLiveContainers(
  supabaseAnon: SupabaseClient,
): Promise<unknown> {
  // Use v_containers — the pre-joined dashboard view (shipments + profiles).
  // Avoids the column-not-found crashes that hit when querying containers
  // directly (e.g. there is no `product` or `vessel` column on containers
  // — those live as `product_name` on containers and `vessel_name` on
  // shipments). The view also already carries the carrier (00331) and
  // bl_number (00327) fields, which may help future questions.
  const { data, error } = await supabaseAnon
    .from("v_containers")
    .select(
      `container_number, product_name, hs_code, vessel_name, status,
       eta, etd, port_of_loading, port_of_destination, origin_country,
       importer_company, supplier_company, shipment_number`,
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error(`[global-copilot] toolGetLiveContainers error: ${error.message}`);
    return { error: error.message };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data ?? []) as any[];
  return {
    count: rows.length,
    containers: rows.map((c) => ({
      container_number: c.container_number,
      product:          c.product_name,
      hs_code:          c.hs_code,
      vessel:           c.vessel_name,
      status:           c.status,
      etd:              c.etd,
      eta:              c.eta,
      port_of_loading:      c.port_of_loading,
      port_of_destination:  c.port_of_destination,
      origin_country:       c.origin_country,
      importer:             c.importer_company,
      supplier:             c.supplier_company,
      shipment_number:      c.shipment_number,
    })),
  };
}

async function toolSearchDocuments(
  args: { search_query?: string; container_numbers?: string[] },
  supabaseAnon: SupabaseClient,
  supabaseAdmin: SupabaseClient,
  apiKey: string,
): Promise<unknown> {
  const q = String(args?.search_query ?? "").trim();
  if (!q) return { error: "search_query is required" };

  const requested = (args?.container_numbers ?? [])
    .map((s) => String(s ?? "").toUpperCase())
    .filter((s) => /^[A-Z]{4}\d{7}$/.test(s));

  // Privacy boundary: resolve container_numbers → live UUIDs via supabaseAnon.
  let containerIds: string[] = [];
  if (requested.length > 0) {
    const { data: matched, error: mErr } = await supabaseAnon
      .from("containers")
      .select("id, container_number, shipment_id")
      .in("container_number", requested);
    if (mErr) {
      console.error(`[global-copilot] toolSearchDocuments resolve error: ${mErr.message}`);
      return { error: mErr.message };
    }
    if (!matched || matched.length === 0) {
      return {
        error:
          `No visible containers matching: ${requested.join(", ")}. ` +
          `Surface this verbatim to the user.`,
      };
    }
    // Expand to siblings in same shipment(s) for cross-document page-split coverage.
    const shipIds = [
      ...new Set(
        (matched as Array<{ shipment_id: string | null }>)
          .map((m) => m.shipment_id)
          .filter(Boolean) as string[],
      ),
    ];
    containerIds = (matched as Array<{ id: string }>).map((m) => m.id);
    if (shipIds.length > 0) {
      const { data: sibs } = await supabaseAnon
        .from("containers")
        .select("id")
        .in("shipment_id", shipIds);
      containerIds = [
        ...new Set([
          ...containerIds,
          ...(((sibs ?? []) as Array<{ id: string }>).map((s) => s.id)),
        ]),
      ];
    }
    console.log(
      `[global-copilot] toolSearchDocuments scoped: requested=${requested.length} containerIds(w/siblings)=${containerIds.length}`,
    );
  }

  const embedding = await embedQuery(q, apiKey);
  if (!embedding) return { error: "embedding failed" };

  // Similarity RPC — RPC enforces auth.uid() server-side; scoped to caller.
  const { data: simChunks, error: rpcErr } = await supabaseAnon.rpc(
    "match_user_document_chunks",
    {
      query_embedding: embedding,
      match_threshold: 0.4,
      match_count: containerIds.length > 0 ? 30 : 12,
    },
  );
  if (rpcErr) {
    console.error(`[global-copilot] toolSearchDocuments RPC error: ${rpcErr.message}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let results = ((simChunks ?? []) as any[]).map((c) => ({
    id: c.id as string,
    container_id: c.container_id as string,
    document_id: c.document_id as string,
    content: String(c.content ?? ""),
    similarity: typeof c.similarity === "number" ? c.similarity : 0,
  }));

  // Relational pull (two-pass): if container_numbers given, pull chunks from
  // those containers. A blind LIMIT grabs T&C boilerplate first and buries
  // the weight/measurement chunks. Fix: keyword-filtered Pass 1 first so the
  // most relevant chunks always make the 60-chunk cap.
  if (containerIds.length > 0) {
    const relKeywords = extractRelKeywords(q);
    const seenRel = new Set(results.map((r) => r.id));

    // Pass 1 — targeted: fetch chunks whose content matches the query keywords.
    // Uses OR ilike across all tokens so any matching chunk is included.
    if (relKeywords.length > 0) {
      const filterExpr = relKeywords.map((k) => `content.ilike.%${k}%`).join(",");
      const { data: targeted, error: tErr } = await supabaseAdmin
        .from("document_chunks")
        .select("id, container_id, document_id, content")
        .in("container_id", containerIds)
        .or(filterExpr)
        .limit(40);
      if (tErr) {
        console.error(`[global-copilot] toolSearchDocuments rel targeted error: ${tErr.message}`);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const c of ((targeted ?? []) as any[])) {
          if (!seenRel.has(c.id)) {
            results.push({
              id: c.id,
              container_id: c.container_id,
              document_id: c.document_id,
              content: String(c.content ?? ""),
              similarity: 0.01, // rank above unfiltered fallback chunks
            });
            seenRel.add(c.id);
          }
        }
      }
    }

    // Pass 2 — unfiltered fallback: fill remaining slots with general chunks.
    // Over-fetch by seenRel.size to compensate for dedup losses.
    const remaining = 60 - results.length;
    if (remaining > 0) {
      const { data: fallback, error: fErr } = await supabaseAdmin
        .from("document_chunks")
        .select("id, container_id, document_id, content")
        .in("container_id", containerIds)
        .limit(remaining + seenRel.size);
      if (fErr) {
        console.error(`[global-copilot] toolSearchDocuments rel fallback error: ${fErr.message}`);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const c of ((fallback ?? []) as any[])) {
          if (!seenRel.has(c.id) && results.length < 60) {
            results.push({
              id: c.id,
              container_id: c.container_id,
              document_id: c.document_id,
              content: String(c.content ?? ""),
              similarity: 0,
            });
            seenRel.add(c.id);
          }
        }
      }
    }

    results = results.slice(0, 60);
  }

  if (results.length === 0) {
    return requested.length > 0
      ? { error: `No documents found for ${requested.join(", ")}. Surface this verbatim to the user.` }
      : { chunk_count: 0, chunks: [] };
  }

  console.log(`[global-copilot] toolSearchDocuments returning chunks=${results.length}`);

  return {
    chunk_count: results.length,
    chunks: results.map((c) => ({
      container_number: chunkContainerNumber(c.content) ?? "unknown",
      content: scrubIdentifiers(c.content).slice(0, 800),
      similarity: c.similarity,
    })),
  };
}

// ─── Phase 1: non-streaming generateContent + function-calling loop ──────────

interface ToolCallContext {
  supabaseAnon: SupabaseClient;
  supabaseAdmin: SupabaseClient;
  apiKey: string;
}

async function executeFunctionCall(
  name: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any,
  ctx: ToolCallContext,
): Promise<unknown> {
  console.log(`[global-copilot] tool call: ${name} args=${JSON.stringify(args).slice(0, 200)}`);
  if (name === "get_live_containers_summary") {
    return await toolGetLiveContainers(ctx.supabaseAnon);
  }
  if (name === "search_container_documents") {
    return await toolSearchDocuments(args ?? {}, ctx.supabaseAnon, ctx.supabaseAdmin, ctx.apiKey);
  }
  return { error: `Unknown tool: ${name}` };
}

async function geminiNonStreaming(
  apiKey: string,
  systemInstruction: string,
  contents: GeminiContent[],
): Promise<{ ok: true; content: GeminiContent } | { ok: false; status: number; body: string }> {
  const res = await fetch(`${GEMINI_NONSTREAM_URL}?key=${apiKey}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents,
      tools: [TOOL_DECLARATIONS],
      toolConfig: { functionCallingConfig: { mode: "AUTO" } },
      generationConfig: {
        maxOutputTokens: 2048,
        temperature:     0.7,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    return { ok: false, status: res.status, body: body.slice(0, 400) };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = (await res.json()) as any;
  const cand = json?.candidates?.[0];
  const role: "model" = "model";
  const parts: GeminiPart[] = Array.isArray(cand?.content?.parts) ? cand.content.parts : [];
  return { ok: true, content: { role, parts } };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // 1. Auth gate
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  const supabaseAnon = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    {
      db:     { schema: "portix" },
      global: { headers: { Authorization: authHeader } },
    },
  );

  // Service-role client: used ONLY inside toolSearchDocuments for chunk fetch
  // after ownership has been verified via supabaseAnon. Bypasses RLS on
  // document_chunks; safe because containerIds are pre-filtered.
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { db: { schema: "portix" } },
  );

  const { data: { user } } = await supabaseAnon.auth.getUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  // 2. Parse messages
  let body: { messages?: ClientMessage[] };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400, headers: corsHeaders });
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) {
    return new Response("messages array is required", { status: 400, headers: corsHeaders });
  }

  const apiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
  if (!apiKey) {
    return new Response("GEMINI_API_KEY not set", { status: 500, headers: corsHeaders });
  }

  // 3. Diagnostic header
  const lastUserText = [...messages].reverse().find((m) => m.role === "user");
  const queryText    = lastUserText ? messageText(lastUserText).trim() : "";
  console.log(`[global-copilot] ============ AGENTIC START ============`);
  console.log(`[global-copilot] user=${user.id}`);
  console.log(`[global-copilot] query="${queryText.slice(0, 200)}"`);
  console.log(`[global-copilot] containersInQuery=${JSON.stringify(findContainerNumbers(queryText))}`);

  // 4. Phase 1: tool-calling loop (max 3 rounds)
  const ctx: ToolCallContext = { supabaseAnon, supabaseAdmin, apiKey };
  const contents: GeminiContent[] = toGeminiContents(messages);
  const MAX_ROUNDS = 3;
  let producedText = false;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const resp = await geminiNonStreaming(apiKey, PORTY_SYSTEM_PROMPT, contents);
    if (!resp.ok) {
      console.error(`[global-copilot] phase1 round=${round} Gemini HTTP ${resp.status}: ${resp.body}`);
      return streamFixedText("I hit a temporary error reaching my brain. Please try again in a moment.");
    }

    const modelTurn = resp.content;
    const functionCalls: Array<{ name: string; args: unknown }> = [];
    let textInTurn = "";
    for (const p of modelTurn.parts) {
      if (p.functionCall?.name) {
        functionCalls.push({ name: p.functionCall.name, args: p.functionCall.args ?? {} });
      }
      if (typeof p.text === "string") {
        textInTurn += p.text;
      }
    }

    console.log(
      `[global-copilot] phase1 round=${round} functionCalls=${JSON.stringify(functionCalls.map((c) => c.name))} textLen=${textInTurn.length}`,
    );

    if (functionCalls.length === 0) {
      // Model has finished tool calls and is ready to answer.
      // DO NOT push modelTurn — contents must end at the last functionResponse
      // (or the initial user prompt if no tools were used). Phase 2 will
      // re-generate and stream the final answer fresh. Pushing the model's
      // pre-generated text here causes Phase 2 to receive a conversation that
      // already ends with the answer, so Gemini emits an empty stream.
      producedText = textInTurn.length > 0;
      break;
    }

    // Append the model turn (with functionCall parts) — required for Gemini's
    // multi-turn function-calling contract.
    contents.push(modelTurn);

    // Execute every requested call (parallel function calling), collect responses.
    const responseParts: GeminiPart[] = [];
    for (const fc of functionCalls) {
      const result = await executeFunctionCall(fc.name, fc.args, ctx);
      responseParts.push({
        functionResponse: { name: fc.name, response: result as Record<string, unknown> },
      });
    }
    contents.push({ role: "user", parts: responseParts });

    if (round === MAX_ROUNDS) {
      // Nudge the model to stop tool-calling on the next pass — phase 2 will
      // re-issue the same conversation in streaming mode.
      console.log(`[global-copilot] phase1 hit MAX_ROUNDS=${MAX_ROUNDS}, forcing answer`);
      contents.push({
        role: "user",
        parts: [{ text: "Now answer the user using the data above. Do not call any more tools." }],
      });
    }
  }

  // 5. Phase 2: stream final answer using the same conversation
  void producedText; // diagnostic only — phase 2 re-renders regardless
  const streamRes = await fetch(`${GEMINI_STREAM_URL}&key=${apiKey}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      systemInstruction: { parts: [{ text: PORTY_SYSTEM_PROMPT }] },
      contents,
      // Disable tool calling on phase 2 — we want plain text only.
      toolConfig: { functionCallingConfig: { mode: "NONE" } },
      generationConfig: {
        maxOutputTokens: 2048,
        temperature:     0.7,
      },
    }),
  });

  if (!streamRes.ok || !streamRes.body) {
    const errBody = await streamRes.text();
    console.error(`[global-copilot] phase2 Gemini HTTP ${streamRes.status}: ${errBody.slice(0, 400)}`);
    return new Response(`Upstream error: ${streamRes.status}`, {
      status: 502,
      headers: corsHeaders,
    });
  }

  const reader  = streamRes.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let pending = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true });

          let idx: number;
          while ((idx = pending.indexOf("\n\n")) !== -1) {
            const eventBlock = pending.slice(0, idx);
            pending = pending.slice(idx + 2);
            for (const line of eventBlock.split("\n")) {
              const delta = extractDelta(line.trim());
              if (delta) controller.enqueue(encoder.encode(delta));
            }
          }
        }
        if (pending.trim()) {
          for (const line of pending.split("\n")) {
            const delta = extractDelta(line.trim());
            if (delta) controller.enqueue(encoder.encode(delta));
          }
        }
      } catch (e) {
        console.error("[global-copilot] phase2 stream error:", (e as Error).message);
      } finally {
        controller.close();
      }
    },
  });

  console.log(`[global-copilot] ============ AGENTIC END (streaming phase2) ============`);

  return new Response(stream, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type":      "text/plain; charset=utf-8",
      "Cache-Control":     "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
});
