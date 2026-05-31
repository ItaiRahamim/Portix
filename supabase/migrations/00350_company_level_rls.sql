-- Migration: 00350_company_level_rls
--
-- CORE ARCHITECTURE SHIFT: User-level → Company-level access control.
--
-- Root cause: racheli200025@gmail.com (logged in) and racheli@portix.test
-- (importer_id on containers) are different auth users at the SAME company
-- "Arie and Hamudi North Fruits LTD". Strict uid-matching blocked the live
-- user from seeing any data.
--
-- Rule applied everywhere:
--   • Importer company: match via profiles.company_name (TEXT, guarded != '')
--   • Supplier company: match via profiles.supplier_org_id (UUID FK, guarded IS NOT NULL)
--   • Customs agent: UNCHANGED — role-based + shipment assignment FK.
--   • Writes (INSERT/UPDATE): also company-level, as colleagues must cover
--     for each other. Activity audit trail preserved via activity_logs.
--
-- Safety guards:
--   company_name != ''  — prevents empty-string default from matching
--                          all unregistered users.
--   supplier_org_id IS NOT NULL — prevents NULL from granting company access.
--
-- All helper functions are STABLE SECURITY DEFINER so Postgres caches
-- one call per query statement (not per row).

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 1: New Company Identity Helper Functions
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION portix.get_user_company_name()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = portix, public
AS $$
    SELECT company_name FROM portix.profiles WHERE id = auth.uid()
$$;

COMMENT ON FUNCTION portix.get_user_company_name() IS
    'Returns the current user''s company_name from portix.profiles.
     Returns NULL or empty string when user has no company set.
     STABLE + SECURITY DEFINER → cached once per query, bypasses profiles RLS.';

CREATE OR REPLACE FUNCTION portix.get_user_supplier_org_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = portix, public
AS $$
    SELECT supplier_org_id FROM portix.profiles WHERE id = auth.uid()
$$;

COMMENT ON FUNCTION portix.get_user_supplier_org_id() IS
    'Returns the current user''s supplier_org_id UUID from portix.profiles.
     Returns NULL for non-supplier or unlinked users.
     STABLE + SECURITY DEFINER → cached once per query.';

GRANT EXECUTE ON FUNCTION portix.get_user_company_name()    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION portix.get_user_supplier_org_id() TO authenticated, service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 2: Index for Efficient Company-Name Lookups
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_profiles_company_name
    ON portix.profiles(company_name)
    WHERE company_name != '';


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 3: portix.containers
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "containers: importer reads own"             ON portix.containers;
DROP POLICY IF EXISTS "containers: supplier reads own"             ON portix.containers;
DROP POLICY IF EXISTS "containers: importer or supplier can create" ON portix.containers;
DROP POLICY IF EXISTS "containers: importer can update own"        ON portix.containers;
DROP POLICY IF EXISTS "containers: supplier can update own"        ON portix.containers;

-- Importer company: any colleague with the same company_name can see the container.
CREATE POLICY "containers: company importer reads"
    ON portix.containers FOR SELECT TO authenticated
    USING (
        portix.is_importer()
        AND importer_id IN (
            SELECT id FROM portix.profiles
            WHERE id = auth.uid()
               OR (company_name = portix.get_user_company_name() AND company_name != '')
        )
    );

-- Supplier company: any colleague with the same supplier_org_id can see.
CREATE POLICY "containers: company supplier reads"
    ON portix.containers FOR SELECT TO authenticated
    USING (
        portix.is_supplier()
        AND supplier_id IN (
            SELECT id FROM portix.profiles
            WHERE id = auth.uid()
               OR (
                   supplier_org_id = portix.get_user_supplier_org_id()
                   AND portix.get_user_supplier_org_id() IS NOT NULL
               )
        )
    );

-- INSERT: company member can create containers on behalf of the company.
CREATE POLICY "containers: company importer or supplier can create"
    ON portix.containers FOR INSERT TO authenticated
    WITH CHECK (
        (
            portix.is_importer()
            AND importer_id IN (
                SELECT id FROM portix.profiles
                WHERE id = auth.uid()
                   OR (company_name = portix.get_user_company_name() AND company_name != '')
            )
        )
        OR (
            portix.is_supplier()
            AND supplier_id IN (
                SELECT id FROM portix.profiles
                WHERE id = auth.uid()
                   OR (
                       supplier_org_id = portix.get_user_supplier_org_id()
                       AND portix.get_user_supplier_org_id() IS NOT NULL
                   )
            )
        )
    );

