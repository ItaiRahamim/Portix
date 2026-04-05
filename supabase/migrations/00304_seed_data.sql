-- ═══════════════════════════════════════════════════════════════════════════
-- PORTIX — Pilot Seed Data
-- Migration: 00304_seed_data.sql
-- Depends on: 00301, 00302, 00303
--
-- Seeds the Portix pilot environment with:
--   • 1 supplier org (Celeste — from the product matrix)
--   • 4 mock user profiles (1 importer, 2 supplier contacts, 1 customs agent)
--     NOTE: auth.users rows must be created via Supabase Auth dashboard or
--     via the Auth API before this seed runs. The UUIDs below are stable and
--     must match the UUIDs assigned by Supabase Auth.
--   • 1 shipment (vessel voyage)
--   • 3 containers (various statuses for UI testing)
--   • 21 document rows (7 per container, auto-seeded by trigger — included
--     here explicitly for deterministic seed ordering)
--   • Celeste product catalog (from the supplier matrix image)
--   • 2 invoices (1 unpaid, 1 partially paid)
--   • 2 claims (1 open, 1 under review)
--   • 2 import licenses (1 valid, 1 expiring soon)
--
-- HOW TO USE:
--   1. Create auth users via Supabase Dashboard → Authentication → Users:
--        alex.morgan@eurofresh.com      (role: importer)
--        edward.koemans@celeste.gr      (role: supplier)
--        deby.ganga@celeste.gr          (role: supplier)
--        ibrahim.hassan@customs.gov.il  (role: customs_agent)
--   2. Copy the UUIDs from the Auth dashboard into the constants below.
--   3. Run this file in the Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────
-- STABLE UUIDs for pilot users
-- Replace with actual UUIDs from Supabase Auth dashboard after creating users
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
    -- ── User IDs (live Supabase Auth UUIDs) ──────────────────────────────
    id_importer_alex    UUID := '611941ba-185d-42dc-b043-8c8ff8322cee'; -- Racheli Abergil (importer)
    id_supplier_edward  UUID := '2bb5020c-bf31-4846-8f0e-b7b44f260f21'; -- Edward Koemans (supplier CEO)
    id_supplier_deby    UUID := '4878f7d4-49cc-4f5a-84cc-e9c4aa318e91'; -- Deby Ganga (supplier docs)
    id_agent_ibrahim    UUID := '4fea9e43-1574-4b85-8e5c-7b400c0cf380'; -- Customs Agent

    -- ── Supplier Org ID ───────────────────────────────────────────────────
    id_org_celeste      UUID := 'bbbbbbbb-0001-4000-8000-000000000001';

    -- ── Shipment & Container IDs ──────────────────────────────────────────
    id_shipment_01      UUID := 'cccccccc-0001-4000-8000-000000000001';
    id_cnt_01           UUID := 'dddddddd-0001-4000-8000-000000000001'; -- missing-documents
    id_cnt_02           UUID := 'dddddddd-0002-4000-8000-000000000002'; -- waiting_customs_review
    id_cnt_03           UUID := 'dddddddd-0003-4000-8000-000000000003'; -- released

    -- ── Invoice IDs ───────────────────────────────────────────────────────
    id_invoice_01       UUID := 'eeeeeeee-0001-4000-8000-000000000001';
    id_invoice_02       UUID := 'eeeeeeee-0002-4000-8000-000000000002';

    -- ── Claim IDs ─────────────────────────────────────────────────────────
    id_claim_01         UUID := 'ffffffff-0001-4000-8000-000000000001';
    id_claim_02         UUID := 'ffffffff-0002-4000-8000-000000000002';

    -- ── License IDs ───────────────────────────────────────────────────────
    id_license_01       UUID := '11111111-0001-4000-8000-000000000001';
    id_license_02       UUID := '11111111-0002-4000-8000-000000000002';

BEGIN

-- ─────────────────────────────────────────────────────────────────────────
-- 1. SUPPLIER ORG — Celeste
-- ─────────────────────────────────────────────────────────────────────────

