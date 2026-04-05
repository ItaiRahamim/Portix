-- ═══════════════════════════════════════════════════════════════
-- PORTIX — Product Catalog & Purchase Order Schema
-- PostgreSQL 15+
--
-- Extends the existing Portix schema (User, Shipment, Container,
-- Document, Invoice, Claim, ImportLicense) with:
--   • Supplier organization & contacts
--   • Normalized product catalog (Product → Variety → Size → Package)
--   • Purchase Orders & line items
--   • Link tables for catalog ↔ operational entities
-- ═══════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────
-- 1. SUPPLIER ORGANIZATION & CONTACTS
-- ─────────────────────────────────────────────

-- Replaces the flat "User with role=SUPPLIER" model.
-- A supplier is a COMPANY; contacts are people inside it.

CREATE TABLE portix.suppliers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name    TEXT        NOT NULL,               -- e.g. "Celeste"
    country         TEXT        NOT NULL,               -- e.g. "Greece"
    address         TEXT,
    phone           TEXT,
    email           TEXT,
    tax_id          TEXT,                                -- VAT / company reg number
    currency        CHAR(3)     NOT NULL DEFAULT 'USD', -- preferred trading currency
    payment_terms   TEXT,                                -- e.g. "Net 30", "CAD"
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE portix.supplier_contacts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id     UUID        NOT NULL REFERENCES portix.suppliers(id) ON DELETE CASCADE,
    full_name       TEXT        NOT NULL,               -- e.g. "Edward Koemans"
    role            TEXT,                                -- e.g. "CEO", "Documents Department"
    email           TEXT,
    phone           TEXT,
    is_primary      BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_supplier_contacts_supplier ON portix.supplier_contacts(supplier_id);


-- ─────────────────────────────────────────────
-- 2. PRODUCT CATALOG (normalized)
-- ─────────────────────────────────────────────

-- Level 1: Product (e.g. "Kiwi", "Tomatoes", "Red Onion")
CREATE TABLE portix.products (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT        NOT NULL,               -- e.g. "Kiwi"
    hs_code         TEXT,                                -- Harmonized System code (6-10 digits)
    category        TEXT,                                -- optional grouping: "Fruit", "Vegetable"
    requires_phyto  BOOLEAN     NOT NULL DEFAULT TRUE,  -- needs phytosanitary cert?
    requires_cooling BOOLEAN    NOT NULL DEFAULT FALSE,  -- needs cooling report?
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_product_name UNIQUE (name)
);

-- Level 2: Variety (e.g. "Hayward", "Tsehelides", "Round")
-- NULL variety = the product has no sub-varieties (like Red Onion)
CREATE TABLE portix.product_varieties (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      UUID        NOT NULL REFERENCES portix.products(id) ON DELETE CASCADE,
    name            TEXT        NOT NULL,               -- e.g. "Hayward", "Round"
    description     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_variety_per_product UNIQUE (product_id, name)
);

CREATE INDEX idx_varieties_product ON portix.product_varieties(product_id);

-- Level 3: Sizes (e.g. "50-70", "18", "60")
-- Sizes are per-product (shared across varieties of that product)
CREATE TABLE portix.product_sizes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      UUID        NOT NULL REFERENCES portix.products(id) ON DELETE CASCADE,
    label           TEXT        NOT NULL,               -- display label: "50-70", "18", "60"
    min_mm          NUMERIC(8,2),                       -- optional: numeric min for sorting/filtering
    max_mm          NUMERIC(8,2),                       -- optional: numeric max
    sort_order      INT         NOT NULL DEFAULT 0,     -- for UI display ordering
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_size_per_product UNIQUE (product_id, label)
);

CREATE INDEX idx_sizes_product ON portix.product_sizes(product_id);

-- Level 4: Packaging options (e.g. "10kg net", "3kg trypack")
-- Packaging is per-product (shared across varieties/sizes)
CREATE TABLE portix.product_packages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      UUID        NOT NULL REFERENCES portix.products(id) ON DELETE CASCADE,
    label           TEXT        NOT NULL,               -- e.g. "10kg net", "3kg trypack"
    weight_kg       NUMERIC(8,2),                       -- net weight per package
    package_type    TEXT,                                -- "net", "loose", "trypack", "carton"
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_package_per_product UNIQUE (product_id, label)
);

CREATE INDEX idx_packages_product ON portix.product_packages(product_id);


-- ─────────────────────────────────────────────
-- 3. SUPPLIER ↔ CATALOG LINK (what each supplier offers)
-- ─────────────────────────────────────────────

-- Each row = "Supplier X offers Product+Variety+Size+Package at Price Y"
-- This is the JOIN table that connects the supplier to every
-- sellable SKU combination they offer.

