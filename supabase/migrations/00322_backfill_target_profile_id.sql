-- Migration: 00322_backfill_target_profile_id.sql
-- Rescues legacy account_transactions rows where target_profile_id is NULL.
-- Three-pass strategy:
--   Pass 1 – container FK (rename-proof; works whenever container_id is set)
--   Pass 2 – company name match (rows without container_id, name unchanged)
--   Pass 3 – heuristic for Make.com drafts whose target company was renamed
--             (only fires when supplier has exactly 1 importer relationship)
-- Then replaces handle_make_invoice_draft RPC to always write both fields.

-- ── Pass 1: container FK ──────────────────────────────────────────────────────
-- The supplier is always the uploader; the importer is always the target.
-- This is 100 % accurate regardless of any company rename.

UPDATE portix.account_transactions t
SET    target_profile_id = CASE
         WHEN t.uploader_user_id = c.supplier_id THEN c.importer_id
         WHEN t.uploader_user_id = c.importer_id THEN c.supplier_id
       END
FROM   portix.containers c
WHERE  t.target_profile_id IS NULL
  AND  t.container_id      = c.id
  AND  (t.uploader_user_id = c.supplier_id OR t.uploader_user_id = c.importer_id);

-- ── Pass 2: company name match ────────────────────────────────────────────────
-- For rows that have no container_id but whose target_company_name still matches
-- a current profile (company hasn't been renamed yet).

UPDATE portix.account_transactions t
SET    target_profile_id = (
         SELECT id
         FROM   portix.profiles p
         WHERE  p.company_name = t.target_company_name
         ORDER  BY p.created_at ASC
         LIMIT  1
       )
WHERE  t.target_profile_id  IS NULL
  AND  t.container_id        IS NULL
  AND  t.target_company_name IS NOT NULL;

-- ── Pass 3: heuristic recovery for renamed targets ────────────────────────────
-- Applies only when the uploader (supplier) has exactly one distinct importer
-- across all their containers, making the assignment unambiguous.
-- Catches Make.com auto-drafts created before the RPC stored container_id.

UPDATE portix.account_transactions t
SET    target_profile_id = (
         SELECT DISTINCT c.importer_id
         FROM   portix.containers c
         WHERE  c.supplier_id = t.uploader_user_id
         LIMIT  1
       )
WHERE  t.target_profile_id IS NULL
  AND  t.container_id      IS NULL
  AND  t.uploader_user_id  IS NOT NULL
  AND  (
         SELECT COUNT(DISTINCT importer_id)
         FROM   portix.containers
         WHERE  supplier_id = t.uploader_user_id
       ) = 1;

-- ── Replace handle_make_invoice_draft RPC ────────────────────────────────────
-- Now writes target_profile_id (importer UUID) and container_id on every row.

CREATE OR REPLACE FUNCTION portix.handle_make_invoice_draft(
  p_container_id UUID,
  p_amount       NUMERIC,
  p_file_path    TEXT,
  p_file_name    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = portix, public
AS $$
DECLARE
  v_supplier_id   UUID;
  v_importer_id   UUID;
  v_supplier_name TEXT;
  v_importer_name TEXT;
  v_txn_id        UUID;
BEGIN
  -- 1. Resolve supplier + importer UUIDs from the container
  SELECT supplier_id, importer_id
    INTO v_supplier_id, v_importer_id
    FROM portix.containers
   WHERE id = p_container_id;

  IF v_supplier_id IS NULL OR v_importer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'container_not_found');
  END IF;

  -- 2. Fetch company names (for legacy string columns — kept for human readability)
  SELECT company_name INTO v_supplier_name FROM portix.profiles WHERE id = v_supplier_id;
  SELECT company_name INTO v_importer_name FROM portix.profiles WHERE id = v_importer_id;

  IF v_supplier_name IS NULL OR v_importer_name IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'profile_not_found');
  END IF;

  -- 3. Insert draft transaction — UUID columns now always populated
  INSERT INTO portix.account_transactions (
    uploader_user_id,
    uploader_company_name,
    target_company_name,
    target_profile_id,        -- ← importer UUID (rename-proof)
    container_id,             -- ← FK to container (rename-proof)
    type,
    status,
    amount,
    currency,
    transaction_date,
    document_storage_path,
    document_file_name,
    notes
  ) VALUES (
    v_supplier_id,
    v_supplier_name,
    v_importer_name,
    v_importer_id,            -- importer profile UUID
    p_container_id,           -- container FK
    'invoice',
    'draft',
    p_amount,
    'USD',
    CURRENT_DATE,
    p_file_path,
    p_file_name,
    'Auto-drafted by Make.com OCR'
  )
  RETURNING id INTO v_txn_id;

  RETURN jsonb_build_object(
    'ok',               true,
    'transaction_id',   v_txn_id,
    'supplier_company', v_supplier_name,
    'importer_company', v_importer_name,
    'amount',           p_amount
  );
END;
$$;

GRANT EXECUTE ON FUNCTION portix.handle_make_invoice_draft(UUID, NUMERIC, TEXT, TEXT)
  TO authenticated, service_role;
