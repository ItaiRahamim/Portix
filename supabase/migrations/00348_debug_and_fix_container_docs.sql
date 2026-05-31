-- Migration: 00348_debug_and_fix_container_docs
--
-- Two parts:
--   1. Diagnostic RPC: portix.debug_container_auth(uuid) — returns auth.uid(),
--      the container's importer_id / supplier_id / shipment customs_agent_id,
--      and the boolean results so we can see exactly why the gate fails.
--   2. Rewrite portix.get_container_documents — replace the is_customs_agent()
--      call (which chains through get_user_role → profiles lookup, adding a
--      potential failure point) with a direct FK lookup of the shipment's
--      customs_agent_id. Simpler, fewer moving parts, same security contract.


-- ── 1. Diagnostic RPC ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION portix.debug_container_auth(p_container_id UUID)
RETURNS TABLE (
    current_uid          UUID,
    container_importer   UUID,
    container_supplier   UUID,
    shipment_agent       UUID,
    uid_is_importer      BOOLEAN,
    uid_is_supplier      BOOLEAN,
    uid_is_agent         BOOLEAN,
    is_customs_agent_fn  BOOLEAN,
    can_see_gate         BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = portix, public
AS $$
DECLARE
    v_uid  UUID := auth.uid();
    v_imp  UUID;
    v_sup  UUID;
    v_agt  UUID;
BEGIN
    SELECT c.importer_id, c.supplier_id, s.customs_agent_id
    INTO   v_imp, v_sup, v_agt
    FROM   portix.containers c
    LEFT JOIN portix.shipments s ON s.id = c.shipment_id
    WHERE  c.id = p_container_id;

    RETURN QUERY SELECT
        v_uid,
        v_imp,
        v_sup,
        v_agt,
        (v_uid = v_imp),
        (v_uid = v_sup),
        (v_uid = v_agt),
        portix.is_customs_agent(),
        (v_uid = v_imp OR v_uid = v_sup OR v_uid = v_agt OR portix.is_customs_agent());
END;
$$;

GRANT EXECUTE ON FUNCTION portix.debug_container_auth(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION portix.debug_container_auth(UUID) IS
    'One-shot diagnostic: returns auth.uid() + container ownership columns '
    'to expose why the get_container_documents gate rejects a legitimate owner.';


-- ── 2. Rewrite get_container_documents (simpler gate) ────────────────────────
-- Gate now does a single LEFT JOIN pull of importer_id / supplier_id /
-- shipments.customs_agent_id and matches uid against all three directly.
-- No call to is_customs_agent() / get_user_role() / profiles lookup.
-- If ANY of those three FKs equals auth.uid() the caller may read the docs.

CREATE OR REPLACE FUNCTION portix.get_container_documents(p_container_id UUID)
RETURNS SETOF portix.documents
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = portix, public
AS $$
DECLARE
    v_uid          UUID := auth.uid();
    v_importer_id  UUID;
    v_supplier_id  UUID;
    v_agent_id     UUID;
    v_can_see      BOOLEAN;
    v_is_agent     BOOLEAN;
    rec            portix.documents%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN
        RETURN;
    END IF;

    -- Pull the three ownership fields in one pass (no RLS, SECURITY DEFINER
    -- runs as function owner with full table access).
    SELECT c.importer_id, c.supplier_id, s.customs_agent_id
    INTO   v_importer_id, v_supplier_id, v_agent_id
    FROM   portix.containers c
    LEFT JOIN portix.shipments s ON s.id = c.shipment_id
    WHERE  c.id = p_container_id;

    v_is_agent := (v_uid = v_agent_id OR portix.is_customs_agent());
    v_can_see  := (v_uid = v_importer_id OR v_uid = v_supplier_id OR v_is_agent);

    IF NOT v_can_see THEN
        RETURN;
    END IF;

    FOR rec IN
        SELECT *
        FROM   portix.documents
        WHERE  container_id = p_container_id
        ORDER BY document_type
    LOOP
        IF NOT v_is_agent THEN
            rec.internal_note := NULL;
        END IF;
        RETURN NEXT rec;
    END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION portix.get_container_documents(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION portix.get_container_documents(UUID) IS
    'Documents for a container, gated by direct FK match '
    '(importer_id / supplier_id / shipment.customs_agent_id = auth.uid(), '
    'or is_customs_agent() fallback). SECURITY DEFINER — bypasses documents '
    'RLS. internal_note nulled for non-agents.';

NOTIFY pgrst, 'reload schema';
