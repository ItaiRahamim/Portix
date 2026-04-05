# CLAUDE.md — KILO Project Guide

> This file is the single source of truth for working on KILO.
> Update it whenever a new pattern, bug, or preference is discovered — don't wait to be asked.
> Errors go to `knowledge/ERRORS.md`.
> Source PRDs: `src/imports/import-export-platform-redesig.md`, `src/imports/container-dashboard-redesign.md`, `src/imports/import-export-wireframe.md`

---

## 1. Project Identity & Design Goal

**KILO** is an Import/Export Logistics Management Platform.
It is a **Next.js 15 App Router** frontend running on **mock data** (no live database yet).

**Core design goal:** Minimize importer manual work.
- The **supplier** should be able to open shipments independently and upload all documents without waiting for the importer.
- The **customs agent** should be able to review and approve/reject documents without manual handoffs.
- The **importer** only monitors — they should rarely need to take action.

**Three roles:**
| Role | Responsibility |
|---|---|
| `importer` | Monitors containers, manages accounts, claims, licenses. Can create shipments. |
| `supplier` | Creates shipments, uploads documents, manages cargo photos, replaces rejected docs. |
| `customs-agent` | Reviews/approves/rejects documents, manages clearance readiness. |

**The operational unit is the CONTAINER, not the shipment.**
Every table, every action, every status is per container.
Shipments are just a grouping wrapper — never show a "shipments table."

---

## 2. Business Rules (from PRD — must always be respected)

### Clearance Rules
- A container can only become `ready-for-clearance` **AFTER all 7 required documents are uploaded AND approved** by the customs agent.
- If ANY document is rejected → container status becomes `rejected-action-required`.
- A rejected document **must** have a mandatory free-text rejection reason. Cannot reject without one.
- After a rejected doc is replaced by the supplier → status returns to `waiting-for-review`.

### Document Status Flow
```
missing → uploaded → under-review → approved
                                  ↘ rejected → (supplier replaces) → uploaded → under-review → ...
```

### Container Status Flow
```
missing-documents → waiting-for-review → rejected-action-required ↩
                                       ↓
                              ready-for-clearance → in-clearance → released
```

### The 7 Required Documents (per container)
1. Commercial Invoice
2. Packing List
3. Phytosanitary Certificate
4. Bill of Lading
5. Certificate of Origin
6. Cooling Report
7. Insurance

All defined in `ALL_DOCUMENT_TYPES` in `lib/mock-data.ts`. Do not add or remove from this list without a PRD change.

---

## 3. Screens & Features (PRD spec)

### Importer Dashboard — Container Control
**KPI Cards:** Active Containers · Waiting for Documents · Waiting Customs Review · Rejected Containers · Ready for Clearance

**Container Table Columns:**
Container Number · Shipment ID · Supplier · Product · Vessel · ETD · ETA · Container Status · Documents Status · Customs Review Status · Clearance Status · Alerts · Action

**Filters:** By Supplier · By Clearance Status

**Container Status labels:**
- `missing-documents` → "Documents Missing"
- `waiting-for-review` → "Waiting Customs Review"
- `rejected-action-required` → "Rejected Documents"
- `ready-for-clearance` → "Ready for Clearance"
- `in-clearance` → "In Clearance"
- `released` → "Released"
- (future) `claim-open` → "Claim Open"

---

### Supplier Dashboard — Container List
**KPI Cards:** Missing Documents · Rejected Documents · Awaiting Re-upload · Urgent Containers

**Container Table Columns:**
Container Number · Shipment ID · Importer · Product · ETA · Required Documents · Uploaded Documents · Review Status · Rejected Documents · Next Action

**Actions per row:** View Container · Upload Missing Documents · Replace Rejected Documents

---

### Customs Agent Dashboard — Container Review Queue
**KPI Cards:** Containers Awaiting Review · Documents Pending Review · Rejected Documents · Containers Ready for Clearance

**Container Table Columns:**
Container Number · Shipment ID · Importer · Supplier · Product · ETA · Uploaded Documents · Pending Review · Rejected Documents · Clearance Status · Action

---

### Container Details Page (shared by all roles, role-aware)

**Header fields:**
Container Number · Shipment ID · Importer · Supplier · Product · Vessel · ETD · ETA · Port of Loading · Port of Destination · Clearance Status

**Sections:**
1. Clearance Progress Summary Card (Total / Uploaded / Approved / Rejected / Pending / Missing)
2. Documents Checklist Table (Document Type · Upload Status · Upload Date · Review Status · Rejection Reason · File · Action)
3. Pre-Loading Cargo Photos (supplier uploads images/videos with comments — visible to importer)
4. Activity/Logistics Timeline (see below)

