// Supabase Edge Function: extract-license-data
// Runtime: Deno (Supabase Edge Functions)
//
// Downloads an import license file from the license-files bucket,
// sends it to Google Gemini 2.5 Flash for multimodal OCR extraction,
// and returns structured JSON with the key license fields.
//
// Input (POST body):
//   { "file_path": "importer_id/timestamp_filename.pdf" }
//
// Output:
//   { "license_number": "...", "product_type": "...", "expiration_date": "YYYY-MM-DD", "issue_date": "YYYY-MM-DD" }
//
// Env vars required:
//   SUPABASE_URL              (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//   GEMINI_API_KEY            Set in Dashboard → Edge Functions → Secrets

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── CORS headers ─────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Supabase admin client ────────────────────────────────────────────────────

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false } },
);

// ─── Gemini helpers ───────────────────────────────────────────────────────────

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
      console.warn(`[extract-license-data] fetchWithRetry attempt ${attempt + 1}/${maxRetries + 1} after ${delayMs}ms`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
    lastRes = await fetch(url, init);
    if (lastRes.ok || !RETRIABLE_STATUSES.has(lastRes.status)) break;
  }
  return lastRes;
}

/** Derive MIME type from file extension (Gemini requires accurate MIME types). */
function mimeFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    pdf:  "application/pdf",
    jpg:  "image/jpeg",
    jpeg: "image/jpeg",
    png:  "image/png",
    webp: "image/webp",
    heic: "image/heic",
    heif: "image/heif",
  };
  return map[ext] ?? "application/octet-stream";
}

const EXTRACTION_PROMPT = `You are an expert document analyst specialising in import/export licenses.
Examine this government-issued import license document carefully.
Extract the following fields:
  1. license_number — the official license or permit number (e.g. "IL-2026-00123")
  2. product_type   — the commodity or product description (e.g. "Fresh Citrus Fruits", "Frozen Beef")
  3. expiration_date — the license expiry date in YYYY-MM-DD format
  4. issue_date      — the license issue/start date in YYYY-MM-DD format (if present)

Return ONLY a valid JSON object with exactly these four keys.
If a field is not found, use null.
Do not include any explanation, markdown, or extra text — JSON only.

Example output:
{"license_number":"IL-2026-00123","product_type":"Fresh Citrus Fruits","expiration_date":"2027-03-31","issue_date":"2026-04-01"}`;

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  // Preflight — must be first
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Parse request ───────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const filePath: string | null = body?.file_path ?? null;

    if (!filePath) {
      return new Response(
        JSON.stringify({ ok: false, error: "file_path is required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    console.log(`[extract-license-data] Processing: ${filePath}`);

    // ── Download file from license-files bucket ─────────────────────────────
    const { data: fileData, error: downloadErr } = await supabaseAdmin
      .storage
      .from("license-files")
      .download(filePath);

    if (downloadErr || !fileData) {
      console.error("[extract-license-data] Download failed:", downloadErr?.message);
      return new Response(
        JSON.stringify({ ok: false, error: `File download failed: ${downloadErr?.message}` }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    // ── Convert file to base64 ──────────────────────────────────────────────
    const arrayBuffer = await fileData.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);

    // Deno-native base64 encoding (no Node Buffer needed)
    let binary = "";
    for (let i = 0; i < uint8.length; i++) {
      binary += String.fromCharCode(uint8[i]);
    }
    const base64Data = btoa(binary);
    const mimeType = mimeFromPath(filePath);

    console.log(`[extract-license-data] File size: ${uint8.length} bytes, MIME: ${mimeType}`);

    // ── Call Gemini multimodal — model fallback + per-model retry ──────────
    const apiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
    if (!apiKey) throw new Error("GEMINI_API_KEY secret is not set.");

    const geminiBody = JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: mimeType, data: base64Data } },
          { text: EXTRACTION_PROMPT },
        ],
      }],
      generationConfig: {
        maxOutputTokens: 256,
        temperature: 0.1, // very low — deterministic structured output
      },
    });

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
        console.warn(`[extract-license-data] Model ${model} exhausted, trying next...`);
        continue;
      }

      // Any other error — fail fast
      console.error("[extract-license-data] Gemini error:", geminiRaw.slice(0, 400));
      return new Response(
        JSON.stringify({ ok: false, error: `Gemini API error (HTTP ${res.status})` }),
        { status: 502, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    if (!succeeded) {
      return new Response(
        JSON.stringify({ ok: false, error: "All Gemini models overloaded. Try again later." }),
        { status: 503, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    // ── Parse Gemini response ───────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geminiJson = JSON.parse(geminiRaw) as any;
    const rawText: string = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    console.log("[extract-license-data] Gemini raw output:", rawText.slice(0, 500));

    // Strip markdown fences if Gemini wraps the JSON in ```json ... ```
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    let extracted: {
      license_number: string | null;
      product_type: string | null;
      expiration_date: string | null;
      issue_date: string | null;
    };

    try {
      extracted = JSON.parse(cleaned);
    } catch {
      console.error("[extract-license-data] Failed to parse Gemini JSON:", cleaned);
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Gemini returned non-JSON output. Please fill the form manually.",
          raw: cleaned.slice(0, 200),
        }),
        { status: 422, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    // ── Return extracted fields ─────────────────────────────────────────────
    return new Response(
      JSON.stringify({
        ok: true,
        license_number:  extracted.license_number  ?? null,
        product_type:    extracted.product_type    ?? null,
        expiration_date: extracted.expiration_date ?? null,
        issue_date:      extracted.issue_date      ?? null,
      }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } },
    );

  } catch (err) {
    console.error("[extract-license-data] Fatal:", (err as Error).message);
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }
});