-- UPDATE for importer company members.
CREATE POLICY "containers: company importer can update"
    ON portix.containers FOR UPDATE TO authenticated
    USING (
        portix.is_importer()
        AND importer_id IN (
            SELECT id FROM portix.profiles
            WHERE id = auth.uid()
               OR (company_name = portix.get_user_company_name() AND company_name != '')
        )
    )
    WITH CHECK (
        importer_id IN (
            SELECT id FROM portix.profiles
            WHERE id = auth.uid()
               OR (company_name = portix.get_user_company_name() AND company_name != '')
        )
    );

-- UPDATE for supplier company members.
CREATE POLICY "containers: company supplier can update"
    ON portix.containers FOR UPDATE TO authenticated
    USING (
        portix.is_supplier()
        AND supplier_id IN (
            SELECT id FROM portix.profiles
            WHERE id = auth.uid()
               OR (
                   supplier_org_id = portix.get_user_supplier_org_id()
                   AND portix.get_user_supplier_org_id() IS NOT NULL
               )
        )
    )
    WITH CHECK (
        supplier_id IN (
            SELECT id FROM portix.profiles
            WHERE id = auth.uid()
               OR (
                   supplier_org_id = portix.get_user_supplier_org_id()
                   AND portix.get_user_supplier_org_id() IS NOT NULL
               )
        )
    );

-- Customs-agent policies from 00302/00313 are KEPT UNCHANGED.


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 4: portix.shipments
-- NOTE: portix.shipments has NO importer_id / supplier_id columns.
-- Ownership is via: created_by (FK to profiles) or via having a container
-- in the shipment (containers.shipment_id = shipments.id, with importer/
-- supplier FK on containers).
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "shipments: importer reads own"              ON portix.shipments;
DROP POLICY IF EXISTS "shipments: supplier reads own"              ON portix.shipments;
DROP POLICY IF EXISTS "shipments: importer or supplier can insert" ON portix.shipments;
DROP POLICY IF EXISTS "shipments: creator can update"              ON portix.shipments;

-- Importer: see shipments where they (or a company colleague) created it,
-- or has a container in it.
CREATE POLICY "shipments: company importer reads"
    ON portix.shipments FOR SELECT TO authenticated
    USING (
        portix.is_importer()
        AND (
            created_by IN (
                SELECT id FROM portix.profiles
                WHERE id = auth.uid()
                   OR (company_name = portix.get_user_company_name() AND company_name != '')
            )
            OR id IN (
                SELECT c.shipment_id FROM portix.containers c
                WHERE c.importer_id IN (
                    SELECT id FROM portix.profiles
                    WHERE id = auth.uid()
                       OR (company_name = portix.get_user_company_name() AND company_name != '')
                )
            )
        )
    );

-- Supplier: same pattern via supplier_org_id.
CREATE POLICY "shipments: company supplier reads"
    ON portix.shipments FOR SELECT TO authenticated
    USING (
        portix.is_supplier()
        AND (
            created_by IN (
                SELECT id FROM portix.profiles
                WHERE id = auth.uid()
                   OR (
                       supplier_org_id = portix.get_user_supplier_org_id()
                       AND portix.get_user_supplier_org_id() IS NOT NULL
                   )
            )
            OR id IN (
                SELECT c.shipment_id FROM portix.containers c
                WHERE c.supplier_id IN (
                    SELECT id FROM portix.profiles
                    WHERE id = auth.uid()
                       OR (
                           supplier_org_id = portix.get_user_supplier_org_id()
                           AND portix.get_user_supplier_org_id() IS NOT NULL
                       )
                )
            )
        )
    );

-- INSERT: creator must be the actual session user (no impersonation on creates).
CREATE POLICY "shipments: company can insert"
    ON portix.shipments FOR INSERT TO authenticated
    WITH CHECK (
        created_by = auth.uid()
        AND portix.get_user_role() IN ('importer', 'supplier')
    );

-- UPDATE: company member of the creator can update shipment metadata.
CREATE POLICY "shipments: company creator can update"
    ON portix.shipments FOR UPDATE TO authenticated
    USING (
        created_by IN (
            SELECT id FROM portix.profiles
            WHERE id = auth.uid()
               OR (company_name = portix.get_user_company_name() AND company_name != '')
               OR (
                   supplier_org_id = portix.get_user_supplier_org_id()
                   AND portix.get_user_supplier_org_id() IS NOT NULL
               )
        )
    )
    WITH CHECK (
        created_by IN (
            SELECT id FROM portix.profiles
            WHERE id = auth.uid()
               OR (company_name = portix.get_user_company_name() AND company_name != '')
               OR (
                   supplier_org_id = portix.get_user_supplier_org_id()
                   AND portix.get_user_supplier_org_id() IS NOT NULL
               )
        )
    );

