// Supabase Edge Function: global-copilot
// Runtime: Deno
//
// "Porty" — the floating AI assistant available in every dashboard screen.
// Streams Gemini's text generation back to the browser as plain text deltas
// so it pairs cleanly with @ai-sdk/react useChat + TextStreamChatTransport.
//
// Request body:
//   { messages: [{ role: 'user' | 'assistant' | 'system', content?: string,
//                  parts?: [{ type: 'text', text: string }] }] }
//
// Auth: must include Authorization: Bearer <supabase_user_jwt> so anonymous
//       callers can't burn our Gemini quota. The JWT is validated by reading
//       the user via supabase.auth.getUser(); we don't actually need the user
//       data — just proof of a valid signed-in session.
//
// Env vars:
//   SUPABASE_URL              (auto-injected)
//   SUPABASE_ANON_KEY         (auto-injected)
//   GEMINI_API_KEY            Set in Dashboard → Edge Functions → Secrets

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── CORS ─────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─── System prompt (Porty persona) ────────────────────────────────────────────

const PORTY_SYSTEM_PROMPT = `You are "Porty", a helpful, friendly, and hyper-knowledgeable animated shipping container. You are an expert in global supply chain, freight forwarding, Israeli customs regulations, Incoterms, and import logistics. Answer concisely. Be professional but slightly playful.

STRICT RULES — VIOLATING ANY OF THESE IS A SEVERE ERROR:
1. NEVER mention internal database IDs, UUIDs (e.g. "e2dc0f20-1234-..."), 8-character hex tokens, document_id values, or any system metadata tag. Refer to containers only by their real ISO 6346 number (4 letters + 7 digits, e.g. MAEU1234567).
2. When the user asks about a SPECIFIC container number, cross-reference that number against the "Container Number:" line in each retrieved chunk BEFORE quoting any fact. Only quote data from chunks whose Container Number matches the one in the question.
3. If you are unsure whether a piece of information belongs to the requested container, DO NOT GUESS. Say you don't know.
4. If the retrieved context is empty or none of the chunks match the requested container, reply EXACTLY: "No information found for container <NUMBER>." — nothing else, no fallback to general knowledge for container-specific questions.
5. For generic logistics / Incoterms / customs questions that don't reference a specific container, fall back on your general knowledge.`;

// ─── ID scrub + container helpers ────────────────────────────────────────────
// Belt-and-suspenders against the LLM citing internal UUIDs / 8-char hex
// prefixes from leaked metadata. We sanitize both the retrieval context
// before injection AND rely on the system prompt to forbid the model from
// emitting them anyway.

const UUID_RE         = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const BARE_HEX_RE     = /\b[a-f0-9]{8}\b/g;
const CONTAINER_NUM_RE = /\b[A-Z]{4}\d{7}\b/g;

function scrubIdentifiers(text: string): string {
  return text
    .replace(UUID_RE, "")
    .replace(BARE_HEX_RE, "")
    // Tidy up the trailing spaces / double whitespace the substitutions leave
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +(\n)/g, "$1");
}

/** Pull every ISO 6346 container number out of arbitrary text. */
function findContainerNumbers(text: string): string[] {
  return [...new Set((text.toUpperCase().match(CONTAINER_NUM_RE) ?? []))];
}

/** Extract the first Container Number declared inside a chunk body.
 *  Returns the ISO 6346 code, the literal "ALL" (for multi-container docs
 *  like invoices/BLs that cover every container in a shipment), or null
 *  when no Container Number header is present.
 *
 *  Robust to Gemini quirks:
 *   - case-insensitive (uppercases everything first)
 *   - whitespace-tolerant inside the ID (e.g. "SEGU 9467227" → SEGU9467227)
 *   - matches synonyms like "Container No.", "Container #" */
