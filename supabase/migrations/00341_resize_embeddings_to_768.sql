-- Migration: 00341_resize_embeddings_to_768
--
-- Resize portix.document_chunks.embedding from vector(1536) → vector(768)
-- to match Gemini's text-embedding-004 model (768 dims).
--
-- Decision: switching off OpenAI text-embedding-3-small (1536d) onto Gemini
-- text-embedding-004 (768d). Same vendor as the rest of the AI stack
-- (Gemini 2.5 Flash classification, claim summaries, audit), so we only
-- need one API key + one rate-limit budget.
--
-- Table is empty in practice (RAG ingestion not yet wired up) so we
-- TRUNCATE and re-create the column. Safer than ALTER COLUMN TYPE which
-- has no implicit cast between vector dimensions.

-- 1. Drop dependents (index + RPC bound to old signature)
DROP INDEX  IF EXISTS portix.idx_document_chunks_embedding_hnsw;
DROP FUNCTION IF EXISTS portix.match_document_chunks(
    public.vector(1536), FLOAT, INT, UUID
);

-- 2. Wipe + resize the column
TRUNCATE portix.document_chunks;
ALTER TABLE portix.document_chunks DROP COLUMN embedding;
ALTER TABLE portix.document_chunks
    ADD COLUMN embedding public.vector(768) NOT NULL;

-- 3. Recreate HNSW cosine index for the new dimensionality
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding_hnsw
    ON portix.document_chunks
    USING hnsw (embedding public.vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- 4. Recreate match_document_chunks with vector(768) signature
CREATE OR REPLACE FUNCTION portix.match_document_chunks(
    query_embedding     public.vector(768),
    match_threshold     FLOAT,
    match_count         INT,
    filter_container_id UUID
)
RETURNS TABLE (
    id          UUID,
    document_id UUID,
    content     TEXT,
    similarity  FLOAT,
    chunk_index INT,
    metadata    JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = portix, public
AS $$
BEGIN
    -- Caller must own the container (service_role bypasses since auth.uid() is null)
    IF auth.uid() IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1
            FROM portix.containers c
            WHERE c.id = filter_container_id
              AND (
                  c.importer_id = auth.uid()
                  OR c.supplier_id = auth.uid()
                  OR (
                      portix.get_user_role() = 'customs_agent'
                      AND c.status IN ('waiting_customs_review', 'in_clearance')
                  )
              )
        ) THEN
            RAISE EXCEPTION 'access denied: container not visible to caller';
        END IF;
    END IF;

    RETURN QUERY
    SELECT
        dc.id,
        dc.document_id,
        dc.content,
        (1 - (dc.embedding <=> query_embedding))::FLOAT AS similarity,
        dc.chunk_index,
        dc.metadata
    FROM portix.document_chunks dc
    WHERE dc.container_id = filter_container_id
      AND (1 - (dc.embedding <=> query_embedding)) >= match_threshold
    ORDER BY dc.embedding <=> query_embedding ASC
    LIMIT match_count;
END;
$$;

GRANT EXECUTE ON FUNCTION portix.match_document_chunks(
    public.vector(768), FLOAT, INT, UUID
) TO authenticated, service_role;

COMMENT ON FUNCTION portix.match_document_chunks IS
    'Cosine similarity search over portix.document_chunks (Gemini 768d embeddings). '
    'Returns top match_count chunks above match_threshold for the given container.';
