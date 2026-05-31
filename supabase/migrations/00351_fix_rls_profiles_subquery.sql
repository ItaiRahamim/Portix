-- Migration: 00351_fix_rls_profiles_subquery
--
-- EMERGENCY FIX — two root causes for 0-row dashboard after 00350:
--
-- 1. portix.profiles has RLS ENABLED in the live DB but the permissive
--    "any authenticated user can read for display" SELECT policy (00302) was
--    NEVER EXECUTED (migration was repaired-as-applied without running SQL).
--    Result: every inline `SELECT id FROM portix.profiles WHERE ...` inside
--    container/document/etc. RLS policies evaluates with deny-all on profiles
--    → the IN subqueries return empty sets → every company-level gate fails
--    → 0 rows for all tables.
--
-- 2. portix.v_containers uses security_invoker = true and does INNER JOINs
--    to portix.profiles (for importer and supplier names). That JOIN is also
--    RLS-evaluated with the calling user's context → profiles deny-all
--    → JOIN fails → v_containers returns 0 rows even for the container owner.
--
-- Fix:
--   a. Restore the profiles permissive SELECT policy for authenticated users.
--   b. Add two new SECURITY DEFINER helper functions that wrap the company-
--      member ID lookup so policies can call them instead of inline subqueries.
--      These functions bypass profiles RLS entirely (same pattern as the
--      existing get_user_role() / is_importer() helpers).
--   c. Rewrite the 00350 container + shipment + documents policies to call
--      the new functions, eliminating the inline profiles sub-selects.
--      Other tables (invoices, claims, etc.) follow the same rewrite.
--   d. Restore the minimal set of other 00302 policies that were repaired
--      but never executed, to avoid other blank sections.

-- ─────────────────────────────────────────────────────────────────────────────
-- PART A: Restore permissive profiles READ policy
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "profiles: any authenticated user can read for display" ON portix.profiles;

CREATE POLICY "profiles: any authenticated user can read for display"
    ON portix.profiles
    FOR SELECT
    TO authenticated
    USING (true);

-- Also restore the "user can read own profile" and "user can update own" if missing
DROP POLICY IF EXISTS "profiles: user can read own profile"   ON portix.profiles;
DROP POLICY IF EXISTS "profiles: user can update own profile" ON portix.profiles;

CREATE POLICY "profiles: user can read own profile"
    ON portix.profiles FOR SELECT TO authenticated
    USING (id = auth.uid());

CREATE POLICY "profiles: user can update own profile"
    ON portix.profiles FOR UPDATE TO authenticated
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());


-- ─────────────────────────────────────────────────────────────────────────────
-- PART B: SECURITY DEFINER company-member helper functions
-- These bypass profiles RLS completely (same pattern as get_user_role).
-- Returns SETOF UUID. STABLE → Postgres caches one call per query statement.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION portix.get_company_importer_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = portix, public
AS $$
    -- All profile IDs that are importers in the same company as the caller.
    -- Returns the caller's own UID even when company_name is empty (direct match).
    SELECT id FROM portix.profiles
    WHERE id = auth.uid()
       OR (
           company_name = portix.get_user_company_name()
           AND company_name != ''
       )
$$;

CREATE OR REPLACE FUNCTION portix.get_company_supplier_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = portix, public
AS $$
    -- All profile IDs that belong to the same supplier org as the caller.
    -- Returns the caller's own UID even when supplier_org_id is NULL (direct match).
    SELECT id FROM portix.profiles
    WHERE id = auth.uid()
       OR (
           supplier_org_id = portix.get_user_supplier_org_id()
           AND portix.get_user_supplier_org_id() IS NOT NULL
       )
$$;

GRANT EXECUTE ON FUNCTION portix.get_company_importer_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION portix.get_company_supplier_ids() TO authenticated, service_role;

COMMENT ON FUNCTION portix.get_company_importer_ids() IS
    'SECURITY DEFINER: returns all profile IDs in the caller''s importer company.
     Bypasses profiles RLS so policy bodies can call this safely without
     inline profiles subqueries triggering deny-all.';