-- Customs-agent shipments policies from 00302/00313 KEPT UNCHANGED.


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 5: portix.documents
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "documents: importer reads own container docs"         ON portix.documents;
DROP POLICY IF EXISTS "documents: supplier reads own container docs"         ON portix.documents;
DROP POLICY IF EXISTS "documents: importer or supplier can upload"           ON portix.documents;
DROP POLICY IF EXISTS "documents: importer or supplier can update upload fields" ON portix.documents;
DROP POLICY IF EXISTS "documents: supplier can upload for own containers"    ON portix.documents;
DROP POLICY IF EXISTS "documents: supplier can update upload fields"         ON portix.documents;
DROP POLICY IF EXISTS "documents: supplier can delete own uploads"           ON portix.documents;

-- Gate macro for documents: via container → importer/supplier company.
-- Used in all three operations below.

CREATE POLICY "documents: company member reads"
    ON portix.documents FOR SELECT TO authenticated
    USING (
        container_id IN (
            SELECT c.id FROM portix.containers c
            WHERE c.importer_id IN (
                SELECT id FROM portix.profiles
                WHERE id = auth.uid()
                   OR (company_name = portix.get_user_company_name() AND company_name != '')
            )
            OR c.supplier_id IN (
                SELECT id FROM portix.profiles
                WHERE id = auth.uid()
                   OR (
                       supplier_org_id = portix.get_user_supplier_org_id()
                       AND portix.get_user_supplier_org_id() IS NOT NULL
                   )
            )
        )
    );

CREATE POLICY "documents: company member can upload"
    ON portix.documents FOR INSERT TO authenticated
    WITH CHECK (
        container_id IN (
            SELECT c.id FROM portix.containers c
            WHERE c.importer_id IN (
                SELECT id FROM portix.profiles
                WHERE id = auth.uid()
                   OR (company_name = portix.get_user_company_name() AND company_name != '')
            )
            OR c.supplier_id IN (
                SELECT id FROM portix.profiles
                WHERE id = auth.uid()
                   OR (
                       supplier_org_id = portix.get_user_supplier_org_id()
                       AND portix.get_user_supplier_org_id() IS NOT NULL
                   )
            )
        )
    );

CREATE POLICY "documents: company member can update upload fields"
    ON portix.documents FOR UPDATE TO authenticated
    USING (
        container_id IN (
            SELECT c.id FROM portix.containers c
            WHERE c.importer_id IN (
                SELECT id FROM portix.profiles
                WHERE id = auth.uid()
                   OR (company_name = portix.get_user_company_name() AND company_name != '')
            )
            OR c.supplier_id IN (
                SELECT id FROM portix.profiles
                WHERE id = auth.uid()
                   OR (
                       supplier_org_id = portix.get_user_supplier_org_id()
                       AND portix.get_user_supplier_org_id() IS NOT NULL
                   )
            )
        )
    )
    WITH CHECK (
        container_id IN (
            SELECT c.id FROM portix.containers c
            WHERE c.importer_id IN (
                SELECT id FROM portix.profiles
                WHERE id = auth.uid()
                   OR (company_name = portix.get_user_company_name() AND company_name != '')
            )
            OR c.supplier_id IN (
                SELECT id FROM portix.profiles
                WHERE id = auth.uid()
                   OR (
                       supplier_org_id = portix.get_user_supplier_org_id()
                       AND portix.get_user_supplier_org_id() IS NOT NULL
                   )
            )
        )
        AND status NOT IN ('approved')   -- cannot upgrade to approved via this path
        AND internal_note IS NULL        -- cannot write internal_note
    );

-- Customs-agent documents policies from 00302/00313 KEPT UNCHANGED.


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 6: portix.invoices
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "invoices: importer reads own"                         ON portix.invoices;
DROP POLICY IF EXISTS "invoices: supplier reads own"                         ON portix.invoices;
DROP POLICY IF EXISTS "invoices: importer can create"                        ON portix.invoices;
DROP POLICY IF EXISTS "invoices: importer can update own"                    ON portix.invoices;
DROP POLICY IF EXISTS "invoices: supplier can upload swift document"         ON portix.invoices;

