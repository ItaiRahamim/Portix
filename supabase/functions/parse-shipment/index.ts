// Supabase Edge Function: parse-shipment
// Deno runtime
//
// Receives a shipping document (PDF or image) via multipart FormData,
// sends it to Google Gemini 2.5 Flash for AI extraction, and returns
// structured shipment + container fields for the New Shipment Modal autofill.
//
// This replaces the previous Make.com webhook proxy.
//
// Input  (multipart/form-data): file
// Output (JSON):                { shipment: {...}, containers: [...] }
//
// Env vars:
//   GEMINI_API_KEY  — Set in Dashboard → Edge Functions → Secrets

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Gemini helpers ─────────────────────────────────────────────────────────────

// Primary model first; fallback to less-loaded models on 503 "High Demand" errors.
const FALLBACK_MODELS = ["gemini-2.5-flash", "gemini-1.5-flash", "gemini-1.5-pro"];
const GEMINI_BASE     = "https://generativelanguage.googleapis.com/v1beta/models";

function geminiUrl(model: string): string {
  const key = Deno.env.get("GEMINI_API_KEY") ?? "";
  if (!key) throw new Error("GEMINI_API_KEY secret is not set.");
  return `${GEMINI_BASE}/${model}:generateContent?key=${key}`;
}

/** Best-effort MIME type from file.type, falling back to extension. */
function resolvedMime(fileName: string, declaredType: string): string {
  if (declaredType && declaredType !== "application/octet-stream") return declaredType;
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
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

/**
 * Robustly extract a JSON substring from Gemini output.
 * Strips markdown fences first, then slices from the first { / [ to the last } / ].
 * This handles truncation artefacts and any extra prose Gemini adds around the JSON.
 */
function extractJsonText(text: string): string {
  let s = text.replace(/```json/gi, "").replace(/```/g, "").trim();

  const firstBrace   = s.indexOf("{");
  const lastBrace    = s.lastIndexOf("}");
  const firstBracket = s.indexOf("[");
  const lastBracket  = s.lastIndexOf("]");

  // Prefer whichever opening delimiter appears first
  const isArray =
    firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace);

  if (isArray && firstBracket !== -1 && lastBracket !== -1) {
    s = s.substring(firstBracket, lastBracket + 1);
  } else if (!isArray && firstBrace !== -1 && lastBrace !== -1) {
    s = s.substring(firstBrace, lastBrace + 1);
  }

  return s;
}

// ── Extraction prompt ──────────────────────────────────────────────────────────

const EXTRACTION_PROMPT = `You are an expert logistics AI. Analyze the uploaded document (likely a Proforma Invoice, Quote, or Packing List).
Your task is to extract shipment details, container details, and financial totals.

CRITICAL RULES:
1. Output RAW JSON ONLY. No markdown, no explanations.
2. If a value is not found, return null (for strings) or empty string (for enums).
3. Dates MUST be in ISO format (YYYY-MM-DD).
4. For "totalAmount", extract the grand total of the document. Numeric only.

Return a JSON object with this EXACT structure:
{
  "shipment": {
    "supplierName": "String",
    "productName": "String",
    "totalAmount": Number,
    "currency": "String",
    "vesselName": "String",
    "voyageNumber": "String",
    "etd": "YYYY-MM-DD",
    "eta": "YYYY-MM-DD",
    "originCountry": "String",
    "destinationPort": "String"
  },
  "containers": [
    {
      "containerNumber": "String",
      "containerType": "20ft/40ft/etc",
      "temperature": "String",
      "portOfLoading": "String",
      "portOfDestination": "String"
    }
  ]
}`;

// ── Main handler ───────────────────────────────────────────────────────────────

serve(async (req) => {
  // Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Parse multipart ───────────────────────────────────────────────────────
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return new Response(
        JSON.stringify({ error: "Expected multipart/form-data body" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    const file = formData.get("file") as File | null;
    if (!file) {
      return new Response(
        JSON.stringify({ error: "No file provided" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    // ── Base64 encode ─────────────────────────────────────────────────────────
    const arrayBuffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < uint8.length; i++) {
      binary += String.fromCharCode(uint8[i]);
    }
    const base64Data = btoa(binary);
    const mimeType = resolvedMime(file.name, file.type);

    console.log(`[parse-shipment] File: ${file.name}, ${uint8.length} bytes, MIME: ${mimeType}`);

    // ── Call Gemini with model fallback on 503 High-Demand errors ────────────
    const geminiBody = JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: mimeType, data: base64Data } },
          { text: EXTRACTION_PROMPT },
        ],
      }],
      generationConfig: { maxOutputTokens: 2048, temperature: 0.1 },
    });

    let geminiRaw = "";
    let succeeded = false;

    for (const model of FALLBACK_MODELS) {
      const res = await fetch(geminiUrl(model), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: geminiBody,
      });

      geminiRaw = await res.text();

      if (res.ok) {
        succeeded = true;
        break;
      }

      if (res.status === 503 || res.status === 429) {
        const reason = res.status === 503 ? "overloaded (503)" : "rate-limited (429)";
        console.warn(`[parse-shipment] Model ${model} is ${reason}, trying next...`);
        continue;
      }

      // Any other error (400 bad prompt, 401 key invalid, etc.) — fail fast
      console.error(`[parse-shipment] Gemini error (${res.status}):`, geminiRaw.slice(0, 400));
      return new Response(
        JSON.stringify({ error: `Gemini API error (HTTP ${res.status})` }),
        { status: 502, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    if (!succeeded) {
      return new Response(
        JSON.stringify({ error: "All fallback models are currently overloaded. Please try again." }),
        { status: 503, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    // ── Parse response ────────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geminiJson = JSON.parse(geminiRaw) as any;
    const rawText: string = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    console.log("[parse-shipment] Gemini raw output:", rawText.slice(0, 500));

    // Extract the JSON block robustly (handles fences, leading prose, truncation)
    const cleaned = extractJsonText(rawText);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let extracted: { shipment: Record<string, unknown>; containers: unknown[] };
    try {
      extracted = JSON.parse(cleaned);
    } catch {
      console.error("[parse-shipment] JSON parse failed. Raw:", rawText.slice(0, 400));
      return new Response(
        JSON.stringify({ error: "Gemini returned unparseable response", raw: rawText.slice(0, 200) }),
        { status: 502, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    if (!extracted?.shipment) {
      return new Response(
        JSON.stringify({ error: "Gemini response missing 'shipment' key" }),
        { status: 502, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    return new Response(
      JSON.stringify({
        shipment: extracted.shipment,
        containers: Array.isArray(extracted.containers) ? extracted.containers : [],
      }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  } catch (err) {
    console.error("[parse-shipment] Fatal:", (err as Error).message);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }
});
