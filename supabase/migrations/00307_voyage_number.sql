-- ─── Add voyage_number to portix.shipments ────────────────────────────────────
-- Required by the create_shipment_with_containers RPC (migration 00305).
-- The initial schema omitted this column; this migration adds it idempotently.

ALTER TABLE portix.shipments
  ADD COLUMN IF NOT EXISTS voyage_number TEXT;

COMMENT ON COLUMN portix.shipments.voyage_number IS 'Carrier voyage/rotation number (e.g. "123W") — optional';
