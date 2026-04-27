-- Migration: 00319_add_container_id_to_transactions.sql
-- Adds a container_id FK to account_transactions so the ledger can display
-- the container number and link to the container detail page.

ALTER TABLE portix.account_transactions
  ADD COLUMN IF NOT EXISTS container_id UUID
    REFERENCES portix.containers(id) ON DELETE SET NULL;

-- Index for join performance
CREATE INDEX IF NOT EXISTS account_transactions_container_id_idx
  ON portix.account_transactions(container_id);
