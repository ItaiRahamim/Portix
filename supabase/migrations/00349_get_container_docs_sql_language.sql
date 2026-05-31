-- Migration: 00349_get_container_docs_sql_language
--
-- Multiple plpgsql rewrites of get_container_documents returned [].
-- The 9 documents exist (confirmed via service role). The failure is inside
-- the plpgsql body — most likely the DECLARE + SELECT INTO pattern silently
-- leaves v_importer_id / v_uid NULL in Supabase's SECURITY DEFINER context
-- (a known interaction between plpgsql variable assignment and PostgREST's
-- SET LOCAL request.jwt.claims when the function owner role-switches).
--
-- Fix: rewrite in pure LANGUAGE sql (no plpgsql, no DECLARE block, no
-- variable assignment). In SQL functions, auth.uid() and the subqueries are
-- evaluated inline at query time rather than via variable binding.
-- Eliminating the plpgsql layer removes every known failure point at once.
--
-- Gate: caller must be importer, supplier, or assigned customs-agent FK, OR
-- have is_customs_agent() = true (matches "containers: customs agent reads all"
-- policy). internal_note is nulled for non-agents via a CASE expression.
--
-- Because SETOF portix.documents doesn't allow overriding individual columns,
-- we RETURN TABLE with explicit columns and null-out internal_note for
-- non-agents inline.

-- Drop existing function so we can change the return type from
-- SETOF portix.documents → RETURNS TABLE(...). CASCADE handles the GRANT.
DROP FUNCTION IF EXISTS portix.get_container_documents(UUID);

CREATE FUNCTION portix.get_container_documents(p_container_id UUID)
RETURNS TABLE (
    id                  UUID,
    container_id        UUID,
    document_type       portix.document_type,
    status              portix.document_status,
    storage_path        TEXT,
    file_name           TEXT,
    file_size_bytes     BIGINT,
    mime_type           TEXT,
    uploaded_by         UUID,
    reviewed_by         UUID,
    rejection_reason    TEXT,
    internal_note       TEXT,   -- nulled for non-agents below
    document_number     TEXT,
    issue_date          DATE,
    notes               TEXT,
    uploaded_at         TIMESTAMPTZ,
    reviewed_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ,
    importer_approved_at TIMESTAMPTZ,
    agent_approved_at   TIMESTAMPTZ,
    ai_data             JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = portix, public
AS $$
  SELECT
      d.id,
      d.container_id,
      d.document_type,
      d.status,
      d.storage_path,
      d.file_name,
      d.file_size_bytes,
      d.mime_type,
      d.uploaded_by,
      d.reviewed_by,
      d.rejection_reason,
      -- Only return internal_note for the assigned customs agent or any customs agent
      CASE
          WHEN auth.uid() = (
              SELECT s.customs_agent_id
              FROM   portix.shipments s
              JOIN   portix.containers c2 ON c2.shipment_id = s.id
              WHERE  c2.id = p_container_id
              LIMIT  1
          ) OR portix.is_customs_agent()
          THEN d.internal_note
          ELSE NULL
      END  AS internal_note,
      d.document_number,
      d.issue_date,
      d.notes,
      d.uploaded_at,
      d.reviewed_at,
      d.created_at,
      d.updated_at,
      d.importer_approved_at,
      d.agent_approved_at,
      d.ai_data
  FROM portix.documents d
  WHERE d.container_id = p_container_id
    AND auth.uid() IS NOT NULL
    AND (
        -- Importer or supplier owns this container
        auth.uid() IN (
            SELECT c.importer_id FROM portix.containers c WHERE c.id = p_container_id
            UNION ALL
            SELECT c.supplier_id FROM portix.containers c WHERE c.id = p_container_id
        )
        OR
        -- Customs agent: either assigned to the shipment or has the agent role
        auth.uid() = (
            SELECT s.customs_agent_id
            FROM   portix.shipments s
            JOIN   portix.containers c ON c.shipment_id = s.id
            WHERE  c.id = p_container_id
            LIMIT  1
        )
        OR portix.is_customs_agent()
    )
  ORDER BY d.document_type;
$$;

GRANT EXECUTE ON FUNCTION portix.get_container_documents(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION portix.get_container_documents(UUID) IS
    'Returns container documents for importer / supplier / customs-agent. '
    'LANGUAGE sql (no plpgsql variable binding) + SECURITY DEFINER. '
    'internal_note nulled for non-agents. 00349 supersedes 00346/00347/00348.';

NOTIFY pgrst, 'reload schema';
