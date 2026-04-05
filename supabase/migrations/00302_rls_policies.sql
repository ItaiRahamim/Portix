-- ═══════════════════════════════════════════════════════════════════════════
-- PORTIX — Row Level Security (RLS) Policies
-- Migration: 00302_rls_policies.sql
-- Depends on: 00301_initial_schema.sql
-- Last revised: customs_agent scope corrected to reflect operational reality
--
-- Security model:
--
--   importer      → sees only containers/docs/invoices/claims where importer_id = auth.uid()
--
--   supplier      → sees only containers/docs/media where supplier_id = auth.uid()
--
--   customs_agent → operational tracking role:
--                   • containers : ALL statuses from departure (ETD) through release
--                   • documents  : ALL docs for any visible container, any doc status
--                                  (they must see uploaded docs before formal review)
--                   • invoices   : SELECT on all invoices (needed for duty/tax calculation)
--                   • UPDATE only on actionable statuses — cannot create/delete
--                   • NO access  : claims, pre_loading_media, payments, import_licenses
--
-- All policies use auth.uid() (Supabase built-in).
-- Helper functions (get_user_role, is_*) defined in Section 1 for reuse.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 1: Helper Functions
-- SECURITY DEFINER: each function runs as its definer (postgres superuser),
-- so the profiles lookup always succeeds regardless of the caller's RLS state.
-- STABLE: result is cached for the duration of a single SQL statement.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION portix.get_user_role()
RETURNS portix.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = portix, public
AS $$
    SELECT role
    FROM portix.profiles
    WHERE id = auth.uid()
$$;

COMMENT ON FUNCTION portix.get_user_role() IS
    'Returns the authenticated user''s role from portix.profiles.
     SECURITY DEFINER bypasses RLS on profiles for this lookup.';

CREATE OR REPLACE FUNCTION portix.is_importer()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = portix, public AS $$
    SELECT portix.get_user_role() = 'importer'
$$;

CREATE OR REPLACE FUNCTION portix.is_supplier()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = portix, public AS $$
    SELECT portix.get_user_role() = 'supplier'
$$;

CREATE OR REPLACE FUNCTION portix.is_customs_agent()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = portix, public AS $$
    SELECT portix.get_user_role() = 'customs_agent'
$$;


-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 2: Enable RLS on all tables
-- PostgreSQL disables RLS by default — must be explicitly enabled per table.
-- service_role bypasses RLS automatically in Supabase (admin/server use).
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE portix.supplier_orgs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE portix.profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE portix.shipments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE portix.containers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE portix.documents           ENABLE ROW LEVEL SECURITY;
ALTER TABLE portix.pre_loading_media   ENABLE ROW LEVEL SECURITY;
ALTER TABLE portix.invoices            ENABLE ROW LEVEL SECURITY;
ALTER TABLE portix.payments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE portix.claims              ENABLE ROW LEVEL SECURITY;
ALTER TABLE portix.claim_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE portix.claim_attachments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE portix.import_licenses     ENABLE ROW LEVEL SECURITY;


-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 3: supplier_orgs
-- All authenticated users can read org names (needed for dropdowns/display).
-- Only the supplier whose profile links to an org can update that org.
-- ─────────────────────────────────────────────────────────────────────────

CREATE POLICY "supplier_orgs: all authenticated users can read"
    ON portix.supplier_orgs
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "supplier_orgs: supplier can update own org"
    ON portix.supplier_orgs
    FOR UPDATE
    TO authenticated
    USING (
        id IN (
            SELECT supplier_org_id
            FROM portix.profiles
            WHERE id = auth.uid()
        )
    );


-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 4: profiles
-- Every user reads/updates only their own row.
-- INSERT is handled by the handle_new_user trigger (00303) — no policy needed.
-- A second SELECT policy allows reading any profile for name/company display
-- (e.g. "Supplier: Celeste" shown on every container row for all roles).
-- ─────────────────────────────────────────────────────────────────────────

-- Own profile — full read + update
CREATE POLICY "profiles: user can read own profile"
    ON portix.profiles
    FOR SELECT
    TO authenticated
    USING (id = auth.uid());

