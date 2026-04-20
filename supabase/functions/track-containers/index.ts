// Supabase Edge Function: track-containers
// Runtime: Deno (Supabase Edge Functions)
//
// Polls carrier APIs for all active containers, updates:
//   current_location, api_eta, tracking_status_raw, last_tracking_update
//
// Schedule: invoke via pg_cron or Supabase Dashboard → Edge Functions → Schedules
//
// Env vars required:
//   SUPABASE_URL                (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY   (auto-injected)
//   MAERSK_CLIENT_ID            Set in Dashboard → Edge Functions → Secrets
//   MAERSK_CLIENT_SECRET        Set in Dashboard → Edge Functions → Secrets

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Carrier Detection ────────────────────────────────────────────────────────
// BIC owner codes are the FIRST 4 CHARACTERS of a container number (not 3).
// The 4th character is always the equipment category identifier (U = container).
// We match on the full 4-char prefix for unambiguous carrier resolution.

const CARRIER_BY_PREFIX: Record<string, string> = {
  // Maersk / Sealand / Hamburg Süd (all route through Maersk Track API)
  MSKU: "maersk",  // Maersk Line (main)
  MRKU: "maersk",  // Maersk Line
  MNBU: "maersk",  // Maersk Line
  TCKU: "maersk",  // Maersk Tankers
  SUDU: "maersk",  // Hamburg Süd
  GLDU: "maersk",  // Maersk (Sealand)
  HJMU: "maersk",  // Maersk
  MCSU: "maersk",  // Maersk
  // MSC — Phase 2
  MSCU: "msc",
  MEDU: "msc",
  // CMA CGM — Phase 3
  CMAU: "cma",
  CGMU: "cma",
  APHU: "cma",     // APL (owned by CMA CGM)
  // Hapag-Lloyd — Phase 4
  HLXU: "hapag",
  HLCU: "hapag",
  // Evergreen — Phase 4
  EISU: "evergreen",
  EGHU: "evergreen",
};

function detectCarrier(containerNumber: string): string {
  // Use the first 4 characters — the full BIC owner code including category
  const prefix = containerNumber.replace(/\s/g, "").slice(0, 4).toUpperCase();
  const carrier = CARRIER_BY_PREFIX[prefix];
  if (!carrier) {
    console.warn(
      `[track-containers] Unknown carrier for prefix '${prefix}' (container: ${containerNumber}). ` +
      `Add this prefix to CARRIER_BY_PREFIX to enable tracking.`
    );
  }
  return carrier ?? "unknown";
}

// ─── Maersk OAuth2 Token ──────────────────────────────────────────────────────
// Maersk APIs (post-2022) require an OAuth2 access token obtained via the
// Client Credentials grant before calling any tracking endpoint.
// Token endpoint: POST https://api.maersk.com/oauth2/access_token
// Docs: https://developer.maersk.com/documentation/authentication

const MAERSK_TOKEN_URL = "https://api.maersk.com/oauth2/access_token";
// DCSA Track & Trace v2 — official Maersk public gateway path.
// Uses equipmentReference query param, not a path segment.
// Docs: https://developer.maersk.com/product-catalog/track-and-trace
const MAERSK_EVENTS_URL = "https://api.maersk.com/track-and-trace-private/v2/events";

async function getMaerskBearerToken(): Promise<string> {
  const url = "https://api.maersk.com/oauth2/access_token";
  const params = new URLSearchParams();
  params.append("grant_type", "client_credentials");
  params.append("client_id", Deno.env.get("MAERSK_CLIENT_ID") || "");
  params.append("client_secret", Deno.env.get("MAERSK_CLIENT_SECRET") || "");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Maersk token endpoint returned HTTP ${res.status}. Body: ${err}`);
  }
  const data = await res.json();
  return data.access_token;
}

// ─── Maersk Track & Trace ─────────────────────────────────────────────────────

async function fetchMaerskTracking(
  containerNumber: string,
  bearerToken: string,
): Promise<unknown> {
  const url = `https://api.maersk.com/track-and-trace-private/v2/events?equipmentReference=${containerNumber}`;

  console.log(`[track-containers] GET ${url}`);
  const res = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${bearerToken}`,
      "Consumer-Key": Deno.env.get("MAERSK_CLIENT_ID") || "",
      "Accept": "application/json",
    },
  });

  const responseText = await res.text();
  console.log(
    `[track-containers] Maersk T&T responded HTTP ${res.status} for ${containerNumber}:`,
    responseText.slice(0, 500)
  );

  if (!res.ok) {
    throw new Error(
      `Maersk T&T API HTTP ${res.status} for ${containerNumber}. Body: ${responseText.slice(0, 500)}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new Error(
      `Maersk T&T returned non-JSON for ${containerNumber}: ${responseText.slice(0, 300)}`
    );
  }

  return parsed;
}

