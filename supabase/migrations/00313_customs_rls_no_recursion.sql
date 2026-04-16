-- ─── Customs RLS: Flat, Recursion-Free Policies ──────────────────────────────
-- Previous policies checked portix.profiles.role inside shipments/containers/documents
-- policies, creating a circular dependency that Postgres detects as infinite recursion.
--
-- Fix: identity check ONLY. If auth.uid() matches customs_agent_id on the shipment,
-- the user has access — no role lookup needed, no cross-table recursion possible.

-- ── Drop every customs-related policy we may have created ─────────────────────

DROP POLICY IF EXISTS "customs_agents_read_containers_in_review"   ON portix.containers;
DROP POLICY IF EXISTS "customs_agents_read_assigned_containers"     ON portix.containers;
DROP POLICY IF EXISTS "customs_read_assigned_containers"            ON portix.containers;

DROP POLICY IF EXISTS "customs_agents_read_documents"               ON portix.documents;
DROP POLICY IF EXISTS "customs_agents_manage_documents"             ON portix.documents;
DROP POLICY IF EXISTS "customs_agents_read_assigned_documents"      ON portix.documents;
DROP POLICY IF EXISTS "customs_agents_manage_assigned_documents"    ON portix.documents;
DROP POLICY IF EXISTS "customs_read_assigned_documents"             ON portix.documents;
DROP POLICY IF EXISTS "customs_manage_assigned_documents"           ON portix.documents;

-- ── Shipments ─────────────────────────────────────────────────────────────────
-- Customs agent can read the shipment they are assigned to.

DROP POLICY IF EXISTS "customs_read_assigned_shipments"  ON portix.shipments;
DROP POLICY IF EXISTS "customs_agents_read_shipments"    ON portix.shipments;

CREATE POLICY "customs_read_assigned_shipments"
  ON portix.shipments
  FOR SELECT
  USING (
    -- Direct identity check — no profiles lookup, no recursion
    customs_agent_id = auth.uid()
  );

-- ── Containers ────────────────────────────────────────────────────────────────
-- Flat EXISTS against shipments only — does not touch profiles.

CREATE POLICY "customs_read_assigned_containers"
  ON portix.containers
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
        FROM portix.shipments s
       WHERE s.id                = portix.containers.shipment_id
         AND s.customs_agent_id  = auth.uid()
    )
  );

-- ── Documents (SELECT) ────────────────────────────────────────────────────────
-- One-hop JOIN: documents → containers → shipments.customs_agent_id

CREATE POLICY "customs_read_assigned_documents"
  ON portix.documents
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
        FROM portix.containers c
        JOIN portix.shipments   s ON s.id = c.shipment_id
       WHERE c.id               = portix.documents.container_id
         AND s.customs_agent_id = auth.uid()
    )
  );

-- ── Documents (UPDATE) ────────────────────────────────────────────────────────

CREATE POLICY "customs_manage_assigned_documents"
  ON portix.documents
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
        FROM portix.containers c
        JOIN portix.shipments   s ON s.id = c.shipment_id
       WHERE c.id               = portix.documents.container_id
         AND s.customs_agent_id = auth.uid()
    )
  );