COMMENT ON FUNCTION portix.get_company_supplier_ids() IS
    'SECURITY DEFINER: returns all profile IDs in the caller''s supplier org.
     Bypasses profiles RLS so policy bodies can call this safely.';


-- ─────────────────────────────────────────────────────────────────────────────
-- PART C: Rewrite company-level policies to use SECURITY DEFINER helpers
-- Replace inline `SELECT id FROM portix.profiles WHERE ...` with function calls.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── portix.containers ────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "containers: company importer reads"             ON portix.containers;
DROP POLICY IF EXISTS "containers: company supplier reads"             ON portix.containers;
DROP POLICY IF EXISTS "containers: company importer or supplier can create" ON portix.containers;
DROP POLICY IF EXISTS "containers: company importer can update"        ON portix.containers;
DROP POLICY IF EXISTS "containers: company supplier can update"        ON portix.containers;

CREATE POLICY "containers: company importer reads"
    ON portix.containers FOR SELECT TO authenticated
    USING (
        portix.is_importer()
        AND importer_id = ANY(ARRAY(SELECT portix.get_company_importer_ids()))
    );

CREATE POLICY "containers: company supplier reads"
    ON portix.containers FOR SELECT TO authenticated
    USING (
        portix.is_supplier()
        AND supplier_id = ANY(ARRAY(SELECT portix.get_company_supplier_ids()))
    );

CREATE POLICY "containers: company importer or supplier can create"
    ON portix.containers FOR INSERT TO authenticated
    WITH CHECK (
        (portix.is_importer() AND importer_id = ANY(ARRAY(SELECT portix.get_company_importer_ids())))
        OR
        (portix.is_supplier() AND supplier_id = ANY(ARRAY(SELECT portix.get_company_supplier_ids())))
    );

CREATE POLICY "containers: company importer can update"
    ON portix.containers FOR UPDATE TO authenticated
    USING  (portix.is_importer() AND importer_id = ANY(ARRAY(SELECT portix.get_company_importer_ids())))
    WITH CHECK (importer_id = ANY(ARRAY(SELECT portix.get_company_importer_ids())));

CREATE POLICY "containers: company supplier can update"
    ON portix.containers FOR UPDATE TO authenticated
    USING  (portix.is_supplier() AND supplier_id = ANY(ARRAY(SELECT portix.get_company_supplier_ids())))
    WITH CHECK (supplier_id = ANY(ARRAY(SELECT portix.get_company_supplier_ids())));


-- ── portix.shipments ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "shipments: company importer reads"    ON portix.shipments;
DROP POLICY IF EXISTS "shipments: company supplier reads"    ON portix.shipments;
DROP POLICY IF EXISTS "shipments: company can insert"        ON portix.shipments;
DROP POLICY IF EXISTS "shipments: company creator can update" ON portix.shipments;

-- Shipments: importer sees shipment if they (or company colleague) created it,
-- or if they have a container in it.
CREATE POLICY "shipments: company importer reads"
    ON portix.shipments FOR SELECT TO authenticated
    USING (
        portix.is_importer()
        AND (
            created_by = ANY(ARRAY(SELECT portix.get_company_importer_ids()))
            OR id IN (
                SELECT c.shipment_id FROM portix.containers c
                WHERE c.importer_id = ANY(ARRAY(SELECT portix.get_company_importer_ids()))
            )
        )
    );

CREATE POLICY "shipments: company supplier reads"
    ON portix.shipments FOR SELECT TO authenticated
    USING (
        portix.is_supplier()
        AND (
            created_by = ANY(ARRAY(SELECT portix.get_company_supplier_ids()))
            OR id IN (
                SELECT c.shipment_id FROM portix.containers c
                WHERE c.supplier_id = ANY(ARRAY(SELECT portix.get_company_supplier_ids()))
            )
        )
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
    )
    WITH CHECK (
        created_by = ANY(ARRAY(SELECT portix.get_company_importer_ids()))
        OR created_by = ANY(ARRAY(SELECT portix.get_company_supplier_ids()))
    );


