-- ═══════════════════════════════════════════════════════════════════════════
-- PORTIX — Initial Schema Migration
-- Migration: 00301_initial_schema.sql
-- Platform:  Supabase (PostgreSQL 15+)
-- Author:    Portix Engineering
--
-- Dependency order:
--   1. Schema namespace
--   2. Enum types
--   3. supplier_orgs
--   4. profiles        (extends auth.users → supplier_orgs)
--   5. shipments       (→ profiles)
--   6. containers      (→ shipments, profiles × 2)
--   7. documents       (→ containers, profiles × 2)
--   8. pre_loading_media (→ containers, profiles)
--   9. invoices        (→ profiles × 2, containers optional)
--  10. payments        (→ invoices)
--  11. claims          (→ containers, profiles × 2)
--  12. claim_messages  (→ claims, profiles)
--  13. claim_attachments (→ claim_messages)
--  14. import_licenses (→ profiles × 2)
--  15. Views (computed columns workaround for non-immutable expressions)
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 1: Schema Namespace
-- ─────────────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS portix;

-- Grant usage to authenticated and anon roles (Supabase Auth roles)
GRANT USAGE ON SCHEMA portix TO anon, authenticated, service_role;

-- Future tables in portix schema inherit these grants automatically
ALTER DEFAULT PRIVILEGES IN SCHEMA portix
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA portix
    GRANT USAGE, SELECT ON SEQUENCES TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 2: Enum Types
-- All values use lowercase snake_case (PostgreSQL convention)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TYPE portix.user_role AS ENUM (
    'importer',
    'supplier',
    'customs_agent'
);

CREATE TYPE portix.container_status AS ENUM (
    'documents_missing',
    'waiting_customs_review',
    'rejected_documents',
    'ready_for_clearance',
    'in_clearance',
    'released',
    'claim_open'
);

CREATE TYPE portix.container_type AS ENUM (
    '20ft',
    '40ft',
    '40ft_hc',
    'reefer_40ft'
);

-- The 7 REQUIRED types (enforced by application seeding logic):
--   commercial_invoice, packing_list, phytosanitary_certificate,
--   bill_of_lading, certificate_of_origin, cooling_report, insurance_certificate
CREATE TYPE portix.document_type AS ENUM (
    'commercial_invoice',
    'packing_list',
    'phytosanitary_certificate',
    'bill_of_lading',
    'certificate_of_origin',
    'cooling_report',
    'insurance_certificate',
    'customs_declaration',
    'inspection_certificate',
    'dangerous_goods_declaration',
    'import_license_doc',
    'other'
);

CREATE TYPE portix.document_status AS ENUM (
    'missing',
    'uploaded',
    'under_review',
    'approved',
    'rejected'
);

CREATE TYPE portix.invoice_status AS ENUM (
    'unpaid',
    'partially_paid',
    'paid'
);

CREATE TYPE portix.claim_status AS ENUM (
    'open',
    'under_review',
    'negotiation',
    'resolved',
    'closed'
);

CREATE TYPE portix.claim_type AS ENUM (
    'damaged_goods',
    'missing_goods',
    'short_shipment',
    'quality_issue',
    'documentation_error',
    'delay',
    'other'
);

CREATE TYPE portix.media_type AS ENUM (
    'image',
    'video',
    'document'
);