function chunkContainerNumber(content: string): string | null {
  // Collapse all whitespace so "SEGU 9467227" matches as one token
  const upper = content.toUpperCase().replace(/[ \t]+/g, " ");
  const compact = upper.replace(/(?<=[A-Z])\s+(?=\d)/g, ""); // drop space between letters and digits
  const m = compact.match(/CONTAINER\s*(?:NUMBER|NO\.?|#)\s*:?\s*([A-Z]{4}\d{7}|ALL)/);
  return m ? m[1] : null;
}

/**
 * Streams a fixed text response back to the client in the same plain-text
 * shape the TextStreamChatTransport expects from Gemini. Used to short-circuit
 * when we know retrieval found nothing relevant — saves Gemini quota AND
 * eliminates any chance the model invents data.
 */
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

// ─── Gemini streaming ─────────────────────────────────────────────────────────
// SSE endpoint: returns lines like  data: {"candidates":[{"content":{"parts":[{"text":"..."}]}}]}
// We parse each event and re-emit just the text delta.

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL   =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse`;

// ─── Embedding model (RAG retrieval query) ───────────────────────────────────
// Must match the model + dimensionality used to populate document_chunks
// in embed-document / backfill-rag, otherwise cosine similarity is meaningless.

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
        taskType: "RETRIEVAL_QUERY",       // paired with RETRIEVAL_DOCUMENT at ingest
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
// Accepts both legacy `{role, content}` and the modern ai-sdk
// `{role, parts: [{type:'text', text}]}` shapes.

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

function toGeminiContents(messages: ClientMessage[]) {
  // Gemini expects roles 'user' | 'model'. We drop 'system' messages (the
  // system prompt is sent via systemInstruction) and remap 'assistant' → 'model'.
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: messageText(m) }],
    }))
    .filter((c) => c.parts[0].text.trim().length > 0);
}

// ─── SSE delta extractor ──────────────────────────────────────────────────────

function extractDelta(sseLine: string): string {
  // Format: "data: {json}" — strip prefix, parse, pull text out
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

// ─── Handler ──────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // 1. Auth gate — must have a valid Supabase JWT
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  // db.schema = 'portix' is REQUIRED — the RAG RPC (and every other table
  // we care about) lives in the portix schema. Without this option supabase-js
  // routes RPC calls to public.* and PostgREST 404s with
  //   "Could not find the function public.match_user_document_chunks in the schema cache".
  const supabaseAnon = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    {
      db:     { schema: "portix" },
      global: { headers: { Authorization: authHeader } },
    },
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

  // 3. Call Gemini streaming
  const apiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
  if (!apiKey) {
    return new Response("GEMINI_API_KEY not set", { status: 500, headers: corsHeaders });
  }

  // ── RAG retrieval ─────────────────────────────────────────────────────────
  // Two retrieval paths run depending on whether the user named a container:
  //
  //   A. NO container in query → similarity search via RPC (existing behaviour).
  //      Failure is non-fatal — Porty falls back to general knowledge.
  //
  //   B. Container named (e.g. SEGU9467227) → DIRECT lookup via supabaseAnon:
  //      fetch chunks where containers.container_number = ANY(requested) AND
  //      chunks tagged "Container Number: ALL" for the same shipment. This
  //      bypasses similarity entirely so a Hebrew (or otherwise low-cosine)
  //      query can't starve the response. Similarity is still run in parallel
  //      to surface anything tagged ALL that lives under a different container,
  //      and the two result sets are merged + de-duped before injection.

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Chunk = { id: string; container_id: string; document_id?: string | null; content: string; similarity?: number };

  let contextString = "";
  const lastUserText = [...messages].reverse().find((m) => m.role === "user");
  const queryText = lastUserText ? messageText(lastUserText).trim() : "";

  const requestedContainers = queryText ? findContainerNumbers(queryText) : [];
  const filterByContainer   = requestedContainers.length > 0;

  if (queryText) {
    console.log(`[global-copilot] ============ RAG START ============`);
    console.log(`[global-copilot] user=${user.id}`);
    console.log(`[global-copilot] query="${queryText.slice(0, 200)}"`);
    console.log(`[global-copilot] requestedContainers=${JSON.stringify(requestedContainers)} (count=${requestedContainers.length})`);

    const merged: Map<string, Chunk> = new Map();

    // Track which chunks came via the SHIPMENT-LEVEL lookup. Those chunks
    // bypass the content-membership filter on PATH A (similarity) — needed
    // because a single PDF gets split across pages: container ID on Page 1,
    // weights on Page 3. Strict text-filter would drop Page 3 even though
    // it logically belongs to the same document.
    const shipmentChunkIds = new Set<string>();

    // PATH B: SHIPMENT-LEVEL retrieval — primary path when filter requested
    if (filterByContainer) {
      try {
        // 1. Resolve container_numbers → matched container rows (+ shipment_id).
        //    Container numbers in DB are uppercase per create_shipment_with_containers;
        //    requestedContainers are already uppercased by findContainerNumbers().
        console.log(`[global-copilot] PATH B (shipment-level): containers.in("container_number", ${JSON.stringify(requestedContainers)})`);
        const { data: ctrs, error: ctrErr } = await supabaseAnon
          .from("containers")
          .select("id, container_number, shipment_id")
          .in("container_number", requestedContainers);

        if (ctrErr) {
          console.error(`[global-copilot] PATH B container lookup error: ${ctrErr.message}`);
        } else {
          console.log(`[global-copilot] PATH B matched containers: ${JSON.stringify((ctrs ?? []).map((c: { id: string; container_number: string }) => ({ id: c.id.slice(0,8), num: c.container_number })))}`);
          const matchedIds  = (ctrs ?? []).map((c: { id: string }) => c.id);
          const shipmentIds = [...new Set((ctrs ?? []).map((c: { shipment_id: string | null }) => c.shipment_id).filter(Boolean) as string[])];
          console.log(`[global-copilot] PATH B matchedIds=${matchedIds.length} shipmentIds=${shipmentIds.length}`);

          if (matchedIds.length === 0) {
            const refusal = requestedContainers.length === 1
              ? `No information found for container ${requestedContainers[0]}.`
              : `No information found for containers ${requestedContainers.join(", ")}.`;
            console.log(`[global-copilot] short-circuit (no visible containers): ${refusal}`);
            return streamFixedText(refusal);
          }

          // 2. Sibling expansion: every container that shares a shipment_id
          //    with one of the matched containers. RLS scopes the result to
          //    siblings the caller can actually see — anything the user
          //    doesn't own is silently dropped at the row-security layer.
          let siblingIds: string[] = matchedIds;
          if (shipmentIds.length > 0) {
            const { data: siblings, error: sErr } = await supabaseAnon
              .from("containers")
              .select("id")
              .in("shipment_id", shipmentIds);

            if (sErr) {
              console.error(`[global-copilot] PATH B sibling lookup error: ${sErr.message}`);
            } else {
              siblingIds = [...new Set([...matchedIds, ...(siblings ?? []).map((c: { id: string }) => c.id)])];
            }
          }
          console.log(`[global-copilot] PATH B shipment-scope container_ids: ${siblingIds.length}`);

          // 3a. Fetch EVERY chunk whose container_id is in the shipment scope.
          const { data: shipChunks, error: scErr } = await supabaseAnon
            .from("document_chunks")
            .select("id, container_id, document_id, content")
            .in("container_id", siblingIds)
            .limit(80);

          if (scErr) {
            console.error(`[global-copilot] PATH B shipment-chunk (by container) error: ${scErr.message}`);
          } else {
            const arr = (shipChunks ?? []) as Chunk[];
            for (const c of arr) {
              merged.set(c.id, c);
              shipmentChunkIds.add(c.id);
            }
            console.log(`[global-copilot] PATH B chunks via container_id: ${arr.length}`);
            arr.slice(0, 3).forEach((c, i) => {
              const head       = String(c.content ?? "").replace(/\s+/g, " ").slice(0, 250);
              const detectedCn = chunkContainerNumber(String(c.content ?? ""));
              console.log(`[global-copilot]   ship-byctr[${i}] container_id=${c.container_id.slice(0,8)} detectedCn=${detectedCn} content_head="${head}"`);
            });
          }

          // 3b. Documents-pivot: even when chunks.container_id is wrong/null,
          //     the document_id still points at portix.documents, which always
          //     has the right container_id. Walk:
          //       documents (container_id IN siblings) → doc_ids
          //       chunks (document_id IN doc_ids)
          //     This catches chunks whose container_id linkage drifted from
          //     the underlying document (e.g. shipment-level uploads where
          //     the original document.container_id was reassigned).
          const { data: shipDocs, error: sdErr } = await supabaseAnon
            .from("documents")
            .select("id, container_id")
            .in("container_id", siblingIds);

          if (sdErr) {
            console.error(`[global-copilot] PATH B documents lookup error: ${sdErr.message}`);
          } else {
            const docIds = (shipDocs ?? []).map((d: { id: string }) => d.id);
            console.log(`[global-copilot] PATH B documents in shipment: ${docIds.length}`);
            if (docIds.length > 0) {
              const { data: docChunks, error: dcErr } = await supabaseAnon
                .from("document_chunks")
                .select("id, container_id, document_id, content")
                .in("document_id", docIds)
                .limit(80);

              if (dcErr) {
                console.error(`[global-copilot] PATH B shipment-chunk (by document) error: ${dcErr.message}`);
              } else {
                const arr = (docChunks ?? []) as Chunk[];
                let added = 0;
                for (const c of arr) {
                  if (!merged.has(c.id)) added++;
                  merged.set(c.id, c);
                  shipmentChunkIds.add(c.id);
                }
                console.log(`[global-copilot] PATH B chunks via document_id: ${arr.length} (new=${added})`);
                arr.slice(0, 3).forEach((c, i) => {
                  const head       = String(c.content ?? "").replace(/\s+/g, " ").slice(0, 250);
                  const detectedCn = chunkContainerNumber(String(c.content ?? ""));
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const did        = (c as any).document_id ? String((c as any).document_id).slice(0,8) : "?";
                  console.log(`[global-copilot]   ship-bydoc[${i}] document_id=${did} container_id=${c.container_id?.slice(0,8) ?? "null"} detectedCn=${detectedCn} content_head="${head}"`);
                });
              }
            }
          }
        }
      } catch (e) {
        console.error(`[global-copilot] PATH B exception: ${(e as Error).message}`);
      }
    }

    // PATH A: Similarity search — supplemental, especially for the
    // non-container case AND for picking up chunks that may live OUTSIDE the
    // shipment scope (e.g. a generic logistics question, or a stray reference).
    const queryEmbedding = await embedQuery(queryText, apiKey);
    if (!queryEmbedding) {
      console.error("[global-copilot] PATH A embedQuery returned null — skipping similarity step");
    } else {
      console.log(`[global-copilot] PATH A queryEmbedding ready (len=${queryEmbedding.length})`);
      const matchCount = filterByContainer ? 20 : 8;
      const { data: simChunks, error: rpcErr } = await supabaseAnon
        .rpc("match_user_document_chunks", {
          query_embedding: queryEmbedding,
          match_threshold: 0.5,
          match_count:     matchCount,
        });

      if (rpcErr) {
        console.error(`[global-copilot] PATH A similarity RPC error: ${rpcErr.message}`);
      } else {
        const rawArr = (simChunks ?? []) as Chunk[];
        console.log(`[global-copilot] PATH A similarity returned: ${rawArr.length} (threshold=0.5, count=${matchCount})`);
        rawArr.slice(0, 3).forEach((c, i) => {
          const head       = String(c.content ?? "").replace(/\s+/g, " ").slice(0, 200);
          const detectedCn = chunkContainerNumber(String(c.content ?? ""));
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const sim        = (c as any).similarity;
          console.log(`[global-copilot]   sim[${i}] sim=${typeof sim === "number" ? sim.toFixed(3) : "?"} detectedCn=${detectedCn} content_head="${head}"`);
        });

        // Filter logic:
        //   - If container was named AND chunk wasn't already pulled via the
        //     shipment-level lookup, keep it only when its body contains a
        //     requested number / "ALL" marker. This prevents leakage from
        //     OTHER shipments the user can see.
        //   - Chunks already in shipmentChunkIds pass through unconditionally
        //     (they're shipment-scoped — page-break safe).
        //   - No container in query → keep everything.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let usableSim: any[] = rawArr;
        if (filterByContainer) {
          const wanted = requestedContainers.map((s) => s.toUpperCase());
          usableSim = rawArr.filter((c) => {
            if (shipmentChunkIds.has(c.id)) return true;
            const upper = String(c.content ?? "").toUpperCase();
            return wanted.some((w) => upper.includes(w))
                || /\bCONTAINER\s*(?:NUMBER|NO\.?|#)?\s*:?\s*ALL\b/.test(upper);
          });
          console.log(`[global-copilot] PATH A similarity after filter: ${usableSim.length}/${rawArr.length}`);
        }
        for (const c of usableSim as Chunk[]) merged.set(c.id, c);
      }
    }

    // Final assemble — cap at 40 so the model gets the full doc set.
    const chunksOut = [...merged.values()].slice(0, 40);
    console.log(`[global-copilot] MERGED chunksOut=${chunksOut.length}`);
    chunksOut.slice(0, 5).forEach((c, i) => {
      const upper      = String(c.content ?? "").toUpperCase();
      const detectedCn = chunkContainerNumber(String(c.content ?? ""));
      const bodyHits   = requestedContainers.filter((rc) => upper.includes(rc));
      const viaShip    = shipmentChunkIds.has(c.id);
      console.log(`[global-copilot]   merged[${i}] container_id=${c.container_id.slice(0,8)} detectedCn=${detectedCn} viaShip=${viaShip} bodyMentions=${JSON.stringify(bodyHits)}`);
    });

    if (filterByContainer && chunksOut.length === 0) {
      const refusal = requestedContainers.length === 1
        ? `No information found for container ${requestedContainers[0]}.`
        : `No information found for containers ${requestedContainers.join(", ")}.`;
      console.log(`[global-copilot] short-circuit (no chunks after merge): ${refusal}`);
      return streamFixedText(refusal);
    }

    contextString = chunksOut
      .map((c) => {
        const realCn = chunkContainerNumber(String(c.content ?? "")) ?? "unknown";
        const txt    = String(c.content ?? "").replace(/\s+/g, " ").trim().slice(0, 800);
        return `- [container ${realCn}] ${txt}`;
      })
      .join("\n");

    console.log(`[global-copilot] ============ RAG END (hits=${chunksOut.length}) ============`);
  }

  // Final scrub — even if a chunk body contains a stray UUID / 8-hex token,
  // strip it before the model ever sees it. This is the second line of defence;
  // the system prompt forbids the model from emitting these strings too.
  contextString = scrubIdentifiers(contextString);

  console.log(
    "[global-copilot] Injected Context (length=" + contextString.length + "):\n" +
    (contextString || "(empty — model will use general knowledge only)"),
  );

  // Build an ALL-semantics instruction tailored to which container(s) the
  // user actually asked about. Only included when the user named a container.
  const allClause = filterByContainer
    ? (requestedContainers.length === 1
        ? `If a chunk says "Container Number: ALL", it applies to ALL containers in the shared shipment/invoice/B/L — including ${requestedContainers[0]}. Treat data from such chunks as relevant to ${requestedContainers[0]}.`
        : `If a chunk says "Container Number: ALL", it applies to EVERY container in the shared shipment/invoice/B/L — including ${requestedContainers.join(", ")}. Treat data from such chunks as relevant to each requested container.`)
    : `If a chunk says "Container Number: ALL", it applies to every container in that shipment/invoice/B/L.`;

  const systemPromptWithRag = contextString
    ? [
        PORTY_SYSTEM_PROMPT,
        "",
        "You will be provided with document chunks for the ENTIRE shipment that contains the requested container — not just chunks that mention the container number verbatim. PDFs are split across pages, so the container number may appear on Page 1 while its tare/gross weights, seal, or HS code appear on Page 3 in a separate chunk. You MUST read across chunks and reason about the document as a whole: match Bill of Lading numbers, document numbers, and positional order to connect a container ID in one chunk to the figures in another.",
        "",
        "Cross-referencing rules:",
        "1. If a chunk explicitly says 'Container Number: X' (or 'ALL'), data in that chunk belongs to container X (or to every container in the document).",
        "2. If a chunk has no container header but is part of the same Bill of Lading / invoice / packing list as a chunk that does identify the container, treat the figures as belonging to that container UNLESS another container number appears between them.",
        "3. When a multi-container document lists per-container rows (e.g. a table with container number + tare + cargo weight per row), match the requested container to its specific row.",
        "4. If after cross-referencing you still cannot confidently attribute a figure to the requested container, say so honestly — do not guess.",
        allClause,
        "Refer to containers by their ISO container number (e.g. MAEU1234567) — never by internal IDs.",
        "",
        "RETRIEVED CONTEXT:",
        contextString,
      ].join("\n")
    : PORTY_SYSTEM_PROMPT;

  const geminiBody = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPromptWithRag }] },
    contents:          toGeminiContents(messages),
    generationConfig: {
      maxOutputTokens: 800,
      temperature:     0.7,
    },
  });

  const upstream = await fetch(`${GEMINI_URL}&key=${apiKey}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    geminiBody,
  });

  if (!upstream.ok || !upstream.body) {
    const errBody = await upstream.text();
    console.error(`[global-copilot] Gemini HTTP ${upstream.status}: ${errBody.slice(0, 400)}`);
    return new Response(`Upstream error: ${upstream.status}`, {
      status: 502,
      headers: corsHeaders,
    });
  }

  // 4. Re-emit Gemini SSE as a plain text stream of deltas.
  //    @ai-sdk/react TextStreamChatTransport just concatenates the chunks.
  const reader  = upstream.body.getReader();
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

          // SSE events are separated by blank lines (\n\n). Each event may
          // contain multiple "data:" lines but Gemini only sends one per event.
          let idx: number;
          while ((idx = pending.indexOf("\n\n")) !== -1) {
            const eventBlock = pending.slice(0, idx);
            pending = pending.slice(idx + 2);
            // Each line of the block — handle "data:" prefixed entries
            for (const line of eventBlock.split("\n")) {
              const delta = extractDelta(line.trim());
              if (delta) controller.enqueue(encoder.encode(delta));
            }
          }
        }
        // Drain any final unterminated event
        if (pending.trim()) {
          for (const line of pending.split("\n")) {
            const delta = extractDelta(line.trim());
            if (delta) controller.enqueue(encoder.encode(delta));
          }
        }
      } catch (e) {
        console.error("[global-copilot] stream error:", (e as Error).message);
      } finally {
        controller.close();
      }
    },
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
});