INSERT INTO portix.supplier_orgs (
    id, company_name, country, email, currency, payment_terms, notes
) VALUES (
    id_org_celeste,
    'Celeste',
    'Greece',
    'info@celeste.gr',
    'EUR',
    'Net 30',
    'Pilot supplier. Products: Red Onion, Yellow Onion, Kiwi (Hayward/Tsehelides), Tomatoes (Round).'
) ON CONFLICT (id) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────
-- 2. PROFILES
-- NOTE: These rows are normally auto-created by the handle_new_user trigger.
-- Inserted here explicitly for seed environments where auth.users already
-- exists (e.g., Supabase local dev with pre-seeded auth users).
-- ─────────────────────────────────────────────────────────────────────────

INSERT INTO portix.profiles (
    id, email, full_name, company_name, role, supplier_org_id
) VALUES
    (
        id_importer_alex,
        'racheli@eurofresh.com',
        'Racheli Abergil',
        'EuroFresh Imports GmbH',
        'importer',
        NULL
    ),
    (
        id_supplier_edward,
        'edward.koemans@celeste.gr',
        'Edward Koemans',
        'Celeste',
        'supplier',
        id_org_celeste
    ),
    (
        id_supplier_deby,
        'deby.ganga@celeste.gr',
        'Deby Ganga',
        'Celeste',
        'supplier',
        id_org_celeste
    ),
    (
        id_agent_ibrahim,
        'ibrahim.hassan@customs.gov.il',
        'Ibrahim Hassan',
        'Israel Customs Authority',
        'customs_agent',
        NULL
    )
ON CONFLICT (id) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────
-- 3. SHIPMENT
-- ─────────────────────────────────────────────────────────────────────────

INSERT INTO portix.shipments (
    id, shipment_number, vessel_name, origin_port, destination_port,
    origin_country, etd, eta, created_by
) VALUES (
    id_shipment_01,
    'SHP-2026-001',
    'MSC Mirella',
    'Piraeus',
    'Ashdod',
    'Greece',
    '2026-04-10 08:00:00+00',
    '2026-04-19 14:00:00+00',
    id_supplier_edward
) ON CONFLICT (id) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────
-- 4. CONTAINERS (3 containers across 3 status states for UI testing)
-- Note: seed_container_documents trigger will auto-create 7 document rows
-- for each container. The documents section below UPDATES those auto-seeded rows.
-- ─────────────────────────────────────────────────────────────────────────

INSERT INTO portix.containers (
    id, container_number, shipment_id, importer_id, supplier_id,
    product_name, hs_code, container_type, temperature_setting,
    port_of_loading, port_of_destination, etd, eta, status
) VALUES
    (
        id_cnt_01,
        'MSCU1234567',
        id_shipment_01,
        id_importer_alex,
        id_supplier_edward,
        'Kiwi (Hayward)',
        '0810.50',
        'reefer_40ft',
        '0°C to +2°C',
        'Piraeus',
        'Ashdod',
        '2026-04-10 08:00:00+00',
        '2026-04-19 14:00:00+00',
        'documents_missing'      -- 2 of 7 docs uploaded
    ),
    (
        id_cnt_02,
        'MSCU7654321',
        id_shipment_01,
        id_importer_alex,
        id_supplier_edward,
        'Red Onion',
        '0703.10',
        '40ft',
        NULL,
        'Piraeus',
        'Ashdod',
        '2026-04-10 08:00:00+00',
        '2026-04-19 14:00:00+00',
        'waiting_customs_review' -- all 7 docs uploaded, pending customs review
    ),
    (
        id_cnt_03,
        'MSCU9999000',
        id_shipment_01,
        id_importer_alex,
        id_supplier_edward,
        'Tomatoes (Round)',
        '0702.00',
        'reefer_40ft',
        '+8°C to +12°C',
        'Piraeus',
        'Ashdod',
        '2026-03-01 08:00:00+00',
        '2026-03-10 14:00:00+00',
        'released'               -- fully processed, historical
    )
