-- Migration: 00342_grant_service_role_portix
--
-- Supabase auto-grants the `service_role` Postgres role on the `public`
-- schema only. Custom schemas (like `portix`) need explicit grants or
-- writes from Edge Functions fail with "permission denied for table …",
-- even when supabase-js correctly attaches the service-role bearer.
--
-- This migration backfills the missing grants for everything the
-- backfill-rag + embed-document edge functions touch, plus sets default
-- privileges so future tables / sequences / functions added to the portix
-- schema are automatically writeable by service_role without another
-- migration.

-- 1. Let service_role enter the schema and resolve identifiers in it.
GRANT USAGE ON SCHEMA portix TO service_role;

-- 2. Hand service_role full DML on every existing table + view + sequence.
GRANT ALL ON ALL TABLES    IN SCHEMA portix TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA portix TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA portix TO service_role;

-- 3. Default privileges — anything created in portix from now on
--    inherits these grants without another migration.
ALTER DEFAULT PRIVILEGES IN SCHEMA portix
    GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA portix
    GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA portix
    GRANT ALL ON FUNCTIONS TO service_role;

-- 4. Also grant on the RAG table specifically, in case the above missed
--    something due to migration ordering (belt-and-suspenders).
GRANT USAGE ON SCHEMA portix TO service_role;
GRANT ALL ON TABLE portix.document_chunks TO service_role;
