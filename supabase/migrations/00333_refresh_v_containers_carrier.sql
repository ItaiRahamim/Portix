-- Migration: 00333_refresh_v_containers_carrier
--
-- IMPORTANT: In PostgreSQL, adding a column to a base table does NOT
-- automatically update views that use `SELECT c.*`. The view's column list
-- is frozen at creation time, so v_containers was silently missing the new
-- `carrier` column added in migration 00331.
--
-- Fix: recreate the view so Postgres resolves `c.*` against the current
-- table definition and the `carrier` column is visible to the frontend.
--
-- This is a verbatim re-declaration of 00327_add_bl_number_to_v_containers.sql —
-- no logic changes, only a forced refresh.

DROP VIEW IF EXISTS portix.v_containers;

CREATE OR REPLACE VIEW portix.v_containers AS
SELECT
    c.*,
    -- Shipment details
    s.shipment_number,
    s.vessel_name,
    s.origin_country,
    s.customs_agent_id,
    -- Party names (denormalized for display)
    p_imp.company_name               AS importer_company,
    p_sup.company_name               AS supplier_company,
    -- B/L number from documents table — null until supplier uploads the bill of lading
    d_bl.document_number             AS bill_of_lading_number
FROM portix.containers c
JOIN  portix.shipments  s     ON s.id     = c.shipment_id
JOIN  portix.profiles   p_imp ON p_imp.id = c.importer_id
JOIN  portix.profiles   p_sup ON p_sup.id = c.supplier_id
LEFT JOIN portix.documents d_bl
       ON d_bl.container_id   = c.id
      AND d_bl.document_type  = 'bill_of_lading';

COMMENT ON VIEW portix.v_containers IS
    'Enriched container view with shipment, party names, B/L number, and carrier pre-joined. Use for all dashboard queries.';