ON CONFLICT (id) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────
-- 5. DOCUMENTS
-- The trigger seeds 7 "missing" rows per container automatically.
-- Below we UPDATE specific rows to reflect realistic test states.
-- Container 01: 2 docs uploaded, 5 missing (documents_missing state)
-- Container 02: all 7 uploaded, 5 approved, 2 under_review (waiting_customs_review)
-- Container 03: all 7 approved (released)
-- ─────────────────────────────────────────────────────────────────────────

-- Container 01: Upload commercial_invoice and bill_of_lading
UPDATE portix.documents SET
    status          = 'uploaded',
    storage_path    = 'documents/' || id_cnt_01 || '/commercial_invoice/CI-2026-001.pdf',
    file_name       = 'CI-2026-001.pdf',
    file_size_bytes = 204800,
    mime_type       = 'application/pdf',
    uploaded_by     = id_supplier_edward,
    document_number = 'CI-2026-001',
    issue_date      = '2026-04-08',
    uploaded_at     = '2026-04-08 10:00:00+00'
WHERE container_id = id_cnt_01 AND document_type = 'commercial_invoice';

UPDATE portix.documents SET
    status          = 'uploaded',
    storage_path    = 'documents/' || id_cnt_01 || '/bill_of_lading/BL-MSC-001.pdf',
    file_name       = 'BL-MSC-001.pdf',
    file_size_bytes = 153600,
    mime_type       = 'application/pdf',
    uploaded_by     = id_supplier_edward,
    document_number = 'BL-MSC-2026-001',
    issue_date      = '2026-04-09',
    uploaded_at     = '2026-04-09 09:00:00+00'
WHERE container_id = id_cnt_01 AND document_type = 'bill_of_lading';

-- Container 02: All 7 uploaded — 5 approved, 2 still under_review
UPDATE portix.documents SET
    status = 'approved', reviewed_by = id_agent_ibrahim,
    uploaded_by = id_supplier_edward, reviewed_at = '2026-04-13 11:00:00+00',
    uploaded_at = '2026-04-11 09:00:00+00',
    storage_path = 'documents/' || id_cnt_02 || '/commercial_invoice/CI-2026-002.pdf',
    file_name = 'CI-2026-002.pdf', file_size_bytes = 204800, mime_type = 'application/pdf'
WHERE container_id = id_cnt_02 AND document_type = 'commercial_invoice';

UPDATE portix.documents SET
    status = 'approved', reviewed_by = id_agent_ibrahim,
    uploaded_by = id_supplier_edward, reviewed_at = '2026-04-13 11:05:00+00',
    uploaded_at = '2026-04-11 09:05:00+00',
    storage_path = 'documents/' || id_cnt_02 || '/packing_list/PL-2026-002.pdf',
    file_name = 'PL-2026-002.pdf', file_size_bytes = 98304, mime_type = 'application/pdf'
WHERE container_id = id_cnt_02 AND document_type = 'packing_list';

UPDATE portix.documents SET
    status = 'approved', reviewed_by = id_agent_ibrahim,
    uploaded_by = id_supplier_edward, reviewed_at = '2026-04-13 11:10:00+00',
    uploaded_at = '2026-04-11 09:10:00+00',
    storage_path = 'documents/' || id_cnt_02 || '/bill_of_lading/BL-MSC-002.pdf',
    file_name = 'BL-MSC-002.pdf', file_size_bytes = 153600, mime_type = 'application/pdf'
WHERE container_id = id_cnt_02 AND document_type = 'bill_of_lading';

UPDATE portix.documents SET
    status = 'approved', reviewed_by = id_agent_ibrahim,
    uploaded_by = id_supplier_edward, reviewed_at = '2026-04-13 11:15:00+00',
    uploaded_at = '2026-04-11 09:15:00+00',
    storage_path = 'documents/' || id_cnt_02 || '/certificate_of_origin/CO-2026-002.pdf',
    file_name = 'CO-2026-002.pdf', file_size_bytes = 81920, mime_type = 'application/pdf'
WHERE container_id = id_cnt_02 AND document_type = 'certificate_of_origin';

