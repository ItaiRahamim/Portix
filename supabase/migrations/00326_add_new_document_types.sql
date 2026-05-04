-- Migration: 00326_add_new_document_types
-- Adds eur_1, proforma_invoice, bl_draft to portix.document_type enum.
-- These are pre-shipment / supplementary document types.
-- IMPORTANT: PostgreSQL requires a separate ALTER for each new enum value.

ALTER TYPE portix.document_type ADD VALUE IF NOT EXISTS 'eur_1';
ALTER TYPE portix.document_type ADD VALUE IF NOT EXISTS 'proforma_invoice';
ALTER TYPE portix.document_type ADD VALUE IF NOT EXISTS 'bl_draft';