-- ── portix.documents ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "documents: company member reads"                  ON portix.documents;
DROP POLICY IF EXISTS "documents: company member can upload"             ON portix.documents;
DROP POLICY IF EXISTS "documents: company member can update upload fields" ON portix.documents;

-- Gate macro: can user access this container_id?
-- A document is accessible if its container is accessible by the user's company.
CREATE POLICY "documents: company member reads"
    ON portix.documents FOR SELECT TO authenticated
    USING (
        container_id IN (
            SELECT id FROM portix.containers
            WHERE importer_id = ANY(ARRAY(SELECT portix.get_company_importer_ids()))
               OR supplier_id = ANY(ARRAY(SELECT portix.get_company_supplier_ids()))
        )
    );

CREATE POLICY "documents: company member can upload"
    ON portix.documents FOR INSERT TO authenticated
    WITH CHECK (
        container_id IN (
            SELECT id FROM portix.containers
            WHERE importer_id = ANY(ARRAY(SELECT portix.get_company_importer_ids()))
               OR supplier_id = ANY(ARRAY(SELECT portix.get_company_supplier_ids()))
        )
    );

CREATE POLICY "documents: company member can update upload fields"
    ON portix.documents FOR UPDATE TO authenticated
    USING (
        container_id IN (
            SELECT id FROM portix.containers
            WHERE importer_id = ANY(ARRAY(SELECT portix.get_company_importer_ids()))
               OR supplier_id = ANY(ARRAY(SELECT portix.get_company_supplier_ids()))
        )
    )
    WITH CHECK (
        container_id IN (
            SELECT id FROM portix.containers
            WHERE importer_id = ANY(ARRAY(SELECT portix.get_company_importer_ids()))
               OR supplier_id = ANY(ARRAY(SELECT portix.get_company_supplier_ids()))
        )
        AND status NOT IN ('approved')
        AND internal_note IS NULL
    );


-- ── portix.invoices ──────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "invoices: company importer reads"         ON portix.invoices;
DROP POLICY IF EXISTS "invoices: company supplier reads"         ON portix.invoices;
DROP POLICY IF EXISTS "invoices: company importer can create"    ON portix.invoices;
DROP POLICY IF EXISTS "invoices: company importer can update"    ON portix.invoices;
DROP POLICY IF EXISTS "invoices: company supplier can upload swift" ON portix.invoices;

-- Also ensure customs-agent read exists
DROP POLICY IF EXISTS "invoices: customs agent reads all for duty calculation" ON portix.invoices;
CREATE POLICY "invoices: customs agent reads all for duty calculation"
    ON portix.invoices FOR SELECT TO authenticated
    USING (portix.is_customs_agent());

CREATE POLICY "invoices: company importer reads"
    ON portix.invoices FOR SELECT TO authenticated
    USING (portix.is_importer() AND importer_id = ANY(ARRAY(SELECT portix.get_company_importer_ids())));

CREATE POLICY "invoices: company supplier reads"
    ON portix.invoices FOR SELECT TO authenticated
    USING (portix.is_supplier() AND supplier_id = ANY(ARRAY(SELECT portix.get_company_supplier_ids())));

CREATE POLICY "invoices: company importer can create"
    ON portix.invoices FOR INSERT TO authenticated
    WITH CHECK (portix.is_importer() AND importer_id = ANY(ARRAY(SELECT portix.get_company_importer_ids())));

CREATE POLICY "invoices: company importer can update"
    ON portix.invoices FOR UPDATE TO authenticated
    USING  (portix.is_importer() AND importer_id = ANY(ARRAY(SELECT portix.get_company_importer_ids())))
    WITH CHECK (importer_id = ANY(ARRAY(SELECT portix.get_company_importer_ids())));

