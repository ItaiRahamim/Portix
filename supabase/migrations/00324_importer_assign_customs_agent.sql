-- ─── Fix: Importer can assign customs agent on supplier-created shipments ───────
--
-- Two problems being fixed:
--
-- 1. v_containers view did not expose customs_agent_id from the shipments join,
--    forcing the frontend to make a separate getShipmentById() call which could
--    return null (RLS edge-case) and hide the selector entirely.
--    Fix: add s.customs_agent_id to the view so it is always available on the
--    ContainerView object.
--
-- 2. The only UPDATE policy on portix.shipments was "shipments: creator can update"
--    (USING created_by = auth.uid()). When a supplier creates a shipment the
--    importer is NOT the creator, so assignCustomsAgent() ran 0 rows with no error —
--    a silent no-op.
--    Fix: add a new permissive UPDATE policy that allows any importer to update
--    shipments that contain their containers (regardless of who created the shipment).

-- ── 1. Recreate v_containers with customs_agent_id ────────────────────────────

DROP VIEW IF EXISTS portix.v_containers;

CREATE OR REPLACE VIEW portix.v_containers AS
SELECT
    c.*,
    -- Shipment details
    s.shipment_number,
    s.vessel_name,
    s.origin_country,
    s.customs_agent_id,              -- exposed so the UI never needs a separate
                                     -- getShipmentById() call to render the selector
    -- Party names (denormalized for display)
    p_imp.company_name               AS importer_company,
    p_sup.company_name               AS supplier_company
FROM portix.containers c
JOIN portix.shipments  s     ON s.id     = c.shipment_id
JOIN portix.profiles   p_imp ON p_imp.id = c.importer_id
JOIN portix.profiles   p_sup ON p_sup.id = c.supplier_id;

COMMENT ON VIEW portix.v_containers IS
    'Enriched container view with shipment and party names pre-joined. Use for all dashboard queries.';

-- ── 2. Allow importers to update shipments that contain their containers ───────
--
-- Multiple permissive UPDATE policies are OR-ed by PostgreSQL, so this does NOT
-- replace the existing "shipments: creator can update" policy — it adds a second
-- path that is used when the creator is a supplier.
--
-- Scope is intentionally broad (all columns) because:
--   a) The app only calls UPDATE { customs_agent_id } from the importer UI.
--   b) The importer is the primary commercial stakeholder in the shipment.

CREATE POLICY "shipments: importer can update own"
    ON portix.shipments
    FOR UPDATE
    TO authenticated
    USING (
        portix.is_importer()
        AND id IN (
            SELECT shipment_id
              FROM portix.containers
             WHERE importer_id = auth.uid()
        )
    )
    WITH CHECK (
        portix.is_importer()
        AND id IN (
            SELECT shipment_id
              FROM portix.containers
             WHERE importer_id = auth.uid()
        )
    );