-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 3: supplier_orgs
-- Company-level supplier entity. Multiple supplier users can belong to one org.
-- Must be created BEFORE profiles (profiles.supplier_org_id → supplier_orgs).
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE portix.supplier_orgs (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name    TEXT            NOT NULL,
    country         TEXT            NOT NULL,
    address         TEXT,
    phone           TEXT,
    email           TEXT,
    tax_id          TEXT,                           -- VAT / company registration number
    currency        CHAR(3)         NOT NULL DEFAULT 'USD',
    payment_terms   TEXT,                           -- e.g. "Net 30", "L/C", "CAD"
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    notes           TEXT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

COMMENT ON TABLE portix.supplier_orgs IS
    'Company-level supplier record. A supplier user is linked via profiles.supplier_org_id.';


-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 4: profiles
-- Extends auth.users. Auto-created by handle_new_user trigger (see 00303).
-- This is the FK target for ALL user references across the schema.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE portix.profiles (
    -- id MUST match auth.users.id — Supabase Auth owns this UUID
    id              UUID            PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

    email           TEXT            NOT NULL,
    full_name       TEXT            NOT NULL DEFAULT '',
    company_name    TEXT            NOT NULL DEFAULT '',
    role            portix.user_role NOT NULL,
    phone           TEXT,
    avatar_url      TEXT,           -- Supabase Storage path in 'avatars' bucket

    -- Optional: links a supplier user to their company org
    -- NULL for importers and customs_agents
    supplier_org_id UUID            REFERENCES portix.supplier_orgs(id) ON DELETE SET NULL,

    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_role         ON portix.profiles(role);
CREATE INDEX idx_profiles_supplier_org ON portix.profiles(supplier_org_id);

COMMENT ON TABLE portix.profiles IS
    'Extends auth.users. Row auto-created on signup via handle_new_user trigger (00303).';
COMMENT ON COLUMN portix.profiles.supplier_org_id IS
    'Only set when role = ''supplier''. Links to richer company-level data in supplier_orgs.';
COMMENT ON COLUMN portix.profiles.avatar_url IS
    'Full storage path inside the Supabase Storage ''avatars'' bucket.';


-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 5: shipments
-- Vessel/voyage grouping for containers.
-- NOTE: Shipments are NEVER shown as a standalone list in the UI (Portix arch rule).
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE portix.shipments (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_number TEXT            NOT NULL UNIQUE, -- e.g. "SHP-2026-001"
    vessel_name     TEXT            NOT NULL,
    origin_port     TEXT            NOT NULL,
    destination_port TEXT           NOT NULL,
    etd             TIMESTAMPTZ     NOT NULL,        -- Estimated Time of Departure
    eta             TIMESTAMPTZ     NOT NULL,        -- Estimated Time of Arrival
    origin_country  TEXT,
    created_by      UUID            NOT NULL REFERENCES portix.profiles(id),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT chk_shipment_etd_before_eta CHECK (etd < eta)
);

CREATE INDEX idx_shipments_created_by ON portix.shipments(created_by);
CREATE INDEX idx_shipments_eta        ON portix.shipments(eta);

COMMENT ON TABLE portix.shipments IS
    'Vessel/voyage metadata. Groups containers. Never shown as a standalone UI list per Portix arch rules.';


-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 6: containers  (PRIMARY ENTITY)
-- The central operational unit. All documents, media, claims belong here.
-- Dashboard KPI counters (docs_*) are kept in sync by trigger (see 00303).
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE portix.containers (
    id                  UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
    container_number    TEXT                    NOT NULL UNIQUE, -- e.g. "MSCU1234567"
    shipment_id         UUID                    NOT NULL REFERENCES portix.shipments(id) ON DELETE RESTRICT,
    importer_id         UUID                    NOT NULL REFERENCES portix.profiles(id),
    supplier_id         UUID                    NOT NULL REFERENCES portix.profiles(id),

    -- Product (denormalized — avoids a join on every dashboard row)
    product_name        TEXT                    NOT NULL,
    hs_code             TEXT,

    -- Physical details
    container_type      portix.container_type   NOT NULL DEFAULT 'reefer_40ft',
    temperature_setting TEXT,                   -- e.g. "-1°C to +1°C" for reefer

    -- Logistics
    port_of_loading     TEXT                    NOT NULL,
    port_of_destination TEXT                    NOT NULL,
    etd                 TIMESTAMPTZ             NOT NULL,
    eta                 TIMESTAMPTZ             NOT NULL,

    -- Status state machine (see CLAUDE.md flow)
    status              portix.container_status NOT NULL DEFAULT 'documents_missing',

    -- Denormalized document progress counters
    -- Kept in sync by sync_document_counts trigger (see 00303)
    -- Used by dashboard KPI cards with zero extra queries
    docs_total          SMALLINT                NOT NULL DEFAULT 7,
    docs_uploaded       SMALLINT                NOT NULL DEFAULT 0,
    docs_approved       SMALLINT                NOT NULL DEFAULT 0,
    docs_rejected       SMALLINT                NOT NULL DEFAULT 0,

    notes               TEXT,
    created_at          TIMESTAMPTZ             NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ             NOT NULL DEFAULT now(),

    -- Business rules (enforced at DB level)
    CONSTRAINT chk_container_importer_ne_supplier CHECK (importer_id != supplier_id),
    CONSTRAINT chk_container_etd_before_eta       CHECK (etd < eta),
    CONSTRAINT chk_container_docs_non_negative    CHECK (
        docs_uploaded >= 0 AND docs_approved >= 0 AND docs_rejected >= 0
    ),
    CONSTRAINT chk_container_docs_le_total CHECK (
        docs_uploaded <= docs_total AND
        docs_approved <= docs_total AND
        docs_rejected <= docs_total
    )
);

CREATE INDEX idx_containers_status      ON portix.containers(status);
CREATE INDEX idx_containers_importer    ON portix.containers(importer_id);
CREATE INDEX idx_containers_supplier    ON portix.containers(supplier_id);
CREATE INDEX idx_containers_shipment    ON portix.containers(shipment_id);
CREATE INDEX idx_containers_eta         ON portix.containers(eta);
-- Composite index for the most common dashboard filter
CREATE INDEX idx_containers_imp_status  ON portix.containers(importer_id, status);
CREATE INDEX idx_containers_sup_status  ON portix.containers(supplier_id, status);

COMMENT ON TABLE portix.containers IS
    'PRIMARY ENTITY. Every document, media file, and claim belongs to a container.';
COMMENT ON COLUMN portix.containers.docs_total IS
    'Always 7 for standard containers (the 7 required document types). Kept in sync by trigger.';
COMMENT ON COLUMN portix.containers.docs_approved IS
    'When docs_approved = docs_total, trigger auto-advances status to ready_for_clearance.';
COMMENT ON COLUMN portix.containers.temperature_setting IS
    'Only relevant for container_type = ''reefer_40ft''. e.g. "-1°C to +1°C".';


-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 7: documents
-- One row per required document type per container.
-- 7 rows auto-seeded at container creation (status = 'missing').
-- BUSINESS RULE: rejection_reason is MANDATORY when status = 'rejected'.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE portix.documents (
    id                  UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
    container_id        UUID                    NOT NULL REFERENCES portix.containers(id) ON DELETE CASCADE,
    document_type       portix.document_type    NOT NULL,
    status              portix.document_status  NOT NULL DEFAULT 'missing',

    -- Supabase Storage (bucket: 'documents')
    -- Path pattern: documents/{container_id}/{document_type}/{filename}
    storage_path        TEXT,           -- full path inside the 'documents' bucket
    file_name           TEXT,
    file_size_bytes     BIGINT,
    mime_type           TEXT,

    -- Audit trail
    uploaded_by         UUID            REFERENCES portix.profiles(id) ON DELETE SET NULL,
    reviewed_by         UUID            REFERENCES portix.profiles(id) ON DELETE SET NULL,

    -- Rejection fields
    -- CRITICAL: rejection_reason is enforced MANDATORY by CHECK constraint below
    rejection_reason    TEXT,
    internal_note       TEXT,           -- customs agent only — excluded from documents_public view

    -- Document metadata (filled in upload modal)
    document_number     TEXT,           -- e.g. invoice number, B/L number
    issue_date          DATE,
    notes               TEXT,

    -- Timestamps
    uploaded_at         TIMESTAMPTZ,
    reviewed_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),

    -- One row per document type per container
    CONSTRAINT uq_document_per_container UNIQUE (container_id, document_type),

    -- *** PRD BUSINESS RULE: rejection requires a reason (cannot be NULL)
    CONSTRAINT chk_rejection_reason_required
        CHECK (status != 'rejected' OR rejection_reason IS NOT NULL),

    -- Storage path must be present once document is no longer 'missing'
    CONSTRAINT chk_storage_path_when_uploaded
        CHECK (
            status = 'missing'
            OR (storage_path IS NOT NULL AND file_name IS NOT NULL)
        ),

    -- Reviewed_by must be set when document is approved or rejected
    CONSTRAINT chk_reviewer_when_decided
        CHECK (
            status NOT IN ('approved', 'rejected')
            OR reviewed_by IS NOT NULL
        )
);

CREATE INDEX idx_documents_container        ON portix.documents(container_id);
CREATE INDEX idx_documents_container_status ON portix.documents(container_id, status);
CREATE INDEX idx_documents_status           ON portix.documents(status);
CREATE INDEX idx_documents_uploaded_by      ON portix.documents(uploaded_by);
CREATE INDEX idx_documents_reviewed_by      ON portix.documents(reviewed_by);

COMMENT ON TABLE portix.documents IS
    '7 rows auto-seeded per container at creation (all status=missing). See seed_container_documents trigger.';
COMMENT ON COLUMN portix.documents.internal_note IS
    'Visible to customs_agent only. Excluded from portix.v_documents_public view.';
COMMENT ON COLUMN portix.documents.rejection_reason IS
    'MANDATORY when status=rejected. Enforced by CHECK constraint chk_rejection_reason_required.';
COMMENT ON COLUMN portix.documents.storage_path IS
    'Full path within the Supabase Storage ''documents'' bucket. Use to generate signed URLs.';


-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 8: pre_loading_media
-- Cargo photos/videos uploaded by Supplier before container loading.
-- Visible to Importer. Customs Agent has NO access.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE portix.pre_loading_media (
    id              UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
    container_id    UUID                NOT NULL REFERENCES portix.containers(id) ON DELETE CASCADE,
    uploaded_by     UUID                NOT NULL REFERENCES portix.profiles(id) ON DELETE RESTRICT,
    media_type      portix.media_type   NOT NULL,

    -- Supabase Storage (bucket: 'cargo-media')
    -- Path pattern: cargo-media/{container_id}/{filename}
    storage_path    TEXT                NOT NULL,
    file_name       TEXT                NOT NULL,
    file_size_bytes BIGINT,
    mime_type       TEXT,
    thumbnail_path  TEXT,               -- optional: video thumbnail path

    comment         TEXT,
    created_at      TIMESTAMPTZ         NOT NULL DEFAULT now()
);

CREATE INDEX idx_media_container   ON portix.pre_loading_media(container_id);
CREATE INDEX idx_media_uploaded_by ON portix.pre_loading_media(uploaded_by);

COMMENT ON TABLE portix.pre_loading_media IS
    'Pre-loading cargo photos and videos. Supplier uploads, Importer reads. Customs Agent: no access (RLS).';


-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 9: invoices
-- Financial tracking between Importer and Supplier.
-- Customs Agent has NO access to any financial tables.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE portix.invoices (
    id              UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number  TEXT                    NOT NULL UNIQUE, -- e.g. "INV-2026-001"
    importer_id     UUID                    NOT NULL REFERENCES portix.profiles(id),
    supplier_id     UUID                    NOT NULL REFERENCES portix.profiles(id),

    -- Optional container link (invoice may cover multiple containers or be standalone)
    container_id    UUID                    REFERENCES portix.containers(id) ON DELETE SET NULL,

    -- Financials — NUMERIC (not FLOAT) for exact monetary values
    amount          NUMERIC(18, 2)          NOT NULL,
    paid_amount     NUMERIC(18, 2)          NOT NULL DEFAULT 0,
    currency        CHAR(3)                 NOT NULL DEFAULT 'USD',

    status          portix.invoice_status   NOT NULL DEFAULT 'unpaid',

    invoice_date    DATE                    NOT NULL,
    due_date        DATE,

    -- SWIFT payment document (Supabase Storage bucket: 'swift-documents')
    -- Path pattern: swift-documents/{importer_id}/{invoice_id}/{filename}
    swift_storage_path TEXT,
    swift_file_name TEXT,

    notes           TEXT,
    created_at      TIMESTAMPTZ             NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ             NOT NULL DEFAULT now(),

    CONSTRAINT chk_invoice_amount_positive CHECK (amount > 0),
    CONSTRAINT chk_invoice_paid_non_negative CHECK (paid_amount >= 0),
    CONSTRAINT chk_invoice_paid_le_total   CHECK (paid_amount <= amount),
    CONSTRAINT chk_invoice_importer_ne_supplier CHECK (importer_id != supplier_id)
);

CREATE INDEX idx_invoices_importer          ON portix.invoices(importer_id);
CREATE INDEX idx_invoices_supplier          ON portix.invoices(supplier_id);
CREATE INDEX idx_invoices_imp_sup           ON portix.invoices(importer_id, supplier_id);
CREATE INDEX idx_invoices_container         ON portix.invoices(container_id);
CREATE INDEX idx_invoices_status            ON portix.invoices(status);
CREATE INDEX idx_invoices_due_date          ON portix.invoices(due_date);

COMMENT ON TABLE portix.invoices IS
    'Importer↔Supplier B2B financial tracking. SWIFT upload stored in Supabase Storage.';


-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 10: payments
-- Individual payment records against an invoice.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE portix.payments (
    id          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id  UUID            NOT NULL REFERENCES portix.invoices(id) ON DELETE CASCADE,
    amount      NUMERIC(18, 2)  NOT NULL,
    currency    CHAR(3)         NOT NULL DEFAULT 'USD',
    paid_at     TIMESTAMPTZ     NOT NULL,
    reference   TEXT,           -- bank wire reference / SWIFT transfer ID
    notes       TEXT,
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT chk_payment_amount_positive CHECK (amount > 0)
);

CREATE INDEX idx_payments_invoice ON portix.payments(invoice_id);
CREATE INDEX idx_payments_paid_at ON portix.payments(paid_at DESC);


-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 11: claims
-- Container disputes between Importer and Supplier.
-- Customs Agent has NO access.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE portix.claims (
    id              UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
    container_id    UUID                    NOT NULL REFERENCES portix.containers(id) ON DELETE RESTRICT,
    importer_id     UUID                    NOT NULL REFERENCES portix.profiles(id),
    supplier_id     UUID                    NOT NULL REFERENCES portix.profiles(id),
    claim_type      portix.claim_type       NOT NULL,
    description     TEXT                    NOT NULL CHECK (length(trim(description)) > 0),
    amount          NUMERIC(18, 2),         -- nullable: some claims are non-financial
    currency        CHAR(3)                 NOT NULL DEFAULT 'USD',
    status          portix.claim_status     NOT NULL DEFAULT 'open',
    resolved_at     TIMESTAMPTZ,            -- set when status = 'resolved' or 'closed'
    created_at      TIMESTAMPTZ             NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ             NOT NULL DEFAULT now(),

    CONSTRAINT chk_claim_amount_positive    CHECK (amount IS NULL OR amount > 0),
    CONSTRAINT chk_claim_parties_differ     CHECK (importer_id != supplier_id)
);

CREATE INDEX idx_claims_container       ON portix.claims(container_id);
CREATE INDEX idx_claims_imp_sup         ON portix.claims(importer_id, supplier_id);
CREATE INDEX idx_claims_status          ON portix.claims(status);
CREATE INDEX idx_claims_created_at      ON portix.claims(created_at DESC);

COMMENT ON TABLE portix.claims IS
    'Container disputes. Both importer and supplier can read/message. Customs Agent: no access (RLS).';


-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 12: claim_messages
-- Threaded messages within a claim dispute.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE portix.claim_messages (
    id          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id    UUID            NOT NULL REFERENCES portix.claims(id) ON DELETE CASCADE,
    sender_id   UUID            NOT NULL REFERENCES portix.profiles(id) ON DELETE RESTRICT,
    message     TEXT            NOT NULL CHECK (length(trim(message)) > 0),
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX idx_claim_msgs_claim      ON portix.claim_messages(claim_id);
CREATE INDEX idx_claim_msgs_claim_time ON portix.claim_messages(claim_id, created_at ASC);
CREATE INDEX idx_claim_msgs_sender     ON portix.claim_messages(sender_id);


-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 13: claim_attachments
-- Files attached to a claim message (images, videos, documents).
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE portix.claim_attachments (
    id              UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id      UUID                NOT NULL REFERENCES portix.claim_messages(id) ON DELETE CASCADE,
    media_type      portix.media_type   NOT NULL,

    -- Supabase Storage (bucket: 'claim-attachments')
    -- Path pattern: claim-attachments/{claim_id}/{message_id}/{filename}
    storage_path    TEXT                NOT NULL,
    file_name       TEXT                NOT NULL,
    file_size_bytes BIGINT,
    mime_type       TEXT,
    created_at      TIMESTAMPTZ         NOT NULL DEFAULT now()
);

CREATE INDEX idx_claim_attachments_message ON portix.claim_attachments(message_id);


-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 14: import_licenses
-- Import license tracking per importer↔supplier pair.
-- license_status and days_remaining are computed in the view below
-- (not as GENERATED columns — CURRENT_DATE is non-immutable in PostgreSQL).
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE portix.import_licenses (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    importer_id     UUID            NOT NULL REFERENCES portix.profiles(id),
    supplier_id     UUID            NOT NULL REFERENCES portix.profiles(id),

    license_number  TEXT            NOT NULL,
    issue_date      DATE            NOT NULL,
    expiration_date DATE            NOT NULL,

    -- Supabase Storage (bucket: 'license-files')
    -- Path pattern: license-files/{importer_id}/{license_id}/{filename}
    storage_path    TEXT,
    file_name       TEXT,
    file_size_bytes BIGINT,

    notes           TEXT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT chk_license_dates CHECK (issue_date < expiration_date),
    CONSTRAINT uq_license_per_pair UNIQUE (importer_id, supplier_id, license_number)
);

CREATE INDEX idx_licenses_imp_sup    ON portix.import_licenses(importer_id, supplier_id);
CREATE INDEX idx_licenses_expiration ON portix.import_licenses(expiration_date);

COMMENT ON TABLE portix.import_licenses IS
    'Import license tracking. Use portix.v_import_licenses view to get computed status and days_remaining.';


-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 15: Views (computed columns — non-immutable expressions)
-- CURRENT_DATE cannot be used in GENERATED ALWAYS AS columns in PostgreSQL
-- because it is STABLE (not IMMUTABLE). Views are the correct solution.
-- ─────────────────────────────────────────────────────────────────────────

-- 15.1 Import Licenses with computed status + days_remaining
CREATE OR REPLACE VIEW portix.v_import_licenses AS
SELECT
    il.*,
    -- Computed: always fresh, never stale
    CASE
        WHEN il.expiration_date < CURRENT_DATE
            THEN 'expired'
        WHEN il.expiration_date <= (CURRENT_DATE + INTERVAL '30 days')
            THEN 'expiring_soon'
        ELSE 'valid'
    END                                             AS license_status,
    (il.expiration_date - CURRENT_DATE)::INT        AS days_remaining,
    -- Joined supplier name for display
    p_sup.company_name                              AS supplier_company,
    p_imp.company_name                              AS importer_company
FROM portix.import_licenses il
LEFT JOIN portix.profiles p_sup ON p_sup.id = il.supplier_id
LEFT JOIN portix.profiles p_imp ON p_imp.id = il.importer_id;

COMMENT ON VIEW portix.v_import_licenses IS
    'Always-fresh license status and days_remaining. Use this view instead of the base table in app queries.';


-- 15.2 Documents public view — hides internal_note from non-agents
-- The application queries this view for Importer and Supplier.
-- Customs Agent queries the base table directly (via RLS on reviewed_by).
CREATE OR REPLACE VIEW portix.v_documents_public AS
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
    -- internal_note intentionally EXCLUDED
    document_number,
    issue_date,
    notes,
    uploaded_at,
    reviewed_at,
    created_at,
    updated_at
FROM portix.documents;

COMMENT ON VIEW portix.v_documents_public IS
    'Excludes internal_note column. Importer and Supplier must query this view, not the base table.';


-- 15.3 Container dashboard view — enriched with joined names
-- Avoids repeated joins in every dashboard query
CREATE OR REPLACE VIEW portix.v_containers AS
SELECT
    c.*,
    -- Shipment details
    s.shipment_number,
    s.vessel_name,
    s.origin_country,
    -- Party names (denormalized for display)
    p_imp.company_name                              AS importer_company,
    p_sup.company_name                              AS supplier_company
FROM portix.containers c
JOIN portix.shipments  s     ON s.id     = c.shipment_id
JOIN portix.profiles   p_imp ON p_imp.id = c.importer_id
JOIN portix.profiles   p_sup ON p_sup.id = c.supplier_id;

COMMENT ON VIEW portix.v_containers IS
    'Enriched container view with shipment and party names pre-joined. Use for all dashboard queries.';