// ─── Normalise Maersk DCSA Events Response ────────────────────────────────────
// DCSA Track & Trace v2 returns either:
//   { events: [...] }   — wrapped object
//   [...]               — bare array (some gateway versions)
//
// Each event has:
//   eventType              : "TRANSPORT" | "EQUIPMENT" | "SHIPMENT"
//   eventClassifierCode    : "ACT" (actual) | "EST" (estimated) | "PLN" (planned)
//   transportEventTypeCode : "ARRI" (arrival) | "DEPA" (departure)
//   eventDateTime          : ISO-8601 string
//   eventLocation          : { locationName?: string; UNLocationCode?: string }
//
// Strategy:
//   location → name of the MOST RECENT actual or estimated arrival event
//   apiEta   → dateTime of the NEXT estimated arrival (latest EST ARRI event)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DCSAEvent = Record<string, any>;

function extractMaerskData(raw: unknown): {
  location: string | null;
  apiEta: string | null;
} {
  // Normalise to array
  let events: DCSAEvent[] = [];
  if (Array.isArray(raw)) {
    events = raw as DCSAEvent[];
  } else if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if (Array.isArray(r.events)) events = r.events as DCSAEvent[];
    // Fallback: legacy container-envelope shape (old API versions)
    else {
      const containers =
        (r.containers as DCSAEvent[]) ??
        (r.containerTrackingInfoList as DCSAEvent[]) ??
        [];
      const first = (containers[0] ?? r) as DCSAEvent;
      const transportPlan = (first?.transportPlan as DCSAEvent[]) ?? [];
      const lastLeg = transportPlan.at(-1) as DCSAEvent | undefined;
      return {
        location:
          lastLeg?.actualArrival?.location ??
          first?.currentLocation ??
          first?.vesselCurrentPort ??
          null,
        apiEta:
          lastLeg?.estimatedArrival?.dateTime ??
          first?.estimatedTimeOfArrival ??
          first?.eta ??
          null,
      };
    }
  }

  if (events.length === 0) {
    console.warn("[track-containers] extractMaerskData: received empty events array.");
    return { location: null, apiEta: null };
  }

  // ── Most recent actual or estimated TRANSPORT arrival → current location ──
  const arrivals = events
    .filter(
      (e) =>
        e.eventType === "TRANSPORT" &&
        e.transportEventTypeCode === "ARRI" &&
        (e.eventClassifierCode === "ACT" || e.eventClassifierCode === "EST")
    )
    .sort((a, b) =>
      (a.eventDateTime as string).localeCompare(b.eventDateTime as string)
    );

  const lastArrival = arrivals.at(-1);
  const location: string | null =
    lastArrival?.eventLocation?.locationName ??
    lastArrival?.eventLocation?.UNLocationCode ??
    null;

  // ── Next estimated TRANSPORT arrival → ETA ───────────────────────────────
  const estimatedArrivals = events
    .filter(
      (e) =>
        e.eventType === "TRANSPORT" &&
        e.transportEventTypeCode === "ARRI" &&
        e.eventClassifierCode === "EST"
    )
    .sort((a, b) =>
      (a.eventDateTime as string).localeCompare(b.eventDateTime as string)
    );

  // Use the latest EST arrival date as the best ETA signal
  const apiEta: string | null = estimatedArrivals.at(-1)?.eventDateTime ?? null;

  console.log(
    `[track-containers] extractMaerskData: ${events.length} events → ` +
    `location='${location}', eta='${apiEta}'`
  );

  return { location, apiEta };
}

// ─── Isolated Admin Client ────────────────────────────────────────────────────
// Module-level — completely decoupled from any incoming request context.
// Authenticates as service role and bypasses RLS unconditionally.

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  {
    db: { schema: "portix" },
    auth: { persistSession: false },
  },
);