CREATE POLICY "invoices: company importer reads"
    ON portix.invoices FOR SELECT TO authenticated
    USING (
        portix.is_importer()
        AND importer_id IN (
            SELECT id FROM portix.profiles
            WHERE id = auth.uid()
               OR (company_name = portix.get_user_company_name() AND company_name != '')
        )
    );

CREATE POLICY "invoices: company supplier reads"
    ON portix.invoices FOR SELECT TO authenticated
    USING (
        portix.is_supplier()
        AND supplier_id IN (
            SELECT id FROM portix.profiles
            WHERE id = auth.uid()
               OR (
                   supplier_org_id = portix.get_user_supplier_org_id()
                   AND portix.get_user_supplier_org_id() IS NOT NULL
               )
        )
    );

CREATE POLICY "invoices: company importer can create"
    ON portix.invoices FOR INSERT TO authenticated
    WITH CHECK (
        portix.is_importer()
        AND importer_id IN (
            SELECT id FROM portix.profiles
            WHERE id = auth.uid()
               OR (company_name = portix.get_user_company_name() AND company_name != '')
        )
    );

CREATE POLICY "invoices: company importer can update"
    ON portix.invoices FOR UPDATE TO authenticated
    USING (
        portix.is_importer()
        AND importer_id IN (
            SELECT id FROM portix.profiles
            WHERE id = auth.uid()
               OR (company_name = portix.get_user_company_name() AND company_name != '')
        )
    )
    WITH CHECK (
        importer_id IN (
            SELECT id FROM portix.profiles
            WHERE id = auth.uid()
               OR (company_name = portix.get_user_company_name() AND company_name != '')
        )
    );

CREATE POLICY "invoices: company supplier can upload swift"
    ON portix.invoices FOR UPDATE TO authenticated
    USING (
        portix.is_supplier()
        AND supplier_id IN (
            SELECT id FROM portix.profiles
            WHERE id = auth.uid()
               OR (
                   supplier_org_id = portix.get_user_supplier_org_id()
                   AND portix.get_user_supplier_org_id() IS NOT NULL
               )
        )
    )
    WITH CHECK (
        supplier_id IN (
            SELECT id FROM portix.profiles
            WHERE id = auth.uid()
               OR (
                   supplier_org_id = portix.get_user_supplier_org_id()
                   AND portix.get_user_supplier_org_id() IS NOT NULL
               )
        )
    );

-- Customs agent invoices SELECT policy KEPT UNCHANGED.


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 7: portix.payments
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "payments: importer reads payments on own invoices" ON portix.payments;
DROP POLICY IF EXISTS "payments: supplier reads payments on own invoices" ON portix.payments;
DROP POLICY IF EXISTS "payments: importer can record payments"            ON portix.payments;

CREATE POLICY "payments: company importer reads"
    ON portix.payments FOR SELECT TO authenticated
    USING (
        portix.is_importer()
        AND invoice_id IN (
            SELECT id FROM portix.invoices
            WHERE importer_id IN (
                SELECT id FROM portix.profiles
                WHERE id = auth.uid()
                   OR (company_name = portix.get_user_company_name() AND company_name != '')
            )
        )
    );

CREATE POLICY "payments: company supplier reads"
    ON portix.payments FOR SELECT TO authenticated
    USING (
        portix.is_supplier()
        AND invoice_id IN (
            SELECT id FROM portix.invoices
            WHERE supplier_id IN (
                SELECT id FROM portix.profiles
                WHERE id = auth.uid()
                   OR (
                       supplier_org_id = portix.get_user_supplier_org_id()
                       AND portix.get_user_supplier_org_id() IS NOT NULL
                   )
            )
        )
    );

CREATE POLICY "payments: company importer can record"
    ON portix.payments FOR INSERT TO authenticated
    WITH CHECK (
        portix.is_importer()
        AND invoice_id IN (
            SELECT id FROM portix.invoices
            WHERE importer_id IN (
                SELECT id FROM portix.profiles
                WHERE id = auth.uid()
                   OR (company_name = portix.get_user_company_name() AND company_name != '')
            )
        )
    );


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 8: portix.claims + portix.claim_messages + portix.claim_attachments
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "claims: importer reads own"       ON portix.claims;
DROP POLICY IF EXISTS "claims: supplier reads own"       ON portix.claims;
DROP POLICY IF EXISTS "claims: importer can open a claim" ON portix.claims;
DROP POLICY IF EXISTS "claims: importer can update own claims" ON portix.claims;

