-- ─── Carrier Tracking Columns ────────────────────────────────────────────────
-- Adds live-tracking fields to portix.containers.
-- v_containers uses c.* so these columns appear there automatically.

ALTER TABLE portix.containers
  ADD COLUMN IF NOT EXISTS current_location     TEXT,
  ADD COLUMN IF NOT EXISTS api_eta              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tracking_status_raw  JSONB,
  ADD COLUMN IF NOT EXISTS last_tracking_update TIMESTAMPTZ;

COMMENT ON COLUMN portix.containers.current_location     IS 'Human-readable location from carrier API (e.g. "Port of Rotterdam")';
COMMENT ON COLUMN portix.containers.api_eta              IS 'Carrier-reported ETA — may differ from the manually-entered eta field';
COMMENT ON COLUMN portix.containers.tracking_status_raw  IS 'Full JSON response from the carrier tracking API for audit/debugging';
COMMENT ON COLUMN portix.containers.last_tracking_update IS 'Timestamp of the most recent successful carrier API poll';
