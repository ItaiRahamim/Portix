// Supabase Edge Function: generate-claim-summary
// Runtime: Deno (Supabase Edge Functions)
//
// Generates an AI summary for one or all active claims using Google Gemini.
// Can be called:
//   - Directly for a single claim: { "claim_id": "<uuid>" }
//   - In bulk mode (no body or bulk:true): processes all non-closed claims
//     that have had message activity since their last summary.
//
// Env vars required:
//   SUPABASE_URL              (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//   GEMINI_API_KEY            Set in Dashboard → Edge Functions → Secrets

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── CORS headers ─────────────────────────────────────────────────────────────
// Required for browser clients (including localhost dev) to call this function.
// The Authorization header must be listed so the Bearer token passes through.

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

// ─── Gemini REST endpoint ─────────────────────────────────────────────────────

const FALLBACK_MODELS = ["gemini-2.5-flash", "gemini-3-flash", "gemini-2.5-pro"];
const GEMINI_BASE     = "https://generativelanguage.googleapis.com/v1beta/models";

const RETRIABLE_STATUSES = new Set([429, 503]);

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 2,
): Promise<Response> {
  let lastRes!: Response;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delayMs = Math.pow(2, attempt - 1) * 1000;
      console.warn(`[generate-claim-summary] fetchWithRetry attempt ${attempt + 1}/${maxRetries + 1} after ${delayMs}ms`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
    lastRes = await fetch(url, init);
    if (lastRes.ok || !RETRIABLE_STATUSES.has(lastRes.status)) break;
  }
  return lastRes;
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

interface ClaimRow {
  id: string;
  claim_type: string;
  description: string | null;
  amount: number | null;
  status: string;
  last_summary_at: string | null;
}

interface MessageRow {
  message: string;
  sender_role: string | null;
  created_at: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sender: { full_name: string } | null;
}

function buildPrompt(claim: ClaimRow, messages: MessageRow[]): string {
  const messageLines = messages
    .map((m) => {
      const name = m.sender?.full_name ?? m.sender_role ?? "Unknown";
      const date = new Date(m.created_at).toLocaleDateString("en-GB", {
        day: "2-digit", month: "short", year: "numeric",
      });
      return `[${date}] ${name}: ${m.message}`;
    })
    .join("\n");

  return [
    "You are an import/export logistics assistant.",
    "Summarize the status of this claim dispute objectively in 2-3 complete sentences",
    "based on the following details and messages. Be factual and concise.",
    "Do not cut off mid-sentence. Always finish your final sentence.",
    "",
    `Claim type   : ${claim.claim_type.replace(/_/g, " ")}`,
    `Claim status : ${claim.status.replace(/_/g, " ")}`,
    claim.amount != null ? `Claimed amount: $${claim.amount.toLocaleString()}` : null,
    claim.description ? `Initial description: ${claim.description}` : null,
    "",
    "Messages:",
    messageLines || "(No messages yet — this is a newly opened claim.)",
  ].filter((l) => l !== null).join("\n");
}

// ─── Gemini call ──────────────────────────────────────────────────────────────

async function callGemini(prompt: string): Promise<string> {
  const geminiBody = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: 500,  // enough for 2-3 complete sentences with headroom
      temperature: 0.3,      // low temperature = deterministic, factual output
    },
  });

  const apiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
  if (!apiKey) throw new Error("GEMINI_API_KEY secret is not set.");

  let geminiRaw = "";
  let succeeded = false;

  for (const model of FALLBACK_MODELS) {
    const url = `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`;
    const res = await fetchWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: geminiBody,
    }, 2);

    geminiRaw = await res.text();

    if (res.ok) { succeeded = true; break; }

    if (res.status === 503 || res.status === 429 || res.status === 404) {
      console.warn(`[generate-claim-summary] Model ${model} exhausted, trying next...`);
      continue;
    }

    // Any other error (400 bad prompt, 401 invalid key) — fail fast
    throw new Error(`Gemini HTTP ${res.status}: ${geminiRaw.slice(0, 400)}`);
  }

  if (!succeeded) {
    throw new Error("All Gemini models overloaded. Try again later.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(geminiRaw);
  } catch {
    throw new Error(`Gemini returned non-JSON: ${geminiRaw.slice(0, 300)}`);
  }

  // Standard Gemini response path: candidates[0].content.parts[0].text
  const text =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (parsed as any)?.candidates?.[0]?.content?.parts?.[0]?.text as string | undefined;

  if (!text?.trim()) {
    throw new Error(`Gemini response contained no text. Full response: ${geminiRaw.slice(0, 500)}`);
  }

  return text.trim();
}