CREATE POLICY "invoices: company supplier can upload swift"
    ON portix.invoices FOR UPDATE TO authenticated
    USING  (portix.is_supplier() AND supplier_id = ANY(ARRAY(SELECT portix.get_company_supplier_ids())))
    WITH CHECK (supplier_id = ANY(ARRAY(SELECT portix.get_company_supplier_ids())));


-- ── portix.payments ──────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "payments: company importer reads"   ON portix.payments;
DROP POLICY IF EXISTS "payments: company supplier reads"   ON portix.payments;
DROP POLICY IF EXISTS "payments: company importer can record" ON portix.payments;

CREATE POLICY "payments: company importer reads"
    ON portix.payments FOR SELECT TO authenticated
    USING (
        portix.is_importer()
        AND invoice_id IN (
            SELECT id FROM portix.invoices
            WHERE importer_id = ANY(ARRAY(SELECT portix.get_company_importer_ids()))
        )
    );

CREATE POLICY "payments: company supplier reads"
    ON portix.payments FOR SELECT TO authenticated
    USING (
        portix.is_supplier()
        AND invoice_id IN (
            SELECT id FROM portix.invoices
            WHERE supplier_id = ANY(ARRAY(SELECT portix.get_company_supplier_ids()))
        )
    );

CREATE POLICY "payments: company importer can record"
    ON portix.payments FOR INSERT TO authenticated
    WITH CHECK (
        portix.is_importer()
        AND invoice_id IN (
            SELECT id FROM portix.invoices
            WHERE importer_id = ANY(ARRAY(SELECT portix.get_company_importer_ids()))
        )
    );


-- ── portix.claims + messages + attachments ────────────────────────────────────

DROP POLICY IF EXISTS "claims: company importer reads"        ON portix.claims;
DROP POLICY IF EXISTS "claims: company supplier reads"        ON portix.claims;
DROP POLICY IF EXISTS "claims: company importer can open"     ON portix.claims;
DROP POLICY IF EXISTS "claims: company importer can update"   ON portix.claims;

CREATE POLICY "claims: company importer reads"
    ON portix.claims FOR SELECT TO authenticated
    USING (portix.is_importer() AND importer_id = ANY(ARRAY(SELECT portix.get_company_importer_ids())));

CREATE POLICY "claims: company supplier reads"
    ON portix.claims FOR SELECT TO authenticated
    USING (portix.is_supplier() AND supplier_id = ANY(ARRAY(SELECT portix.get_company_supplier_ids())));

CREATE POLICY "claims: company importer can open"
    ON portix.claims FOR INSERT TO authenticated
    WITH CHECK (
        portix.is_importer()
        AND importer_id = ANY(ARRAY(SELECT portix.get_company_importer_ids()))
        AND container_id IN (
            SELECT id FROM portix.containers
            WHERE importer_id = ANY(ARRAY(SELECT portix.get_company_importer_ids()))
        )
    );

CREATE POLICY "claims: company importer can update"
    ON portix.claims FOR UPDATE TO authenticated
    USING  (portix.is_importer() AND importer_id = ANY(ARRAY(SELECT portix.get_company_importer_ids())))
    WITH CHECK (importer_id = ANY(ARRAY(SELECT portix.get_company_importer_ids())));

-- claim_messages
DROP POLICY IF EXISTS "claim_messages: company parties can read" ON portix.claim_messages;
DROP POLICY IF EXISTS "claim_messages: company parties can send" ON portix.claim_messages;

CREATE POLICY "claim_messages: company parties can read"
    ON portix.claim_messages FOR SELECT TO authenticated
    USING (
        claim_id IN (
            SELECT id FROM portix.claims
            WHERE importer_id = ANY(ARRAY(SELECT portix.get_company_importer_ids()))
               OR supplier_id = ANY(ARRAY(SELECT portix.get_company_supplier_ids()))
        )
    );

