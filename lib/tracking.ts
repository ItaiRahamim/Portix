/**
 * Portix — Carrier tracking helpers.
 *
 * Single source of truth for:
 *   1. The set of carriers Portix recognises (canonical lowercase keys).
 *   2. How to map an arbitrary AI / human carrier string to a canonical key.
 *   3. How to build the official carrier tracking URL for a container number.
 *
 * The container number is shown as a clickable external link in the dashboard
 * tables and on the container detail page when both `carrier` and
 * `container_number` are present and `getTrackingLink()` returns non-null.
 *
 * NOTE: Supabase Edge Functions (Deno) cannot import from this file; the
 * `normalizeCarrier()` function is duplicated verbatim into:
 *   - supabase/functions/parse-shipment/index.ts
 *   - supabase/functions/classify-documents/index.ts
 * Keep those copies in sync if this file changes.
 */

/** Canonical carrier identifier — lowercase, kebab-case. */
export type CarrierKey =
  | 'msc'
  | 'maersk'
  | 'zim'
  | 'hapag-lloyd'
  | 'cma-cgm'
  | 'evergreen'
  | 'cosco'
  | 'one'
  | 'yang-ming'
  | 'hmm';

/**
 * Map an arbitrary carrier string (AI output, manual entry, marketing name) to
 * a canonical {@link CarrierKey}. Returns `null` when no match is found —
 * unknown carriers must NOT be persisted as the raw string (DB stays clean).
 *
 * Matching is intentionally lenient: we lowercase, strip non-alphanumerics,
 * then check substrings. "Maersk Line", "MAERSK", "maersk-line" all map to
 * `'maersk'`.
 */
export function normalizeCarrier(
  raw: string | null | undefined,
): CarrierKey | null {
  if (!raw) return null;
  const s = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!s) return null;

  if (s.includes('msc')) return 'msc';
  if (s.includes('maersk')) return 'maersk';
  if (s.includes('zim')) return 'zim';
  if (s.includes('hapag') || s.includes('lloyd')) return 'hapag-lloyd';
  if (s.includes('cmacgm') || s.includes('cma')) return 'cma-cgm';
  if (s.includes('evergreen')) return 'evergreen';
  if (s.includes('cosco')) return 'cosco';
  if (s === 'one' || s.includes('oceannetwork')) return 'one';
  if (s.includes('yangming')) return 'yang-ming';
  if (s.includes('hmm') || s.includes('hyundaimerchant')) return 'hmm';
  return null;
}

/**
 * Build the official carrier tracking URL for a given container number.
 *
 * Returns `null` when:
 *   - `containerNumber` is missing/empty
 *   - `carrier` does not normalize to a known {@link CarrierKey}
 *
 * Callers should fall back to plain text in that case (no broken links).
 */
export function getTrackingLink(
  carrier: string | null | undefined,
  containerNumber: string | null | undefined,
): string | null {
  if (!containerNumber) return null;
  const key = normalizeCarrier(carrier);
  if (!key) return null;

  const cn = encodeURIComponent(containerNumber.trim().toUpperCase());

  switch (key) {
    case 'msc':
      return `https://www.msc.com/en/track-a-shipment?agencyPath=msc&trackingNumber=${cn}`;
    case 'maersk':
      return `https://www.maersk.com/tracking/${cn}`;
    case 'zim':
      return `https://www.zim.com/tools/track-a-shipment?consnumber=${cn}`;
    case 'hapag-lloyd':
      return `https://www.hapag-lloyd.com/en/online-business/track/track-by-container-solution.html?container=${cn}`;
    case 'cma-cgm':
      return `https://www.cma-cgm.com/ebusiness/tracking/search?SearchBy=Container&Reference=${cn}`;
    case 'evergreen':
      return `https://www.shipmentlink.com/tvl2/jsp/TVL2_Cargo.jsp?bl_no=${cn}`;
    case 'cosco':
      return `https://elines.coscoshipping.com/ebusiness/cargoTracking?trackingType=CONTAINER&number=${cn}`;
    case 'one':
      return `https://ecomm.one-line.com/one-ecom/manage-shipment/cargo-tracking?trackingNumber=${cn}`;
    case 'yang-ming':
      return `https://www.yangming.com/e-service/Track_Trace/track_trace_cargo_tracking.aspx?bl_no=${cn}`;
    case 'hmm':
      return `https://www.hmm21.com/e-service/general/trackTrace/TrackTrace.do?BL_NO=${cn}`;
  }
}

/** Human-readable label for a carrier key (for UI display). */
export const CARRIER_LABELS: Record<CarrierKey, string> = {
  msc: 'MSC',
  maersk: 'Maersk',
  zim: 'ZIM',
  'hapag-lloyd': 'Hapag-Lloyd',
  'cma-cgm': 'CMA CGM',
  evergreen: 'Evergreen',
  cosco: 'COSCO',
  one: 'ONE',
  'yang-ming': 'Yang Ming',
  hmm: 'HMM',
};
