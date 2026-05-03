# PRD_V2_Draft

> Draft re-validated against the current codebase on 2026-04-29.  
> Note: there is no top-level `PRD.md` in the current repository. This draft uses `README.md`, `AGENTS.md`, `CLAUDE.md`, `knowledge/DEPLOYMENT_STATUS.md`, the Next.js app, Supabase migrations, and Edge Functions as the source of truth.

## Vision

**Portix eliminates manual work across the entire import/export lifecycle — from supplier document upload to customs clearance — using multimodal AI, real-time collaboration, and enterprise-grade security.**

*Built for the teams moving the world's produce, one container at a time.*

Portix is built around **the container as the unit of work**. Every document, every status, every transaction, every dispute lives on the container — not in a disconnected ERP or email thread.

## Problem

Every shipment of fresh produce, electronics, or industrial goods crosses borders through a gauntlet of paperwork, manual coordination, and fragmented communication. A single 40ft reefer container generates **7 mandatory customs documents**, requires coordination between **3 to 5 parties**, and can be delayed by weeks if even one document is rejected.

The industry still runs on WhatsApp threads, emailed PDFs, and spreadsheets. Customs clearance delays cost the average importer **$300–$800 per day** in storage fees alone.

**Portix closes that gap.** It's the operating system for cross-border trade — connecting importers, suppliers, and customs agents in a single workspace where AI handles the paperwork and humans handle the decisions.

## User Personas

| Role | Responsibility | Schema Table |
|---|---|---|
| `importer` | Monitors containers, manages accounts, claims, licenses. Can create shipments. | `portix.profiles` with `role = 'importer'` |
| `supplier` | Creates shipments, uploads documents, manages cargo photos, replaces rejected docs. | `portix.profiles` with `role = 'supplier'` |
| `customs_agent` | Reviews/approves/rejects documents, manages clearance readiness. | `portix.profiles` with `role = 'customs_agent'` |

## Current Status

### Overall

The application is no longer a mock prototype. The current repo is a live Next.js 15 + Supabase implementation with:

- Supabase Auth login flow and role-based routing
- Role-specific dashboards for importer, supplier, and customs agent
- Container-centric document workflow backed by Supabase tables, storage, and RLS
- Shared container detail experience with customs assignment, document review, cargo media, and logistics timeline
- Separate claims workspace with AI summaries, structured damage report, chat, and realtime message delivery
- Accounts/ledger pages and importer license management
- Multiple Supabase Edge Functions for AI parsing, document classification, claim summaries, license extraction, and carrier tracking experiments

### What Is Verified As Working In Code

#### 1. Authentication and role-aware routing

- `/login` signs users in with Supabase email/password.
- `/` resolves the authenticated user from `profiles.role` and redirects to `/importer`, `/supplier`, or `/customs-agent`.
- Shared `DashboardLayout` renders role-specific navigation and logout.

#### 2. Container dashboards

- Importer dashboard shows container KPIs, filters, table view, and `New Shipment`.
- Supplier dashboard shows missing/rejected/urgent KPIs, filters, and `New Shipment`.
- Customs agent dashboard shows assigned-container review queue and document review KPIs.

#### 3. Shipment creation

- New shipments are created through a multi-step modal.
- `parse-shipment` Edge Function can prefill shipment/container fields from an uploaded document using Gemini.
- Final creation uses the `create_shipment_with_containers` RPC for atomic shipment + containers + default document rows.
- Supplier and importer both have shipment creation entry points.

#### 4. Document workflow

- The shared container detail page loads all required document rows for a container.
- Suppliers can upload missing documents and replace rejected ones.
- Customs agents can approve or reject uploaded documents.
- Rejection reason is mandatory in the UI and enforced in the database.
- Signed URLs are generated for viewing private files from storage.
- Clearance progress counters and status badges are rendered from live data.

#### 5. AI document classification

