-- ─── Standardize customs agent role name to 'customs' ───────────────────────
-- The UI and frontend code uses 'customs_agent' (DB enum value) but we are
-- standardizing to the shorter 'customs'. This migration:
--   1. Adds 'customs' to the user_role enum
--   2. Migrates any existing profiles with role='customs_agent' → 'customs'
--   3. Replaces all RLS policies to check for 'customs' (not 'customs_agent')

-- Step 1: Add new enum value (safe — existing rows are unaffected)
ALTER TYPE portix.user_role ADD VALUE IF NOT EXISTS 'customs';

-- Step 2: Commit the enum change (required before using it in DML)
-- (implicit — Postgres commits DDL in the same transaction for ADD VALUE)

-- Step 3: Migrate existing profiles
UPDATE portix.profiles
   SET role = 'customs'
 WHERE role = 'customs_agent';

-- ─── RLS: Containers ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "customs_agents_read_assigned_containers"   ON portix.containers;
DROP POLICY IF EXISTS "customs_agents_read_containers_in_review"  ON portix.containers;

CREATE POLICY "customs_read_assigned_containers"
  ON portix.containers
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND (SELECT role FROM portix.profiles WHERE id = auth.uid()) IN ('customs', 'customs_agent')
    AND (SELECT customs_agent_id FROM portix.shipments WHERE id = shipment_id) = auth.uid()
  );

-- ─── RLS: Documents ──────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "customs_agents_manage_assigned_documents"  ON portix.documents;
DROP POLICY IF EXISTS "customs_agents_read_assigned_documents"    ON portix.documents;
DROP POLICY IF EXISTS "customs_agents_manage_documents"           ON portix.documents;
DROP POLICY IF EXISTS "customs_agents_read_documents"             ON portix.documents;

CREATE POLICY "customs_read_assigned_documents"
  ON portix.documents
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND (SELECT role FROM portix.profiles WHERE id = auth.uid()) IN ('customs', 'customs_agent')
    AND (
      SELECT customs_agent_id FROM portix.shipments
       WHERE id = (SELECT shipment_id FROM portix.containers WHERE id = container_id)
    ) = auth.uid()
  );

CREATE POLICY "customs_manage_assigned_documents"
  ON portix.documents
  FOR UPDATE
  USING (
    auth.uid() IS NOT NULL
    AND (SELECT role FROM portix.profiles WHERE id = auth.uid()) IN ('customs', 'customs_agent')
    AND (
      SELECT customs_agent_id FROM portix.shipments
       WHERE id = (SELECT shipment_id FROM portix.containers WHERE id = container_id)
    ) = auth.uid()
  );
