-- ─── Make optional shipment fields nullable ───────────────────────────────────
-- origin_port, destination_port, and vessel_name are redundant with per-
-- container fields and may be absent when the AI auto-fill misses them.
-- origin_country was already nullable.

ALTER TABLE portix.shipments
  ALTER COLUMN vessel_name      DROP NOT NULL,
  ALTER COLUMN origin_port      DROP NOT NULL,
  ALTER COLUMN destination_port DROP NOT NULL;

COMMENT ON COLUMN portix.shipments.vessel_name      IS 'Vessel name — optional, may be null when not supplied by AI or user';
COMMENT ON COLUMN portix.shipments.origin_port      IS 'Port of loading — optional, falls back to first container port_of_loading';
COMMENT ON COLUMN portix.shipments.destination_port IS 'Port of destination — optional, falls back to first container port_of_destination';

-- ─── Recreate RPC with smart fallbacks ───────────────────────────────────────
-- Fixes three bugs in the original:
--   1. origin_port / destination_port were never inserted → NOT NULL violation
--   2. etd / eta were never inserted into shipments → NOT NULL violation
--   3. vessel_name passed as '' when blank → NOT NULL violation
-- Fallback chain:
--   origin_port      → p_containers[0].port_of_loading
--   destination_port → p_containers[0].port_of_destination

CREATE OR REPLACE FUNCTION portix.create_shipment_with_containers(
  p_shipment_number   TEXT,
  p_vessel_name       TEXT,
  p_voyage_number     TEXT,
  p_origin_country    TEXT,
  p_importer_id       UUID,
  p_supplier_id       UUID,
  p_product_name      TEXT,
  p_etd               TIMESTAMPTZ,
  p_eta               TIMESTAMPTZ,
  p_containers        JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = portix, public
AS $$
DECLARE
  v_caller_id      UUID := auth.uid();
  v_caller_role    portix.user_role;
  v_shipment_id    UUID;
  v_container      JSONB;
  v_container_id   UUID;
  v_container_ids  UUID[] := ARRAY[]::UUID[];
  v_doc_type       portix.document_type;
  v_doc_types      portix.document_type[] := ARRAY[
    'commercial_invoice',
    'packing_list',
    'phytosanitary_certificate',
    'bill_of_lading',
    'certificate_of_origin',
    'cooling_report',
    'insurance_certificate'
  ]::portix.document_type[];
  -- Derived fallback values from first container
  v_origin_port      TEXT;
  v_destination_port TEXT;
BEGIN
  -- ── Caller identity + role check ────────────────────────────────────────────
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role INTO v_caller_role
    FROM portix.profiles
   WHERE id = v_caller_id;

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;

  IF v_caller_role = 'importer' AND v_caller_id != p_importer_id THEN
    RAISE EXCEPTION 'Permission denied: importer_id does not match authenticated user';
  END IF;

  IF v_caller_role = 'supplier' AND v_caller_id != p_supplier_id THEN
    RAISE EXCEPTION 'Permission denied: supplier_id does not match authenticated user';
  END IF;

  IF v_caller_role = 'customs_agent' THEN
    RAISE EXCEPTION 'Permission denied: customs agents cannot create shipments';
  END IF;

  -- ── Smart fallbacks from first container ────────────────────────────────────
  -- If the form left origin_port / destination_port blank, pull from the
  -- first container row (port_of_loading / port_of_destination).
  v_origin_port := COALESCE(
    NULLIF(trim(p_containers->0->>'port_of_loading'), ''),
    NULL
  );
  v_destination_port := COALESCE(
    NULLIF(trim(p_containers->0->>'port_of_destination'), ''),
    NULL
  );

  -- ── 1. Create shipment ──────────────────────────────────────────────────────
  INSERT INTO portix.shipments (
    shipment_number,
    vessel_name,
    voyage_number,
    origin_country,
    origin_port,
    destination_port,
    etd,
    eta,
    created_by
  ) VALUES (
    p_shipment_number,
    NULLIF(trim(p_vessel_name),      ''),   -- null when blank
    NULLIF(trim(p_voyage_number),    ''),
    NULLIF(trim(p_origin_country),   ''),
    v_origin_port,
    v_destination_port,
    p_etd,
    p_eta,
    v_caller_id
  )
  RETURNING id INTO v_shipment_id;

  -- ── 2. Create containers + seed documents ───────────────────────────────────
  FOR v_container IN SELECT * FROM jsonb_array_elements(p_containers)
  LOOP
    INSERT INTO portix.containers (
      shipment_id,
      importer_id,
      supplier_id,
      container_number,
      container_type,
      product_name,
      port_of_loading,
      port_of_destination,
      etd,
      eta,
      temperature_setting
    ) VALUES (
      v_shipment_id,
      p_importer_id,
      p_supplier_id,
      upper(trim(v_container->>'container_number')),
      (v_container->>'container_type')::portix.container_type,
      p_product_name,
      trim(v_container->>'port_of_loading'),
      trim(v_container->>'port_of_destination'),
      p_etd,
      p_eta,
      NULLIF(trim(v_container->>'temperature_setting'), '')
    )
    RETURNING id INTO v_container_id;

    v_container_ids := array_append(v_container_ids, v_container_id);

    -- Seed 7 document rows (missing status) for this container
    FOREACH v_doc_type IN ARRAY v_doc_types LOOP
      INSERT INTO portix.documents (container_id, document_type, status)
      VALUES (v_container_id, v_doc_type, 'missing')
      ON CONFLICT (container_id, document_type) DO NOTHING;
    END LOOP;
  END LOOP;

  -- ── 3. Return result ────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'shipment_id',   v_shipment_id,
    'container_ids', to_jsonb(v_container_ids)
  );
END;
$$;

-- Re-grant (CREATE OR REPLACE resets permissions on some Postgres versions)
GRANT EXECUTE ON FUNCTION portix.create_shipment_with_containers(
  TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB
) TO authenticated;
