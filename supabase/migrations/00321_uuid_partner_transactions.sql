-- Migration: 00321_uuid_partner_transactions.sql
-- Adds target_profile_id UUID to account_transactions so ledger queries
-- work by profile ID rather than company name strings.
-- This prevents balance data loss when a company renames itself.

ALTER TABLE portix.account_transactions
  ADD COLUMN IF NOT EXISTS target_profile_id UUID
    REFERENCES portix.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS account_transactions_target_profile_id_idx
  ON portix.account_transactions(target_profile_id);
