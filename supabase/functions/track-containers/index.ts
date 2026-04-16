// Supabase Edge Function: track-containers
// Runtime: Deno (Supabase Edge Functions)
//
// Polls carrier APIs for all active containers, updates:
//   current_location, api_eta, tracking_status_raw, last_tracking_update
//
// Schedule: invoke via pg_cron or Supabase Dashboard → Edge Functions → Schedules
// Env vars required:
//   SUPABASE_URL             (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//   MAERSK_API_KEY           (set in Supabase Dashboard → Edge Functions → Secrets)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Carrier Detection ────────────────────────────────────────────────────────
// Container owner codes (first 3 characters of the 4-char BIC prefix)
// Add more codes here as needed — the switch statement routes them to handlers.

const CARRIER_BY_PREFIX: Record<string, string> = {
  // Maersk / Sealand / Hamburg Süd (all use Maersk Track API)
  MAE: "maersk", MRK: "maersk", MSK: "maersk",
  TRL: "maersk", SUD: "maersk", TCK: "maersk", MCS: "maersk",
  // MSC — Phase 2
  MSC: "msc", MSD: "msc",
  // CMA CGM — Phase 3
  CMA: "cma", CMB: "cma",
};

function detectCarrier(containerNumber: string): string {
  const prefix = containerNumber.replace(/\s/g, "").slice(0, 3).toUpperCase();
  return CARRIER_BY_PREFIX[prefix] ?? "unknown";
}

// ─── Maersk Track & Trace ─────────────────────────────────────────────────────
// Docs: https://developer.maersk.com/product-catalogue/track-and-trace
// Endpoint: GET /track/v1/containers/{containerNumber}
// Auth:     Consumer-Key header

const MAERSK_TRACK_BASE_URL =
  "https://api.maersk.com/track/v1/containers";

async function fetchMaerskTracking(
  containerNumber: string,
  apiKey: string,
): Promise<unknown> {
  const url = `${MAERSK_TRACK_BASE_URL}/${encodeURIComponent(containerNumber)}`;

  const res = await fetch(url, {
    headers: {
      "Consumer-Key": apiKey,
      "Accept": "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Maersk API ${res.status}: ${body}`);
  }

  return res.json();
}

// Normalise Maersk response shape → { location, apiEta }
// The Maersk T&T API returns different shapes depending on the product version.
// This function tries the most common paths and falls back gracefully.
function extractMaerskData(raw: unknown): {
  location: string | null;
  apiEta: string | null;
} {
  const r = raw as Record<string, unknown>;

  // V2 shape: containers[].transportPlan[]
  const containers =
    (r?.containers as unknown[]) ??
    (r?.containerTrackingInfoList as unknown[]) ??
    [];

  const first = (containers[0] ?? r) as Record<string, unknown>;

  // Current location: last completed transport leg
  const transportPlan = (first?.transportPlan as Record<string, unknown>[]) ?? [];
  const lastLeg = transportPlan.at(-1) as Record<string, unknown> | undefined;

  const location: string | null =
    (lastLeg?.actualArrival as Record<string, unknown>)?.location as string ??
    (first?.currentLocation as string) ??
    (first?.vesselCurrentPort as string) ??
    null;

  // API ETA: estimated arrival of final leg
  const apiEta: string | null =
    (lastLeg?.estimatedArrival as Record<string, unknown>)?.dateTime as string ??
    (first?.estimatedTimeOfArrival as string) ??
    (first?.eta as string) ??
    null;

  return { location, apiEta };
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  try {
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceRoleKey,
      {
        db: { schema: "portix" },
        global: {
          // Explicitly pin the service-role key as the Authorization header.
          // Without this, Supabase Edge Functions can inherit the incoming
          // request's Authorization header (e.g. anon key from the test panel),
          // which downgrades privileges and triggers RLS rejections.
          headers: { Authorization: `Bearer ${serviceRoleKey}` },
        },
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );

    const maerskKey = Deno.env.get("MAERSK_API_KEY") ?? null;

    // ── Optional body: target a single container for dashboard testing ─────────
    // Accepted payload: { "container_id": "uuid" } OR { "container_number": "MSKU1234567" }
    let filterContainerId: string | null = null;
    let filterContainerNumber: string | null = null;

    try {
      const body = await req.json().catch(() => null);
      if (body?.container_id)     filterContainerId     = body.container_id;
      if (body?.container_number) filterContainerNumber = body.container_number;
    } catch {
      // No body or invalid JSON — run in bulk mode (normal scheduled invocation)
    }

    // ── Fetch containers ────────────────────────────────────────────────────────
    let query = supabase
      .from("containers")
      .select("id, container_number, status")
      .not("status", "in", '("released")');

    if (filterContainerId)     query = query.eq("id", filterContainerId);
    if (filterContainerNumber) query = query.ilike("container_number", filterContainerNumber);

    const { data: containers, error: fetchError } = await query;

    if (fetchError) throw fetchError;

    // Group by carrier
    const byCarrier = new Map<string, { id: string; container_number: string; status: string }[]>();
    for (const c of containers ?? []) {
      const carrier = detectCarrier(c.container_number);
      if (!byCarrier.has(carrier)) byCarrier.set(carrier, []);
      byCarrier.get(carrier)!.push(c);
    }

    const results: unknown[] = [];

    for (const [carrier, group] of byCarrier.entries()) {
      for (const container of group) {
        try {
          let raw: unknown = null;
          let location: string | null = null;
          let apiEta: string | null = null;

          switch (carrier) {
            case "maersk": {
              if (!maerskKey) {
                results.push({ id: container.id, skipped: "MAERSK_API_KEY not set" });
                continue;
              }
              try {
                raw = await fetchMaerskTracking(container.container_number, maerskKey);
              } catch (maerskErr) {
                // Carrier API error — log and skip DB update for this container
                const msg = (maerskErr as Error).message;
                console.error(`[track-containers] Maersk API error for ${container.container_number}:`, msg);
                results.push({ id: container.id, carrier, container_number: container.container_number, error: `Maersk: ${msg}` });
                continue;
              }
              ({ location, apiEta } = extractMaerskData(raw));
              break;
            }

            // ── Phase 2: MSC ─────────────────────────────────────────────────
            // case "msc": {
            //   raw = await fetchMscTracking(container.container_number, Deno.env.get("MSC_API_KEY")!);
            //   ({ location, apiEta } = extractMscData(raw));
            //   break;
            // }

            // ── Phase 3: CMA CGM ─────────────────────────────────────────────
            // case "cma": { ... break; }

            default:
              results.push({
                id: container.id,
                skipped: `carrier '${carrier}' not yet implemented`,
              });
              continue;
          }

          const { error: updateError } = await supabase
            .from("containers")
            .update({
              current_location: location,
              api_eta: apiEta,
              tracking_status_raw: raw,
              last_tracking_update: new Date().toISOString(),
            })
            .eq("id", container.id);

          if (updateError) {
            console.error(`[track-containers] DB update failed for ${container.container_number}:`, updateError.message);
            results.push({ id: container.id, carrier, container_number: container.container_number, error: `DB: ${updateError.message}` });
            continue;
          }

          results.push({
            id: container.id,
            carrier,
            container_number: container.container_number,
            location,
            apiEta,
          });
        } catch (err) {
          console.error(
            `[track-containers] ${container.container_number}:`,
            (err as Error).message,
          );
          results.push({
            id: container.id,
            carrier,
            container_number: container.container_number,
            error: (err as Error).message,
          });
        }
      }
    }

    return new Response(
      JSON.stringify({ ok: true, processed: results.length, results }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[track-containers] fatal:", (err as Error).message);
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
