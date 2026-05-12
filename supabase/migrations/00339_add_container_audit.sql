-- Migration: 00339_add_container_audit
--
-- Adds ai_audit_results JSONB to portix.containers.
-- Populated by the audit-documents Edge Function when an importer/supplier
-- triggers "Run Document Audit". Null = audit not yet run.
--
-- Schema:
--   ai_audit_results: AuditDiscrepancy[] | null
--
-- Where AuditDiscrepancy =
--   { field: string, doc1: string, doc2: string,
--     severity: 'high' | 'medium' | 'low', description: string }

ALTER TABLE portix.containers
    ADD COLUMN IF NOT EXISTS ai_audit_results JSONB NULL;

COMMENT ON COLUMN portix.containers.ai_audit_results IS
    'AI cross-validation results. Array of discrepancy objects or [] when clean. '
    'Null means audit has not been run yet. Set by audit-documents Edge Function.';
