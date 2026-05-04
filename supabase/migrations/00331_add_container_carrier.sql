-- Migration: 00331_add_container_carrier
--
-- Adds canonical normalized carrier key column to portix.containers.
-- Populated by parse-shipment + classify-documents edge functions when a Bill
-- of Lading (or B/L Draft) is processed. Drives the dashboard's clickable
-- container-number → carrier tracking-page links.
--
-- Allowed values are not enforced as an enum (carriers can be added freely);
-- code-side helper normalizeCarrier() canonicalises the value before write.

ALTER TABLE portix.containers
    ADD COLUMN carrier TEXT NULL;

COMMENT ON COLUMN portix.containers.carrier IS
    'Normalized shipping line key (e.g. msc, maersk, zim, hapag-lloyd, cma-cgm, evergreen, cosco, one). Null when unknown. Populated by AI from Bill of Lading.';

-- Partial index — only rows that actually have a carrier are indexed.
CREATE INDEX IF NOT EXISTS idx_containers_carrier
    ON portix.containers (carrier)
    WHERE carrier IS NOT NULL;

-- v_containers view inherits the new column automatically via SELECT c.*
-- (verified in 00327_add_bl_number_to_v_containers.sql). No view rebuild needed.
