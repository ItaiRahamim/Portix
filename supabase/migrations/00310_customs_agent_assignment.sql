-- ─── Customs Agent Assignment ──────────────────────────────────────────────
-- Allows importers to assign a specific customs agent to a shipment.
-- Once assigned, only that agent can see the containers in that shipment.

ALTER TABLE portix.shipments
  ADD COLUMN IF NOT EXISTS customs_agent_id UUID REFERENCES portix.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_shipments_customs_agent_id ON portix.shipments(customs_agent_id);

COMMENT ON COLUMN portix.shipments.customs_agent_id IS
  'UUID of the assigned customs agent (role=customs). If set, only this agent can view the containers in this shipment.';
