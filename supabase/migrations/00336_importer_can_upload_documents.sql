-- Migration: 00336_importer_can_upload_documents
--
-- Extends document upload permissions so that IMPORTERS can upload and replace
-- documents, not only suppliers. Both parties share equal upload rights for
-- containers they are associated with.
--
-- Changes:
--   1. DROP supplier-only INSERT policy → replace with importer-OR-supplier policy.
--   2. DROP supplier-only UPDATE policy → replace with importer-OR-supplier policy.
--
-- RLS logic: a user may INSERT or UPDATE a document row when they are either
-- the importer_id OR the supplier_id on the parent container.
--
-- Note: the 7 initial document rows (status='missing') are still seeded by the
-- create_shipment_with_containers() RPC (SECURITY DEFINER) — no change there.

-- ── DROP old supplier-only policies ──────────────────────────────────────────

DROP POLICY IF EXISTS "documents: supplier can upload for own containers"
    ON portix.documents;

DROP POLICY IF EXISTS "documents: supplier can update upload fields"
    ON portix.documents;

-- ── INSERT ───────────────────────────────────────────────────────────────────
-- Importer OR supplier can insert document rows for their own containers.
-- (Uncommon but needed for edge-cases like classify-documents creating new rows.)

CREATE POLICY "documents: importer or supplier can upload"
    ON portix.documents
    FOR INSERT
    TO authenticated
    WITH CHECK (
        container_id IN (
            SELECT id FROM portix.containers
            WHERE importer_id = auth.uid()
               OR supplier_id = auth.uid()
        )
    );

-- ── UPDATE ───────────────────────────────────────────────────────────────────
-- Importer OR supplier can update a document that is 'missing' (first upload)
-- or 'rejected' (replacing a rejected document).
-- Customs-agent UPDATE policy is unchanged (approve/reject flow).

CREATE POLICY "documents: importer or supplier can update upload fields"
    ON portix.documents
    FOR UPDATE
    TO authenticated
    USING (
        container_id IN (
            SELECT id FROM portix.containers
            WHERE importer_id = auth.uid()
               OR supplier_id = auth.uid()
        )
        AND status IN ('missing', 'rejected')
    )
    WITH CHECK (
        container_id IN (
            SELECT id FROM portix.containers
            WHERE importer_id = auth.uid()
               OR supplier_id = auth.uid()
        )
    );
