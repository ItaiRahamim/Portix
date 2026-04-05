-- ═══════════════════════════════════════════════════════════════════════════
-- PORTIX — Database Triggers & Functions
-- Migration: 00303_triggers.sql
-- Depends on: 00301_initial_schema.sql, 00302_rls_policies.sql
--
-- Trigger inventory:
--   1. handle_new_user              — auto-create profile on auth signup
--   2. seed_container_documents     — auto-create 7 document rows on container INSERT
--   3. sync_document_counts         — keep containers.docs_* counters in sync
--   4. auto_advance_container_status — auto-advance status based on doc approval
--   5. update_updated_at            — generic updated_at maintenance
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────
-- TRIGGER 1: handle_new_user
-- Fires AFTER INSERT on auth.users (Supabase Auth managed table).
-- Auto-creates a profiles row so every authenticated user has a profile.
-- The role is read from raw_user_meta_data.role (set during signup).
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION portix.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = portix, public
AS $$
BEGIN
    INSERT INTO portix.profiles (
        id,
        email,
        full_name,
        company_name,
        role
    ) VALUES (
        NEW.id,
        COALESCE(NEW.email, ''),
        COALESCE(
            NEW.raw_user_meta_data ->> 'full_name',
            NEW.raw_user_meta_data ->> 'name',
            split_part(COALESCE(NEW.email, ''), '@', 1)
        ),
        COALESCE(NEW.raw_user_meta_data ->> 'company_name', ''),
        -- Role must be passed in signup metadata: supabase.auth.signUp({ data: { role: 'importer' } })
        -- Falls back to 'importer' if not provided (safe default)
        COALESCE(
            (NEW.raw_user_meta_data ->> 'role')::portix.user_role,
            'importer'::portix.user_role
        )
    )
    ON CONFLICT (id) DO NOTHING; -- Idempotent: ignore if profile already exists

    RETURN NEW;
EXCEPTION
    WHEN invalid_text_representation THEN
        -- Invalid role value in metadata — fall back to 'importer'
        INSERT INTO portix.profiles (id, email, full_name, company_name, role)
        VALUES (
            NEW.id,
            COALESCE(NEW.email, ''),
            COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
            COALESCE(NEW.raw_user_meta_data ->> 'company_name', ''),
            'importer'::portix.user_role
        )
        ON CONFLICT (id) DO NOTHING;
        RETURN NEW;
END;
$$;