CREATE POLICY "claim_messages: company parties can send"
    ON portix.claim_messages FOR INSERT TO authenticated
    WITH CHECK (
        sender_id = auth.uid()
        AND claim_id IN (
            SELECT id FROM portix.claims
            WHERE importer_id = ANY(ARRAY(SELECT portix.get_company_importer_ids()))
               OR supplier_id = ANY(ARRAY(SELECT portix.get_company_supplier_ids()))
        )
    );

-- claim_attachments
DROP POLICY IF EXISTS "claim_attachments: company parties can read"   ON portix.claim_attachments;
DROP POLICY IF EXISTS "claim_attachments: company parties can upload" ON portix.claim_attachments;

CREATE POLICY "claim_attachments: company parties can read"
    ON portix.claim_attachments FOR SELECT TO authenticated
    USING (
        message_id IN (
            SELECT cm.id FROM portix.claim_messages cm
            JOIN portix.claims c ON c.id = cm.claim_id
            WHERE c.importer_id = ANY(ARRAY(SELECT portix.get_company_importer_ids()))
               OR c.supplier_id = ANY(ARRAY(SELECT portix.get_company_supplier_ids()))
        )
    );

CREATE POLICY "claim_attachments: company parties can upload"
    ON portix.claim_attachments FOR INSERT TO authenticated
    WITH CHECK (
        message_id IN (
            SELECT cm.id FROM portix.claim_messages cm
            JOIN portix.claims c ON c.id = cm.claim_id
            WHERE c.importer_id = ANY(ARRAY(SELECT portix.get_company_importer_ids()))
               OR c.supplier_id = ANY(ARRAY(SELECT portix.get_company_supplier_ids()))
        )
    );


-- ── portix.activity_logs ─────────────────────────────────────────────────────

DROP POLICY IF EXISTS "activity_logs: company member reads"   ON portix.activity_logs;
DROP POLICY IF EXISTS "activity_logs: company member can log" ON portix.activity_logs;

CREATE POLICY "activity_logs: company member reads"
    ON portix.activity_logs FOR SELECT TO authenticated
    USING (
        container_id IN (
            SELECT id FROM portix.containers
            WHERE importer_id = ANY(ARRAY(SELECT portix.get_company_importer_ids()))
               OR supplier_id = ANY(ARRAY(SELECT portix.get_company_supplier_ids()))
        )
        OR portix.is_customs_agent()
    );

CREATE POLICY "activity_logs: company member can log"
    ON portix.activity_logs FOR INSERT TO authenticated
    WITH CHECK (
        container_id IN (
            SELECT id FROM portix.containers
            WHERE importer_id = ANY(ARRAY(SELECT portix.get_company_importer_ids()))
               OR supplier_id = ANY(ARRAY(SELECT portix.get_company_supplier_ids()))
        )
        OR portix.is_customs_agent()
    );


-- ── portix.container_costs ───────────────────────────────────────────────────

DROP POLICY IF EXISTS "container_costs: company member can manage" ON portix.container_costs;

CREATE POLICY "container_costs: company member can manage"
    ON portix.container_costs FOR ALL TO authenticated
    USING (
        container_id IN (
            SELECT id FROM portix.containers
            WHERE importer_id = ANY(ARRAY(SELECT portix.get_company_importer_ids()))
               OR supplier_id = ANY(ARRAY(SELECT portix.get_company_supplier_ids()))
        )
    )
    WITH CHECK (
        container_id IN (
            SELECT id FROM portix.containers
            WHERE importer_id = ANY(ARRAY(SELECT portix.get_company_importer_ids()))
               OR supplier_id = ANY(ARRAY(SELECT portix.get_company_supplier_ids()))
        )
    );


-- ── portix.pre_loading_media ─────────────────────────────────────────────────

DROP POLICY IF EXISTS "media: company member reads"        ON portix.pre_loading_media;
DROP POLICY IF EXISTS "media: company member can upload"   ON portix.pre_loading_media;
DROP POLICY IF EXISTS "media: company supplier can delete" ON portix.pre_loading_media;