UPDATE portix.documents SET
    status = 'approved', reviewed_by = id_agent_ibrahim,
    uploaded_by = id_supplier_edward, reviewed_at = '2026-04-13 11:20:00+00',
    uploaded_at = '2026-04-11 09:20:00+00',
    storage_path = 'documents/' || id_cnt_02 || '/insurance_certificate/INS-2026-002.pdf',
    file_name = 'INS-2026-002.pdf', file_size_bytes = 61440, mime_type = 'application/pdf'
WHERE container_id = id_cnt_02 AND document_type = 'insurance_certificate';

UPDATE portix.documents SET
    status = 'under_review',
    uploaded_by = id_supplier_edward, uploaded_at = '2026-04-11 09:25:00+00',
    storage_path = 'documents/' || id_cnt_02 || '/phytosanitary_certificate/PHYTO-2026-002.pdf',
    file_name = 'PHYTO-2026-002.pdf', file_size_bytes = 71680, mime_type = 'application/pdf'
WHERE container_id = id_cnt_02 AND document_type = 'phytosanitary_certificate';

UPDATE portix.documents SET
    status = 'under_review',
    uploaded_by = id_supplier_edward, uploaded_at = '2026-04-11 09:30:00+00',
    storage_path = 'documents/' || id_cnt_02 || '/cooling_report/COOL-2026-002.pdf',
    file_name = 'COOL-2026-002.pdf', file_size_bytes = 40960, mime_type = 'application/pdf'
WHERE container_id = id_cnt_02 AND document_type = 'cooling_report';

-- Container 03: All 7 approved (released state)
UPDATE portix.documents SET
    status = 'approved', reviewed_by = id_agent_ibrahim,
    uploaded_by = id_supplier_edward,
    uploaded_at = '2026-03-03 09:00:00+00', reviewed_at = '2026-03-05 11:00:00+00',
    storage_path = 'documents/' || id_cnt_03 || '/commercial_invoice/CI-2026-003.pdf',
    file_name = 'CI-2026-003.pdf', file_size_bytes = 204800, mime_type = 'application/pdf'
WHERE container_id = id_cnt_03 AND document_type = 'commercial_invoice';

UPDATE portix.documents SET
    status = 'approved', reviewed_by = id_agent_ibrahim,
    uploaded_by = id_supplier_edward,
    uploaded_at = '2026-03-03 09:05:00+00', reviewed_at = '2026-03-05 11:05:00+00',
    storage_path = 'documents/' || id_cnt_03 || '/packing_list/PL-2026-003.pdf',
    file_name = 'PL-2026-003.pdf', file_size_bytes = 98304, mime_type = 'application/pdf'
WHERE container_id = id_cnt_03 AND document_type = 'packing_list';

UPDATE portix.documents SET
    status = 'approved', reviewed_by = id_agent_ibrahim,
    uploaded_by = id_supplier_edward,
    uploaded_at = '2026-03-03 09:10:00+00', reviewed_at = '2026-03-05 11:10:00+00',
    storage_path = 'documents/' || id_cnt_03 || '/phytosanitary_certificate/PHYTO-2026-003.pdf',
    file_name = 'PHYTO-2026-003.pdf', file_size_bytes = 71680, mime_type = 'application/pdf'
WHERE container_id = id_cnt_03 AND document_type = 'phytosanitary_certificate';

UPDATE portix.documents SET
    status = 'approved', reviewed_by = id_agent_ibrahim,
    uploaded_by = id_supplier_edward,
    uploaded_at = '2026-03-03 09:15:00+00', reviewed_at = '2026-03-05 11:15:00+00',
    storage_path = 'documents/' || id_cnt_03 || '/bill_of_lading/BL-MSC-003.pdf',
    file_name = 'BL-MSC-003.pdf', file_size_bytes = 153600, mime_type = 'application/pdf'
WHERE container_id = id_cnt_03 AND document_type = 'bill_of_lading';

