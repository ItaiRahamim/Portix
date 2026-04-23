-- ============================================================
-- Migration 00317: B2B Companies + Financial Transactions
-- ============================================================
-- Introduces:
--   portix.companies          — company-level entities (importer/supplier/broker)
--   portix.profiles.company_id — links every user to their company
--   portix.transaction_type   — enum: invoice | payment | credit_note
--   portix.transaction_status — enum: active | pending_approval | approved | rejected | voided
--   portix.transactions       — unified financial ledger (replaces invoice+payment tables in UI)
--   portix.company_balances   — live balance view per company pair
-- ============================================================

-- ─── 1. Companies ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS portix.companies (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('importer', 'supplier', 'broker')),
  country    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE portix.companies ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read all companies (needed for counterpart lookup).
CREATE POLICY "companies_select_authenticated"
  ON portix.companies FOR SELECT
  TO authenticated
  USING (true);

-- Only service role inserts/updates (done via admin client or migrations).
-- No direct user INSERT — companies are managed by admins.

-- ─── 2. Link profiles → companies ────────────────────────────────────────────

ALTER TABLE portix.profiles
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES portix.companies(id);

CREATE INDEX IF NOT EXISTS idx_profiles_company_id ON portix.profiles(company_id);

-- Auto-create one company per distinct (company_name, role) combination that
-- already exists in profiles, then back-fill company_id.
DO $$
BEGIN
  -- Insert companies from existing company_name values
  INSERT INTO portix.companies (name, type)
  SELECT DISTINCT
    company_name,
    CASE role
      WHEN 'importer'      THEN 'importer'
      WHEN 'supplier'      THEN 'supplier'
      WHEN 'customs_agent' THEN 'broker'
      WHEN 'customs'       THEN 'broker'
      ELSE 'importer'
    END
  FROM portix.profiles
  WHERE company_name IS NOT NULL AND company_name <> ''
  ON CONFLICT DO NOTHING;

  -- Back-fill company_id on profiles
  UPDATE portix.profiles p
  SET    company_id = c.id
  FROM   portix.companies c
  WHERE  p.company_name = c.name
    AND  p.company_id IS NULL;
END $$;

