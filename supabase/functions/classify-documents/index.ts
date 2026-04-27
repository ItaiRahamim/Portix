// Supabase Edge Function: classify-documents  (Unified Orchestrator)
// Deno runtime
//
// Replaces the previous Make.com webhook + client-side DB patch loop.
// Receives a shipping document via multipart FormData, classifies it with
// Google Gemini 2.5 Flash, and performs all side-effects server-side
// using the service role key:
//
//   1. Gemini AI: identify document type(s) and extract metadata
//   2. Storage:   upload the file to the `documents` bucket
//                 (path: smart_uploads/{shipment_id}/{timestamp}_{filename})
//   3. DB:        UPDATE portix.documents rows (status → 'uploaded')
//                 — only rows with status 'missing' or 'uploaded' are touched
//                 — handles "ALL" container_number by applying to every sibling
//   4. RPC:       if document_type = 'commercial_invoice' and amount > 0,
//                 call portix.handle_make_invoice_draft to create a draft txn
//
// Input  (multipart/form-data): file, containerId
// Output (JSON):                { ok: true, results: [...], storage_path: "..." }
//
// Env vars:
//   SUPABASE_URL              (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//   GEMINI_API_KEY            — Set in Dashboard → Edge Functions → Secrets

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Supabase admin client (portix schema, bypasses RLS) ───────────────────────

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { db: { schema: "portix" }, auth: { persistSession: false } },
);

// ── Gemini helpers ─────────────────────────────────────────────────────────────

// Primary model first; fallback to less-loaded models on 503 "High Demand" errors.
const FALLBACK_MODELS = ["gemini-2.5-flash", "gemini-1.5-flash", "gemini-1.5-pro"];
const GEMINI_BASE     = "https://generativelanguage.googleapis.com/v1beta/models";

function geminiUrl(model: string): string {
  const key = Deno.env.get("GEMINI_API_KEY") ?? "";
  if (!key) throw new Error("GEMINI_API_KEY secret is not set.");
  return `${GEMINI_BASE}/${model}:generateContent?key=${key}`;
}

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

// portix.document_type enum — only these values are accepted
const VALID_DOC_TYPES = new Set([
  "commercial_invoice",
  "packing_list",
  "phytosanitary_certificate",
  "bill_of_lading",
  "certificate_of_origin",
  "cooling_report",
  "insurance_certificate",
]);

// ── Classification prompt ──────────────────────────────────────────────────────

const CLASSIFICATION_PROMPT = `You are an expert logistics AI. Analyze the uploaded PDF file.
This file may contain a single document or multiple different logistics documents merged together ("Frankenstein" PDF).

Task: Identify every document type present and extract its specific metadata.

CRITICAL RULES:
1. Output RAW JSON ONLY. No markdown.
2. For "document_type", you MUST use ONLY these exact allowed values:
   'commercial_invoice', 'packing_list', 'phytosanitary_certificate', 'bill_of_lading', 'certificate_of_origin', 'cooling_report', 'insurance_certificate', 'customs_declaration', 'other'.

Return a JSON object with this EXACT structure:
{
  "documents_found": [
    {
      "document_type": "Exact enum value from the list above",
      "document_number": "String (e.g., Invoice Number, BL Number, or Certificate Number. null if not found)",
      "issue_date": "YYYY-MM-DD (null if not found)",
      "container_number": "String. CRITICAL: Look for the specific container number (e.g., MSKU1234567) this document refers to. If the document applies to ALL containers or no specific container is listed, return 'ALL'",
      "extractedData": {
        "supplierName": "String",
        "totalAmount": Number,
        "currency": "String (e.g., USD, EUR)",
        "itemCount": Number
      }
    }
  ]
}`;

// ── Types ──────────────────────────────────────────────────────────────────────

interface DocumentFound {
  document_type: string;
  container_number: string | null;
  document_number: string | null;
  issue_date: string | null;
  extractedData: {
    supplierName: string | null;
    totalAmount: number | null;
    currency: string | null;
    itemCount: number | null;
  } | null;
}

interface ClassifyResult {
  document_type: string;
  container_number: string | null;
  success: boolean;
}

// ── Main handler ───────────────────────────────────────────────────────────────