-- Attach to auth.users (Supabase's managed auth schema)
CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION portix.handle_new_user();

COMMENT ON FUNCTION portix.handle_new_user() IS
    'Auto-creates portix.profiles row when a new user signs up via Supabase Auth.
     Role is read from raw_user_meta_data.role passed during signUp().';


-- ─────────────────────────────────────────────────────────────────────────
-- TRIGGER 2: seed_container_documents
-- Fires AFTER INSERT on portix.containers.
-- Auto-creates exactly 7 document rows (one per required document type)
-- all with status = ''missing''. This is the canonical way new containers
-- get their document checklist.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION portix.seed_container_documents()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = portix, public
AS $$
DECLARE
    -- The 7 required document types (CLAUDE.md / PRD canonical list)
    required_types portix.document_type[] := ARRAY[
        'commercial_invoice',
        'packing_list',
        'phytosanitary_certificate',
        'bill_of_lading',
        'certificate_of_origin',
        'cooling_report',
        'insurance_certificate'
    ]::portix.document_type[];

    doc_type portix.document_type;
BEGIN
    -- Insert one 'missing' document row for each required type
    FOREACH doc_type IN ARRAY required_types LOOP
        INSERT INTO portix.documents (
            container_id,
            document_type,
            status
        ) VALUES (
            NEW.id,
            doc_type,
            'missing'::portix.document_status
        )
        ON CONFLICT (container_id, document_type) DO NOTHING; -- Idempotent
    END LOOP;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_container_created_seed_documents
    AFTER INSERT ON portix.containers
    FOR EACH ROW
    EXECUTE FUNCTION portix.seed_container_documents();

COMMENT ON FUNCTION portix.seed_container_documents() IS
    'Auto-seeds 7 document rows (all status=missing) for every new container.
     The 7 types are: commercial_invoice, packing_list, phytosanitary_certificate,
     bill_of_lading, certificate_of_origin, cooling_report, insurance_certificate.';


-- ─────────────────────────────────────────────────────────────────────────
-- TRIGGER 3: sync_document_counts
-- Fires AFTER UPDATE OF status on portix.documents.
-- Keeps containers.docs_uploaded, docs_approved, docs_rejected in sync.
-- These denormalized counters power dashboard KPI cards with zero joins.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION portix.sync_document_counts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = portix, public
AS $$
DECLARE
    v_uploaded  SMALLINT;
    v_approved  SMALLINT;
    v_rejected  SMALLINT;
BEGIN
    -- Recount all document statuses for this container
    SELECT
        COUNT(*) FILTER (WHERE status != 'missing'),
        COUNT(*) FILTER (WHERE status = 'approved'),
        COUNT(*) FILTER (WHERE status = 'rejected')
    INTO v_uploaded, v_approved, v_rejected
    FROM portix.documents
    WHERE container_id = NEW.container_id;

    -- Update the denormalized counters on the container row
    UPDATE portix.containers
    SET
        docs_uploaded = v_uploaded,
        docs_approved = v_approved,
        docs_rejected = v_rejected,
        updated_at    = now()
    WHERE id = NEW.container_id;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_document_status_changed_sync_counts
    AFTER UPDATE OF status ON portix.documents
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status) -- Only fire when status actually changes
    EXECUTE FUNCTION portix.sync_document_counts();

COMMENT ON FUNCTION portix.sync_document_counts() IS
    'Keeps containers.docs_uploaded/approved/rejected in sync after document status changes.
     Fires ONLY when document status actually changes (WHEN guard reduces unnecessary executions).';


-- ─────────────────────────────────────────────────────────────────────────
-- TRIGGER 4: auto_advance_container_status
-- Fires AFTER UPDATE OF docs_approved, docs_rejected on portix.containers.
-- Implements the business rules:
--   Rule A: docs_approved = docs_total AND status = 'waiting_customs_review'
--           → status advances to 'ready_for_clearance'
--   Rule B: docs_rejected > 0 AND status IN ('waiting_customs_review', 'ready_for_clearance')
--           → status regresses to 'rejected_documents'
--
-- NOTE: This trigger fires AFTER sync_document_counts updates the counters,
--       creating a safe chain: document status change → counters update → container status advance.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION portix.auto_advance_container_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = portix, public
AS $$
BEGIN
    -- RULE B: Any rejection overrides approval (checked first — higher priority)
    IF NEW.docs_rejected > 0
       AND NEW.status IN (
           'waiting_customs_review',
           'ready_for_clearance'
       )
    THEN
        UPDATE portix.containers
        SET status     = 'rejected_documents',
            updated_at = now()
        WHERE id = NEW.id;

        RETURN NEW;
    END IF;

    -- RULE A: All documents approved → ready for clearance
    IF NEW.docs_approved = NEW.docs_total
       AND NEW.docs_total > 0
       AND NEW.docs_rejected = 0
       AND NEW.status = 'waiting_customs_review'
    THEN
        UPDATE portix.containers
        SET status     = 'ready_for_clearance',
            updated_at = now()
        WHERE id = NEW.id;

        RETURN NEW;
    END IF;

    -- RULE C: A previously rejected doc is replaced and re-uploaded
    -- (rejected count drops to 0, still has pending docs) → back to waiting_customs_review
    IF OLD.docs_rejected > 0
       AND NEW.docs_rejected = 0
       AND NEW.status = 'rejected_documents'
    THEN
        UPDATE portix.containers
        SET status     = 'waiting_customs_review',
            updated_at = now()
        WHERE id = NEW.id;

        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_container_docs_changed_advance_status
    AFTER UPDATE OF docs_approved, docs_rejected ON portix.containers
    FOR EACH ROW
    WHEN (
        OLD.docs_approved IS DISTINCT FROM NEW.docs_approved
        OR OLD.docs_rejected IS DISTINCT FROM NEW.docs_rejected
    )
    EXECUTE FUNCTION portix.auto_advance_container_status();