CREATE TABLE portix.supplier_catalog_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id     UUID        NOT NULL REFERENCES portix.suppliers(id) ON DELETE CASCADE,
    product_id      UUID        NOT NULL REFERENCES portix.products(id) ON DELETE CASCADE,
    variety_id      UUID                 REFERENCES portix.product_varieties(id) ON DELETE SET NULL,
    size_id         UUID                 REFERENCES portix.product_sizes(id) ON DELETE SET NULL,
    package_id      UUID                 REFERENCES portix.product_packages(id) ON DELETE SET NULL,

    -- Pricing
    unit_price      NUMERIC(12,4),                      -- price per package/unit
    currency        CHAR(3)     NOT NULL DEFAULT 'USD',
    price_term      TEXT        NOT NULL DEFAULT 'FOB', -- FOB, CIF, EXW, etc.

    -- Availability
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    season_start    INT,                                -- month 1-12 (nullable = year-round)
    season_end      INT,                                -- month 1-12

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_supplier_catalog_item UNIQUE (supplier_id, product_id, variety_id, size_id, package_id)
);

CREATE INDEX idx_catalog_supplier ON portix.supplier_catalog_items(supplier_id);
CREATE INDEX idx_catalog_product  ON portix.supplier_catalog_items(product_id);


-- ─────────────────────────────────────────────
-- 4. PURCHASE ORDERS
-- ─────────────────────────────────────────────

CREATE TYPE portix.po_status AS ENUM (
    'DRAFT',
    'SENT',
    'CONFIRMED',
    'PARTIALLY_SHIPPED',
    'SHIPPED',
    'COMPLETED',
    'CANCELLED'
);

CREATE TABLE portix.purchase_orders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_number       TEXT        NOT NULL UNIQUE,        -- e.g. "PO-2026-001"
    importer_id     UUID        NOT NULL,               -- FK → existing User table
    supplier_id     UUID        NOT NULL REFERENCES portix.suppliers(id),
    status          portix.po_status NOT NULL DEFAULT 'DRAFT',

    -- Dates
    order_date      DATE        NOT NULL DEFAULT CURRENT_DATE,
    requested_ship_date DATE,
    confirmed_ship_date DATE,

    -- Terms
    currency        CHAR(3)     NOT NULL DEFAULT 'USD',
    price_term      TEXT        NOT NULL DEFAULT 'FOB', -- FOB, CIF, etc.
    payment_terms   TEXT,                                -- "Net 30", "L/C", "CAD"

    -- Totals (denormalized for quick access, recomputed from line items)
    total_units     INT         NOT NULL DEFAULT 0,
    total_amount    NUMERIC(14,2) NOT NULL DEFAULT 0,

    -- Logistics link (assigned after booking)
    shipment_id     TEXT,                                -- FK → existing Shipment table

    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_po_supplier   ON portix.purchase_orders(supplier_id);
CREATE INDEX idx_po_status     ON portix.purchase_orders(status);

