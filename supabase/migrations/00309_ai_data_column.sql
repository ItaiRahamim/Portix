-- ─── AI extracted data column on portix.documents ────────────────────────────
-- Stores the raw JSON object returned by Make.com's document classification
-- for each identified document. Used for audit, re-processing, and display.

ALTER TABLE portix.documents
  ADD COLUMN IF NOT EXISTS ai_data JSONB;

COMMENT ON COLUMN portix.documents.ai_data IS
  'Raw extracted data from AI document classification (Make.com classify_documents action)';