**Logistics Timeline events:**
Container created → Loaded → Sailed → Transshipment → Arrived → Docs approved → In clearance → Released

---

### Document Upload Modal (Supplier)
**Fields:** Shipment ID (auto) · Container Number (auto) · Document Type · File Upload · Document Number · Issue Date · Notes

**After upload:** status → `uploaded` (waiting for customs review)

**Validation:** Document type required · File required

---

### Reject Document Modal (Customs Agent)
**Fields:** Document Name (auto) · Container Number (auto) · Rejection Reason (mandatory free text) · Internal Note (optional)

**Rules:** Cannot submit without rejection reason. On reject → document status = `rejected`, container status = `rejected-action-required`.

---

### Accounts Module (all roles)
**Importer view:** list of suppliers with financial status
**Supplier view:** list of importers (clients)
**Customs Agent view:** list of all clients

**Columns:** Name · Total Invoices · Total Amount · Paid Amount · Remaining Balance · Last Payment Date · Action

**Inside each account → Invoices Table:**
Invoice Number · Date · Related Shipment/Container · Amount · Paid Amount · Remaining · Status · SWIFT Document · Action

**Invoice Status:** Unpaid · Partially Paid · Paid

**Invoice Actions:** Upload Invoice · Upload SWIFT · View · Download

---

### Claims Module (Importer + Supplier)
**Importer:** opens claims per container

**Claim fields:** Container Number · Supplier · Product · Claim Type · Description · Amount · Status

**Claim Status:** Open · Under Review · Negotiation · Resolved · Closed

**Claim thread:** messages between importer and supplier with file attachments (images, videos, documents)

---

### Import Licenses Module (Importer)
**Fields:** Supplier · License Number · File · Issue Date · Expiration Date

**Auto-computed:** Days remaining until expiration

**Status indicators:** Valid · Expiring Soon (≤30 days) · Expired

---

### New Shipment (Importer + Supplier)
Both roles can create a new shipment. The modal is role-aware:
- **Importer creates:** picks supplier → origin country auto-fills
- **Supplier creates:** picks importer → origin country auto-fills from their own country

Located in `components/new-shipment-modal.tsx`. Accepts a `role` prop.

---

## 4. Tech Stack

| Layer | Tool | Notes |
|---|---|---|
| Framework | Next.js 15.5 (App Router) | `app/` directory only. Ignore `src/` — legacy Vite stub |
| Language | TypeScript (strict) | `@/*` path alias maps to root |
| Styling | **Tailwind CSS v4** | No `tailwind.config.ts` — config is in `app/globals.css` via `@theme` |
| Components | shadcn/ui + Radix UI | All UI in `components/ui/` |
| Icons | Lucide React | Always import from `lucide-react` |
| Toasts | Sonner | `toast.success()` / `toast.error()` — import from `"sonner"` |
| Data | `lib/mock-data.ts` | In-memory mutable arrays — no API |
| Charts | Recharts | Available |
| Animations | Motion (Framer) | Available — use sparingly |

---

## 5. Project Structure

```
KILO/
├── app/
│   ├── layout.tsx                  # Root layout (fonts, Toaster)
│   ├── page.tsx                    # Role selector landing page
│   └── (dashboard)/                # Route group — no URL segment
│       ├── importer/               # /importer
│       │   ├── page.tsx            # Container Control dashboard
│       │   ├── accounts/
│       │   ├── claims/
│       │   ├── licenses/
│       │   └── containers/[id]/
│       ├── supplier/               # /supplier
│       │   ├── page.tsx
│       │   ├── accounts/
│       │   └── containers/[id]/
│       └── customs-agent/          # /customs-agent
│           ├── page.tsx
│           ├── accounts/
│           └── containers/[id]/
├── components/
│   ├── ui/                         # shadcn/ui — don't edit manually
│   ├── dashboard-layout.tsx        # Sidebar nav wrapper — role-aware
│   ├── container-detail-page.tsx   # Shared across all 3 roles
│   ├── account-detail-page.tsx
│   ├── accounts-page.tsx
│   ├── kpi-card.tsx
│   ├── status-badge.tsx
│   ├── new-shipment-modal.tsx      # 2-step wizard — role-aware
│   ├── document-upload-modal.tsx
│   └── reject-document-modal.tsx
├── lib/
│   ├── mock-data.ts                # ALL types, arrays, helpers
│   ├── db.ts                       # Prisma client (not used in dev)
│   └── utils.ts                    # cn() helper
├── knowledge/
│   └── ERRORS.md
├── src/imports/                    # PRD source documents (read-only reference)
│   ├── import-export-platform-redesig.md
│   ├── container-dashboard-redesign.md
│   └── import-export-wireframe.md
└── prisma/schema.prisma            # Future PostgreSQL schema
```

