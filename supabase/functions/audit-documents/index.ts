// Supabase Edge Function: audit-documents
// Runtime: Deno (Supabase Edge Functions)
//
// Cross-validates AI-extracted data across all documents in a container.
// Compares fields like weight, container number, port of loading, value, etc.
// and surfaces discrepancies as a structured JSON array.
//
// Called by the frontend "Run Document Audit" button.
// Body: { "container_id": "<uuid>" }
//
// Returns:
//   { ok: true, discrepancies: AuditDiscrepancy[], container_id: string }
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
      console.warn(`[audit-documents] fetchWithRetry attempt ${attempt + 1}/${maxRetries + 1} after ${delayMs}ms`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
    lastRes = await fetch(url, init);
    if (lastRes.ok || !RETRIABLE_STATUSES.has(lastRes.status)) break;
  }
  return lastRes;
}

// ─── Gemini call ──────────────────────────────────────────────────────────────

async function callGemini(prompt: string): Promise<string> {
  const geminiBody = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: 1500,
      temperature: 0.1,              // near-deterministic for auditing
      responseMimeType: "application/json", // force raw JSON — no markdown fences
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
      console.warn(`[audit-documents] Model ${model} unavailable, trying next...`);
      continue;
    }

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const text = (parsed as any)?.candidates?.[0]?.content?.parts?.[0]?.text as string | undefined;

  if (!text?.trim()) {
    throw new Error(`Gemini response contained no text. Full response: ${geminiRaw.slice(0, 500)}`);
  }

  return text.trim();
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

interface DocumentRow {
  document_type: string;
  ai_data: Record<string, unknown> | null;
}

function buildAuditPrompt(containerId: string, docs: DocumentRow[]): string {
  const docSummaries = docs
    .filter((d) => d.ai_data && Object.keys(d.ai_data).length > 0)
    .map((d) => {
      const label = d.document_type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      return `### ${label}\n${JSON.stringify(d.ai_data, null, 2)}`;
    })
    .join("\n\n");

  return [
    "You are a strict customs compliance auditor.",
    "Review the following AI-extracted data from multiple shipping documents for the same container.",
    "Your job is to find ANY discrepancies between the documents.",
    "",
    "Check for mismatches in these fields (when present across 2+ documents):",
    "- Total Weight (gross, net, or tare)",
    "- Container Number",
    "- Seal Number",
    "- Port of Loading / Port of Origin",
    "- Port of Discharge / Port of Destination",
    "- Total Value / Invoice Amount",
    "- Quantity / Number of Units / Packages",
    "- Product Description / HS Code",
    "- Shipper Name / Exporter",
    "- Consignee Name / Importer",
    "- Vessel Name / Voyage Number",
    "- Issue Date / Shipment Date",
    "",
    "Return ONLY a valid JSON array. No markdown, no explanation, no text outside the array.",
    "Each discrepancy object must have exactly these fields:",
    '  { "field": "string", "doc1": "string", "doc2": "string", "severity": "high"|"medium"|"low", "description": "string" }',
    "",
    "Severity guide:",
    "  high   = likely to cause customs rejection or delay (weight/value/container number mismatch)",
    "  medium = should be reviewed but may be acceptable (minor name variation, date offset)",
    "  low    = informational inconsistency (formatting difference, optional field)",
    "",
    "If there are NO discrepancies, return an empty array: []",
    "Do NOT invent discrepancies. Only flag real mismatches with evidence from the data below.",
    "",
    `Container ID: ${containerId}`,
    "",
    "Document Data:",
    docSummaries || "(No document AI data available)",
  ].join("\n");
}

// ─── Parse Gemini JSON output ─────────────────────────────────────────────────

interface AuditDiscrepancy {
  field: string;
  doc1: string;
  doc2: string;
  severity: "high" | "medium" | "low";
  description: string;
}

