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

const PORTY_SYSTEM_PROMPT = `You are "Porty", a helpful, friendly, and hyper-knowledgeable animated shipping container. You are an expert in global supply chain, freight forwarding, Israeli customs regulations, Incoterms, and import logistics. Answer concisely. If asked about general customs rules, answer from your knowledge. Be professional but slightly playful.`;

// ─── Gemini streaming ─────────────────────────────────────────────────────────
// SSE endpoint: returns lines like  data: {"candidates":[{"content":{"parts":[{"text":"..."}]}}]}
// We parse each event and re-emit just the text delta.

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL   =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse`;

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

  const supabaseAnon = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
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

  const geminiBody = JSON.stringify({
    systemInstruction: { parts: [{ text: PORTY_SYSTEM_PROMPT }] },
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