CREATE POLICY "claims: company importer reads"
    ON portix.claims FOR SELECT TO authenticated
    USING (
        portix.is_importer()
        AND importer_id IN (
            SELECT id FROM portix.profiles
            WHERE id = auth.uid()
               OR (company_name = portix.get_user_company_name() AND company_name != '')
        )
    );

CREATE POLICY "claims: company supplier reads"
    ON portix.claims FOR SELECT TO authenticated
    USING (
        portix.is_supplier()
        AND supplier_id IN (
            SELECT id FROM portix.profiles
            WHERE id = auth.uid()
               OR (
                   supplier_org_id = portix.get_user_supplier_org_id()
                   AND portix.get_user_supplier_org_id() IS NOT NULL
               )
        )
    );

CREATE POLICY "claims: company importer can open"
    ON portix.claims FOR INSERT TO authenticated
    WITH CHECK (
        portix.is_importer()
        AND importer_id IN (
            SELECT id FROM portix.profiles
            WHERE id = auth.uid()
               OR (company_name = portix.get_user_company_name() AND company_name != '')
        )
        AND container_id IN (
            SELECT id FROM portix.containers
            WHERE importer_id IN (
                SELECT id FROM portix.profiles
                WHERE id = auth.uid()
                   OR (company_name = portix.get_user_company_name() AND company_name != '')
            )
        )
    );

CREATE POLICY "claims: company importer can update"
    ON portix.claims FOR UPDATE TO authenticated
    USING (
        portix.is_importer()
        AND importer_id IN (
            SELECT id FROM portix.profiles
            WHERE id = auth.uid()
               OR (company_name = portix.get_user_company_name() AND company_name != '')
        )
    )
    WITH CHECK (
        importer_id IN (
            SELECT id FROM portix.profiles
            WHERE id = auth.uid()
               OR (company_name = portix.get_user_company_name() AND company_name != '')
        )
    );

-- claim_messages

DROP POLICY IF EXISTS "claim_messages: parties can read" ON portix.claim_messages;
DROP POLICY IF EXISTS "claim_messages: parties can send" ON portix.claim_messages;

CREATE POLICY "claim_messages: company parties can read"
    ON portix.claim_messages FOR SELECT TO authenticated
    USING (
        claim_id IN (
            SELECT id FROM portix.claims
            WHERE importer_id IN (
                SELECT id FROM portix.profiles
                WHERE id = auth.uid()
                   OR (company_name = portix.get_user_company_name() AND company_name != '')
            )
            OR supplier_id IN (
                SELECT id FROM portix.profiles
                WHERE id = auth.uid()
                   OR (
                       supplier_org_id = portix.get_user_supplier_org_id()
                       AND portix.get_user_supplier_org_id() IS NOT NULL
                   )
            )
        )
    );

CREATE POLICY "claim_messages: company parties can send"
    ON portix.claim_messages FOR INSERT TO authenticated
    WITH CHECK (
        sender_id = auth.uid()   -- actual sender must be the session user (no impersonation)
        AND claim_id IN (
            SELECT id FROM portix.claims
            WHERE importer_id IN (
                SELECT id FROM portix.profiles
                WHERE id = auth.uid()
                   OR (company_name = portix.get_user_company_name() AND company_name != '')
            )
            OR supplier_id IN (
                SELECT id FROM portix.profiles
                WHERE id = auth.uid()
                   OR (
                       supplier_org_id = portix.get_user_supplier_org_id()
                       AND portix.get_user_supplier_org_id() IS NOT NULL
                   )
            )
        )
    );

-- claim_attachments

DROP POLICY IF EXISTS "claim_attachments: parties can read"  ON portix.claim_attachments;
DROP POLICY IF EXISTS "claim_attachments: sender can upload" ON portix.claim_attachments;

CREATE POLICY "claim_attachments: company parties can read"
    ON portix.claim_attachments FOR SELECT TO authenticated
    USING (
        message_id IN (
            SELECT cm.id FROM portix.claim_messages cm
            JOIN portix.claims c ON c.id = cm.claim_id
            WHERE c.importer_id IN (
                SELECT id FROM portix.profiles
                WHERE id = auth.uid()
                   OR (company_name = portix.get_user_company_name() AND company_name != '')
            )
            OR c.supplier_id IN (
                SELECT id FROM portix.profiles
                WHERE id = auth.uid()
                   OR (
                       supplier_org_id = portix.get_user_supplier_org_id()
                       AND portix.get_user_supplier_org_id() IS NOT NULL
                   )
            )
        )
    );