// ─── Process single claim ─────────────────────────────────────────────────────

async function processClaim(
  claim: ClaimRow,
): Promise<{ ok: boolean; skipped?: string; error?: string; length?: number }> {
  // 1. Fetch messages for this claim (with sender name join)
  const { data: messages, error: msgErr } = await supabaseAdmin
    .from("claim_messages")
    .select("message, sender_role, created_at, sender:profiles!sender_id(full_name)")
    .eq("claim_id", claim.id)
    .order("created_at", { ascending: true });

  if (msgErr) {
    return { ok: false, error: `msg fetch: ${msgErr.message}` };
  }

  // 2. Change detection — skip if all messages pre-date the last summary
  if (claim.last_summary_at && messages && messages.length > 0) {
    const latestAt = (messages as MessageRow[]).at(-1)?.created_at ?? "";
    if (latestAt && latestAt <= claim.last_summary_at) {
      return { ok: true, skipped: "no new activity since last summary" };
    }
  }

  // 3. Build prompt and call Gemini
  let summary: string;
  try {
    summary = await callGemini(buildPrompt(claim, (messages ?? []) as MessageRow[]));
  } catch (geminiErr) {
    return { ok: false, error: (geminiErr as Error).message };
  }

  // 4. Persist result
  const { error: updateErr } = await supabaseAdmin
    .from("claims")
    .update({
      claim_summary: summary,
      last_summary_at: new Date().toISOString(),
    })
    .eq("id", claim.id);

  if (updateErr) {
    return { ok: false, error: `db update: ${updateErr.message}` };
  }

  return { ok: true, length: summary.length };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  // Handle CORS preflight — browsers send OPTIONS before every cross-origin POST.
  // Must be handled BEFORE any async logic so the preflight round-trip is fast.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Parse request ───────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const claimId: string | null = body?.claim_id ?? null;
    const bulkMode = !claimId;

    // ── Resolve which claims to process ────────────────────────────────────
    let claims: ClaimRow[] = [];

    if (!bulkMode) {
      console.log(`[generate-claim-summary] Single-claim mode: ${claimId}`);
      const { data, error } = await supabaseAdmin
        .from("claims")
        .select("id, claim_type, description, amount, status, last_summary_at")
        .eq("id", claimId)
        .single();
      if (error || !data) {
        return new Response(
          JSON.stringify({ ok: false, error: error?.message ?? "Claim not found" }),
          { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } },
        );
      }
      claims = [data as ClaimRow];
    } else {
      console.log("[generate-claim-summary] Bulk mode: fetching all non-closed claims");
      const { data, error } = await supabaseAdmin
        .from("claims")
        .select("id, claim_type, description, amount, status, last_summary_at")
        .not("status", "in", '("closed")');
      if (error) {
        return new Response(
          JSON.stringify({ ok: false, error: error.message }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } },
        );
      }
      claims = (data ?? []) as ClaimRow[];
    }

    console.log(`[generate-claim-summary] Processing ${claims.length} claim(s) in parallel`);

    // ── Process all claims in parallel — partial failure safe ──────────────
    const settled = await Promise.allSettled(claims.map((c) => processClaim(c)));

    const results = settled.map((r, i) => {
      const entry = {
        claim_id: claims[i].id,
        ...(r.status === "fulfilled"
          ? r.value
          : { ok: false, error: (r.reason as Error).message }),
      };
      // Log per-claim outcome
      if (entry.skipped) {
        console.log(`[generate-claim-summary] Skipped ${entry.claim_id}: ${entry.skipped}`);
      } else if (!entry.ok) {
        console.error(`[generate-claim-summary] Failed ${entry.claim_id}: ${entry.error}`);
      } else {
        console.log(`[generate-claim-summary] ✓ ${entry.claim_id} — ${entry.length} chars`);
      }
      return entry;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const successItems = results.filter((r: any) => r.ok && !r.skipped);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const failedItems  = results.filter((r: any) => !r.ok);
    const httpStatus   = failedItems.length > 0 && successItems.length > 0 ? 207 : 200;

    return new Response(
      JSON.stringify({
        ok: true,
        processed: results.length,
        results,               // backward compat
        success: successItems,
        failed:  failedItems,
      }),
      { status: httpStatus, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  } catch (err) {
    console.error("[generate-claim-summary] Fatal:", (err as Error).message);
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }
});
