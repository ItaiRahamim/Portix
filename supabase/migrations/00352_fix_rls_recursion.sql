-- Migration: 00352_fix_rls_recursion
--
-- FIX: ERROR 42P17 infinite recursion detected in policy for relation "containers".
--
-- The loop:
--   containers RLS  → "customs_read_assigned_containers" (00313) does
--                     EXISTS(SELECT FROM portix.shipments ...) → triggers shipments RLS
--   shipments RLS   → company policy does
--                     id IN (SELECT shipment_id FROM portix.containers ...) → triggers containers RLS
--   → containers → shipments → containers → ∞
--
-- Fix: break BOTH cross-table edges with SECURITY DEFINER helper functions
-- that read the raw tables WITHOUT triggering RLS.

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1: RLS-bypass helper functions
-- ─────────────────────────────────────────────────────────────────────────────

-- True if auth.uid() is the customs agent assigned to the given shipment.
-- Reads shipments directly under definer rights → no shipments RLS triggered.
CREATE OR REPLACE FUNCTION portix.is_customs_agent_for_shipment(p_shipment_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = portix, public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM portix.shipments s
        WHERE s.id = p_shipment_id
          AND s.customs_agent_id = auth.uid()
    )
$$;

-- True if the caller's company (importer company_name OR supplier_org_id) owns
-- ANY container in the given shipment. Reads containers directly under definer
-- rights → no containers RLS triggered (breaks the loop).
CREATE OR REPLACE FUNCTION portix.does_company_own_shipment(p_shipment_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = portix, public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM portix.containers c
        WHERE c.shipment_id = p_shipment_id
          AND (
              c.importer_id = ANY(ARRAY(SELECT portix.get_company_importer_ids()))
           OR c.supplier_id = ANY(ARRAY(SELECT portix.get_company_supplier_ids()))
          )
    )
$$;

GRANT EXECUTE ON FUNCTION portix.is_customs_agent_for_shipment(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION portix.does_company_own_shipment(UUID)     TO authenticated, service_role;

COMMENT ON FUNCTION portix.is_customs_agent_for_shipment(UUID) IS
    'SECURITY DEFINER: is auth.uid() the assigned customs agent for the shipment? '
    'Reads shipments without triggering RLS — breaks containers↔shipments recursion.';
COMMENT ON FUNCTION portix.does_company_own_shipment(UUID) IS
    'SECURITY DEFINER: does the caller''s company own any container in the shipment? '
    'Reads containers without triggering RLS — breaks containers↔shipments recursion.';


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2: Remove ALL containers policies that query shipments (the recursive edge)
-- These are redundant — "containers: customs agent reads all" (is_customs_agent())
-- already covers customs SELECT with no cross-table join.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "customs_read_assigned_containers"            ON portix.containers;
DROP POLICY IF EXISTS "customs_agents_read_assigned_containers"     ON portix.containers;
DROP POLICY IF EXISTS "customs_agents_read_containers_in_review"    ON portix.containers;
DROP POLICY IF EXISTS "customs_read_containers"                     ON portix.containers;

-- Ensure the flat, non-recursive customs SELECT policy exists.
DROP POLICY IF EXISTS "containers: customs agent reads all" ON portix.containers;
CREATE POLICY "containers: customs agent reads all"
    ON portix.containers FOR SELECT TO authenticated
    USING (portix.is_customs_agent());


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3: Rewrite shipments policies to use does_company_own_shipment()
-- (no raw SELECT on containers → no recursion)
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "shipments: company importer reads"     ON portix.shipments;
DROP POLICY IF EXISTS "shipments: company supplier reads"     ON portix.shipments;
DROP POLICY IF EXISTS "shipments: company reads"              ON portix.shipments;
DROP POLICY IF EXISTS "shipments: company can insert"         ON portix.shipments;
DROP POLICY IF EXISTS "shipments: company creator can update" ON portix.shipments;

-- SELECT: company created it, or company owns a container in it.
CREATE POLICY "shipments: company reads"
    ON portix.shipments FOR SELECT TO authenticated
    USING (
        created_by = ANY(ARRAY(SELECT portix.get_company_importer_ids()))
        OR created_by = ANY(ARRAY(SELECT portix.get_company_supplier_ids()))
        OR portix.does_company_own_shipment(id)
    );

CREATE POLICY "shipments: company can insert"
    ON portix.shipments FOR INSERT TO authenticated
    WITH CHECK (
        created_by = auth.uid()
        AND portix.get_user_role() IN ('importer', 'supplier')
    );

CREATE POLICY "shipments: company creator can update"
    ON portix.shipments FOR UPDATE TO authenticated
    USING (
        created_by = ANY(ARRAY(SELECT portix.get_company_importer_ids()))
        OR created_by = ANY(ARRAY(SELECT portix.get_company_supplier_ids()))
        OR portix.does_company_own_shipment(id)
    )
    WITH CHECK (
        created_by = ANY(ARRAY(SELECT portix.get_company_importer_ids()))
        OR created_by = ANY(ARRAY(SELECT portix.get_company_supplier_ids()))
        OR portix.does_company_own_shipment(id)
    );

-- Keep flat customs SELECT (no join).
DROP POLICY IF EXISTS "shipments: customs agent reads all" ON portix.shipments;
CREATE POLICY "shipments: customs agent reads all"
    ON portix.shipments FOR SELECT TO authenticated
    USING (portix.is_customs_agent());


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4: Replace recursive customs DOCUMENT policies (they JOIN shipments)
-- with the definer helper. documents → containers → shipments was also at risk.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "customs_read_assigned_documents"   ON portix.documents;
DROP POLICY IF EXISTS "customs_manage_assigned_documents" ON portix.documents;

-- Flat role-based customs policies (no cross-table joins).
DROP POLICY IF EXISTS "documents: customs agent reads all" ON portix.documents;
CREATE POLICY "documents: customs agent reads all"
    ON portix.documents FOR SELECT TO authenticated
    USING (portix.is_customs_agent());

DROP POLICY IF EXISTS "documents: customs agent can review submitted docs" ON portix.documents;
CREATE POLICY "documents: customs agent can review submitted docs"
    ON portix.documents FOR UPDATE TO authenticated
    USING (
        portix.is_customs_agent()
        AND status IN ('uploaded', 'under_review')
    );


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 5: container_costs customs policy (00344) JOINs containers+shipments.
-- Replace with the definer helper to avoid any residual recursion path.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Customs agent can read container costs" ON portix.container_costs;
CREATE POLICY "Customs agent can read container costs"
    ON portix.container_costs FOR SELECT TO authenticated
    USING (
        portix.get_user_role() = 'customs_agent'
        AND container_id IN (
            SELECT c.id FROM portix.containers c
            WHERE portix.is_customs_agent_for_shipment(c.shipment_id)
        )
    );


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 6: activity_logs customs path — keep simple is_customs_agent() (already so)
-- No change needed; the company branch reads containers via definer-safe helpers.
-- ─────────────────────────────────────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';