const PARSE_FALLBACK: AuditDiscrepancy[] = [{
  field: "AI Parsing Error",
  doc1: "-",
  doc2: "-",
  severity: "high",
  description: "The AI generated malformed data. Please run the audit again.",
}];

function parseDiscrepancies(raw: string): AuditDiscrepancy[] {
  // 1. Strip ALL markdown code fences.
  //    responseMimeType should prevent them but fallback models may still wrap.
  const cleaned = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/gi, "")
    .trim();

  // 2. First attempt — direct JSON.parse
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // 3. Second attempt — extract first [...] block (handles extra prose wrapping)
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        // fall through to fallback below
      }
    }
  }

  // 4. If still not a valid array → return safe fallback (never throw)
  if (!Array.isArray(parsed)) {
    console.error("[audit-documents] Gemini parse failed. Raw output:", cleaned.slice(0, 500));
    return PARSE_FALLBACK;
  }

  // 5. Validate + normalize each item; skip malformed entries rather than crashing
  const results: AuditDiscrepancy[] = [];
  for (let i = 0; i < (parsed as unknown[]).length; i++) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const obj = (parsed as any[])[i];
      const severity = ["high", "medium", "low"].includes(obj?.severity) ? obj.severity : "medium";
      results.push({
        field:       String(obj?.field       ?? `Unknown field ${i}`),
        doc1:        String(obj?.doc1        ?? ""),
        doc2:        String(obj?.doc2        ?? ""),
        severity:    severity as "high" | "medium" | "low",
        description: String(obj?.description ?? ""),
      });
    } catch {
      // Skip malformed items silently
    }
  }

  return results;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  // Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const containerId: string | undefined = body?.container_id;

    if (!containerId) {
      return new Response(
        JSON.stringify({ ok: false, error: "container_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 1. Fetch all documents with ai_data for this container
    const { data: docs, error: docsErr } = await supabaseAdmin
      .from("documents")
      .select("document_type, ai_data")
      .eq("container_id", containerId)
      .not("ai_data", "is", null);

    if (docsErr) {
      throw new Error(`Failed to fetch documents: ${docsErr.message}`);
    }

    const validDocs = (docs ?? []).filter(
      (d) => d.ai_data && Object.keys(d.ai_data).length > 0,
    ) as DocumentRow[];

    // Need at least 2 documents with ai_data to cross-validate
    if (validDocs.length < 2) {
      // Store empty array (audit ran, nothing to compare)
      await supabaseAdmin
        .from("containers")
        .update({ ai_audit_results: [] })
        .eq("id", containerId);

      return new Response(
        JSON.stringify({
          ok: true,
          container_id: containerId,
          discrepancies: [],
          message: "Fewer than 2 documents have been processed by AI. Upload and classify more documents first.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2. Build prompt + call Gemini
    const prompt = buildAuditPrompt(containerId, validDocs);
    console.log(`[audit-documents] Auditing container ${containerId} with ${validDocs.length} docs`);

    const rawOutput = await callGemini(prompt);
    // parseDiscrepancies never throws — returns PARSE_FALLBACK on any bad output
    let discrepancies: AuditDiscrepancy[];
    try {
      discrepancies = parseDiscrepancies(rawOutput);
    } catch {
      // Belt-and-suspenders: shouldn't reach here, but guarantee 200 regardless
      console.error("[audit-documents] Unexpected parseDiscrepancies throw; using fallback");
      discrepancies = PARSE_FALLBACK;
    }

    console.log(`[audit-documents] Found ${discrepancies.length} discrepancy/ies for ${containerId}`);

    // 3. Persist to containers.ai_audit_results
    const { error: updateErr } = await supabaseAdmin
      .from("containers")
      .update({ ai_audit_results: discrepancies })
      .eq("id", containerId);

    if (updateErr) {
      throw new Error(`Failed to save audit results: ${updateErr.message}`);
    }

    return new Response(
      JSON.stringify({ ok: true, container_id: containerId, discrepancies }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[audit-documents] Error:", message);
    return new Response(
      JSON.stringify({ ok: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
