-- Migration: 00335_add_container_costs
--
-- Creates portix.container_costs — one row per container storing all landed-cost
-- component values entered by the importer / supplier in the Finance tab.
-- Row is created on first save (upsert). Deleted automatically when container deleted.

-- ── Table ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS portix.container_costs (
    container_id    UUID        PRIMARY KEY
                                REFERENCES portix.containers(id) ON DELETE CASCADE,
    fob_value       NUMERIC     NOT NULL DEFAULT 0,
    freight         NUMERIC     NOT NULL DEFAULT 0,
    insurance       NUMERIC     NOT NULL DEFAULT 0,
    customs_duty    NUMERIC     NOT NULL DEFAULT 0,
    port_handling   NUMERIC     NOT NULL DEFAULT 0,
    inland_trucking NUMERIC     NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE portix.container_costs IS
    'Landed-cost components for a container, entered manually in the Finance tab.';

-- ── RLS ────────────────────────────────────────────────────────────────────────

ALTER TABLE portix.container_costs ENABLE ROW LEVEL SECURITY;

-- Importer and supplier: full read + write for containers they own.
CREATE POLICY "Importer/supplier can manage their container costs"
    ON portix.container_costs
    FOR ALL
    TO authenticated
    USING (
        container_id IN (
            SELECT id FROM portix.containers
            WHERE importer_id = auth.uid()
               OR supplier_id = auth.uid()
        )
    )
    WITH CHECK (
        container_id IN (
            SELECT id FROM portix.containers
            WHERE importer_id = auth.uid()
               OR supplier_id = auth.uid()
        )
    );

-- Customs agent: read-only for any container they can see.
CREATE POLICY "Customs agent can read container costs"
    ON portix.container_costs
    FOR SELECT
    TO authenticated
    USING (
        portix.get_user_role() = 'customs_agent'
    );

-- ── GRANTs ─────────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE ON portix.container_costs TO authenticated;
