-- Migration: 00343_global_rag_search
--
-- Adds portix.match_user_document_chunks — a container-agnostic vector
-- search RPC that scopes results to every container the calling user
-- can see (importer / supplier / customs agent in queue).
--
-- Powers the "Porty" global copilot: when the user asks a question,
-- the edge function embeds the query, calls this RPC, and feeds the
-- top chunks into the LLM prompt as RAG context.
--
-- Differs from portix.match_document_chunks (00341) in two ways:
--   1. NO filter_container_id argument — search spans every container
--      the user has access to.
--   2. Returns container_id alongside the chunk so the LLM prompt can
--      cite the source container.

CREATE OR REPLACE FUNCTION portix.match_user_document_chunks(
    query_embedding public.vector(768),
    match_threshold FLOAT,
    match_count     INT
)
RETURNS TABLE (
    id           UUID,
    document_id  UUID,
    container_id UUID,
    content      TEXT,
    similarity   FLOAT,
    metadata     JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = portix, public
AS $$
BEGIN
    -- Anonymous callers get nothing — the copilot is gated server-side
    -- but defending in depth here too.
    IF auth.uid() IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        dc.id,
        dc.document_id,
        dc.container_id,
        dc.content,
        (1 - (dc.embedding <=> query_embedding))::FLOAT AS similarity,
        dc.metadata
    FROM portix.document_chunks dc
    WHERE
        dc.container_id IN (
            -- Containers the user owns as importer or supplier
            SELECT c.id
            FROM portix.containers c
            WHERE c.importer_id = auth.uid()
               OR c.supplier_id = auth.uid()
            UNION
            -- Containers a customs agent can currently see in their queue.
            -- Mirrors the same status set the document_chunks RLS uses.
            SELECT c.id
            FROM portix.containers c
            WHERE portix.get_user_role() = 'customs_agent'
              AND c.status IN ('waiting_customs_review', 'in_clearance')
        )
        AND (1 - (dc.embedding <=> query_embedding)) >= match_threshold
    ORDER BY dc.embedding <=> query_embedding ASC
    LIMIT match_count;
END;
$$;

GRANT EXECUTE ON FUNCTION portix.match_user_document_chunks(
    public.vector(768), FLOAT, INT
) TO authenticated, service_role;

COMMENT ON FUNCTION portix.match_user_document_chunks IS
    'User-scoped cosine similarity search across portix.document_chunks. '
    'Returns top match_count chunks above match_threshold from every '
    'container the caller (auth.uid()) can see. Powers the Porty global copilot.';