-- ─── 3. Transaction enums ──────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE portix.transaction_type AS ENUM ('invoice', 'payment', 'credit_note');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE portix.transaction_status AS ENUM (
    'active',            -- invoice issued / credit note issued (immediately in force)
    'pending_approval',  -- payment submitted, awaiting creditor approval
    'approved',          -- payment confirmed by creditor → offsets debt
    'rejected',          -- payment proof rejected by creditor
    'voided'             -- transaction cancelled (no balance effect)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 4. Transactions table ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS portix.transactions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── Type & status ──────────────────────────────────────────────────────────
  type                   portix.transaction_type   NOT NULL,
  status                 portix.transaction_status NOT NULL DEFAULT 'active',

  -- ── Company parties ────────────────────────────────────────────────────────
  -- creditor = who is owed money (supplier or broker)
  -- debtor   = who owes money (importer)
  creditor_company_id    UUID NOT NULL REFERENCES portix.companies(id),
  debtor_company_id      UUID NOT NULL REFERENCES portix.companies(id),
  CHECK (creditor_company_id <> debtor_company_id),

  -- ── Acting user ────────────────────────────────────────────────────────────
  created_by             UUID NOT NULL REFERENCES portix.profiles(id),

  -- ── Financial ──────────────────────────────────────────────────────────────
  amount                 NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
  currency               CHAR(3) NOT NULL DEFAULT 'USD',

  -- ── Parent link (payments & credit notes reference the invoice they offset) ─
  parent_transaction_id  UUID REFERENCES portix.transactions(id),

  -- ── Optional container link ────────────────────────────────────────────────
  container_id           UUID REFERENCES portix.containers(id),

  -- ── Document upload ────────────────────────────────────────────────────────
  document_storage_path  TEXT,
  document_file_name     TEXT,
  document_uploaded_by   UUID REFERENCES portix.profiles(id),

  -- ── Dates ──────────────────────────────────────────────────────────────────
  transaction_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date               DATE,

  -- ── Approval ───────────────────────────────────────────────────────────────
  approved_by            UUID REFERENCES portix.profiles(id),
  approved_at            TIMESTAMPTZ,

  -- ── Metadata ───────────────────────────────────────────────────────────────
  reference_number       TEXT,   -- invoice number, SWIFT ref, credit note number
  notes                  TEXT,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_transactions_creditor
  ON portix.transactions(creditor_company_id);
CREATE INDEX IF NOT EXISTS idx_transactions_debtor
  ON portix.transactions(debtor_company_id);
CREATE INDEX IF NOT EXISTS idx_transactions_parent
  ON portix.transactions(parent_transaction_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type_status
  ON portix.transactions(type, status);
CREATE INDEX IF NOT EXISTS idx_transactions_date
  ON portix.transactions(transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_created_by
  ON portix.transactions(created_by);

-- ─── 5. RLS on transactions ────────────────────────────────────────────────────

ALTER TABLE portix.transactions ENABLE ROW LEVEL SECURITY;

-- Users can see transactions where their company is either party.
CREATE POLICY "transactions_select_own_company"
  ON portix.transactions FOR SELECT
  TO authenticated
  USING (
    creditor_company_id = (
      SELECT company_id FROM portix.profiles WHERE id = auth.uid()
    )
    OR
    debtor_company_id = (
      SELECT company_id FROM portix.profiles WHERE id = auth.uid()
    )
  );

-- Creditor company members can insert invoices and credit notes.
-- Debtor company members can insert payments.
-- Enforced at the application layer; DB allows any authenticated user whose
-- company is a party to insert (more granular rules live in the app).
CREATE POLICY "transactions_insert_own_company"
  ON portix.transactions FOR INSERT
  TO authenticated
  WITH CHECK (
    creditor_company_id = (
      SELECT company_id FROM portix.profiles WHERE id = auth.uid()
    )
    OR
    debtor_company_id = (
      SELECT company_id FROM portix.profiles WHERE id = auth.uid()
    )
  );

-- Only creditor company members can approve/reject payments (UPDATE).
CREATE POLICY "transactions_update_creditor"
  ON portix.transactions FOR UPDATE
  TO authenticated
  USING (
    creditor_company_id = (
      SELECT company_id FROM portix.profiles WHERE id = auth.uid()
    )
  );

-- ─── 6. Company balances view ─────────────────────────────────────────────────
-- Computes the live balance per creditor/debtor company pair.
-- Balance = total invoiced − approved payments − credit notes
-- Pending payments do NOT reduce the balance until approved.

CREATE OR REPLACE VIEW portix.company_balances AS
SELECT
  creditor_company_id,
  debtor_company_id,
  SUM(CASE WHEN type = 'invoice'                                     THEN amount ELSE 0 END) AS total_invoiced,
  SUM(CASE WHEN type = 'payment'     AND status = 'approved'         THEN amount ELSE 0 END) AS total_paid,
  SUM(CASE WHEN type = 'credit_note' AND status NOT IN ('voided','rejected') THEN amount ELSE 0 END) AS total_credits,
  SUM(CASE WHEN type = 'invoice'                                     THEN  amount
           WHEN type = 'payment'     AND status = 'approved'         THEN -amount
           WHEN type = 'credit_note' AND status NOT IN ('voided','rejected') THEN -amount
           ELSE 0
       END) AS current_balance
FROM portix.transactions
WHERE status <> 'voided'
GROUP BY creditor_company_id, debtor_company_id;

-- ─── 7. updated_at trigger on transactions ────────────────────────────────────

CREATE OR REPLACE FUNCTION portix.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_transactions_updated_at ON portix.transactions;
CREATE TRIGGER trg_transactions_updated_at
  BEFORE UPDATE ON portix.transactions
  FOR EACH ROW EXECUTE FUNCTION portix.set_updated_at();

DROP TRIGGER IF EXISTS trg_companies_updated_at ON portix.companies;
CREATE TRIGGER trg_companies_updated_at
  BEFORE UPDATE ON portix.companies
  FOR EACH ROW EXECUTE FUNCTION portix.set_updated_at();

-- ─── 8. PostgREST schema reload ───────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