- Supplier container detail includes a `Smart Upload` zone.
- `classify-documents` Edge Function accepts multipart file upload, calls Gemini, detects one or more document types, uploads the file to storage, and updates `portix.documents`.
- The function handles `ALL` container routing across sibling containers in the same shipment.
- Commercial invoice classification can trigger draft ledger creation through `handle_make_invoice_draft`.

#### 6. Customs agent assignment and scoped review

- Importer container detail includes a customs-agent assignment widget.
- Assignment writes to `shipments.customs_agent_id`.
- Customs queue is explicitly filtered to assigned shipments.
- Relevant migrations show that RLS for customs access was tightened to shipment assignment rather than broad container visibility.

#### 7. Logistics timeline

- Container detail includes a working logistics timeline component.
- Timeline derives stages from ETD/ETA plus container status.
- Importer and supplier can edit ETD/ETA directly from the UI.
- Carrier tracking fields (`current_location`, `api_eta`, `last_tracking_update`) are displayed when data exists.

#### 8. Pre-loading cargo media

- Supplier can upload images and videos to `cargo-media`.
- Importer can view uploaded cargo media with signed URLs.
- Captions are supported.
- File compression / preprocessing exists client-side before upload.

#### 9. Claims workspace

- Importer has a claims list and can create a new claim.
- Supplier has a claims list and can open claim detail pages.
- Claim detail supports:
  - AI summary block with `Generate Now`
  - structured damage report form
  - threaded communication UI
  - file attachments in chat
  - attachment gallery/panel
  - importer-side claim status updates
- `generate-claim-summary` Edge Function exists and supports single-claim and bulk processing.
- Realtime subscription for new `claim_messages` is implemented with Supabase `postgres_changes`.

#### 10. Import licenses

- Importer has a dedicated licenses page.
- Licenses load from `v_import_licenses` with computed status behavior.
- License files use a private `license-files` bucket and signed URLs.
- `extract-license-data` Edge Function uses Gemini to extract `license_number`, `product_type`, `issue_date`, and `expiration_date`.
- The license create flow supports both AI extraction and manual entry.

#### 11. Accounts / ledger

- Importer, supplier, and customs-agent all have accounts pages.
- Partner discovery is live and derived from real relationships in containers and shipment assignment.
- Ledger detail pages support:
  - invoice creation
  - credit note creation
  - payment proof upload
  - approval/rejection of submitted transactions
  - draft transaction handling
- Private `swift-documents` storage is used for supporting files.

#### 12. Import cost calculator

- Importer has a calculator page with route templates, product lines, customs cost lines, VAT toggle, and scenario calculations.
- This is currently a frontend productivity tool, not a workflow integrated into shipments or the ledger.

#### 13. Database and security foundations

- Core schema, enums, views, counters, and triggers are present in Supabase migrations.
- `v_containers`, `v_documents_public`, and `v_import_licenses` are implemented.
- RLS exists across profiles, shipments, containers, documents, claims, claim messages, claim attachments, licenses, and media.
- Shipment assignment and customs visibility have dedicated fix migrations, including the `v_containers` view update exposing `customs_agent_id`.

## Features

### Shipped / Live In The Current App

#### A. Container Control

- Role-specific dashboards for importer, supplier, and customs agent
- Shared role-aware container detail page
- Container document checklist and progress summary
- Status-driven customs clearance flow
- Customs agent assignment by shipment
- ETD/ETA editing from the timeline UI

#### B. Document Management

- Manual upload and replacement of required customs documents
- Document approval and rejection workflow
- Mandatory rejection reason
- Signed private file viewing
- AI smart upload and document classification
- Multi-document bundle handling
- Multi-container `ALL` routing in classification logic

#### C. Logistics Visibility

- Logistics timeline component
- Carrier tracking fields in schema and UI
- Dashboard ETA urgency indicators
- Cargo image/video uploads with captions

#### D. Claims And Dispute Resolution

- Importer claim creation
- Supplier/importer claim lists
- Claim detail pages
- Chat-based communication
- File attachments in claim conversation
- Realtime new-message subscription
- AI summary generation
- Structured damage report editing and viewing

#### E. Financial Operations

