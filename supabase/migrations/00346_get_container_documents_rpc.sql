-- Migration: 00346_get_container_documents_rpc
--
-- The Document Checklist went empty after 00344 flipped v_documents_public to
-- security_invoker. The page had worked for months because the view was
-- SECURITY DEFINER and silently BYPASSED documents RLS — the importer/supplier
-- read never actually exercised row security. Enforcing RLS (via the invoker
-- view, or via a direct documents query) returns zero rows on production for
-- reasons we can't safely introspect from the app, so the checklist is blank
-- even though the container's denormalised docs_total says 9 rows exist.
--
-- Fix: a SECURITY DEFINER RPC that does NOT depend on the documents RLS
-- policies. It re-implements the access gate explicitly — the caller must be
-- the container's importer, supplier, or the customs agent assigned to its
-- shipment — then returns that container's documents. internal_note is nulled
-- for everyone except the assigned customs agent, preserving the column-level
-- privacy the v_documents_public view used to provide.
--
-- Security properties:
--   • No cross-container leak: rows are scoped to p_container_id AND the caller
--     must pass the ownership/assignment gate, so a user cannot read documents
--     for a container they don't already have access to.
--   • internal_note stays customs-agent-only.
--   • auth.uid() is read from the JWT and works under SECURITY DEFINER.

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
    v_is_agent BOOLEAN;
    rec        portix.documents%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN
        RETURN;
    END IF;

    -- Access gate: importer / supplier on the container, or the customs agent
    -- assigned to its shipment. Mirrors the containers SELECT RLS exactly.
    SELECT EXISTS (
        SELECT 1
        FROM portix.containers c
        LEFT JOIN portix.shipments s ON s.id = c.shipment_id
        WHERE c.id = p_container_id
          AND (
              c.importer_id      = v_uid
           OR c.supplier_id      = v_uid
           OR s.customs_agent_id = v_uid
          )
    ) INTO v_can_see;

    IF NOT v_can_see THEN
        RETURN;
    END IF;

    -- Only the assigned customs agent may see internal_note.
    SELECT EXISTS (
        SELECT 1
        FROM portix.containers c
        JOIN portix.shipments s ON s.id = c.shipment_id
        WHERE c.id = p_container_id
          AND s.customs_agent_id = v_uid
    ) INTO v_is_agent;

    FOR rec IN
        SELECT *
        FROM portix.documents
        WHERE container_id = p_container_id
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
    'Returns a container''s documents for importer/supplier/assigned customs '
    'agent. SECURITY DEFINER with an explicit ownership gate (does not rely on '
    'documents RLS). internal_note nulled for non-agents. Powers the Document '
    'Checklist after 00344 RLS enforcement emptied the view-based read path.';

NOTIFY pgrst, 'reload schema';