serve(async (req) => {
  // Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Parse incoming multipart ─────────────────────────────────────────────
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return new Response(
        JSON.stringify({ error: "Expected multipart/form-data body" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    const file        = formData.get("file") as File | null;
    const containerId = formData.get("containerId") as string | null;

    if (!file || !containerId) {
      return new Response(
        JSON.stringify({ error: "file and containerId are required" }),
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

    console.log(
      `[classify-documents] File: ${file.name}, ${uint8.length} bytes, MIME: ${mimeType}, container: ${containerId}`,
    );

    // ── Call Gemini with model fallback on 503 High-Demand errors ────────────
    const geminiBody = JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: mimeType, data: base64Data } },
          { text: CLASSIFICATION_PROMPT },
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
        console.warn(`[classify-documents] Model ${model} is ${reason}, trying next...`);
        continue;
      }

      // Any other error (400 bad prompt, 401 key invalid, etc.) — fail fast
      console.error(`[classify-documents] Gemini error (${res.status}):`, geminiRaw.slice(0, 400));
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

    // ── Parse Gemini response ─────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geminiJson = JSON.parse(geminiRaw) as any;
    const rawText: string = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    console.log("[classify-documents] Gemini raw:", rawText.slice(0, 500));

    // Extract the JSON block robustly (handles fences, leading prose, truncation)
    const cleaned = extractJsonText(rawText);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("[classify-documents] JSON parse failed. Raw:", rawText.slice(0, 300));
      return new Response(
        JSON.stringify({ error: "Gemini returned unparseable JSON", raw: rawText.slice(0, 200) }),
        { status: 502, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    // Filter to only recognised document types
    const documentsFound: DocumentFound[] = Array.isArray(parsed?.documents_found)
      ? parsed.documents_found.filter((d: DocumentFound) => VALID_DOC_TYPES.has(d?.document_type))
      : [];

    if (documentsFound.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, results: [], message: "No documents identified" }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    // ── Resolve container → shipment ──────────────────────────────────────────
    const { data: containerRow, error: containerErr } = await supabaseAdmin
      .from("containers")
      .select("id, shipment_id")
      .eq("id", containerId)
      .single();

    if (containerErr || !containerRow) {
      console.error("[classify-documents] Container lookup failed:", containerErr?.message);
      return new Response(
        JSON.stringify({ error: "Container not found" }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    const shipmentId: string = containerRow.shipment_id;

    // ── Fetch sibling containers in the same shipment ─────────────────────────
    const { data: siblings } = await supabaseAdmin
      .from("containers")
      .select("id, container_number")
      .eq("shipment_id", shipmentId);

    const siblingList: { id: string; container_number: string }[] = siblings ?? [];

    // ── Upload file to storage once ───────────────────────────────────────────
    // Path: smart_uploads/{shipment_id}/{timestamp}_{sanitized_filename}
    const safeName    = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `smart_uploads/${shipmentId}/${Date.now()}_${safeName}`;

    const { error: uploadErr } = await supabaseAdmin.storage
      .from("documents")
      .upload(storagePath, arrayBuffer, { contentType: mimeType, upsert: true });

    if (uploadErr) {
      console.warn("[classify-documents] Storage upload failed:", uploadErr.message);
      // Non-fatal — DB rows will get null storage_path; supplier can re-upload later
    }

    const finalStoragePath = uploadErr ? null : storagePath;

    // ── DB: update each matched document row ──────────────────────────────────
    const normalize = (s?: string | null) => (s ?? "").trim().toLowerCase();
    const results: ClassifyResult[] = [];

    for (const doc of documentsFound) {
      const isAll = normalize(doc.container_number) === "all";

      // Determine which container IDs to patch
      let targetIds: string[];
      if (isAll) {
        targetIds = siblingList.map((c) => c.id);
      } else {
        const matched = siblingList.find(
          (c) => normalize(c.container_number) === normalize(doc.container_number),
        );
        // Fall back to the current container if no sibling matched
        targetIds = matched ? [matched.id] : [containerId];
      }

      const patch = {
        status:           "uploaded",
        storage_path:     finalStoragePath,
        file_name:        file.name,
        file_size_bytes:  file.size,
        mime_type:        mimeType,
        document_number:  doc.document_number ?? null,
        ai_data:          { ...doc.extractedData, ...doc },
        uploaded_at:      new Date().toISOString(),
        rejection_reason: null,
        reviewed_by:      null,
        reviewed_at:      null,
      };

      let anySuccess = false;
      for (const cid of targetIds) {
        const { error: dbErr } = await supabaseAdmin
          .from("documents")
          .update(patch)
          .eq("container_id",   cid)
          .eq("document_type",  doc.document_type)
          .in("status",         ["missing", "uploaded"]);  // never overwrite approved/rejected

        if (dbErr) {
          console.warn(
            `[classify-documents] DB update failed (${doc.document_type}/${cid}):`,
            dbErr.message,
          );
        } else {
          anySuccess = true;
        }
      }

      // ── RPC: commercial invoice → draft account transaction ─────────────────
      if (doc.document_type === "commercial_invoice") {
        const invoiceAmount = Number(doc.extractedData?.totalAmount ?? 0);
        if (invoiceAmount > 0) {
          const { error: rpcErr } = await supabaseAdmin.rpc("handle_make_invoice_draft", {
            p_container_id: containerId,       // primary container for this upload
            p_amount:       invoiceAmount,
            p_file_path:    finalStoragePath ?? "",
            p_file_name:    file.name,
          });
          if (rpcErr) {
            console.warn(
              "[classify-documents] handle_make_invoice_draft RPC failed:",
              rpcErr.message,
            );
          }
        }
      }

      results.push({
        document_type:    doc.document_type,
        container_number: doc.container_number,
        success:          anySuccess,
      });
    }

    return new Response(
      JSON.stringify({ ok: true, results, storage_path: finalStoragePath }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  } catch (err) {
    console.error("[classify-documents] Fatal:", (err as Error).message);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }
});