CREATE POLICY "claim_attachments: company parties can upload"
    ON portix.claim_attachments FOR INSERT TO authenticated
    WITH CHECK (
        message_id IN (
            SELECT cm.id FROM portix.claim_messages cm
            JOIN portix.claims c ON c.id = cm.claim_id
            WHERE c.importer_id IN (
                SELECT id FROM portix.profiles
                WHERE id = auth.uid()
                   OR (company_name = portix.get_user_company_name() AND company_name != '')
            )
            OR c.supplier_id IN (
                SELECT id FROM portix.profiles
                WHERE id = auth.uid()
                   OR (
                       supplier_org_id = portix.get_user_supplier_org_id()
                       AND portix.get_user_supplier_org_id() IS NOT NULL
                   )
            )
        )
    );


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 9: portix.activity_logs
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Authenticated users can log activity for accessible containers" ON portix.activity_logs;
DROP POLICY IF EXISTS "Authenticated users can log activity"                           ON portix.activity_logs;
DROP POLICY IF EXISTS "Users can read logs for their containers"                       ON portix.activity_logs;

CREATE POLICY "activity_logs: company member reads"
    ON portix.activity_logs FOR SELECT TO authenticated
    USING (
        container_id IN (
            SELECT c.id FROM portix.containers c
            WHERE c.importer_id IN (
                SELECT id FROM portix.profiles
                WHERE id = auth.uid()
                   OR (company_name = portix.get_user_company_name() AND company_name != '')
            )
            OR c.supplier_id IN (
                SELECT id FROM portix.profiles
                WHERE id = auth.uid()
                   OR (
                       supplier_org_id = portix.get_user_supplier_org_id()
                       AND portix.get_user_supplier_org_id() IS NOT NULL
                   )
            )
        )
        OR portix.is_customs_agent()
    );

CREATE POLICY "activity_logs: company member can log"
    ON portix.activity_logs FOR INSERT TO authenticated
    WITH CHECK (
        container_id IN (
            SELECT c.id FROM portix.containers c
            WHERE c.importer_id IN (
                SELECT id FROM portix.profiles
                WHERE id = auth.uid()
                   OR (company_name = portix.get_user_company_name() AND company_name != '')
            )
            OR c.supplier_id IN (
                SELECT id FROM portix.profiles
                WHERE id = auth.uid()
                   OR (
                       supplier_org_id = portix.get_user_supplier_org_id()
                       AND portix.get_user_supplier_org_id() IS NOT NULL
                   )
            )
        )
        OR portix.is_customs_agent()
    );


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 10: portix.container_costs
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Importer/supplier can manage their container costs" ON portix.container_costs;

CREATE POLICY "container_costs: company member can manage"
    ON portix.container_costs FOR ALL TO authenticated
    USING (
        container_id IN (
            SELECT c.id FROM portix.containers c
            WHERE c.importer_id IN (
                SELECT id FROM portix.profiles
                WHERE id = auth.uid()
                   OR (company_name = portix.get_user_company_name() AND company_name != '')
            )
            OR c.supplier_id IN (
                SELECT id FROM portix.profiles
                WHERE id = auth.uid()
                   OR (
                       supplier_org_id = portix.get_user_supplier_org_id()
                       AND portix.get_user_supplier_org_id() IS NOT NULL
                   )
            )
        )
    )
    WITH CHECK (
        container_id IN (
            SELECT c.id FROM portix.containers c
            WHERE c.importer_id IN (
                SELECT id FROM portix.profiles
                WHERE id = auth.uid()
                   OR (company_name = portix.get_user_company_name() AND company_name != '')
            )
            OR c.supplier_id IN (
                SELECT id FROM portix.profiles
                WHERE id = auth.uid()
                   OR (
                       supplier_org_id = portix.get_user_supplier_org_id()
                       AND portix.get_user_supplier_org_id() IS NOT NULL
                   )
            )
        )
    );

-- Customs agent container_costs policy from 00344 KEPT UNCHANGED.


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 11: portix.pre_loading_media
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "media: importer reads own container media"   ON portix.pre_loading_media;
DROP POLICY IF EXISTS "media: supplier reads own container media"   ON portix.pre_loading_media;
DROP POLICY IF EXISTS "media: supplier can upload for own containers" ON portix.pre_loading_media;
DROP POLICY IF EXISTS "media: supplier can delete own uploads"      ON portix.pre_loading_media;