-- Each line = one product/variety/size/package combination + quantity
CREATE TABLE portix.purchase_order_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_id           UUID        NOT NULL REFERENCES portix.purchase_orders(id) ON DELETE CASCADE,
    catalog_item_id UUID                 REFERENCES portix.supplier_catalog_items(id), -- optional link

    -- Denormalized product info (so PO is readable even if catalog changes)
    product_name    TEXT        NOT NULL,
    variety_name    TEXT,
    size_label      TEXT,
    package_label   TEXT,
    hs_code         TEXT,

    -- Quantities & pricing
    quantity        INT         NOT NULL,               -- number of units/packages
    unit_price      NUMERIC(12,4) NOT NULL,
    currency        CHAR(3)     NOT NULL DEFAULT 'USD',
    line_total      NUMERIC(14,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,

    -- Container assignment (which container carries these items)
    container_id    TEXT,                                -- FK → existing Container table

    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_po_items_po        ON portix.purchase_order_items(po_id);
CREATE INDEX idx_po_items_container ON portix.purchase_order_items(container_id);


-- ═══════════════════════════════════════════════════════════════
-- 5. SEED DATA — Celeste Pilot
-- ═══════════════════════════════════════════════════════════════

-- Supplier
INSERT INTO portix.suppliers (id, company_name, country, currency)
VALUES ('a1b2c3d4-0001-4000-8000-000000000001', 'Celeste', 'Greece', 'EUR');

-- Contacts
INSERT INTO portix.supplier_contacts (supplier_id, full_name, role, is_primary) VALUES
('a1b2c3d4-0001-4000-8000-000000000001', 'Edward Koemans', 'CEO', TRUE),
('a1b2c3d4-0001-4000-8000-000000000001', 'Deby Ganga', 'Documents Department', FALSE);

-- Products
INSERT INTO portix.products (id, name, category) VALUES
('b1000000-0000-4000-8000-000000000001', 'Red Onion',    'Vegetable'),
('b1000000-0000-4000-8000-000000000002', 'Yellow Onion', 'Vegetable'),
('b1000000-0000-4000-8000-000000000003', 'Kiwi',        'Fruit'),
('b1000000-0000-4000-8000-000000000004', 'Tomatoes',    'Vegetable');

-- Varieties (only for products that have them)
INSERT INTO portix.product_varieties (id, product_id, name) VALUES
('c1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000003', 'Hayward'),
('c1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000003', 'Tsehelides'),
('c1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000004', 'Round');

-- Sizes
INSERT INTO portix.product_sizes (id, product_id, label, sort_order) VALUES
-- Onion sizes (shared by Red + Yellow)
('d1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', '50-70',  1),
('d1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001', '60-80',  2),
('d1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000001', '90-110', 3),
('d1000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-000000000002', '50-70',  1),
('d1000000-0000-4000-8000-000000000005', 'b1000000-0000-4000-8000-000000000002', '60-80',  2),
('d1000000-0000-4000-8000-000000000006', 'b1000000-0000-4000-8000-000000000002', '90-110', 3),
-- Kiwi sizes
('d1000000-0000-4000-8000-000000000007', 'b1000000-0000-4000-8000-000000000003', '18', 1),
('d1000000-0000-4000-8000-000000000008', 'b1000000-0000-4000-8000-000000000003', '20', 2),
('d1000000-0000-4000-8000-000000000009', 'b1000000-0000-4000-8000-000000000003', '23', 3),
('d1000000-0000-4000-8000-000000000010', 'b1000000-0000-4000-8000-000000000003', '25', 4),
('d1000000-0000-4000-8000-000000000011', 'b1000000-0000-4000-8000-000000000003', '27', 5),
-- Tomato sizes
('d1000000-0000-4000-8000-000000000012', 'b1000000-0000-4000-8000-000000000004', '60', 1),
('d1000000-0000-4000-8000-000000000013', 'b1000000-0000-4000-8000-000000000004', '70', 2),
('d1000000-0000-4000-8000-000000000014', 'b1000000-0000-4000-8000-000000000004', '80', 3);

-- Packages
INSERT INTO portix.product_packages (id, product_id, label, weight_kg, package_type) VALUES
-- Onion packages
('e1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', '10kg net',    10, 'net'),
('e1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001', '5kg net',      5, 'net'),
('e1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000002', '10kg net',    10, 'net'),
('e1000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-000000000002', '5kg net',      5, 'net'),
-- Kiwi packages
('e1000000-0000-4000-8000-000000000005', 'b1000000-0000-4000-8000-000000000003', '10kg loose',  10, 'loose'),
('e1000000-0000-4000-8000-000000000006', 'b1000000-0000-4000-8000-000000000003', '3kg trypack',  3, 'trypack'),
-- Tomato packages
('e1000000-0000-4000-8000-000000000007', 'b1000000-0000-4000-8000-000000000004', '6kg loose',    6, 'loose'),
('e1000000-0000-4000-8000-000000000008', 'b1000000-0000-4000-8000-000000000004', '3kg trypack',  3, 'trypack');


-- ═══════════════════════════════════════════════════════════════
-- 6. SAMPLE QUERY — Full catalog for "Celeste"
-- ═══════════════════════════════════════════════════════════════

/*
  Fetches every possible Product + Variety + Size + Package combination
  for a given supplier, including pricing if available in the catalog.
*/

SELECT
    s.company_name                          AS supplier,
    p.name                                  AS product,
    p.hs_code,
    COALESCE(v.name, '—')                   AS variety,
    sz.label                                AS size,
    pk.label                                AS package,
    pk.weight_kg,
    sci.unit_price,
    sci.currency,
    sci.price_term
FROM portix.suppliers s
-- All products that this supplier carries (via catalog items)
-- Using CROSS JOIN on product dimensions so we see the FULL matrix
-- even for combos not yet priced in supplier_catalog_items
CROSS JOIN portix.products p
LEFT  JOIN portix.product_varieties v   ON v.product_id  = p.id
INNER JOIN portix.product_sizes     sz  ON sz.product_id = p.id
INNER JOIN portix.product_packages  pk  ON pk.product_id = p.id
LEFT  JOIN portix.supplier_catalog_items sci
        ON sci.supplier_id = s.id
       AND sci.product_id  = p.id
       AND (sci.variety_id = v.id OR (sci.variety_id IS NULL AND v.id IS NULL))
       AND sci.size_id     = sz.id
       AND sci.package_id  = pk.id
WHERE s.company_name ILIKE 'celeste'
ORDER BY p.name, v.name NULLS FIRST, sz.sort_order, pk.label;
