#!/usr/bin/env node
/**
 * Portix RAG — Container ID Healer
 *
 * Problem: portix.documents (and portix.document_chunks) have ghost container_ids
 * that no longer exist in portix.containers (old/deleted containers). This breaks
 * relational chunk retrieval because REL 1c queries by live container_id.
 *
 * Fix:
 *   1. Load ALL live containers from portix.containers (id + container_number + shipment_id)
 *   2. Find all portix.documents rows whose container_id is NOT in the live set
 *   3. For each orphan doc, figure out the correct live container:
 *        a. Try: find a live container in the same shipment (via ghost container's old shipment_id
 *           stored in documents.metadata, or by guessing through container_number patterns)
 *        b. Fallback: dump what we know and let the operator decide
 *   4. UPDATE portix.documents + portix.document_chunks
 *   5. Print summary
 *
 * Usage:
 *   node scripts/heal-container-ids.mjs            # dry-run (prints only)
 *   node scripts/heal-container-ids.mjs --apply    # actually executes UPDATEs
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH  = resolve(__dirname, "..", ".env.local");

try {
  const raw = readFileSync(ENV_PATH, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = val;
  }
} catch (e) {
  console.warn(`[heal] could not read ${ENV_PATH}: ${e.message}`);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
const APPLY        = process.argv.includes("--apply");

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("[heal] missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const HEADERS = {
  apikey:          SERVICE_KEY,
  Authorization:   `Bearer ${SERVICE_KEY}`,
  "Accept-Profile": "portix",
  "Content-Type":  "application/json",
};

async function pgRest(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: HEADERS,
    ...opts,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

async function fetchAll(table, select, filter = "") {
  const rows = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const url = `${table}?select=${select}${filter ? `&${filter}` : ""}`;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${url}`, {
      headers: { ...HEADERS, Range: `${from}-${from + PAGE - 1}`, Prefer: "count=exact" },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`fetchAll ${table} HTTP ${res.status}: ${text.slice(0, 400)}`);
    const page = JSON.parse(text);
    rows.push(...page);
    if (page.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

async function main() {
  console.log(`[heal] mode=${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`[heal] url=${SUPABASE_URL}`);
  console.log();

  // ── 1. Load live containers ──────────────────────────────────────────────
  console.log("[heal] fetching live containers...");
  const liveContainers = await fetchAll("containers", "id,container_number,shipment_id");
  const liveIds = new Set(liveContainers.map(c => c.id));
  const liveByNum = new Map(liveContainers.map(c => [c.container_number, c]));
  // shipment_id → [container ids]
  const liveByShipment = new Map();
  for (const c of liveContainers) {
    if (!c.shipment_id) continue;
    if (!liveByShipment.has(c.shipment_id)) liveByShipment.set(c.shipment_id, []);
    liveByShipment.get(c.shipment_id).push(c);
  }
  console.log(`[heal] live containers: ${liveContainers.length}`);
  console.log();

  // ── 2. Load all documents ────────────────────────────────────────────────
  console.log("[heal] fetching all documents...");
  const allDocs = await fetchAll("documents", "id,container_id,document_type,storage_path");
  console.log(`[heal] total documents: ${allDocs.length}`);

  const ghostDocs = allDocs.filter(d => !liveIds.has(d.container_id));
  console.log(`[heal] orphan documents (ghost container_id): ${ghostDocs.length}`);
  if (ghostDocs.length === 0) {
    console.log("[heal] nothing to heal. all documents point to live containers.");
    return;
  }

  // ── 3. Group orphans by ghost container_id ───────────────────────────────
  const ghostGroups = new Map(); // ghostId → [doc, ...]
  for (const d of ghostDocs) {
    if (!ghostGroups.has(d.container_id)) ghostGroups.set(d.container_id, []);
    ghostGroups.get(d.container_id).push(d);
  }

  console.log(`\n[heal] ghost container_id groups: ${ghostGroups.size}`);
  for (const [ghostId, docs] of ghostGroups) {
    console.log(`  ghost ${ghostId} → ${docs.length} doc(s):`);
    for (const d of docs) console.log(`    ${d.id} (${d.document_type})`);
  }
  console.log();

  // ── 4. Load ghost container records (may still exist in portix.containers
  //       if they were soft-deleted or renamed — unlikely but worth checking)
  //       More likely: they were deleted from portix.containers entirely.
  //       We'll try to match via chunk content (container_number embedded in
  //       storage_path or metadata) or ask you to map manually.
  //
  //  Storage paths look like: documents/{container_id}/{doc_type}/{uuid}.pdf
  //  → container_id in path IS the ghost id (useless for resolution).
  //
  //  Better: load document_chunks for ghost container_ids and inspect content
  //  for container numbers, then match to live containers.
  // ─────────────────────────────────────────────────────────────────────────
  console.log("[heal] probing chunk content for container numbers...");
  const ISO_RE = /\b([A-Z]{4}\d{7})\b/g;

  // mapping: ghostId → Set<containerNumber> found in chunk text
  const ghostToNums = new Map();

  for (const [ghostId] of ghostGroups) {
    // Pull up to 20 chunks for this ghost container_id
    const chunks = await pgRest(
      `document_chunks?container_id=eq.${ghostId}&select=content&limit=20`
    );
    const nums = new Set();
    for (const chunk of (chunks ?? [])) {
      const matches = [...(chunk.content ?? "").matchAll(ISO_RE)];
      for (const m of matches) nums.add(m[1]);
    }
    ghostToNums.set(ghostId, nums);
    console.log(`  ghost ${ghostId} → chunk container numbers: ${[...nums].join(", ") || "(none found)"}`);
  }
  console.log();

  // ── 5. Build ghost → live mapping ────────────────────────────────────────
  const healing = []; // { ghostId, liveId, liveContainerNumber, docIds }

  for (const [ghostId, docs] of ghostGroups) {
    const nums = ghostToNums.get(ghostId) ?? new Set();
    let liveContainer = null;

    // Try: match any found container number to live containers
    for (const num of nums) {
      if (liveByNum.has(num)) {
        liveContainer = liveByNum.get(num);
        console.log(`[heal] ghost ${ghostId} → matched by container_number ${num} → live ${liveContainer.id}`);
        break;
      }
    }

    if (!liveContainer) {
      // No container number hit. Try: look for a live container whose shipment
      // contains our ghost — but we don't have the ghost's shipment_id anymore.
      // Last resort: if there's only ONE live container overall per shipment and
      // only ONE ghost group, assume they map. Print a warning.
      console.warn(`[heal] WARN: ghost ${ghostId} — cannot auto-resolve live container.`);
      console.warn(`       container numbers found in chunks: ${[...nums].join(", ") || "(none)"}`);
      console.warn(`       manual mapping required.`);
      continue;
    }

    healing.push({
      ghostId,
      liveId: liveContainer.id,
      liveContainerNumber: liveContainer.container_number,
      docIds: docs.map(d => d.id),
    });
  }

  if (healing.length === 0) {
    console.log("[heal] no auto-resolvable mappings found. check warnings above.");
    return;
  }

  // ── 6. Print plan ─────────────────────────────────────────────────────────
  console.log("\n[heal] ===== HEAL PLAN =====");
  for (const h of healing) {
    console.log(`  ${h.ghostId}`);
    console.log(`    → live: ${h.liveId} (${h.liveContainerNumber})`);
    console.log(`    docs:   ${h.docIds.join(", ")}`);
  }
  console.log();

  if (!APPLY) {
    console.log("[heal] DRY-RUN — pass --apply to execute UPDATEs");
    return;
  }

  // ── 7. Execute UPDATEs ───────────────────────────────────────────────────
  console.log("[heal] applying UPDATEs...");
  for (const h of healing) {
    // 7a. UPDATE portix.documents
    const docRes = await fetch(
      `${SUPABASE_URL}/rest/v1/documents?container_id=eq.${h.ghostId}`,
      {
        method: "PATCH",
        headers: { ...HEADERS, "Content-Profile": "portix", Prefer: "return=representation" },
        body: JSON.stringify({ container_id: h.liveId }),
      }
    );
    const docText = await docRes.text();
    if (!docRes.ok) {
      console.error(`[heal] FAIL documents UPDATE for ghost ${h.ghostId}: ${docText.slice(0, 300)}`);
    } else {
      const updated = JSON.parse(docText);
      console.log(`[heal] documents updated: ${updated.length} rows (${h.ghostId} → ${h.liveId})`);
    }

    // 7b. UPDATE portix.document_chunks
    const chunkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/document_chunks?container_id=eq.${h.ghostId}`,
      {
        method: "PATCH",
        headers: { ...HEADERS, "Content-Profile": "portix", Prefer: "return=representation" },
        body: JSON.stringify({ container_id: h.liveId }),
      }
    );
    const chunkText = await chunkRes.text();
    if (!chunkRes.ok) {
      console.error(`[heal] FAIL document_chunks UPDATE for ghost ${h.ghostId}: ${chunkText.slice(0, 300)}`);
    } else {
      const updated = JSON.parse(chunkText);
      console.log(`[heal] document_chunks updated: ${updated.length} rows (${h.ghostId} → ${h.liveId})`);
    }
  }

  console.log("\n[heal] ===== DONE =====");
  console.log("[heal] re-run backfill with force to rebuild chunks under correct IDs:");
  console.log("  node scripts/backfill-runner.mjs");
}

main().catch(e => {
  console.error(`[heal] FATAL: ${e?.message ?? e}`);
  process.exit(1);
});