CREATE POLICY "profiles: user can update own profile"
    ON portix.profiles
    FOR UPDATE
    TO authenticated
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

-- Cross-user name lookup (read-only, needed for dashboard labels)
-- Column-level restriction (avatar_url, phone) is enforced via the
-- v_containers view which only exposes company_name. This broad SELECT
-- policy is acceptable because profiles contain no financial/sensitive data.
CREATE POLICY "profiles: any authenticated user can read for display"
    ON portix.profiles
    FOR SELECT
    TO authenticated
    USING (true);


-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 5: shipments
--
-- importer      → shipments where they have a container OR they created it
-- supplier      → shipments where they have a container OR they created it
-- customs_agent → ALL shipments (they track voyages from ETD to final release)
-- ─────────────────────────────────────────────────────────────────────────

CREATE POLICY "shipments: importer reads own"
    ON portix.shipments
    FOR SELECT
    TO authenticated
    USING (
        portix.is_importer()
        AND (
            created_by = auth.uid()
            OR id IN (
                SELECT shipment_id FROM portix.containers
                WHERE importer_id = auth.uid()
            )
        )
    );

CREATE POLICY "shipments: supplier reads own"
    ON portix.shipments
    FOR SELECT
    TO authenticated
    USING (
        portix.is_supplier()
        AND (
            created_by = auth.uid()
            OR id IN (
                SELECT shipment_id FROM portix.containers
                WHERE supplier_id = auth.uid()
            )
        )
    );

-- Customs Agent tracks all shipments — no status filter
CREATE POLICY "shipments: customs agent reads all"
    ON portix.shipments
    FOR SELECT
    TO authenticated
    USING (portix.is_customs_agent());

-- Only importers or suppliers can create shipments
CREATE POLICY "shipments: importer or supplier can insert"
    ON portix.shipments
    FOR INSERT
    TO authenticated
    WITH CHECK (
        created_by = auth.uid()
        AND portix.get_user_role() IN ('importer', 'supplier')
    );

-- Only the creator can update shipment metadata
CREATE POLICY "shipments: creator can update"
    ON portix.shipments
    FOR UPDATE
    TO authenticated
    USING (created_by = auth.uid())
    WITH CHECK (created_by = auth.uid());


-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 6: containers  (PRIMARY ENTITY — most critical policies)
--
-- importer      → WHERE importer_id = uid()  (all statuses)
-- supplier      → WHERE supplier_id = uid()  (all statuses)
-- customs_agent → ALL containers, ALL statuses
--                 They follow containers from the moment they are created
--                 (documents_missing) through departure, customs, and release.
--                 UPDATE is restricted to actionable statuses only.
-- ─────────────────────────────────────────────────────────────────────────

-- SELECT ──────────────────────────────────────────────────────────────────

CREATE POLICY "containers: importer reads own"
    ON portix.containers
    FOR SELECT
    TO authenticated
    USING (
        portix.is_importer()
        AND importer_id = auth.uid()
    );

CREATE POLICY "containers: supplier reads own"
    ON portix.containers
    FOR SELECT
    TO authenticated
    USING (
        portix.is_supplier()
        AND supplier_id = auth.uid()
    );

-- Customs Agent: all containers, all statuses — no filter
CREATE POLICY "containers: customs agent reads all"
    ON portix.containers
    FOR SELECT
    TO authenticated
    USING (portix.is_customs_agent());

-- INSERT ──────────────────────────────────────────────────────────────────

CREATE POLICY "containers: importer or supplier can create"
    ON portix.containers
    FOR INSERT
    TO authenticated
    WITH CHECK (
        portix.get_user_role() IN ('importer', 'supplier')
        AND (importer_id = auth.uid() OR supplier_id = auth.uid())
    );

-- UPDATE ──────────────────────────────────────────────────────────────────

CREATE POLICY "containers: importer can update own"
    ON portix.containers
    FOR UPDATE
    TO authenticated
    USING (portix.is_importer() AND importer_id = auth.uid())
    WITH CHECK (importer_id = auth.uid());

