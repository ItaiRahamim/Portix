// Supabase Edge Function: update-claim-summary
// Deno runtime — replaces Next.js app/api/claims/update-summary/route.ts
//
// Bearer-token-protected webhook for external automations (n8n, Make.com, cron)
// to write an AI-generated summary to a claim row. Uses the service role key
// to bypass RLS — this is a trusted backend-to-backend call only.
//
// Input  (JSON, POST):  { claim_id: string, claim_summary: string }
// Output (JSON):        { ok: true, claim_id: string }
//
// Auth:  Authorization: Bearer {SUMMARY_API_SECRET}
//
// Env vars:
//   SUPABASE_URL              (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//   SUMMARY_API_SECRET        — Set in Dashboard → Edge Functions → Secrets

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // ── Preflight ────────────────────────────────────────────────────────────────
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // ── Bearer-token auth ─────────────────────────────────────────────────────
  const secret = Deno.env.get("SUMMARY_API_SECRET");
  const authHeader = req.headers.get("authorization") ?? "";

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }

  try {
    // ── Parse body ────────────────────────────────────────────────────────────
    let body: { claim_id?: string; claim_summary?: string };
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    const { claim_id, claim_summary } = body;

    if (!claim_id || !claim_summary) {
      return new Response(
        JSON.stringify({ error: "claim_id and claim_summary are required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    // ── Service-role Supabase client (bypasses RLS) ───────────────────────────
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { db: { schema: "portix" }, auth: { persistSession: false } },
    );

    // ── Update claim ──────────────────────────────────────────────────────────
    const { data, error } = await supabase
      .from("claims")
      .update({ claim_summary, updated_at: new Date().toISOString() })
      .eq("id", claim_id)
      .select("id")
      .single();

    if (error) {
      console.error("[update-claim-summary] Supabase error:", error.message);
      return new Response(
        JSON.stringify({ error: "Internal server error" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    if (!data) {
      return new Response(
        JSON.stringify({ error: "Claim not found" }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    return new Response(
      JSON.stringify({ ok: true, claim_id: data.id }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  } catch (err) {
    console.error("[update-claim-summary] Fatal:", (err as Error).message);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }
});
