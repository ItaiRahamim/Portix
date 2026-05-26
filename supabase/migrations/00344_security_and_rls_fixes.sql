-- Migration: 00344_security_and_rls_fixes
--
-- Three security fixes:
--   1. Recreate views v_containers, v_documents_public, v_import_licenses with
--      security_invoker = true so RLS on underlying tables is enforced against
--      the calling user's identity (was bypassed via default SECURITY DEFINER).
--   2. Tighten activity_logs INSERT — replace WITH CHECK (true) with a
--      container-ownership check. Customs agent restricted to their assigned
--      containers via shipments.customs_agent_id (no log forgery).
--   3. Tighten container_costs customs_agent SELECT — restrict to containers
--      whose parent shipment is assigned to the agent (was global).
--
-- All changes use CREATE OR REPLACE (no DROP) where possible to avoid
-- cascading dependency errors. Policies are dropped+recreated since
-- PostgreSQL has no ALTER POLICY for USING/WITH CHECK clauses.


-- ── 1. Views: security_invoker = true ─────────────────────────────────────────

-- v_containers — verbatim from 00333 + security_invoker
-- DROP+CREATE (not OR REPLACE) because remote may have drifted column order
-- (Postgres OR REPLACE can only append columns, not reorder/rename).
DROP VIEW IF EXISTS portix.v_containers CASCADE;
CREATE VIEW portix.v_containers
  WITH (security_invoker = true) AS
SELECT
    c.*,
    s.shipment_number,
    s.vessel_name,
    s.origin_country,
    s.customs_agent_id,
    p_imp.company_name               AS importer_company,
    p_sup.company_name               AS supplier_company,
    d_bl.document_number             AS bill_of_lading_number
FROM portix.containers c
JOIN  portix.shipments  s     ON s.id     = c.shipment_id
JOIN  portix.profiles   p_imp ON p_imp.id = c.importer_id
JOIN  portix.profiles   p_sup ON p_sup.id = c.supplier_id
LEFT JOIN portix.documents d_bl
       ON d_bl.container_id   = c.id
      AND d_bl.document_type  = 'bill_of_lading';

COMMENT ON VIEW portix.v_containers IS
    'Enriched container view (security_invoker=true → RLS on base tables enforced for calling user).';


-- v_documents_public — hides internal_note + security_invoker
DROP VIEW IF EXISTS portix.v_documents_public CASCADE;
CREATE VIEW portix.v_documents_public
  WITH (security_invoker = true) AS
SELECT
    id,
    container_id,
    document_type,
    status,
    storage_path,
    file_name,
    file_size_bytes,
    mime_type,
    uploaded_by,
    reviewed_by,
    rejection_reason,
    document_number,
    issue_date,
    notes,
    uploaded_at,
    reviewed_at,
    created_at,
    updated_at
FROM portix.documents;

COMMENT ON VIEW portix.v_documents_public IS
    'Documents view excluding internal_note column (security_invoker=true → RLS enforced for caller).';


-- v_import_licenses — computed license_status + security_invoker
DROP VIEW IF EXISTS portix.v_import_licenses CASCADE;
CREATE VIEW portix.v_import_licenses
  WITH (security_invoker = true) AS
SELECT
    il.*,
    CASE
        WHEN il.expiration_date < CURRENT_DATE
            THEN 'expired'
        WHEN il.expiration_date <= (CURRENT_DATE + INTERVAL '30 days')
            THEN 'expiring_soon'
        ELSE 'valid'
    END                                             AS license_status,
    (il.expiration_date - CURRENT_DATE)::INT        AS days_remaining,
    p_sup.company_name                              AS supplier_company,
    p_imp.company_name                              AS importer_company
FROM portix.import_licenses il
LEFT JOIN portix.profiles p_sup ON p_sup.id = il.supplier_id
LEFT JOIN portix.profiles p_imp ON p_imp.id = il.importer_id;

COMMENT ON VIEW portix.v_import_licenses IS
    'Import licenses with computed status + party names (security_invoker=true → RLS enforced for caller).';


-- ── 2. activity_logs: tighten INSERT policy ───────────────────────────────────
-- Was: WITH CHECK (true)  → any authenticated user could forge logs.
-- Now: user must own the target container OR be the customs agent assigned to
-- the parent shipment. Mirrors container_costs policy logic.

DROP POLICY IF EXISTS "Authenticated users can log activity" ON portix.activity_logs;

CREATE POLICY "Authenticated users can log activity for accessible containers"
    ON portix.activity_logs
    FOR INSERT
    TO authenticated
    WITH CHECK (
        container_id IN (
            SELECT id FROM portix.containers
            WHERE importer_id = auth.uid()
               OR supplier_id = auth.uid()
        )
        OR (
            portix.get_user_role() = 'customs_agent'
            AND container_id IN (
                SELECT c.id FROM portix.containers c
                JOIN portix.shipments s ON s.id = c.shipment_id
                WHERE s.customs_agent_id = auth.uid()
            )
        )
    );


-- ── 3. container_costs: tighten customs_agent SELECT policy ───────────────────
-- Was: role check only → agent saw every container's costs.
-- Now: role + shipment-assignment check → agent sees only their assignments.

DROP POLICY IF EXISTS "Customs agent can read container costs" ON portix.container_costs;

CREATE POLICY "Customs agent can read container costs"
    ON portix.container_costs
    FOR SELECT
    TO authenticated
    USING (
        portix.get_user_role() = 'customs_agent'
        AND container_id IN (
            SELECT c.id FROM portix.containers c
            JOIN portix.shipments s ON s.id = c.shipment_id
            WHERE s.customs_agent_id = auth.uid()
        )
    );
