-- ============================================================
-- Migration 00315 — Fix claim_messages schema
-- ============================================================
-- What this does:
--   1. Adds sender_role to portix.claim_messages
--      (the chat UI colour-codes bubbles by role — was missing from 00301 schema)
--   2. Adds attachments JSONB column to portix.claim_messages
--      (inline attachment metadata — avoids a join for simple file previews)
--   3. Signals PostgREST to reload its schema cache immediately
--      (avoids the "could not find column" 400 error until next restart)
-- ============================================================

-- ─── 1. sender_role ─────────────────────────────────────────────────────────────
-- Stores the sender's role at message-send time so the UI can colour-code
-- without a JOIN to portix.profiles on every message load.

ALTER TABLE portix.claim_messages
  ADD COLUMN IF NOT EXISTS sender_role TEXT
    CHECK (sender_role IN ('importer', 'supplier', 'customs', 'customs_agent'));

-- ─── 2. attachments JSONB ────────────────────────────────────────────────────────
-- Inline attachment metadata (storage_path, file_name, media_type, file_size_bytes).
-- Stored as a JSONB array directly on the message row for fast retrieval.
-- Separate from portix.claim_attachments which stores relational attachment rows.

ALTER TABLE portix.claim_messages
  ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT NULL;

-- ─── 3. Flush PostgREST schema cache ─────────────────────────────────────────────
-- Without this, Supabase continues returning 400 "could not find column"
-- until the next cold restart of PostgREST (~5 min).

NOTIFY pgrst, 'reload schema';
