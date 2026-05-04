-- Migration: 00328_dual_approval_docs
--
-- 1. Adds importer_approved_at / agent_approved_at columns to portix.documents
-- 2. BEFORE trigger auto-sets status for dual-approval doc types (bl_draft, proforma_invoice):
--    - one party approved  → under_review
--    - both approved       → approved  (cascade fires sync_document_counts → auto_advance)
-- 3. Expands required doc set from 7 → 10 (adds eur_1, proforma_invoice, bl_draft)
-- 4. Updates docs_total default 7→10 + backfills existing containers
-- 5. Updates sync_document_counts to track docs_total dynamically
-- 6. Adds INSERT trigger so docs_total stays correct when new doc rows are seeded
-- 7. Recreates seed_container_documents() and create_shipment_with_containers() with 10 types

-- ── 1. Dual-approval columns ──────────────────────────────────────────────────

ALTER TABLE portix.documents
    ADD COLUMN IF NOT EXISTS importer_approved_at TIMESTAMPTZ DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS agent_approved_at     TIMESTAMPTZ DEFAULT NULL;

-- ── 2. Dual-approval BEFORE trigger ──────────────────────────────────────────
-- Fires before any UPDATE that touches importer_approved_at or agent_approved_at.
-- Adjusts status automatically; the AFTER status-change trigger then syncs counters.

CREATE OR REPLACE FUNCTION portix.handle_dual_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = portix, public
AS $$
BEGIN
    -- Only applies to doc types that require dual approval
    IF NEW.document_type IN (
        'bl_draft'::portix.document_type,
        'proforma_invoice'::portix.document_type
    ) THEN
        IF NEW.importer_approved_at IS NOT NULL AND NEW.agent_approved_at IS NOT NULL THEN
            -- Both parties signed off → approve
            NEW.status      := 'approved'::portix.document_status;
            NEW.reviewed_at := now();
        ELSIF NEW.importer_approved_at IS NOT NULL OR NEW.agent_approved_at IS NOT NULL THEN
            -- One party approved, waiting for the other → under_review
            IF NEW.status = 'uploaded'::portix.document_status THEN
                NEW.status := 'under_review'::portix.document_status;
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_document_dual_approval
    BEFORE UPDATE OF importer_approved_at, agent_approved_at ON portix.documents
    FOR EACH ROW
    EXECUTE FUNCTION portix.handle_dual_approval();

COMMENT ON FUNCTION portix.handle_dual_approval() IS
    'For bl_draft and proforma_invoice: sets status=under_review when one party approves,
     status=approved when both importer_approved_at and agent_approved_at are set.';

-- ── 3. Bump docs_total default + update existing containers ──────────────────

ALTER TABLE portix.containers
    ALTER COLUMN docs_total SET DEFAULT 10;

-- Update existing containers BEFORE backfill so CHECK constraints hold
UPDATE portix.containers
SET docs_total = 10
WHERE docs_total < 10;

-- ── 4. Backfill 3 new document rows for all existing containers ───────────────

INSERT INTO portix.documents (container_id, document_type, status)
SELECT c.id, t.doc_type, 'missing'::portix.document_status
FROM  portix.containers c
CROSS JOIN (
    VALUES
        ('eur_1'::portix.document_type),
        ('proforma_invoice'::portix.document_type),
        ('bl_draft'::portix.document_type)
) AS t(doc_type)
ON CONFLICT (container_id, document_type) DO NOTHING;

-- ── 5. Update sync_document_counts to keep docs_total dynamic ────────────────
-- Previously only tracked uploaded/approved/rejected; now also recounts docs_total
-- so the column stays accurate regardless of how many doc types exist.

CREATE OR REPLACE FUNCTION portix.sync_document_counts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = portix, public
AS $$
DECLARE
    v_total     SMALLINT;
    v_uploaded  SMALLINT;
    v_approved  SMALLINT;
    v_rejected  SMALLINT;
BEGIN
    SELECT
        COUNT(*)::SMALLINT,
        COUNT(*) FILTER (WHERE status != 'missing')::SMALLINT,
        COUNT(*) FILTER (WHERE status = 'approved')::SMALLINT,
        COUNT(*) FILTER (WHERE status = 'rejected')::SMALLINT
    INTO v_total, v_uploaded, v_approved, v_rejected
    FROM portix.documents
    WHERE container_id = NEW.container_id;

    UPDATE portix.containers
    SET
        docs_total    = v_total,
        docs_uploaded = v_uploaded,
        docs_approved = v_approved,
        docs_rejected = v_rejected,
        updated_at    = now()
    WHERE id = NEW.container_id;

    RETURN NEW;
END;
$$;

-- ── 6. Add INSERT trigger so docs_total syncs when rows are seeded ────────────

CREATE OR REPLACE TRIGGER on_document_inserted_sync_counts
    AFTER INSERT ON portix.documents
    FOR EACH ROW
    EXECUTE FUNCTION portix.sync_document_counts();

-- ── 7a. Update seed_container_documents trigger → 10 types ───────────────────

CREATE OR REPLACE FUNCTION portix.seed_container_documents()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = portix, public
AS $$
DECLARE
    required_types portix.document_type[] := ARRAY[
        'commercial_invoice',
        'packing_list',
        'phytosanitary_certificate',
        'bill_of_lading',
        'certificate_of_origin',
        'cooling_report',
        'insurance_certificate',
        'eur_1',
        'proforma_invoice',
        'bl_draft'
    ]::portix.document_type[];

    doc_type portix.document_type;
BEGIN
    FOREACH doc_type IN ARRAY required_types LOOP
        INSERT INTO portix.documents (container_id, document_type, status)
        VALUES (NEW.id, doc_type, 'missing'::portix.document_status)
        ON CONFLICT (container_id, document_type) DO NOTHING;
    END LOOP;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION portix.seed_container_documents() IS
    'Auto-seeds 10 document rows (status=missing) for every new container.
     Types: commercial_invoice, packing_list, phytosanitary_certificate, bill_of_lading,
     certificate_of_origin, cooling_report, insurance_certificate, eur_1, proforma_invoice, bl_draft.';

-- ── 7b. Update create_shipment_with_containers RPC → 10 types ────────────────

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
    'cooling_report',
    'insurance_certificate',
    'eur_1',
    'proforma_invoice',
    'bl_draft'
  ]::portix.document_type[];
BEGIN
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

  INSERT INTO portix.shipments (
    shipment_number, vessel_name, voyage_number, origin_country, created_by
  ) VALUES (
    p_shipment_number,
    p_vessel_name,
    NULLIF(p_voyage_number, ''),
    NULLIF(p_origin_country, ''),
    v_caller_id
  )
  RETURNING id INTO v_shipment_id;

  FOR v_container IN SELECT * FROM jsonb_array_elements(p_containers)
  LOOP
    INSERT INTO portix.containers (
      shipment_id, importer_id, supplier_id,
      container_number, container_type, product_name,
      port_of_loading, port_of_destination, etd, eta, temperature_setting
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

    -- Seed 10 document rows (missing status) for this container
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