CREATE POLICY "media: company member reads"
    ON portix.pre_loading_media FOR SELECT TO authenticated
    USING (
        container_id IN (
            SELECT c.id FROM portix.containers c
            WHERE c.importer_id IN (
                SELECT id FROM portix.profiles
                WHERE id = auth.uid()
                   OR (company_name = portix.get_user_company_name() AND company_name != '')
            )
            OR c.supplier_id IN (
                SELECT id FROM portix.profiles
                WHERE id = auth.uid()
                   OR (
                       supplier_org_id = portix.get_user_supplier_org_id()
                       AND portix.get_user_supplier_org_id() IS NOT NULL
                   )
            )
        )
    );

CREATE POLICY "media: company member can upload"
    ON portix.pre_loading_media FOR INSERT TO authenticated
    WITH CHECK (
        container_id IN (
            SELECT c.id FROM portix.containers c
            WHERE c.importer_id IN (
                SELECT id FROM portix.profiles
                WHERE id = auth.uid()
                   OR (company_name = portix.get_user_company_name() AND company_name != '')
            )
            OR c.supplier_id IN (
                SELECT id FROM portix.profiles
                WHERE id = auth.uid()
                   OR (
                       supplier_org_id = portix.get_user_supplier_org_id()
                       AND portix.get_user_supplier_org_id() IS NOT NULL
                   )
            )
        )
    );

CREATE POLICY "media: company supplier can delete"
    ON portix.pre_loading_media FOR DELETE TO authenticated
    USING (
        portix.is_supplier()
        AND container_id IN (
            SELECT c.id FROM portix.containers c
            WHERE c.supplier_id IN (
                SELECT id FROM portix.profiles
                WHERE id = auth.uid()
                   OR (
                       supplier_org_id = portix.get_user_supplier_org_id()
                       AND portix.get_user_supplier_org_id() IS NOT NULL
                   )
            )
        )
    );


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 12: portix.import_licenses
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "licenses: importer full access" ON portix.import_licenses;
DROP POLICY IF EXISTS "licenses: supplier reads own"   ON portix.import_licenses;

CREATE POLICY "licenses: company importer full access"
    ON portix.import_licenses FOR ALL TO authenticated
    USING (
        portix.is_importer()
        AND importer_id IN (
            SELECT id FROM portix.profiles
            WHERE id = auth.uid()
               OR (company_name = portix.get_user_company_name() AND company_name != '')
        )
    )
    WITH CHECK (
        portix.is_importer()
        AND importer_id IN (
            SELECT id FROM portix.profiles
            WHERE id = auth.uid()
               OR (company_name = portix.get_user_company_name() AND company_name != '')
        )
    );