- Partner account discovery
- Role-aware ledger pages
- Invoice / payment / credit-note records
- Payment proof file uploads
- Draft transaction creation hooks for invoice ingestion

#### F. Compliance And Licensing

- Customs review queue
- Internal note visibility for customs review
- Import license management
- AI-powered license data extraction
- Computed license status view

### Partially Implemented / Present But Not End-To-End

#### 1. Carrier tracking

- There is a `track-containers` Edge Function for Maersk authentication and event retrieval.
- The container schema and UI can display tracking results.
- What is missing is the actual end-to-end product flow: polling/scheduling, container update persistence from the function, and operational UI behavior that makes tracking truly live.

#### 2. AI-assisted shipment ingestion

- `parse-shipment` is implemented and wired into the shipment modal.
- The flow is an assistive prefill, not a full autonomous shipment creation pipeline.
- The user still reviews and submits manually.

#### 3. Automated invoice drafting

- Document classification and upload flows can create draft ledger records.
- The product behavior described in narrative docs as fully automatic finance ingestion is only partially present; the ledger still relies on user review and explicit transaction handling.

#### 4. Company-level finance architecture

- Migrations introduce `companies`, `transactions`, and `company_balances`.
- The active app code uses `account_transactions` and `company_name`/`target_profile_id` patterns instead.
- This means the intended normalized finance model is not the one currently driving the UI.

## Gaps Between The Old Product Narrative And The Actual Code

### Not In The Current UI Or Not Wired The Way The Narrative Suggests

#### 1. Claims are not embedded inside container detail

The PRD-style narrative describes claims as part of the container detail experience. In the current app, claims live in separate `/claims` pages. `components/container-detail-page.tsx` does not render a claims module.

#### 2. The old 3-zone `claim_documents` system is not the active implementation

Migration `00314` introduced `claim_documents`, but the current UI uses chat attachments stored in the `documents` bucket and persisted on `claim_messages.attachments`. The current claim pages do not use the `claim_documents` table as the primary UX model.

#### 3. Live carrier API tracking is not a complete shipped feature

The product story implies operational live tracking. The current repo has foundational work only.

#### 4. Full company-normalized ledger model is not the active app path

The database contains a newer `companies` / `transactions` design, but the application still runs on the lighter `account_transactions` workflow in `lib/db.ts`.

#### 5. Customs agent surface is narrower than the original broader vision

Customs agents currently get containers and accounts navigation. They do not have a dedicated claims or licenses product surface in the active app navigation.

## V2 / Backlog

These are the items that were planned, implied, or partially scaffolded, but should be treated as backlog rather than current product truth.

### High-priority backlog

- Fully operational Maersk / carrier tracking integration with scheduled polling, persisted updates, and importer-facing alerts
- Claims module embedded directly into the container detail page
- Consolidate claims attachments architecture so UI, schema, and storage all use one consistent model
- Finish normalized finance migration from `account_transactions` to the newer company/transactions model, or formally retire the unused model
- Expand realtime beyond claim chat where product copy promises “live” updates

### Product backlog

- Autonomous shipment creation from uploaded source documents with less manual review
- Stronger invoice OCR / ledger automation beyond draft creation
- Notifications / alerting around ETA changes, rejections, expiring licenses, and claim updates
- Richer customs-agent operational workspace beyond container review
- Better linkage between calculator outputs and real shipment or account workflows

### Technical / platform backlog

- Production-grade cron or orchestration for tracking updates
- End-to-end validation of all RLS scenarios with real multi-company test users
- Broader test coverage for claim flows, ledger flows, and assignment edge cases
- Tauri desktop/offline phase

## Recommended PRD Truth For The Next Revision

If this draft becomes the new baseline, the PRD should describe Portix today as:

- a container-centric logistics and document workflow app
- with working AI-assisted document classification, shipment prefill, claim summaries, and license extraction
- with working role-based dashboards, customs review, claims pages, accounts pages, and importer license management
- with carrier tracking and some finance architecture still in transition
- and with several narrative “platform” features still better classified as V2 rather than current-state product
