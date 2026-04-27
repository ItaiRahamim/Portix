-- Migration: 00320_create_swift_bucket.sql
-- Creates the `swift-documents` Supabase Storage bucket and its RLS policies.
-- This bucket stores SWIFT payment proofs and account-level invoice PDFs
-- uploaded via the Accounts Ledger page.
--
-- The bucket was specified in 00302_rls_policies.sql comments but never
-- created — causing "File upload failed" errors in the Payment Proof modal.

-- ── Create bucket ─────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'swift-documents',
  'swift-documents',
  FALSE,                -- private — all access via signed URLs
  15728640,             -- 15 MB per file
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- ── Storage policies ──────────────────────────────────────────────────────────

-- Importers and suppliers can upload payment proofs / invoices
CREATE POLICY "swift_docs_upload"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'swift-documents');

-- Importers and suppliers can read documents in this bucket
CREATE POLICY "swift_docs_read"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'swift-documents');

-- Uploaders can delete their own files
CREATE POLICY "swift_docs_delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'swift-documents' AND owner = auth.uid());
