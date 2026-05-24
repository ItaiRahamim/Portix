#!/usr/bin/env node
/**
 * Portix RAG — Backfill Orchestrator
 *
 * Drives the public `backfill-documents` Edge Function with deterministic
 * id-batched calls. The function is configured with --no-verify-jwt so
 * the runner only needs the URL; the service-role key is used to LIST
 * document ids via PostgREST, not to authenticate the function call.
 *
 * Why id-batched and not offset-based?
 *   Offset pagination over a table whose rows can be reordered (or where
 *   the function processes a subset of the limit before timing out) loses
 *   documents permanently. Naming each id explicitly means a 150s timeout
 *   only forgets THAT batch — the next call re-asserts the same ids.
 *
 * Usage:
 *   node scripts/backfill-runner.mjs                    # process all docs, batch=3
 *   node scripts/backfill-runner.mjs --batch=5          # custom batch size
 *   node scripts/backfill-runner.mjs --dry              # dry-run only
 *   node scripts/backfill-runner.mjs --limit=20         # only first 20 ids (testing)
 *
 * Reads env from .env.local automatically.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Load .env.local ─────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH  = resolve(__dirname, "..", ".env.local");

try {
  const raw = readFileSync(ENV_PATH, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = val;
  }
} catch (e) {
  console.warn(`[backfill-runner] could not read ${ENV_PATH}: ${e.message}`);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ||
                     process.env.SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("[backfill-runner] missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

// ─── CLI args ────────────────────────────────────────────────────────────────

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);

const BATCH        = Math.max(1, Math.min(parseInt(args.batch ?? "3", 10), 20));
const DRY_RUN      = args.dry === true;
const ID_CAP       = args.limit ? parseInt(args.limit, 10) : Infinity;
const REQ_TIMEOUT  = 160_000; // edge fn caps at 150s — give 10s headroom
const PAUSE_BETWEEN_MS = 250;

const ENDPOINT = `${SUPABASE_URL}/functions/v1/backfill-documents`;

console.log(`[backfill-runner] endpoint=${ENDPOINT}`);
console.log(`[backfill-runner] batch=${BATCH} dryRun=${DRY_RUN} idCap=${ID_CAP === Infinity ? "∞" : ID_CAP}`);

// ─── 1. List ALL document ids via PostgREST + service-role ──────────────────

async function listDocumentIds() {
  // PostgREST pagination via Range header. We pull in pages of 1000.
  const ids = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/documents?select=id&storage_path=not.is.null&order=created_at.asc`;
    const res = await fetch(url, {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Accept-Profile": "portix",   // route the request to schema portix
        Range:             `${from}-${from + PAGE - 1}`,
        Prefer:            "count=exact",
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`documents list HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    const page = await res.json();
    for (const row of page) if (row?.id) ids.push(row.id);
    if (page.length < PAGE) break;
    from += PAGE;
  }
  return ids;
}

// ─── 2. POST one batch with timeout + structured error ──────────────────────

async function postBatch(documentIds) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort("client-timeout"), REQ_TIMEOUT);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentIds,
        batchSize: documentIds.length,
        dryRun: DRY_RUN,
        // force is implied for documentIds-targeted calls (server enforces),
        // but pass it explicitly for clarity.
        force: true,
      }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* keep raw text */ }
    return {
      ok: res.ok && (json?.ok ?? true),
      status: res.status,
      json,
      raw: json ? null : text.slice(0, 400),
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: String(e?.message ?? e),
    };
  } finally {
    clearTimeout(t);
  }
}

// ─── 3. Main loop ────────────────────────────────────────────────────────────

const main = async () => {
  console.log(`[backfill-runner] listing document ids...`);
  let allIds = await listDocumentIds();
  console.log(`[backfill-runner] fetched ${allIds.length} document ids from DB`);

  if (allIds.length > ID_CAP) {
    console.log(`[backfill-runner] capping to first ${ID_CAP}`);
    allIds = allIds.slice(0, ID_CAP);
  }

  if (allIds.length === 0) {
    console.log(`[backfill-runner] nothing to do.`);
    return;
  }

  const failures = []; // { ids, status, error }
  let okCount   = 0;
  let totalChunks = 0;

  const totalBatches = Math.ceil(allIds.length / BATCH);
  for (let i = 0; i < allIds.length; i += BATCH) {
    const idx   = Math.floor(i / BATCH) + 1;
    const batch = allIds.slice(i, i + BATCH);
    process.stdout.write(`[backfill-runner] batch ${idx}/${totalBatches} (${batch.length} ids) ... `);

    const t0  = Date.now();
    const res = await postBatch(batch);
    const dt  = ((Date.now() - t0) / 1000).toFixed(1);

    if (res.ok) {
      const proc = res.json?.processedCount ?? "?";
      const succ = res.json?.successCount ?? "?";
      const err  = res.json?.errorCount ?? "?";
      const ins  = res.json?.successCount ?? 0;
      okCount   += res.json?.successCount ?? 0;
      totalChunks += (res.json?.successCount ?? 0);
      console.log(`OK ${dt}s processed=${proc} success=${succ} err=${err}`);
      // Surface individual doc errors if any
      if (Array.isArray(res.json?.errors) && res.json.errors.length > 0) {
        for (const e of res.json.errors) {
          console.log(`    !! doc ${e.document_id}: ${e.error}`);
          failures.push({ ids: [e.document_id], status: 200, error: e.error });
        }
      }
      // If server reported a timeout, the batch is partially done — retry remaining
      if (res.json?.timedOut) {
        console.log(`    .. server timed out; remaining ${res.json?.remainingCount ?? "?"} of this batch may need re-run`);
      }
      void ins; // (kept for log readability)
    } else {
      console.log(`FAIL ${dt}s status=${res.status} ${res.error ?? res.raw ?? ""}`);
      failures.push({ ids: batch, status: res.status, error: res.error ?? res.raw ?? "unknown" });
    }

    if (PAUSE_BETWEEN_MS > 0) {
      await new Promise((r) => setTimeout(r, PAUSE_BETWEEN_MS));
    }
  }

  console.log("");
  console.log(`[backfill-runner] ====== SUMMARY ======`);
  console.log(`[backfill-runner] total ids submitted: ${allIds.length}`);
  console.log(`[backfill-runner] doc-level OKs:       ${okCount}`);
  console.log(`[backfill-runner] failures:            ${failures.reduce((s, f) => s + f.ids.length, 0)}`);
  if (failures.length > 0) {
    console.log(`[backfill-runner] failed batches/ids:`);
    for (const f of failures) {
      console.log(`  [status=${f.status}] ${f.ids.join(", ")}  ::  ${f.error}`);
    }
    console.log(`[backfill-runner] re-run failed ids only:`);
    const failedIds = failures.flatMap((f) => f.ids);
    console.log(`  cat > /tmp/failed.json <<EOF\n  {"documentIds": ${JSON.stringify(failedIds)}, "force": true}\n  EOF`);
  }
  if (totalChunks) {
    // not a true chunk count, just OK count — kept for backwards compat with log
  }
};

main().catch((e) => {
  console.error(`[backfill-runner] FATAL: ${e?.message ?? e}`);
  process.exit(1);
});