// ─── Main Handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  try {
    // ── Credentials ──────────────────────────────────────────────────────────
    const maerskClientId     = Deno.env.get("MAERSK_CLIENT_ID")     ?? null;
    const maerskClientSecret = Deno.env.get("MAERSK_CLIENT_SECRET") ?? null;

    // Log which credential mode is active (without leaking values)
    if (maerskClientId && maerskClientSecret) {
      console.log("[track-containers] Maersk auth mode: OAuth2 Client Credentials ✓");
    } else {
      console.warn(
        "[track-containers] WARNING: MAERSK_CLIENT_ID or MAERSK_CLIENT_SECRET not found in env vars. " +
        "Set both secrets in Supabase Dashboard → Edge Functions → Secrets."
      );
    }

    // ── Optional body: target a single container for debugging ───────────────
    let filterContainerId:     string | null = null;
    let filterContainerNumber: string | null = null;

    try {
      const body = await req.json().catch(() => null);
      if (body?.container_id)     filterContainerId     = body.container_id;
      if (body?.container_number) filterContainerNumber = body.container_number;
    } catch { /* bulk mode */ }

    if (filterContainerNumber) {
      console.log(`[track-containers] Targeted mode: container_number = ${filterContainerNumber}`);
    } else if (filterContainerId) {
      console.log(`[track-containers] Targeted mode: container_id = ${filterContainerId}`);
    } else {
      console.log("[track-containers] Bulk mode: processing all active containers");
    }

    // ── Fetch containers from DB ──────────────────────────────────────────────
    let query = supabaseAdmin
      .from("containers")
      .select("id, container_number, status")
      .not("status", "in", '("released")');

    if (filterContainerId)     query = query.eq("id", filterContainerId);
    if (filterContainerNumber) query = query.ilike("container_number", filterContainerNumber);

    const { data: containers, error: fetchError } = await query;

    if (fetchError) {
      console.error("[track-containers] DB fetch error:", fetchError.message);
      throw fetchError;
    }

    console.log(`[track-containers] Found ${containers?.length ?? 0} container(s) in DB.`);

    // ── Diagnostic: container not found ──────────────────────────────────────
    if (!containers || containers.length === 0) {
      const msg = filterContainerNumber
        ? `Container '${filterContainerNumber}' not found in portix.containers (or status is 'released'). ` +
          `Add this container to the database first.`
        : "No active containers found in the database.";
      console.warn(`[track-containers] ${msg}`);
      return new Response(
        JSON.stringify({ ok: true, processed: 0, results: [], diagnostic: msg }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    // ── Obtain Maersk OAuth2 token once for all Maersk containers ────────────
    let maerskBearerToken: string | null = null;
    let maerskTokenError: string | null = null;

    const hasMaerskContainers = containers.some(
      (c) => detectCarrier(c.container_number) === "maersk"
    );

    if (hasMaerskContainers && maerskClientId && maerskClientSecret) {
      try {
        maerskBearerToken = await getMaerskBearerToken();
      } catch (tokenErr) {
        maerskTokenError = (tokenErr as Error).message;
        console.error("[track-containers] Failed to obtain Maersk Bearer token:", maerskTokenError);
        // Don't throw — surface error per-container below
      }
    }

    // ── Group by carrier ──────────────────────────────────────────────────────
    const byCarrier = new Map<string, { id: string; container_number: string; status: string }[]>();
    for (const c of containers) {
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
              // Surface token error early
              if (maerskTokenError) {
                results.push({
                  id: container.id,
                  carrier,
                  container_number: container.container_number,
                  error: `Maersk auth failed: ${maerskTokenError}`,
                });
                continue;
              }

              try {
                raw = await fetchMaerskTracking(container.container_number, maerskBearerToken!);
              } catch (maerskErr) {
                const msg = (maerskErr as Error).message;
                console.error(
                  `[track-containers] Maersk API error for ${container.container_number}: ${msg}`
                );
                results.push({
                  id: container.id,
                  carrier,
                  container_number: container.container_number,
                  error: `Maersk API: ${msg}`,
                  hint: "Check MAERSK_CLIENT_ID / MAERSK_CLIENT_SECRET secrets in Supabase Dashboard.",
                });
                continue;
              }

              ({ location, apiEta } = extractMaerskData(raw));
              break;
            }

            // ── Phase 2: MSC ─────────────────────────────────────────────────
            // case "msc": { ... break; }

            // ── Phase 3: CMA CGM ─────────────────────────────────────────────
            // case "cma": { ... break; }

            default:
              results.push({
                id: container.id,
                container_number: container.container_number,
                skipped: `Carrier '${carrier}' not yet implemented. Add prefix to CARRIER_BY_PREFIX and implement handler.`,
              });
              continue;
          }

          // ── Write to DB ───────────────────────────────────────────────────
          const { error: updateError } = await supabaseAdmin
            .from("containers")
            .update({
              current_location: location,
              api_eta: apiEta,
              tracking_status_raw: raw,
              last_tracking_update: new Date().toISOString(),
            })
            .eq("id", container.id);

          if (updateError) {
            console.error(
              `[track-containers] DB update failed for ${container.container_number}:`,
              updateError.message
            );
            results.push({
              id: container.id,
              carrier,
              container_number: container.container_number,
              error: `DB update: ${updateError.message}`,
            });
            continue;
          }

          console.log(
            `[track-containers] ✓ ${container.container_number}: location='${location}', eta='${apiEta}'`
          );
          results.push({
            id: container.id,
            carrier,
            container_number: container.container_number,
            location,
            apiEta,
          });
        } catch (err) {
          console.error(
            `[track-containers] Unhandled error for ${container.container_number}:`,
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