---

## 6. Data Layer Rules (Critical)

### The Mock Data System
All data lives in `lib/mock-data.ts` as **exported `const` arrays** — still mutable via `.push()`.

**No persistence** — changes reset on page refresh. Intentional for the prototype.

### Mutating Arrays → Forcing Re-render
After any `.push()`, the consuming component must re-render via `refreshKey`:
```tsx
const [refreshKey, setRefreshKey] = useState(0);
const data = useMemo(() => mockContainers.map(...), [refreshKey]);
// After push:
setRefreshKey(k => k + 1);
```

### ID Generation Pattern
```ts
const shipmentId  = `SHP-2026-${String(mockShipments.length + 1).padStart(3, "0")}`;
const containerId = `CNT${String(mockContainers.length + 1).padStart(3, "0")}`;
const docId       = `DOC${String(mockDocuments.length + 1).padStart(3, "0")}`;
```

### Creating a Shipment (Full Sequence)
1. Push to `mockShipments`
2. For each container → push to `mockContainers`
3. For each container → push 7 docs to `mockDocuments` (all `status: "missing"`)

### Mock Identity Constants
```ts
const CURRENT_IMPORTER_ID = "IMP001";  // EuroFresh Imports GmbH
const CURRENT_SUPPLIER_ID = "SUP001";  // FreshFruit Exports SA
```

---

## 7. Styling Rules

### Tailwind v4 — No Config File
- Config is in `app/globals.css` inside `@theme { }`.
- **Never** create `tailwind.config.ts` — breaks the build.
- Use `cn()` from `lib/utils.ts` for conditional classes.

### shadcn/ui
- All in `components/ui/` — treat as read-only.
- Import: `import { Button } from "@/components/ui/button"`.

---

## 8. Component Patterns

### Shared Page Components
`container-detail-page.tsx`, `account-detail-page.tsx`, `accounts-page.tsx` are **role-aware**.
Always edit the shared component — never duplicate per role.

### Dashboard Layout
```tsx
<DashboardLayout role="importer" title="..." subtitle="...">
  {/* content */}
</DashboardLayout>
```

### Modal Pattern
- Props: `open: boolean`, `onClose: () => void`
- Reset state in `handleClose()`
- `onOpenChange={(o) => { if (!o) handleClose(); }}`

### Role-Aware Props
```tsx
interface Props {
  role?: "importer" | "supplier" | "customs-agent";
}
// Default to "importer" if omitted
```

---

## 9. Dev Workflow

```bash
npm run dev    # Start dev server (port 3000)
npm run build  # TypeScript check + build — run before every commit
npm run lint   # ESLint
```

### Critical: Restart After Adding Files
After adding a new component file, **restart the dev server**.
Stale `.next` cache → `MODULE_NOT_FOUND` chunk errors → white/unstyled page.
→ Stop → `npm run dev` again.

---

## 10. Known Gotchas & Anti-Patterns

| ❌ Don't | ✅ Do instead |
|---|---|
| Show a "shipments table" | The operational unit is always CONTAINER |
| Allow clearance without all docs approved | Enforce the PRD rule in UI logic |
| Allow rejection without a reason | Rejection reason is mandatory (PRD rule) |
| Create `tailwind.config.ts` | Never — Tailwind v4 uses `globals.css` |
| Assume `.next` cache is valid after new files | Always restart dev server |
| Use `useMemo(fn, [])` after array mutation | Use `refreshKey` as dependency |
| Hardcode IDs inline | Use `CURRENT_IMPORTER_ID` / `CURRENT_SUPPLIER_ID` constants |
| Edit `components/ui/*.tsx` | Use them as-is |

---

## 11. Prisma / Database (Future)

Schema exists but **not connected** in the prototype.
When migrating: replace `mockArray.push()` with `db.*` calls.
Scripts: `npm run db:push` · `npm run db:migrate` · `npm run db:studio`

---

## 12. Learning & Knowledge Management

- **Domain knowledge:** business rules, role permissions, naming conventions → update this file.
- **Procedural knowledge:** build steps, restart patterns, state patterns → update this file.
- **Bugs & lessons:** log to `knowledge/ERRORS.md` immediately when encountered.
- Propose edits to CLAUDE.md whenever a new pattern or correction emerges. Don't wait.
