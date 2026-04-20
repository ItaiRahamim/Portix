import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/claims/update-summary
 *
 * Bearer-token-protected webhook for nightly AI-generated claim summaries.
 * Called by an external automation (n8n, cron, Make.com, etc.).
 * Uses the service role key to bypass RLS — trusted backend call only.
 *
 * Authorization: Bearer {SUMMARY_API_SECRET}
 *
 * Body:
 * {
 *   "claim_id": "uuid",
 *   "claim_summary": "AI-generated summary text…"
 * }
 *
 * Example curl:
 *   curl -X POST https://your-app.com/api/claims/update-summary \
 *     -H "Authorization: Bearer $SUMMARY_API_SECRET" \
 *     -H "Content-Type: application/json" \
 *     -d '{"claim_id":"abc-123","claim_summary":"Ongoing dispute re: moisture damage…"}'
 */
export async function POST(req: NextRequest) {
  // 1. Verify API secret
  const authHeader = req.headers.get("authorization");
  const secret = process.env.SUMMARY_API_SECRET;

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse and validate body
  let body: { claim_id?: string; claim_summary?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { claim_id, claim_summary } = body;

  if (!claim_id || !claim_summary) {
    return NextResponse.json(
      { error: "claim_id and claim_summary are required" },
      { status: 400 }
    );
  }

  // 3. Service role client — targets portix schema, bypasses RLS
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: "portix" } }
  );

  // 4. Update the claim
  const { data, error } = await supabase
    .from("claims")
    .update({ claim_summary, updated_at: new Date().toISOString() })
    .eq("id", claim_id)
    .select("id")
    .single();

  if (error) {
    console.error("[update-summary] Supabase error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Claim not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, claim_id: data.id });
}
