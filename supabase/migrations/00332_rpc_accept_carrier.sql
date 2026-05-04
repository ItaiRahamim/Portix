-- Migration: 00332_rpc_accept_carrier
--
-- Extends create_shipment_with_containers() to read an optional 'carrier' key
-- out of each container's JSONB payload and persist it to the new
-- portix.containers.carrier column added in 00331.
--
-- Backward compatible: if the JSONB row has no 'carrier' key, NULL is stored.
-- The New Shipment modal forwards the normalized carrier returned by the
-- parse-shipment edge function into each container row.

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
  v_caller_id    UUID := auth.uid();
  v_caller_role  portix.user_role;
  v_shipment_id  UUID;
  v_container    JSONB;
  v_container_id UUID;
  v_container_ids UUID[] := ARRAY[]::UUID[];
  v_doc_type     portix.document_type;
  v_doc_types    portix.document_type[] := ARRAY[
    'commercial_invoice',
    'packing_list',
    'phytosanitary_certificate',
    'bill_of_lading',
    'certificate_of_origin',
    'eur_1',
    'proforma_invoice',
    'bl_draft'
  ]::portix.document_type[];
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role INTO v_caller_role FROM portix.profiles WHERE id = v_caller_id;

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

  INSERT INTO portix.shipments (
    shipment_number, vessel_name, voyage_number, origin_country, created_by
  ) VALUES (
    p_shipment_number, p_vessel_name,
    NULLIF(p_voyage_number, ''), NULLIF(p_origin_country, ''), v_caller_id
  )
  RETURNING id INTO v_shipment_id;

  FOR v_container IN SELECT * FROM jsonb_array_elements(p_containers)
  LOOP
    INSERT INTO portix.containers (
      shipment_id, importer_id, supplier_id,
      container_number, container_type, product_name,
      port_of_loading, port_of_destination, etd, eta, temperature_setting,
      carrier
    ) VALUES (
      v_shipment_id, p_importer_id, p_supplier_id,
      upper(trim(v_container->>'container_number')),
      (v_container->>'container_type')::portix.container_type,
      p_product_name,
      trim(v_container->>'port_of_loading'),
      trim(v_container->>'port_of_destination'),
      p_etd, p_eta,
      NULLIF(trim(v_container->>'temperature_setting'), ''),
      NULLIF(trim(v_container->>'carrier'), '')
    )
    RETURNING id INTO v_container_id;

    v_container_ids := array_append(v_container_ids, v_container_id);

    FOREACH v_doc_type IN ARRAY v_doc_types LOOP
      INSERT INTO portix.documents (container_id, document_type, status)
      VALUES (v_container_id, v_doc_type, 'missing')
      ON CONFLICT (container_id, document_type) DO NOTHING;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'shipment_id',   v_shipment_id,
    'container_ids', to_jsonb(v_container_ids)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION portix.create_shipment_with_containers(
  TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB
) TO authenticated;