CREATE POLICY "licenses: company supplier reads"
    ON portix.import_licenses FOR SELECT TO authenticated
    USING (
        portix.is_supplier()
        AND supplier_id IN (
            SELECT id FROM portix.profiles
            WHERE id = auth.uid()
               OR (
                   supplier_org_id = portix.get_user_supplier_org_id()
                   AND portix.get_user_supplier_org_id() IS NOT NULL
               )
        )
    );


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 13: Update portix.get_container_documents RPC
-- Add company-level gate on top of direct uid matching.
-- Return type is unchanged (matches 00349 exactly).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION portix.get_container_documents(p_container_id UUID)
RETURNS TABLE (
    id                   UUID,
    container_id         UUID,
    document_type        portix.document_type,
    status               portix.document_status,
    storage_path         TEXT,
    file_name            TEXT,
    file_size_bytes      BIGINT,
    mime_type            TEXT,
    uploaded_by          UUID,
    reviewed_by          UUID,
    rejection_reason     TEXT,
    internal_note        TEXT,
    document_number      TEXT,
    issue_date           DATE,
    notes                TEXT,
    uploaded_at          TIMESTAMPTZ,
    reviewed_at          TIMESTAMPTZ,
    created_at           TIMESTAMPTZ,
    updated_at           TIMESTAMPTZ,
    importer_approved_at TIMESTAMPTZ,
    agent_approved_at    TIMESTAMPTZ,
    ai_data              JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = portix, public
AS $$
  SELECT
      d.id,
      d.container_id,
      d.document_type,
      d.status,
      d.storage_path,
      d.file_name,
      d.file_size_bytes,
      d.mime_type,
      d.uploaded_by,
      d.reviewed_by,
      d.rejection_reason,
      CASE WHEN portix.is_customs_agent() THEN d.internal_note ELSE NULL END AS internal_note,
      d.document_number,
      d.issue_date,
      d.notes,
      d.uploaded_at,
      d.reviewed_at,
      d.created_at,
      d.updated_at,
      d.importer_approved_at,
      d.agent_approved_at,
      d.ai_data
  FROM portix.documents d
  WHERE d.container_id = p_container_id
    AND auth.uid() IS NOT NULL
    AND (
        -- ── Direct uid ownership ───────────────────────────────────────────
        auth.uid() IN (
            SELECT c.importer_id FROM portix.containers c WHERE c.id = p_container_id
            UNION ALL
            SELECT c.supplier_id FROM portix.containers c WHERE c.id = p_container_id
        )
        OR
        -- ── Company-level: importer colleague ─────────────────────────────
        (
            portix.get_user_role() = 'importer'
            AND portix.get_user_company_name() != ''
            AND portix.get_user_company_name() = (
                SELECT p.company_name
                FROM portix.containers c
                JOIN portix.profiles p ON p.id = c.importer_id
                WHERE c.id = p_container_id
            )
        )
        OR
        -- ── Company-level: supplier colleague ─────────────────────────────
        (
            portix.get_user_role() = 'supplier'
            AND portix.get_user_supplier_org_id() IS NOT NULL
            AND portix.get_user_supplier_org_id() = (
                SELECT p.supplier_org_id
                FROM portix.containers c
                JOIN portix.profiles p ON p.id = c.supplier_id
                WHERE c.id = p_container_id
            )
        )
        OR
        -- ── Customs agent: assigned FK or role ────────────────────────────
        auth.uid() = (
            SELECT s.customs_agent_id
            FROM portix.shipments s
            JOIN portix.containers c ON c.shipment_id = s.id
            WHERE c.id = p_container_id
            LIMIT 1
        )
        OR portix.is_customs_agent()
    )
  ORDER BY d.document_type;
$$;

GRANT EXECUTE ON FUNCTION portix.get_container_documents(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION portix.get_container_documents(UUID) IS
    'Returns container documents for any company member of the container''s '
    'importer or supplier, or for customs agents. Company-level: importer via '
    'company_name match, supplier via supplier_org_id match. '
    'SECURITY DEFINER LANGUAGE sql. internal_note only for customs agents.';


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 14: Update portix.match_user_document_chunks RPC (AI copilot)
-- Widen from uid-only to company-level so the AI sees company containers.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION portix.match_user_document_chunks(
    query_embedding public.vector(768),
    match_threshold FLOAT,
    match_count     INT
)
RETURNS TABLE (
    id           UUID,
    document_id  UUID,
    container_id UUID,
    content      TEXT,
    similarity   FLOAT,
    metadata     JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = portix, public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        dc.id,
        dc.document_id,
        dc.container_id,
        dc.content,
        (1 - (dc.embedding <=> query_embedding))::FLOAT AS similarity,
        dc.metadata
    FROM portix.document_chunks dc
    WHERE
        dc.container_id IN (
            -- Containers the user owns or their company colleagues own (importer side)
            SELECT c.id
            FROM portix.containers c
            JOIN portix.profiles p ON p.id = c.importer_id
            WHERE p.id = auth.uid()
               OR (p.company_name = portix.get_user_company_name() AND p.company_name != '')
            UNION
            -- Containers the user's supplier company owns
            SELECT c.id
            FROM portix.containers c
            JOIN portix.profiles p ON p.id = c.supplier_id
            WHERE p.id = auth.uid()
               OR (
                   p.supplier_org_id = portix.get_user_supplier_org_id()
                   AND portix.get_user_supplier_org_id() IS NOT NULL
               )
            UNION
            -- Containers a customs agent can see in their queue
            SELECT c.id
            FROM portix.containers c
            WHERE portix.get_user_role() = 'customs_agent'
              AND c.status IN ('waiting_customs_review', 'in_clearance')
        )
        AND (1 - (dc.embedding <=> query_embedding)) >= match_threshold
    ORDER BY dc.embedding <=> query_embedding ASC
    LIMIT match_count;
END;
$$;

GRANT EXECUTE ON FUNCTION portix.match_user_document_chunks(
    public.vector(768), FLOAT, INT
) TO authenticated, service_role;

COMMENT ON FUNCTION portix.match_user_document_chunks IS
    'User + company scoped cosine similarity search across portix.document_chunks. '
    'Returns top match_count chunks above match_threshold from every container '
    'the caller or their company colleagues can see. Powers the Porty global copilot.';


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 15: Reload PostgREST schema cache
-- ─────────────────────────────────────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';
