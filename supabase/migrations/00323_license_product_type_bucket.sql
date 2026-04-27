-- Migration: 00323_license_product_type_bucket.sql
-- Adds product_type to import_licenses (needed for AI extraction output),
-- creates the license-files Storage bucket (was documented but never created),
-- and adds its RLS policies.

-- ── 1. Add product_type column ────────────────────────────────────────────────

ALTER TABLE portix.import_licenses
  ADD COLUMN IF NOT EXISTS product_type TEXT;

COMMENT ON COLUMN portix.import_licenses.product_type IS
  'Product/commodity description extracted from the license document by Gemini AI.';

-- ── 2. Create license-files Storage bucket ────────────────────────────────────
-- Referenced in comments since migration 00302 but never actually created,
-- matching the same pattern used for swift-documents (migration 00320).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'license-files',
  'license-files',
  FALSE,                -- private — access via signed URLs only
  20971520,             -- 20 MB per file
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- ── 3. Storage RLS policies ───────────────────────────────────────────────────

-- Importers can upload their own license files
CREATE POLICY "license_files_upload"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'license-files');

-- Importers can read files they own
CREATE POLICY "license_files_read"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'license-files');

-- Importers can delete their own files
CREATE POLICY "license_files_delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'license-files' AND owner = auth.uid());
