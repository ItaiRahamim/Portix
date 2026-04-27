-- Migration: 00318_make_invoice_draft_rpc.sql
-- RPC callable by Make.com (service role) to insert a draft invoice transaction
-- after performing OCR on a commercial invoice document.

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
  -- 1. Resolve supplier + importer IDs from the container
  SELECT supplier_id, importer_id
    INTO v_supplier_id, v_importer_id
    FROM portix.containers
   WHERE id = p_container_id;

  IF v_supplier_id IS NULL OR v_importer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'container_not_found');
  END IF;

  -- 2. Fetch company names from profiles
  SELECT company_name INTO v_supplier_name
    FROM portix.profiles WHERE id = v_supplier_id;

  SELECT company_name INTO v_importer_name
    FROM portix.profiles WHERE id = v_importer_id;

  IF v_supplier_name IS NULL OR v_importer_name IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'profile_not_found');
  END IF;

  -- 3. Insert draft transaction (supplier → importer invoice)
  INSERT INTO portix.account_transactions (
    uploader_user_id,
    uploader_company_name,
    target_company_name,
    type,
    status,
    amount,
    currency,
    transaction_date,
    document_storage_path,
    document_file_name,
    notes
  ) VALUES (
    v_supplier_id,             -- attributed to supplier
    v_supplier_name,
    v_importer_name,
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
    'ok',                   true,
    'transaction_id',       v_txn_id,
    'supplier_company',     v_supplier_name,
    'importer_company',     v_importer_name,
    'amount',               p_amount
  );
END;
$$;

-- Grant execution to authenticated users and service role
GRANT EXECUTE ON FUNCTION portix.handle_make_invoice_draft(UUID, NUMERIC, TEXT, TEXT)
  TO authenticated, service_role;