UPDATE portix.documents SET
    status = 'approved', reviewed_by = id_agent_ibrahim,
    uploaded_by = id_supplier_edward,
    uploaded_at = '2026-03-03 09:20:00+00', reviewed_at = '2026-03-05 11:20:00+00',
    storage_path = 'documents/' || id_cnt_03 || '/certificate_of_origin/CO-2026-003.pdf',
    file_name = 'CO-2026-003.pdf', file_size_bytes = 81920, mime_type = 'application/pdf'
WHERE container_id = id_cnt_03 AND document_type = 'certificate_of_origin';

UPDATE portix.documents SET
    status = 'approved', reviewed_by = id_agent_ibrahim,
    uploaded_by = id_supplier_edward,
    uploaded_at = '2026-03-03 09:25:00+00', reviewed_at = '2026-03-05 11:25:00+00',
    storage_path = 'documents/' || id_cnt_03 || '/cooling_report/COOL-2026-003.pdf',
    file_name = 'COOL-2026-003.pdf', file_size_bytes = 40960, mime_type = 'application/pdf'
WHERE container_id = id_cnt_03 AND document_type = 'cooling_report';

UPDATE portix.documents SET
    status = 'approved', reviewed_by = id_agent_ibrahim,
    uploaded_by = id_supplier_edward,
    uploaded_at = '2026-03-03 09:30:00+00', reviewed_at = '2026-03-05 11:30:00+00',
    storage_path = 'documents/' || id_cnt_03 || '/insurance_certificate/INS-2026-003.pdf',
    file_name = 'INS-2026-003.pdf', file_size_bytes = 61440, mime_type = 'application/pdf'
WHERE container_id = id_cnt_03 AND document_type = 'insurance_certificate';

-- Manually sync doc counters (triggers already fire on UPDATE, but explicit is safer for seeds)
UPDATE portix.containers SET
    docs_uploaded = 2, docs_approved = 0, docs_rejected = 0
WHERE id = id_cnt_01;

UPDATE portix.containers SET
    docs_uploaded = 7, docs_approved = 5, docs_rejected = 0
WHERE id = id_cnt_02;

UPDATE portix.containers SET
    docs_uploaded = 7, docs_approved = 7, docs_rejected = 0
WHERE id = id_cnt_03;


-- ─────────────────────────────────────────────────────────────────────────
-- 6. INVOICES
-- ─────────────────────────────────────────────────────────────────────────

INSERT INTO portix.invoices (
    id, invoice_number, importer_id, supplier_id, container_id,
    amount, paid_amount, currency, status, invoice_date, due_date, notes
) VALUES
    (
        id_invoice_01,
        'INV-2026-001',
        id_importer_alex,
        id_supplier_edward,
        id_cnt_02,
        45000.00,
        0.00,
        'EUR',
        'unpaid',
        '2026-04-11',
        '2026-05-11',
        'Kiwi Hayward shipment — SHP-2026-001'
    ),
    (
        id_invoice_02,
        'INV-2026-002',
        id_importer_alex,
        id_supplier_edward,
        id_cnt_03,
        28000.00,
        14000.00,
        'EUR',
        'partially_paid',
        '2026-03-10',
        '2026-04-10',
        'Tomatoes Round — first payment received'
    )
ON CONFLICT (id) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────
-- 7. PAYMENTS (for the partially paid invoice)
-- ─────────────────────────────────────────────────────────────────────────

INSERT INTO portix.payments (
    invoice_id, amount, currency, paid_at, reference
) VALUES (
    id_invoice_02,
    14000.00,
    'EUR',
    '2026-03-20 10:00:00+00',
    'SWIFT-REF-20260320-EUR'
) ON CONFLICT DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────
-- 8. CLAIMS
-- ─────────────────────────────────────────────────────────────────────────

INSERT INTO portix.claims (
    id, container_id, importer_id, supplier_id,
    claim_type, description, amount, currency, status
) VALUES
    (
        id_claim_01,
        id_cnt_03,
        id_importer_alex,
        id_supplier_edward,
        'quality_issue',
        'Approximately 15% of tomatoes arrived with visible bruising and early signs of decay. Cold chain may have been interrupted.',
        4200.00,
        'EUR',
        'open'
    ),
    (
        id_claim_02,
        id_cnt_03,
        id_importer_alex,
        id_supplier_edward,
        'short_shipment',
        'Declared weight 24,000 kg. Actual received weight 23,100 kg. Shortfall of 900 kg.',
        1350.00,
        'EUR',
        'under_review'
    )
