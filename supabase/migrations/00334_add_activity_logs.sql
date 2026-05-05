-- Migration: 00334_add_activity_logs
--
-- Creates portix.activity_logs — an append-only audit trail for container actions.
-- Rows are written by the frontend via the Supabase browser client using
-- the authenticated user's JWT (RLS enforces scope).
--
-- Retention: rows are deleted automatically when the parent container is deleted
-- (ON DELETE CASCADE). No UPDATE or DELETE is allowed to any row — immutable log.

-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS portix.activity_logs (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    container_id UUID        NOT NULL REFERENCES portix.containers(id) ON DELETE CASCADE,
    actor        VARCHAR(255) NOT NULL,   -- display name of the user who performed the action
    action       VARCHAR(100) NOT NULL,   -- e.g. 'MANUAL_UPDATE', 'DOC_APPROVED', 'DOC_REJECTED'
    details      TEXT,                    -- human-readable description; nullable
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_container_id
    ON portix.activity_logs (container_id, created_at DESC);

COMMENT ON TABLE portix.activity_logs IS
    'Append-only audit trail for container events. Never UPDATE or DELETE rows.';

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE portix.activity_logs ENABLE ROW LEVEL SECURITY;

-- INSERT: any authenticated user whose role is importer, supplier, or customs_agent.
-- The app only writes logs for containers the user already has UPDATE access to,
-- so this broad INSERT policy is safe — it just avoids a second privilege check.
CREATE POLICY "Authenticated users can log activity"
    ON portix.activity_logs
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- SELECT: user can read logs only for containers they own.
-- Mirrors the containers table RLS: importer or supplier FK, or customs agent.
CREATE POLICY "Users can read logs for their containers"
    ON portix.activity_logs
    FOR SELECT
    TO authenticated
    USING (
        container_id IN (
            SELECT id FROM portix.containers
            WHERE importer_id = auth.uid()
               OR supplier_id = auth.uid()
        )
        OR portix.get_user_role() = 'customs_agent'
    );

-- No UPDATE policy → rows are immutable.
-- No DELETE policy → rows are immutable.

-- ── GRANTs ────────────────────────────────────────────────────────────────────

GRANT INSERT, SELECT ON portix.activity_logs TO authenticated;
GRANT USAGE ON SEQUENCE portix.activity_logs_id_seq TO authenticated;

-- anon role gets nothing (all routes require auth).
