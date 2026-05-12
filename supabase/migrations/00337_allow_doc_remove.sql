-- Migration: 00337_allow_doc_remove
--
-- Extends the importer/supplier UPDATE policy to also cover 'uploaded' status.
-- This lets them reset (remove) a document that has been uploaded but not yet
-- approved, without touching approved documents.
--
-- Allowed statuses for UPDATE: missing | rejected | uploaded
-- Blocked statuses:            approved | under_review
--
-- "under_review" is intentionally blocked — once customs review starts,
-- the submitter must wait for an approval or rejection before re-uploading.

DROP POLICY IF EXISTS "documents: importer or supplier can update upload fields"
    ON portix.documents;

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
        AND status IN ('missing', 'rejected', 'uploaded')
    )
    WITH CHECK (
        container_id IN (
            SELECT id FROM portix.containers
            WHERE importer_id = auth.uid()
               OR supplier_id = auth.uid()
        )
    );