ON CONFLICT (id) DO NOTHING;

-- Add a claim message thread to claim_01
WITH msg AS (
    INSERT INTO portix.claim_messages (claim_id, sender_id, message)
    VALUES (
        id_claim_01,
        id_importer_alex,
        'We received the tomatoes today. 15% of boxes show bruising consistent with temperature fluctuation. Attaching photos.'
    )
    RETURNING id
)
INSERT INTO portix.claim_attachments (message_id, media_type, storage_path, file_name, file_size_bytes, mime_type)
SELECT
    msg.id,
    'image',
    'claim-attachments/' || id_claim_01 || '/photo-bruising-01.jpg',
    'photo-bruising-01.jpg',
    512000,
    'image/jpeg'
FROM msg;

INSERT INTO portix.claim_messages (claim_id, sender_id, message)
VALUES (
    id_claim_01,
    id_supplier_edward,
    'We are sorry to hear this. Our cooling report confirms the container was maintained at +10°C throughout. Can you share the photos so we can investigate?'
);


-- ─────────────────────────────────────────────────────────────────────────
-- 9. IMPORT LICENSES
-- (license_status and days_remaining computed in the view)
-- ─────────────────────────────────────────────────────────────────────────

INSERT INTO portix.import_licenses (
    id, importer_id, supplier_id,
    license_number, issue_date, expiration_date,
    file_name, notes
) VALUES
    (
        id_license_01,
        id_importer_alex,
        id_supplier_edward,
        'IL-2025-CEL-001',
        '2025-06-01',
        '2026-06-01',  -- Valid (expires in ~2 months from April 2026)
        'IL-2025-CEL-001.pdf',
        'General produce import license for Celeste (Greece). Covers all product categories.'
    ),
    (
        id_license_02,
        id_importer_alex,
        id_supplier_edward,
        'IL-2026-CEL-KIWI',
        '2026-01-01',
        '2026-04-25',  -- Expiring soon (within 30 days of April 2026)
        'IL-2026-CEL-KIWI.pdf',
        'Special kiwi import license — expedited. RENEWAL REQUIRED URGENTLY.'
    )
ON CONFLICT (id) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────
-- 10. CELESTE PRODUCT CATALOG
-- (from the supplier matrix image — for reference / future PO module)
-- Products, varieties, sizes, packages
-- ─────────────────────────────────────────────────────────────────────────

-- Products
INSERT INTO portix.supplier_orgs (id, company_name, country, currency)
VALUES (id_org_celeste, 'Celeste', 'Greece', 'EUR')
ON CONFLICT (id) DO NOTHING;

-- Note: Full product catalog (products, varieties, sizes, packages, supplier_catalog_items)
-- is defined in the separate portix-product-catalog.sql file.
-- The Celeste pilot seed here focuses on the operational tables only.


RAISE NOTICE 'Portix pilot seed data loaded successfully.';
RAISE NOTICE '  Supplier org:  Celeste (%)' , id_org_celeste;
RAISE NOTICE '  Profiles:      4 users (importer, 2× supplier, customs_agent)';
RAISE NOTICE '  Shipment:      SHP-2026-001 (MSC Mirella, Piraeus→Ashdod)';
RAISE NOTICE '  Containers:    3 (documents_missing, waiting_customs_review, released)';
RAISE NOTICE '  Documents:     21 rows (7 per container, various statuses)';
RAISE NOTICE '  Invoices:      2 (1 unpaid, 1 partially_paid)';
RAISE NOTICE '  Claims:        2 (1 open with message thread, 1 under_review)';
RAISE NOTICE '  Licenses:      2 (1 valid, 1 expiring_soon)';
RAISE NOTICE '';
RAISE NOTICE 'NEXT STEP: Create auth users via Supabase Dashboard and update UUIDs if needed.';

END $$;