CREATE POLICY "media: company member reads"
    ON portix.pre_loading_media FOR SELECT TO authenticated
    USING (
        container_id IN (
            SELECT id FROM portix.containers
            WHERE importer_id = ANY(ARRAY(SELECT portix.get_company_importer_ids()))
               OR supplier_id = ANY(ARRAY(SELECT portix.get_company_supplier_ids()))
        )
    );

CREATE POLICY "media: company member can upload"
    ON portix.pre_loading_media FOR INSERT TO authenticated
    WITH CHECK (
        container_id IN (
            SELECT id FROM portix.containers
            WHERE importer_id = ANY(ARRAY(SELECT portix.get_company_importer_ids()))
               OR supplier_id = ANY(ARRAY(SELECT portix.get_company_supplier_ids()))
        )
    );

CREATE POLICY "media: company supplier can delete"
    ON portix.pre_loading_media FOR DELETE TO authenticated
    USING (
        portix.is_supplier()
        AND container_id IN (
            SELECT id FROM portix.containers
            WHERE supplier_id = ANY(ARRAY(SELECT portix.get_company_supplier_ids()))
        )
    );


-- ── portix.import_licenses ───────────────────────────────────────────────────

DROP POLICY IF EXISTS "licenses: company importer full access" ON portix.import_licenses;
DROP POLICY IF EXISTS "licenses: company supplier reads"       ON portix.import_licenses;

CREATE POLICY "licenses: company importer full access"
    ON portix.import_licenses FOR ALL TO authenticated
    USING  (portix.is_importer() AND importer_id = ANY(ARRAY(SELECT portix.get_company_importer_ids())))
    WITH CHECK (portix.is_importer() AND importer_id = ANY(ARRAY(SELECT portix.get_company_importer_ids())));

CREATE POLICY "licenses: company supplier reads"
    ON portix.import_licenses FOR SELECT TO authenticated
    USING (portix.is_supplier() AND supplier_id = ANY(ARRAY(SELECT portix.get_company_supplier_ids())));


-- ─────────────────────────────────────────────────────────────────────────────
-- PART D: Restore missing 00302 policies for tables not covered above
-- ─────────────────────────────────────────────────────────────────────────────

-- supplier_orgs: all auth users can read (for display in company name resolution)
DROP POLICY IF EXISTS "supplier_orgs: all authenticated users can read" ON portix.supplier_orgs;
CREATE POLICY "supplier_orgs: all authenticated users can read"
    ON portix.supplier_orgs FOR SELECT TO authenticated USING (true);

-- Customs agent on shipments (from 00302, in case it was never applied)
DROP POLICY IF EXISTS "shipments: customs agent reads all" ON portix.shipments;
CREATE POLICY "shipments: customs agent reads all"
    ON portix.shipments FOR SELECT TO authenticated
    USING (portix.is_customs_agent());

-- Containers: customs agent reads all (from 00302, in case it was never applied)
DROP POLICY IF EXISTS "containers: customs agent reads all" ON portix.containers;
CREATE POLICY "containers: customs agent reads all"
    ON portix.containers FOR SELECT TO authenticated
    USING (portix.is_customs_agent());

-- Documents: customs agent reads all (from 00302)
DROP POLICY IF EXISTS "documents: customs agent reads all" ON portix.documents;
CREATE POLICY "documents: customs agent reads all"
    ON portix.documents FOR SELECT TO authenticated
    USING (portix.is_customs_agent());

-- Documents: customs agent can update (review/approve/reject) - from 00302/00313
DROP POLICY IF EXISTS "customs_manage_assigned_documents" ON portix.documents;
DROP POLICY IF EXISTS "documents: customs agent can review submitted docs" ON portix.documents;
CREATE POLICY "customs_manage_assigned_documents"
    ON portix.documents FOR UPDATE TO authenticated
    USING (
        portix.is_customs_agent()
        AND status IN ('uploaded', 'under_review')
    );


-- ─────────────────────────────────────────────────────────────────────────────
-- RELOAD
-- ─────────────────────────────────────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';
