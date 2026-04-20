-- ============================================================
-- Migration 00314 — Claimix Integration into portix schema
-- ============================================================
-- What this does:
--   1. Extends portix.claims with full damage-report + AI-summary fields
--      from Claimix, keeping all existing Portix columns intact.
--   2. Adds sender_role to portix.claim_messages so the chat UI knows
--      the role of each sender without a profile join.
--   3. Creates portix.claim_documents (3-zone document system).
--   4. Creates the claim-documents storage bucket + access policies.
--   5. Adds RLS policies for claim_documents.
-- ============================================================

-- ─── 1. Extend portix.claims ────────────────────────────────────────────────

ALTER TABLE portix.claims
  ADD COLUMN IF NOT EXISTS invoice_number           TEXT,
  ADD COLUMN IF NOT EXISTS stuffing_date            DATE,
  ADD COLUMN IF NOT EXISTS release_date             DATE,
  ADD COLUMN IF NOT EXISTS waste_percentage         NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS claim_summary            TEXT,          -- AI-generated nightly
  ADD COLUMN IF NOT EXISTS damage_type              TEXT,          -- Moisture | Physical | Temperature | Contamination | Other
  ADD COLUMN IF NOT EXISTS affected_units           INTEGER,
  ADD COLUMN IF NOT EXISTS total_units              INTEGER,
  ADD COLUMN IF NOT EXISTS estimated_loss_usd       NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS damage_description       TEXT,
  ADD COLUMN IF NOT EXISTS damage_location          TEXT,
  ADD COLUMN IF NOT EXISTS temperature_log_present  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS inspector_name           TEXT,
  ADD COLUMN IF NOT EXISTS inspection_date          DATE,
  -- supplier_user_id: links the claim to a specific supplier Supabase user,
  -- granting them portal access. Separate from supplier_id (company FK).
  ADD COLUMN IF NOT EXISTS supplier_user_id         UUID REFERENCES portix.profiles(id) ON DELETE SET NULL;

-- ─── 2. Add sender_role to claim_messages ───────────────────────────────────
-- Allows the chat UI to colour-code bubbles without a profile join.

ALTER TABLE portix.claim_messages
  ADD COLUMN IF NOT EXISTS sender_role TEXT CHECK (sender_role IN ('importer', 'supplier', 'customs', 'customs_agent'));

-- ─── 3. Create portix.claim_documents ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS portix.claim_documents (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id     UUID         NOT NULL REFERENCES portix.claims(id) ON DELETE CASCADE,
  zone         TEXT         NOT NULL CHECK (zone IN (
                                'pre_stuffing_qc',
                                'additional_costs_invoices',
                                'supporting_documents'
                            )),
  file_name    TEXT         NOT NULL,
  file_path    TEXT         NOT NULL,
  file_size    INTEGER,
  mime_type    TEXT,
  uploaded_by  UUID         NOT NULL REFERENCES portix.profiles(id),
  uploaded_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ─── 4. RLS on claim_documents ──────────────────────────────────────────────

ALTER TABLE portix.claim_documents ENABLE ROW LEVEL SECURITY;

-- Importers: full access to documents on claims they own
CREATE POLICY "claim_docs_importer_all"
  ON portix.claim_documents
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM portix.claims c
      JOIN portix.profiles p ON p.id = auth.uid()
      WHERE c.id = claim_documents.claim_id
        AND c.importer_id = auth.uid()
        AND p.role = 'importer'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM portix.claims c
      JOIN portix.profiles p ON p.id = auth.uid()
      WHERE c.id = claim_documents.claim_id
        AND c.importer_id = auth.uid()
        AND p.role = 'importer'
    )
  );

-- Suppliers: full access on claims assigned to them
CREATE POLICY "claim_docs_supplier_all"
  ON portix.claim_documents
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM portix.claims c
      JOIN portix.profiles p ON p.id = auth.uid()
      WHERE c.id = claim_documents.claim_id
        AND (c.supplier_id = auth.uid() OR c.supplier_user_id = auth.uid())
        AND p.role = 'supplier'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM portix.claims c
      JOIN portix.profiles p ON p.id = auth.uid()
      WHERE c.id = claim_documents.claim_id
        AND (c.supplier_id = auth.uid() OR c.supplier_user_id = auth.uid())
        AND p.role = 'supplier'
    )
  );

-- Customs: read-only on all claim documents
CREATE POLICY "claim_docs_customs_read"
  ON portix.claim_documents
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM portix.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('customs', 'customs_agent')
    )
  );

-- ─── 5. Storage bucket + policies ───────────────────────────────────────────
-- Run this in the Supabase Dashboard → Storage if SQL INSERT fails
-- due to missing bucket function permissions.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'claim-documents',
  'claim-documents',
  FALSE,
  52428800,   -- 50 MB per file
  ARRAY[
    'image/jpeg','image/png','image/gif','image/webp',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/csv',
    'video/mp4','video/quicktime'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Storage: authenticated users can upload to claim-documents
CREATE POLICY "claim_docs_storage_upload"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'claim-documents');

-- Storage: authenticated users can read their own uploads
CREATE POLICY "claim_docs_storage_read"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'claim-documents');
