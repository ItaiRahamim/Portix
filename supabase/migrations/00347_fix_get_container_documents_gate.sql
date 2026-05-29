-- Migration: 00347_fix_get_container_documents_gate
--
-- 00346's get_container_documents RPC returned an empty array (200 OK) even
-- when the container was visible. Root cause: the access gate was STRICTER
-- than container visibility.
--
-- portix.containers has a policy "containers: customs agent reads all"
-- (USING is_customs_agent()) created in 00302 and never dropped — so ANY
-- customs agent can SELECT every container via v_containers. But 00346's gate
-- only allowed importer / supplier / the customs agent ASSIGNED to the
-- shipment. A customs agent viewing a container they aren't assigned to could
-- load the page (container visible) yet get zero documents.
--
-- Fix: make the document gate mirror container visibility exactly. A caller
-- who can see the container can read its documents:
--   • importer_id = uid
--   • supplier_id = uid
--   • is_customs_agent()  (matches the "customs agent reads all" container policy)
--
-- internal_note stays customs-agent-only (any customs agent, matching the
-- long-standing "documents: customs agent reads all" policy from 00302).
--
-- The frontend already passes the correct parameter name (p_container_id), so
-- no signature change — CREATE OR REPLACE keeps the same arg.

CREATE OR REPLACE FUNCTION portix.get_container_documents(p_container_id UUID)
RETURNS SETOF portix.documents
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = portix, public
AS $$
DECLARE
    v_uid      UUID := auth.uid();
    v_can_see  BOOLEAN;
    v_is_agent BOOLEAN := portix.is_customs_agent();
    rec        portix.documents%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN
        RETURN;
    END IF;

    -- Gate mirrors container SELECT visibility: importer/supplier owner, OR any
    -- customs agent (the "customs agent reads all" container policy). Scoped to
    -- the single requested container, so no cross-container leak beyond what the
    -- caller can already see in the container list.
    SELECT EXISTS (
        SELECT 1
        FROM portix.containers c
        WHERE c.id = p_container_id
          AND (
              c.importer_id = v_uid
           OR c.supplier_id = v_uid
           OR v_is_agent
          )
    ) INTO v_can_see;

    IF NOT v_can_see THEN
        RETURN;
    END IF;

    FOR rec IN
        SELECT *
        FROM portix.documents
        WHERE container_id = p_container_id
        ORDER BY document_type
    LOOP
        -- Only customs agents see internal_note (matches 00302 doc policy).
        IF NOT v_is_agent THEN
            rec.internal_note := NULL;
        END IF;
        RETURN NEXT rec;
    END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION portix.get_container_documents(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION portix.get_container_documents(UUID) IS
    'Returns a container''s documents for any caller who can see the container '
    '(importer / supplier / customs agent). SECURITY DEFINER with a gate that '
    'mirrors container SELECT visibility. internal_note nulled for non-agents.';

NOTIFY pgrst, 'reload schema';