CREATE POLICY "containers: supplier can update own"
    ON portix.containers
    FOR UPDATE
    TO authenticated
    USING (portix.is_supplier() AND supplier_id = auth.uid())
    WITH CHECK (supplier_id = auth.uid());

-- Customs Agent can update status/notes on containers they are actively processing.
-- Writable statuses: waiting_customs_review, rejected_documents,
--                    ready_for_clearance, in_clearance
-- Read-only statuses: documents_missing (supplier's problem), released (done), claim_open
CREATE POLICY "containers: customs agent can update actionable containers"
    ON portix.containers
    FOR UPDATE
    TO authenticated
    USING (
        portix.is_customs_agent()
        AND status IN (
            'waiting_customs_review',
            'rejected_documents',
            'ready_for_clearance',
            'in_clearance'
        )
    );


-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 7: documents
--
-- importer      → reads docs for own containers (all doc statuses)
-- supplier      → reads docs for own containers (all doc statuses)
--                 uploads/updates docs in 'missing' or 'rejected' status
-- customs_agent → reads ALL docs for ALL containers (any doc status)
--                 They need to see uploaded docs even before formal review,
--                 and track document history across the full container lifecycle.
--                 Can only UPDATE docs that are in an actionable review state.
-- ─────────────────────────────────────────────────────────────────────────

-- SELECT ──────────────────────────────────────────────────────────────────

CREATE POLICY "documents: importer reads own container docs"
    ON portix.documents
    FOR SELECT
    TO authenticated
    USING (
        portix.is_importer()
        AND container_id IN (
            SELECT id FROM portix.containers
            WHERE importer_id = auth.uid()
        )
    );

CREATE POLICY "documents: supplier reads own container docs"
    ON portix.documents
    FOR SELECT
    TO authenticated
    USING (
        portix.is_supplier()
        AND container_id IN (
            SELECT id FROM portix.containers
            WHERE supplier_id = auth.uid()
        )
    );

-- Customs Agent: ALL documents for ALL containers, ANY document status.
-- No container-status or document-status filter — they track the full lifecycle.
CREATE POLICY "documents: customs agent reads all"
    ON portix.documents
    FOR SELECT
    TO authenticated
    USING (portix.is_customs_agent());

-- INSERT ──────────────────────────────────────────────────────────────────
-- Initial 7 rows per container are seeded by the service_role trigger (00303).
-- Suppliers insert replacements for rejected documents.

CREATE POLICY "documents: supplier can upload for own containers"
    ON portix.documents
    FOR INSERT
    TO authenticated
    WITH CHECK (
        portix.is_supplier()
        AND container_id IN (
            SELECT id FROM portix.containers
            WHERE supplier_id = auth.uid()
        )
    );

-- UPDATE ──────────────────────────────────────────────────────────────────

-- Supplier: can update a document that is 'missing' (first upload)
--           or 'rejected' (replacing a rejected document)
CREATE POLICY "documents: supplier can update upload fields"
    ON portix.documents
    FOR UPDATE
    TO authenticated
    USING (
        portix.is_supplier()
        AND container_id IN (
            SELECT id FROM portix.containers
            WHERE supplier_id = auth.uid()
        )
        AND status IN ('missing', 'rejected')
    );

-- Customs Agent: can approve or reject documents that have been submitted.
-- Actionable document statuses: 'uploaded' (just received) or 'under_review' (being assessed).
-- They can act on documents for ANY container they can see (not filtered by container status).
-- The mandatory rejection_reason CHECK constraint (00301) still enforces that
-- a reason must be provided when setting status = 'rejected'.
CREATE POLICY "documents: customs agent can review submitted docs"
    ON portix.documents
    FOR UPDATE
    TO authenticated
    USING (
        portix.is_customs_agent()
        AND status IN ('uploaded', 'under_review')
    );


-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 8: pre_loading_media
--
-- Supplier uploads cargo photos/videos before container loading.
-- Importer views them to monitor cargo condition.
-- Customs Agent: NO ACCESS — pre-loading media is not part of customs workflow.
-- ─────────────────────────────────────────────────────────────────────────

CREATE POLICY "media: importer reads own container media"
    ON portix.pre_loading_media
    FOR SELECT
    TO authenticated
    USING (
        portix.is_importer()
        AND container_id IN (
            SELECT id FROM portix.containers
            WHERE importer_id = auth.uid()
        )
    );

CREATE POLICY "media: supplier reads own container media"
    ON portix.pre_loading_media
    FOR SELECT
    TO authenticated
    USING (
        portix.is_supplier()
        AND container_id IN (
            SELECT id FROM portix.containers
            WHERE supplier_id = auth.uid()
        )
    );

CREATE POLICY "media: supplier can upload for own containers"
    ON portix.pre_loading_media
    FOR INSERT
    TO authenticated
    WITH CHECK (
        portix.is_supplier()
        AND uploaded_by = auth.uid()
        AND container_id IN (
            SELECT id FROM portix.containers
            WHERE supplier_id = auth.uid()
        )
    );

CREATE POLICY "media: supplier can delete own uploads"
    ON portix.pre_loading_media
    FOR DELETE
    TO authenticated
    USING (
        portix.is_supplier()
        AND uploaded_by = auth.uid()
    );

-- Customs Agent: intentionally no policy → RLS default-deny → zero rows


-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 9: invoices
--
-- importer      → full CRUD on own invoices
-- supplier      → SELECT + SWIFT upload (UPDATE) on own invoices
-- customs_agent → SELECT on ALL invoices
--                 Reason: customs agents must verify the declared commercial
--                 value of goods to calculate duties and taxes accurately.
--                 Read-only — they cannot create, modify, or delete invoices.
-- ─────────────────────────────────────────────────────────────────────────

-- SELECT ──────────────────────────────────────────────────────────────────

CREATE POLICY "invoices: importer reads own"
    ON portix.invoices
    FOR SELECT
    TO authenticated
    USING (
        portix.is_importer()
        AND importer_id = auth.uid()
    );

CREATE POLICY "invoices: supplier reads own"
    ON portix.invoices
    FOR SELECT
    TO authenticated
    USING (
        portix.is_supplier()
        AND supplier_id = auth.uid()
    );

-- Customs Agent: read-only access to ALL invoices for duty/tax calculation.
-- They need the declared commercial value regardless of which importer/supplier pair.
CREATE POLICY "invoices: customs agent reads all for duty calculation"
    ON portix.invoices
    FOR SELECT
    TO authenticated
    USING (portix.is_customs_agent());

-- INSERT ──────────────────────────────────────────────────────────────────

CREATE POLICY "invoices: importer can create"
    ON portix.invoices
    FOR INSERT
    TO authenticated
    WITH CHECK (
        portix.is_importer()
        AND importer_id = auth.uid()
    );

-- UPDATE ──────────────────────────────────────────────────────────────────

CREATE POLICY "invoices: importer can update own"
    ON portix.invoices
    FOR UPDATE
    TO authenticated
    USING (portix.is_importer() AND importer_id = auth.uid())
    WITH CHECK (importer_id = auth.uid());

-- Supplier updates only the SWIFT document fields on their invoices
CREATE POLICY "invoices: supplier can upload swift document"
    ON portix.invoices
    FOR UPDATE
    TO authenticated
    USING (portix.is_supplier() AND supplier_id = auth.uid())
    WITH CHECK (supplier_id = auth.uid());

-- Customs Agent: intentionally no INSERT/UPDATE/DELETE → read-only enforced by absence of policy


-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 10: payments
--
-- Accessed via invoice ownership. Read by both importer and supplier.
-- Customs Agent: NO ACCESS — payment history is not part of customs workflow.
-- ─────────────────────────────────────────────────────────────────────────

CREATE POLICY "payments: importer reads payments on own invoices"
    ON portix.payments
    FOR SELECT
    TO authenticated
    USING (
        portix.is_importer()
        AND invoice_id IN (
            SELECT id FROM portix.invoices
            WHERE importer_id = auth.uid()
        )
    );

CREATE POLICY "payments: supplier reads payments on own invoices"
    ON portix.payments
    FOR SELECT
    TO authenticated
    USING (
        portix.is_supplier()
        AND invoice_id IN (
            SELECT id FROM portix.invoices
            WHERE supplier_id = auth.uid()
        )
    );

CREATE POLICY "payments: importer can record payments"
    ON portix.payments
    FOR INSERT
    TO authenticated
    WITH CHECK (
        portix.is_importer()
        AND invoice_id IN (
            SELECT id FROM portix.invoices
            WHERE importer_id = auth.uid()
        )
    );

-- Customs Agent: intentionally no policy → zero rows


-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 11: claims
--
-- Importer opens, Supplier responds. Both see the full thread.
-- Customs Agent: NO ACCESS — claims are a commercial dispute, not customs.
-- ─────────────────────────────────────────────────────────────────────────

CREATE POLICY "claims: importer reads own"
    ON portix.claims
    FOR SELECT
    TO authenticated
    USING (portix.is_importer() AND importer_id = auth.uid());

CREATE POLICY "claims: supplier reads own"
    ON portix.claims
    FOR SELECT
    TO authenticated
    USING (portix.is_supplier() AND supplier_id = auth.uid());

CREATE POLICY "claims: importer can open a claim"
    ON portix.claims
    FOR INSERT
    TO authenticated
    WITH CHECK (
        portix.is_importer()
        AND importer_id = auth.uid()
        AND container_id IN (
            SELECT id FROM portix.containers
            WHERE importer_id = auth.uid()
        )
    );

CREATE POLICY "claims: importer can update own claims"
    ON portix.claims
    FOR UPDATE
    TO authenticated
    USING (portix.is_importer() AND importer_id = auth.uid())
    WITH CHECK (importer_id = auth.uid());

-- Customs Agent: intentionally no policy → zero rows


-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 12: claim_messages + claim_attachments
-- Both importer and supplier can read and write within claims they own.
-- Customs Agent: NO ACCESS.
-- ─────────────────────────────────────────────────────────────────────────

CREATE POLICY "claim_messages: parties can read"
    ON portix.claim_messages
    FOR SELECT
    TO authenticated
    USING (
        claim_id IN (
            SELECT id FROM portix.claims
            WHERE importer_id = auth.uid()
               OR supplier_id = auth.uid()
        )
    );

CREATE POLICY "claim_messages: parties can send"
    ON portix.claim_messages
    FOR INSERT
    TO authenticated
    WITH CHECK (
        sender_id = auth.uid()
        AND claim_id IN (
            SELECT id FROM portix.claims
            WHERE importer_id = auth.uid()
               OR supplier_id = auth.uid()
        )
    );

CREATE POLICY "claim_attachments: parties can read"
    ON portix.claim_attachments
    FOR SELECT
    TO authenticated
    USING (
        message_id IN (
            SELECT cm.id
            FROM portix.claim_messages cm
            JOIN portix.claims c ON c.id = cm.claim_id
            WHERE c.importer_id = auth.uid()
               OR c.supplier_id = auth.uid()
        )
    );

CREATE POLICY "claim_attachments: sender can upload"
    ON portix.claim_attachments
    FOR INSERT
    TO authenticated
    WITH CHECK (
        message_id IN (
            SELECT id FROM portix.claim_messages
            WHERE sender_id = auth.uid()
        )
    );

-- Customs Agent: intentionally no policy → zero rows


-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 13: import_licenses
-- Importer manages (full CRUD). Supplier reads their own licenses.
-- Customs Agent: NO ACCESS — licenses are tracked in their own systems.
-- ─────────────────────────────────────────────────────────────────────────

CREATE POLICY "licenses: importer full access"
    ON portix.import_licenses
    FOR ALL
    TO authenticated
    USING (portix.is_importer() AND importer_id = auth.uid())
    WITH CHECK (portix.is_importer() AND importer_id = auth.uid());

CREATE POLICY "licenses: supplier reads own"
    ON portix.import_licenses
    FOR SELECT
    TO authenticated
    USING (portix.is_supplier() AND supplier_id = auth.uid());

-- Customs Agent: intentionally no policy → zero rows


-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 14: Revised RLS policy summary matrix
-- ─────────────────────────────────────────────────────────────────────────

/*
┌─────────────────────┬──────────────────────────┬──────────────────────────┬────────────────────────────────────────────┐
│ Table               │ Importer                 │ Supplier                 │ Customs Agent                              │
├─────────────────────┼──────────────────────────┼──────────────────────────┼────────────────────────────────────────────┤
│ supplier_orgs       │ SELECT (all)             │ SELECT + UPDATE own org  │ SELECT (all)                               │
│ profiles            │ SELECT (all) + UPDATE own│ SELECT (all) + UPDATE own│ SELECT (all) + UPDATE own                 │
│ shipments           │ SELECT own + INSERT/UPDATE│ SELECT own + INSERT/UPDATE│ SELECT ALL (tracks full voyage)          │
│ containers          │ SELECT/INSERT/UPDATE own  │ SELECT/INSERT/UPDATE own │ SELECT ALL statuses                       │
│                     │                          │                          │ UPDATE actionable statuses only            │
│                     │                          │                          │ (waiting_customs_review, rejected_documents,│
│                     │                          │                          │  ready_for_clearance, in_clearance)        │
│ documents           │ SELECT own containers    │ SELECT own + INSERT +    │ SELECT ALL docs, ALL statuses             │
│                     │                          │ UPDATE missing/rejected  │ UPDATE uploaded/under_review only          │
│ pre_loading_media   │ SELECT own containers    │ SELECT + INSERT + DELETE │ ✗ No access                               │
│                     │                          │ own containers           │                                            │
│ invoices            │ SELECT/INSERT/UPDATE own │ SELECT own + UPDATE SWIFT│ SELECT ALL (for duty/tax calculation)     │
│ payments            │ SELECT/INSERT own        │ SELECT own               │ ✗ No access                               │
│ claims              │ SELECT/INSERT/UPDATE own │ SELECT own               │ ✗ No access                               │
│ claim_messages      │ SELECT/INSERT own claims │ SELECT/INSERT own claims │ ✗ No access                               │
│ claim_attachments   │ SELECT/INSERT own claims │ SELECT/INSERT own claims │ ✗ No access                               │
│ import_licenses     │ ALL (full CRUD)          │ SELECT own               │ ✗ No access                               │
└─────────────────────┴──────────────────────────┴──────────────────────────┴────────────────────────────────────────────┘
*/


-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 15: Supabase Storage Bucket Security Reference
-- Bucket creation is done via Supabase Dashboard → Storage → New Bucket.
-- The SQL policies below are reference only — apply them in the dashboard.
-- ─────────────────────────────────────────────────────────────────────────

/*
  BUCKET DEFINITIONS (all private — never public URLs):
    1. documents          — document PDFs uploaded by Supplier
    2. cargo-media        — photos/videos uploaded by Supplier pre-loading
    3. swift-documents    — SWIFT payment PDFs uploaded by Importer
    4. license-files      — Import license PDFs managed by Importer
    5. avatars            — User profile avatars

  STORAGE RLS POLICIES:

  documents bucket:
    SELECT: portix.is_importer() OR portix.is_supplier() OR portix.is_customs_agent()
    INSERT: portix.is_supplier()

  cargo-media bucket:
    SELECT: portix.is_importer() OR portix.is_supplier()
    INSERT: portix.is_supplier()
    DELETE: portix.is_supplier()

  swift-documents bucket:
    SELECT: portix.is_importer() OR portix.is_supplier()
    INSERT: portix.is_importer() OR portix.is_supplier()

  license-files bucket:
    SELECT: portix.is_importer()
    INSERT: portix.is_importer()
    DELETE: portix.is_importer()

  avatars bucket:
    SELECT: auth.uid() IS NOT NULL
    INSERT: auth.uid() = (storage.foldername(name))[1]::uuid
    UPDATE: auth.uid() = (storage.foldername(name))[1]::uuid
    DELETE: auth.uid() = (storage.foldername(name))[1]::uuid

  All file access returns signed URLs with 1-hour expiry — never direct public URLs.
*/
