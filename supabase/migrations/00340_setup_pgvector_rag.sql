-- Migration: 00340_setup_pgvector_rag
--
-- RAG (Retrieval-Augmented Generation) infrastructure for the
-- "Chat with Container Documents" feature.
--
-- Adds:
--   1. pgvector extension (public schema, per Supabase convention)
--   2. portix.document_chunks       — text chunks + 1536-dim embeddings
--                                     (OpenAI text-embedding-3-small)
--   3. HNSW index on embedding      — fast approximate cosine search
--   4. portix.match_document_chunks — similarity RPC, container-scoped
--   5. RLS policies                 — importer/supplier/customs_agent can
--                                     read chunks for containers they own
--
-- Embedding population happens out-of-band via an Edge Function that
-- extracts text from documents and writes rows here. This migration only
-- prepares the schema.

-- ─── 1. Vector extension ──────────────────────────────────────────────────────
-- Must live in `public` so the vector type is resolvable everywhere.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

-- ─── 2. document_chunks table ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS portix.document_chunks (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    container_id  UUID NOT NULL
                  REFERENCES portix.containers(id) ON DELETE CASCADE,
    -- Optional doc reference: null when chunk came from a synthesized source
    -- (e.g. concatenated container metadata). Cascade so doc deletion clears
    -- its chunks automatically.
    document_id   UUID NULL
                  REFERENCES portix.documents(id)  ON DELETE CASCADE,
    content       TEXT NOT NULL,
    embedding     public.vector(1536) NOT NULL,
    -- Token / char counts for retrieval debugging
    token_count   INT NULL,
    chunk_index   INT NOT NULL DEFAULT 0,    -- order within the source document
    metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE portix.document_chunks IS
    'Text chunks + vector embeddings for the per-container RAG chatbot. '
    'Populated by the embed-documents Edge Function after document upload.';

-- Lookups on container_id are the hot path (the RPC filters by it)
CREATE INDEX IF NOT EXISTS idx_document_chunks_container
    ON portix.document_chunks (container_id);

CREATE INDEX IF NOT EXISTS idx_document_chunks_document
    ON portix.document_chunks (document_id)
    WHERE document_id IS NOT NULL;

-- ─── 3. HNSW vector index ─────────────────────────────────────────────────────
-- HNSW > IVFFlat for our scale: better recall and no need to retrain after
-- inserts. Cosine ops chosen because OpenAI embeddings are L2-normalized,
-- so cosine and dot-product rankings are equivalent but cosine is the
-- de-facto standard.
-- m / ef_construction tuned for ~10k–100k rows; raise both for higher recall.
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding_hnsw
    ON portix.document_chunks
    USING hnsw (embedding public.vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- ─── 4. Row Level Security ────────────────────────────────────────────────────

ALTER TABLE portix.document_chunks ENABLE ROW LEVEL SECURITY;

-- Read: anyone who can see the parent container can see its chunks
CREATE POLICY "document_chunks: read by container access"
    ON portix.document_chunks
    FOR SELECT
    TO authenticated
    USING (
        container_id IN (
            SELECT id FROM portix.containers
            WHERE importer_id = auth.uid()
               OR supplier_id = auth.uid()
        )
        OR
        -- Customs agents can read chunks for containers in their review queue
        (
            portix.get_user_role() = 'customs_agent'
            AND container_id IN (
                SELECT id FROM portix.containers
                WHERE status IN ('waiting_customs_review', 'in_clearance')
            )
        )
    );

-- Insert/update/delete: only service role (via Edge Function) — no policies
-- means no access for the `authenticated` role. The Edge Function uses the
-- service_role key which bypasses RLS.

-- ─── 5. match_document_chunks RPC ─────────────────────────────────────────────
-- Cosine similarity search, container-scoped. Returns top N chunks whose
-- similarity exceeds match_threshold (0..1, higher = more similar).
--
-- Usage from the client / Edge Function:
--   select * from portix.match_document_chunks(
--     query_embedding   => $1::vector(1536),
--     match_threshold   => 0.7,
--     match_count       => 8,
--     filter_container_id => $2::uuid
--   );
--
-- SECURITY DEFINER so RLS on document_chunks doesn't block legitimate
-- access from authenticated clients — the function enforces its own
-- container-ownership check below.

CREATE OR REPLACE FUNCTION portix.match_document_chunks(
    query_embedding     public.vector(1536),
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
    -- Ownership check: caller must have access to this container.
    -- Service role bypasses (auth.uid() is null) and proceeds.
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
        -- pgvector cosine distance is in [0, 2]; convert to similarity [-1, 1].
        -- For L2-normalized OpenAI embeddings the range is effectively [0, 1].
        (1 - (dc.embedding <=> query_embedding))::FLOAT AS similarity,
        dc.chunk_index,
        dc.metadata
    FROM portix.document_chunks dc
    WHERE dc.container_id = filter_container_id
      AND (1 - (dc.embedding <=> query_embedding)) >= match_threshold
    ORDER BY dc.embedding <=> query_embedding ASC  -- ascending distance = descending similarity
    LIMIT match_count;
END;
$$;

GRANT EXECUTE ON FUNCTION portix.match_document_chunks(
    public.vector(1536), FLOAT, INT, UUID
) TO authenticated, service_role;

COMMENT ON FUNCTION portix.match_document_chunks IS
    'Cosine similarity search over portix.document_chunks. '
    'Returns top match_count chunks above match_threshold for the given container. '
    'Enforces container ownership for authenticated callers; service_role bypasses.';
