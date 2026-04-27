-- ─── Fix: Shipments UPDATE RLS — definitive, recursion-free ─────────────────
--
-- PROBLEM
-- ───────
-- "shipments: creator can update" (migration 00302) uses USING (created_by = auth.uid()).
-- When a SUPPLIER creates a shipment the importer is NOT the creator, so any
-- importer call to update customs_agent_id executes 0 rows with no error —
-- the UI shows "Success" but nothing persists.
--
-- "shipments: importer can update own" (migration 00324) attempted a fix but
-- used portix.is_importer() — a STABLE SECURITY DEFINER function — combined
-- with an IN subquery, which can misbehave in UPDATE contexts due to STABLE
-- result caching and planner inlining. It may also not have been deployed to
-- the live database.
--
-- ROOT CAUSE PATTERN
-- ──────────────────
-- All previous shipments UPDATE policies rely on either:
--   a) created_by = auth.uid()  → fails for supplier-created shipments
--   b) portix.is_importer()     → STABLE function, unreliable in UPDATE RLS
--   c) id IN (SELECT ...)       → less safe than EXISTS in RLS contexts
--
-- FIX
-- ───
-- Drop every UPDATE policy on portix.shipments.
-- Create ONE clean policy that:
--   • Uses EXISTS (not IN) — explicit, correct, and matches the proven
--     recursion-free pattern used in migration 00313.
--   • Calls NO helper functions (no is_importer(), no get_user_role()) —
--     eliminates the STABLE caching risk entirely.
--   • Covers both paths with a single USING expression:
--       – creator can always update their own shipment
--       – importer can update any shipment containing their containers
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Step 1: Drop every existing UPDATE policy on portix.shipments ─────────────

DROP POLICY IF EXISTS "shipments: creator can update"        ON portix.shipments;
DROP POLICY IF EXISTS "shipments: importer can update own"   ON portix.shipments;

-- ── Step 2: One clean, definitive UPDATE policy ───────────────────────────────

CREATE POLICY "shipments: creator or importer can update"
    ON portix.shipments
    FOR UPDATE
    TO authenticated
    USING (
        -- Path A: the user who created the shipment (works for both importer-
        --         and supplier-created shipments when updated by their creator)
        created_by = auth.uid()

        OR

        -- Path B: any importer whose containers belong to this shipment.
        --   • EXISTS is evaluated per-row and does NOT cache via STABLE semantics.
        --   • portix.shipments.id is explicit — no column ambiguity.
        --   • This fires for supplier-created shipments being updated by the
        --     importer (the Racheli use-case).
        EXISTS (
            SELECT 1
              FROM portix.containers c
             WHERE c.shipment_id = portix.shipments.id
               AND c.importer_id = auth.uid()
        )
    )
    WITH CHECK (
        -- Mirror USING exactly so no row can slip past the WITH CHECK.
        created_by = auth.uid()

        OR

        EXISTS (
            SELECT 1
              FROM portix.containers c
             WHERE c.shipment_id = portix.shipments.id
               AND c.importer_id = auth.uid()
        )
    );