COMMENT ON FUNCTION portix.auto_advance_container_status() IS
    'Implements container status state machine automation:
       - All 7 docs approved → ready_for_clearance
       - Any doc rejected → rejected_documents
       - Last rejection replaced → back to waiting_customs_review
     Fires after sync_document_counts updates counters.';


-- ─────────────────────────────────────────────────────────────────────────
-- TRIGGER 5: update_updated_at (generic)
-- Fires BEFORE UPDATE on any table with an updated_at column.
-- Eliminates the need for application-level timestamp management.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION portix.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

-- Apply to all tables with updated_at
CREATE OR REPLACE TRIGGER set_updated_at_supplier_orgs
    BEFORE UPDATE ON portix.supplier_orgs
    FOR EACH ROW EXECUTE FUNCTION portix.set_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at_profiles
    BEFORE UPDATE ON portix.profiles
    FOR EACH ROW EXECUTE FUNCTION portix.set_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at_shipments
    BEFORE UPDATE ON portix.shipments
    FOR EACH ROW EXECUTE FUNCTION portix.set_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at_containers
    BEFORE UPDATE ON portix.containers
    FOR EACH ROW EXECUTE FUNCTION portix.set_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at_documents
    BEFORE UPDATE ON portix.documents
    FOR EACH ROW EXECUTE FUNCTION portix.set_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at_invoices
    BEFORE UPDATE ON portix.invoices
    FOR EACH ROW EXECUTE FUNCTION portix.set_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at_claims
    BEFORE UPDATE ON portix.claims
    FOR EACH ROW EXECUTE FUNCTION portix.set_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at_import_licenses
    BEFORE UPDATE ON portix.import_licenses
    FOR EACH ROW EXECUTE FUNCTION portix.set_updated_at();

COMMENT ON FUNCTION portix.set_updated_at() IS
    'Generic trigger function: sets updated_at = now() on any UPDATE.
     Applied to all tables with an updated_at column.';


-- ─────────────────────────────────────────────────────────────────────────
-- TRIGGER 6: sync_invoice_status
-- Fires AFTER INSERT on portix.payments.
-- Auto-updates the parent invoice's paid_amount and status
-- when a payment record is added.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION portix.sync_invoice_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = portix, public
AS $$
DECLARE
    v_total_paid    NUMERIC(18, 2);
    v_invoice_total NUMERIC(18, 2);
    v_new_status    portix.invoice_status;
BEGIN
    -- Sum all payments for this invoice
    SELECT
        COALESCE(SUM(amount), 0),
        (SELECT amount FROM portix.invoices WHERE id = NEW.invoice_id)
    INTO v_total_paid, v_invoice_total
    FROM portix.payments
    WHERE invoice_id = NEW.invoice_id;

    -- Determine new status
    IF v_total_paid >= v_invoice_total THEN
        v_new_status := 'paid';
    ELSIF v_total_paid > 0 THEN
        v_new_status := 'partially_paid';
    ELSE
        v_new_status := 'unpaid';
    END IF;

    -- Update invoice
    UPDATE portix.invoices
    SET
        paid_amount = LEAST(v_total_paid, v_invoice_total), -- cap at total
        status      = v_new_status,
        updated_at  = now()
    WHERE id = NEW.invoice_id;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_payment_inserted_sync_invoice
    AFTER INSERT ON portix.payments
    FOR EACH ROW
    EXECUTE FUNCTION portix.sync_invoice_status();

COMMENT ON FUNCTION portix.sync_invoice_status() IS
    'Auto-updates invoices.paid_amount and invoices.status when a payment is recorded.
     Status logic: paid_amount = amount → paid; > 0 → partially_paid; 0 → unpaid.';
