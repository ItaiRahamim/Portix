# CLAUDE.md — Portix Project Guide

> This file is the single source of truth for working on **Portix**.
> Update it whenever a new pattern, bug, or preference is discovered — don't wait to be asked.
> Errors, gotchas, and fixes go to `knowledge/ERRORS.md`.
> Source PRDs: `src/imports/import-export-platform-redesig.md`, `src/imports/container-dashboard-redesign.md`, `src/imports/import-export-wireframe.md`

---

## 1. Project Identity & Tech Stack

**Portix** (formerly KILO) is an Import/Export Logistics Management Platform.
It is a **Next.js 15 App Router** frontend backed by **Supabase PostgreSQL** (live database).

**Core design goal:** Minimize importer manual work.
- The **supplier** can open shipments independently and upload all documents without waiting for the importer.
- The **customs agent** can review and approve/reject documents without manual handoffs.
- The **importer** only monitors — they should rarely need to take action.

**Three roles:**
| Role | Responsibility | Schema Table |
|---|---|---|
| `importer` | Monitors containers, manages accounts, claims, licenses. Can create shipments. | `portix.profiles` with `role = 'importer'` |
| `supplier` | Creates shipments, uploads documents, manages cargo photos, replaces rejected docs. | `portix.profiles` with `role = 'supplier'` |
| `customs_agent` | Reviews/approves/rejects documents, manages clearance readiness. | `portix.profiles` with `role = 'customs_agent'` |

**The operational unit is the CONTAINER, not the shipment.**
Every table, every action, every status is per container.
Shipments are just a grouping wrapper — never show a "shipments table."

### Tech Stack Evolution

| Layer | Before (KILO) | After (Portix) |
|---|---|---|
| Framework | Next.js 15.5 (App Router) | Next.js 15.5 (App Router) |
| Language | TypeScript (strict) | TypeScript (strict) |
| Styling | Tailwind CSS v4 | Tailwind CSS v4 |
| Components | shadcn/ui + Radix UI | shadcn/ui + Radix UI |
| Icons | Lucide React | Lucide React |
| Data | `lib/mock-data.ts` (in-memory) | **Supabase PostgreSQL** (live) |
| Auth | None (role selector only) | **Supabase Auth** (email/password) |
| Storage | None | **Supabase Storage** (4 buckets) |
| AI | None | **Google Gemini 2.5 Flash** (via Edge Function) |
| State Mgmt | React hooks + useMemo | **TanStack Query v5** (caching + realtime) |
| Realtime | None | **Supabase Realtime** (postgres_changes) |

---

## 2. Database: Supabase PostgreSQL & Schema

### Critical: All Tables Live in `portix` Schema

Never create tables without the `portix.` prefix. All DDL must go through migrations in `supabase/migrations/`.

### Key Tables & Relationships

```
portix.profiles              ← extends auth.users; FK→supplier_orgs(optional)
portix.supplier_orgs         ← company-level supplier entity
portix.shipments             ← vessel/voyage grouping (FK→importer, supplier)
portix.containers            ← PRIMARY ENTITY (FK→shipment, importer, supplier)
  portix.documents           ← 7 per container (FK→container)
  portix.pre_loading_media   ← cargo photos/videos (FK→container)
  portix.claims              ← disputes (FK→importer, supplier)
    portix.claim_messages    ← threaded messages (FK→claim, sender)
      portix.claim_attachments ← files on messages (FK→message)
portix.invoices              ← financial (FK→importer, supplier)
portix.payments              ← payment records (FK→invoice)
portix.import_licenses       ← per importer-supplier pair
```

### Enums (All Lowercase, Snake Case)

```sql
portix.user_role:        'importer' | 'supplier' | 'customs_agent'
portix.container_status: 'documents_missing' | 'waiting_customs_review' | 'rejected_documents' | 
                         'ready_for_clearance' | 'in_clearance' | 'released' | 'claim_open'
portix.document_type:    'commercial_invoice' | 'packing_list' | 'phytosanitary_certificate' | 
                         'bill_of_lading' | 'certificate_of_origin' | 'cooling_report' | 'insurance_certificate'
portix.document_status:  'missing' | 'uploaded' | 'under_review' | 'approved' | 'rejected'
portix.claim_status:     'open' | 'under_review' | 'negotiation' | 'resolved' | 'closed'
portix.claim_type:       'damaged_goods' | 'missing_goods' | 'short_shipment' | 'quality_issue' | 
                         'documentation_error' | 'delay' | 'other'
portix.media_type:       'image' | 'video' | 'document'
```

### Design Patterns

1. **`profiles` extends `auth.users`**: All user data lives here. Every FK references `profiles.id`. Role is stored in `profiles.role`.
2. **`license_status` is COMPUTED**: Uses `GENERATED ALWAYS AS` to compute from `expiration_date` — never stale.
3. **Denormalized counters on `containers`**: `docs_uploaded`, `docs_approved`, `docs_rejected` kept in sync by DB trigger — powers dashboard KPI cards with zero extra queries.
4. **Auto-advance triggers**: When all docs approved, container status auto-advances to `ready_for_clearance`. When any doc rejected, status becomes `rejected_documents`.
5. **DB-enforced business rules**: CHECK constraints on documents (rejected → must have reason), containers (importer ≠ supplier, etd < eta).
6. **Column-level RLS on `documents.internal_note`**: Only `customs_agent` can read. Implemented via view `portix.documents_public`.

---

## 3. Row Level Security (RLS) & Role Detection

### Helper Function: Get Current User Role

```sql
CREATE FUNCTION portix.get_user_role() RETURNS portix.user_role AS $$
  SELECT role FROM portix.profiles WHERE id = auth.uid()
$$ LANGUAGE sql STABLE SECURITY DEFINER;
```

### RLS Policy Matrix

| Table | Importer | Supplier | Customs Agent |
|---|---|---|---|
| `profiles` | Own row only | Own row only | Own row only |
| `containers` | Where `importer_id = uid()` | Where `supplier_id = uid()` | Where `status = 'waiting_customs_review'` |
| `documents` | Read own containers | Read+UPDATE own (not `internal_note`) | Read+UPDATE all in review |
| `claims` | Own (importer_id) | Own (supplier_id) | ❌ No access |
| `claim_messages` | Via claim ownership | Via claim ownership | ❌ No access |
| `invoices` | Own (importer_id) | Own (supplier_id) | ❌ No access |

### Role Detection in Code

```ts
// NEVER hardcode roles or assume user_metadata
// ALWAYS query from portix.profiles
const { data: { user } } = await supabase.auth.getUser();
const { data: profile } = await supabase
  .from("profiles")
  .select("role")
  .eq("id", user.id)
  .single();

const role = profile?.role; // "importer" | "supplier" | "customs_agent"
```

---

## 4. Storage Buckets & Signed URLs

### Bucket Definitions

| Bucket | Path Pattern | Access Pattern | Expiry |
|---|---|---|---|
| `documents` | `documents/{container_id}/{document_type}/{uuid}.ext` | Supplier upload, read via signed URL | 1 hour |
| `cargo-media` | `cargo-media/{container_id}/{uuid}.ext` | Supplier upload, read via signed URL | 1 hour |
| `swift-documents` | `swift-documents/{invoice_id}/{uuid}.ext` | Importer upload/read, Supplier read | 1 hour |
| `license-files` | `license-files/{importer_id}/{license_id}/{uuid}.ext` | Importer upload/read | 1 hour |

All buckets are **private** — no public URLs. Always use signed URLs.

### Signed URL Pattern in Code

```ts
const supabase = createBrowserSupabaseClient();
const { data, error } = await supabase.storage
  .from("documents")
  .createSignedUrl(storagePath, 3600); // 1 hour expiry

if (!error && data?.signedUrl) {
  // Use data.signedUrl in <img>, <a href>, window.open(), etc.
}
```

---

## 5. Claims Module: Realtime Chat + AI Summaries

### Architecture

The claims module is a **per-container dispute thread** with:
- Importer + Supplier exchanging messages
- File attachments (images, videos, documents) stored in `documents` bucket
- AI-powered summaries via Gemini (auto-refreshed nightly + manual "Generate Now" button)
- Realtime message delivery using Supabase postgres_changes

### Tables

```sql
portix.claims
├─ id (UUID PK)
├─ container_id (UUID FK)
├─ importer_id (UUID FK)
├─ supplier_id (UUID FK)
├─ claim_type (enum)
├─ status (enum: open, under_review, negotiation, resolved, closed)
├─ description (TEXT)
├─ amount (DECIMAL)
├─ claim_summary (TEXT) ← AI-generated by Gemini
├─ last_summary_at (TIMESTAMPTZ) ← tracks last AI refresh
└─ created_at, updated_at (TIMESTAMPTZ)

portix.claim_messages
├─ id (UUID PK)
├─ claim_id (UUID FK)
├─ sender_id (UUID FK→profiles)
├─ sender_role (enum: importer, supplier) ← redundant but queryable
├─ message (TEXT)
├─ attachments (JSONB) ← null if no files
└─ created_at (TIMESTAMPTZ)

portix.claim_attachments
├─ id (UUID PK)
├─ message_id (UUID FK)
├─ file_name (TEXT)
├─ storage_path (TEXT)
├─ media_type (enum: image, video, document)
├─ file_size_bytes (INT)
└─ created_at (TIMESTAMPTZ)
```

### Message Lifecycle

1. **User sends message** → `sendClaimMessage(claimId, text, role)` inserts to `claim_messages`
2. **File upload** → stored in `documents` bucket, row inserted to `claim_attachments` with FK to message
3. **Realtime trigger** → Supabase postgres_changes fires on `claim_messages` INSERT, TanStack Query pushes to cache instantly
4. **UI displays message** → Lightbox preview for images, signed URL for PDFs/documents

### AI Summary Generation

#### Edge Function: `supabase/functions/generate-claim-summary/index.ts`

```ts
// Deno runtime, Gemini 2.5 Flash
// Endpoint: POST /functions/v1/generate-claim-summary
// Body: { claim_id: UUID }

// Execution flow:
1. Fetch claim metadata + all messages with sender names (joined profiles)
2. Check if latest message post-dates last_summary_at (change detection)
3. Build prompt: claim type, status, amount, all messages in [Date] Sender: message format
4. Call Gemini with maxOutputTokens: 500, temperature: 0.3
5. Parse response: candidates[0].content.parts[0].text
6. Store summary + last_summary_at in portix.claims
7. Return { ok: true, processed: 1, results: [...] }

// CORS headers required:
Access-Control-Allow-Origin: *
Access-Control-Allow-Headers: authorization, x-client-info, apikey, content-type
OPTIONS preflight handler must be first in serve() block
```

#### Nightly Cron Job

```sql
-- Runs daily at 23:00 UTC via pg_cron
-- Supabase Vault stores SUPABASE_URL and SERVICE_ROLE_KEY
-- Function portix.run_daily_claim_summaries() 
--   → reads secrets from vault
--   → calls Edge Function with HTTP POST via pg_net
--   → processes all non-closed claims with new activity

SELECT cron.schedule('daily-claim-summaries', '0 23 * * *', 
  'SELECT portix.run_daily_claim_summaries()');
```

#### Manual Refresh Button

```tsx
// In claim-overview-block.tsx
const [generating, setGenerating] = useState(false);

const handleGenerateNow = async () => {
  setGenerating(true);
  try {
    const { data, error } = await supabase.functions.invoke(
      "generate-claim-summary",
      { body: { claim_id: claimId } }
    );
    if (error) throw error;
    
    // Invalidate cache → refetch fresh summary
    await queryClient.invalidateQueries({ queryKey: ["claim", claimId] });
    toast.success("Summary generated!");
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    setGenerating(false);
  }
};
```

### Realtime Message Delivery

```ts
// In hooks/use-claim-messages.ts
useEffect(() => {
  const channel = supabase
    .channel(`claim-${claimId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "portix",
        table: "claim_messages",
        filter: `claim_id=eq.${claimId}`,
      },
      (payload) => {
        // Push new message directly into TanStack Query cache
        // No refetch — instant UI update
        queryClient.setQueryData(
          ["claimMessages", claimId],
          (old: any) => [...(old || []), payload.new]
        );
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}, [claimId]);
```

---

## 6. TanStack Query (React Query) Patterns

### Cache Key Conventions

```ts
// Containers
["containers", { role, importerId }] // dashboard list
["container", containerId]             // detail page
["containerDocuments", containerId]    // documents only

// Claims
["claims", containerId]                // all claims for container
["claim", claimId]                     // single claim + metadata
["claimMessages", claimId]             // messages thread
```

### Invalidation Patterns

```ts
// After sending a message:
queryClient.invalidateQueries({ queryKey: ["claimMessages", claimId] });
queryClient.invalidateQueries({ queryKey: ["claim", claimId] });

// After generating summary:
await queryClient.invalidateQueries({ queryKey: ["claim", claimId] });

// After document approval:
queryClient.invalidateQueries({ queryKey: ["container", containerId] });
queryClient.invalidateQueries({ queryKey: ["containers", { role }] });
```

### setQueryData Pattern (Instant Updates)

```ts
// Use when you have the new data immediately (realtime INSERT):
queryClient.setQueryData(
  ["claimMessages", claimId],
  (old: any) => [...(old || []), newMessage]
);

// More efficient than invalidateQueries for high-frequency updates
```

---

## 7. Business Rules (from PRD — must always be respected)

### Clearance Rules
- A container can only become `ready_for_clearance` **AFTER all 7 required documents are uploaded AND approved** by the customs agent.
- If ANY document is rejected → container status becomes `rejected_documents`.
- A rejected document **must** have a mandatory free-text rejection reason. Cannot reject without one.
- After a rejected doc is replaced by the supplier → status returns to `waiting_customs_review`.

### Document Status Flow
```
missing → uploaded → under_review → approved
                                  ↘ rejected → (supplier replaces) → uploaded → under_review → ...
```

### Container Status Flow
```
documents_missing → waiting_customs_review → rejected_documents ↩
                                           ↓
                              ready_for_clearance → in_clearance → released
```

### The 7 Required Documents (per container)
1. Commercial Invoice
2. Packing List
3. Phytosanitary Certificate
4. Bill of Lading
5. Certificate of Origin
6. Cooling Report
7. Insurance Certificate

---

## 8. Screens & Features (PRD spec)

### Importer Dashboard — Container Control
**KPI Cards:** Active Containers · Waiting for Documents · Waiting Customs Review · Rejected Containers · Ready for Clearance

**Container Status labels:**
- `documents_missing` → "Documents Missing"
- `waiting_customs_review` → "Waiting Customs Review"
- `rejected_documents` → "Rejected Documents"
- `ready_for_clearance` → "Ready for Clearance"
- `in_clearance` → "In Clearance"
- `released` → "Released"
- `claim_open` → "Claim Open"

---

### Supplier Dashboard — Container List
**KPI Cards:** Missing Documents · Rejected Documents · Awaiting Re-upload · Urgent Containers

**Actions per row:** View Container · Upload Missing Documents · Replace Rejected Documents

---

### Customs Agent Dashboard — Container Review Queue
**KPI Cards:** Containers Awaiting Review · Documents Pending Review · Rejected Documents · Containers Ready for Clearance

---

### Container Details Page (shared by all roles, role-aware)

**Header fields:** Container Number · Shipment ID · Importer · Supplier · Product · Vessel · ETD · ETA · Port of Loading · Port of Destination

**Sections:**
1. Clearance Progress Summary Card (Total / Uploaded / Approved / Rejected / Pending / Missing)
2. Documents Checklist Table (Document Type · Upload Status · Review Status · Rejection Reason · File · Action)
3. Pre-Loading Cargo Photos (supplier uploads images/videos with comments — visible to importer)
4. Activity/Logistics Timeline
5. **Claims Module** (if claim exists) ← AI summaries, realtime chat, file attachments

---

### Claims Module (Importer + Supplier)

**Claim Thread Features:**
- Role-aware message display (Importer messages on right, Supplier on left)
- File attachments with lightbox preview (images) or signed URL (PDFs)
- Sender identity from `profiles.full_name` (not role labels)
- AI summary block with "Generate Now" button
- Real-time message delivery (no page refresh needed)
- Nightly auto-summary at 23:00 UTC

---

## 9. Project Structure

```
Portix/
├── app/
│   ├── layout.tsx                  # Root layout (fonts, Toaster, Supabase session)
│   ├── page.tsx                    # Role selector landing page
│   ├── auth/                       # Supabase Auth flows (signup, login, callback)
│   └── (dashboard)/                # Route group — no URL segment
│       ├── importer/
│       │   ├── page.tsx            # Container Control dashboard
│       │   ├── accounts/
│       │   ├── claims/
│       │   ├── licenses/
│       │   └── containers/[id]/
│       ├── supplier/
│       │   ├── page.tsx
│       │   ├── accounts/
│       │   └── containers/[id]/
│       └── customs-agent/
│           ├── page.tsx
│           ├── accounts/
│           └── containers/[id]/
├── components/
│   ├── ui/                         # shadcn/ui — read-only
│   ├── claims/
│   │   ├── claim-overview-block.tsx      # Summary + "Generate Now" button
│   │   ├── claim-detail-page.tsx         # Full claim thread
│   │   ├── claim-documents-panel.tsx     # File attachments grouped by type
│   │   ├── document-upload-zone.tsx      # Signed URL preview + download
│   │   └── claim-chat.tsx                # Message thread (realtime)
│   ├── dashboard-layout.tsx        # Sidebar nav wrapper — role-aware
│   ├── container-detail-page.tsx   # Shared across all 3 roles
│   └── ... (other shared components)
├── lib/
│   ├── supabase.ts                 # Supabase client + type definitions (replaces db.ts)
│   ├── utils.ts                    # cn() helper
│   └── helpers.ts                  # Date formatting, role labels, etc.
├── hooks/
│   ├── use-claim-messages.ts       # Realtime subscription to claim messages
│   ├── use-containers.ts           # TanStack Query fetch with caching
│   └── use-auth.ts                 # Current user + role detection
├── supabase/
│   ├── migrations/
│   │   ├── 00001_initial_schema.sql
│   │   ├── 00002_rls_policies.sql
│   │   ├── 00003_triggers.sql
│   │   ├── 00004_seed_data.sql
│   │   ├── 00314_add_claims_and_messages.sql
│   │   ├── 00315_fix_claim_messages_schema.sql
│   │   └── 00316_setup_daily_ai_summary.sql
│   ├── functions/
│   │   └── generate-claim-summary/index.ts    # Deno runtime, Gemini API
│   └── storage.md                  # Bucket definitions & security rules
├── knowledge/
│   └── ERRORS.md                   # Bug catalog + fixes
└── prisma/                         # Legacy schema (not used)
```

---

## 10. Data Fetching with lib/supabase.ts

### Type Definitions

```ts
// Always import from lib/supabase.ts, never inline
export interface Claim {
  id: string;
  container_id: string;
  importer_id: string;
  supplier_id: string;
  claim_type: "damaged_goods" | "missing_goods" | ... ;
  status: "open" | "under_review" | ... ;
  description: string;
  amount: number | null;
  claim_summary: string | null;       // ← AI-generated by Gemini
  last_summary_at: string | null;     // ← last refresh timestamp
  created_at: string;
  updated_at: string;
}

export interface ClaimMessage {
  id: string;
  claim_id: string;
  sender_id: string;
  sender_role: "importer" | "supplier";
  message: string;
  attachments: ChatAttachment[] | null;
  created_at: string;
  sender?: {
    full_name: string;
  } | null;  // ← Joined from profiles
}

export interface ChatAttachment {
  id: string;
  message_id: string;
  file_name: string;
  storage_path: string;
  media_type: "image" | "video" | "document";
  file_size_bytes: number | null;
  created_at: string;
}
```

### Query Patterns

```ts
// Fetch claim with all messages and attachment details
const { data: claim } = await supabase
  .from("claims")
  .select("*")
  .eq("id", claimId)
  .single();

// Fetch messages with sender info (profile join)
const { data: messages } = await supabase
  .from("claim_messages")
  .select("*, sender:profiles!sender_id(full_name)")
  .eq("claim_id", claimId)
  .order("created_at", { ascending: true });

// Fetch attachments for a message
const { data: attachments } = await supabase
  .from("claim_attachments")
  .select("*")
  .eq("message_id", messageId);
```

### Mutation Patterns

```ts
// Send a message
const { data: newMessage, error } = await supabase
  .from("claim_messages")
  .insert({
    claim_id: claimId,
    sender_id: userId,
    sender_role: role,  // "importer" or "supplier"
    message: text,
    attachments: null,  // Files linked separately to claim_attachments
  })
  .select("*")
  .single();

// Upload file attachment (after file is uploaded to Storage)
const { data: attachment } = await supabase
  .from("claim_attachments")
  .insert({
    message_id: messageId,
    file_name: file.name,
    storage_path: `documents/${claimId}/${timestamp}-${uuid}.${ext}`,
    media_type: inferMediaType(file),
    file_size_bytes: file.size,
  })
  .select("*")
  .single();

// Generate Gemini summary (manual button)
const { data: result, error } = await supabase.functions.invoke(
  "generate-claim-summary",
  { body: { claim_id: claimId } }
);
```

---

## 11. Component Patterns

### Shared Page Components
`container-detail-page.tsx`, `claim-detail-page.tsx`, `accounts-page.tsx` are **role-aware**.
Always edit the shared component — never duplicate per role.

### Role-Aware Props
```tsx
interface Props {
  role: "importer" | "supplier" | "customs_agent";  // Always pass role explicitly
  containerId: string;
}
```

### Modal Pattern
```tsx
interface Props {
  open: boolean;
  onClose: () => void;
}

export function MyModal({ open, onClose }: Props) {
  const [state, setState] = useState(...);
  
  const handleClose = () => {
    setState(...);  // Reset state
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      ...
    </Dialog>
  );
}
```

---

## 12. Styling Rules

### Tailwind v4 — No Config File
- Config is in `app/globals.css` inside `@theme { }`.
- **Never** create `tailwind.config.ts` — breaks the build.
- Use `cn()` from `lib/utils.ts` for conditional classes.

### shadcn/ui
- All in `components/ui/` — treat as read-only.
- Import: `import { Button } from "@/components/ui/button"`.

---

## 13. Dev Workflow

```bash
npm run dev      # Start dev server (port 3000)
npm run build    # TypeScript check + build — run before every commit
npm run lint     # ESLint

# Database
npx supabase migration new <description>  # Create migration
npx supabase migration up                 # Apply migrations locally
npx supabase functions deploy <name>      # Deploy Edge Function

# Environment
cp .env.local.example .env.local          # Create .env (populate from Supabase dashboard)
```

### Critical: Restart After Adding Files
After adding a new component file, **restart the dev server**.
Stale `.next` cache → `MODULE_NOT_FOUND` chunk errors → white/unstyled page.
→ Stop → `npm run dev` again.

### Critical: Migrations Are Immutable
- **Never** edit an applied migration.
- If a migration has errors, create a **new migration** to fix it.
- Migration sequence is linearized — gaps cause failures.
- Test locally with `npx supabase migration up` before pushing.

---

## 14. Known Gotchas & Anti-Patterns

| ❌ Don't | ✅ Do instead |
|---|---|
| Use `mockData` arrays | Query `portix.*` tables via Supabase |
| Hardcode role strings | Query `portix.profiles.role` or use constants |
| Mutate Supabase data directly | Use `.insert()`, `.update()`, `.delete()` |
| Assume `.next` cache is valid | Always restart dev server after new files |
| Use `invalidateQueries()` for realtime | Use `setQueryData()` with realtime subscription |
| Store secrets in `.env` (frontend) | Use Supabase Vault for Edge Functions |
| Create `tailwind.config.ts` | Never — Tailwind v4 uses `globals.css` |
| Show sender role labels in chat | Use `sender.full_name` from profile join |
| Reject document without a reason | Rejection reason is mandatory (DB CHECK constraint + UI validation) |
| Call Edge Function without CORS | All functions must have OPTIONS handler + corsHeaders |
| Allow unsigned file downloads | Always use signed URLs with 1-hour expiry |
| Edit `components/ui/*.tsx` files | Use them as-is — shadcn/ui treats as read-only |

---

## 15. Common Errors & Fixes

### "Could not find the table 'portix.claim_documents'"
**Root:** Component was querying old table name. Actual schema uses `claim_attachments` joined via `claim_messages`.
**Fix:** Update query to `.from("claim_attachments")` and ensure message_id is used as FK.

### "Could not find column sender_role of 'claim_messages'"
**Root:** Migration hasn't been applied yet, or was skipped.
**Fix:** Run `npx supabase migration up` locally, then deploy function with fresh connection.

### "Response to preflight request doesn't pass access control check"
**Root:** Edge Function missing CORS headers or OPTIONS handler.
**Fix:** Ensure `corsHeaders` const includes `Access-Control-Allow-Origin: *` and function has `if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });` at top of serve() block.

### "Gemini summaries are truncated mid-sentence"
**Root:** `maxOutputTokens: 300` is too low.
**Fix:** Increase to `maxOutputTokens: 500` and refine prompt to explicitly ask for "2-3 complete sentences" and "Do not cut off mid-sentence."

### "ALTER DATABASE: permission denied"
**Root:** Supabase project role cannot set GUC parameters.
**Fix:** Use Supabase Vault instead: `vault.create_secret()` to store secrets, `vault.decrypted_secrets` to read them in functions.

### Logo not appearing in header
**Root:** Next.js Image with `width={0}` doesn't constrain; inline style overrides Tailwind.
**Fix:** Switch to plain `<img>` tag with intrinsic dimensions, drive sizing purely via className.

### Zod v4 type inference breaks @hookform/resolvers
**Root:** Zod v4 produces `unknown` type for `z.coerce.number()`, incompatible with Resolver.
**Fix:** Downgrade to `zod@^3.22.0` in package.json.

### Nightly cron job not running
**Root:** pg_cron not enabled, or Vault secrets not set up.
**Fix:** Ensure extensions are created: `CREATE EXTENSION IF NOT EXISTS pg_cron` (applies automatically in Supabase). Verify `vault.decrypted_secrets` contains the right keys.

---

## 16. Learning & Knowledge Management

- **Domain knowledge:** business rules, role permissions, naming conventions, schema design → update this file immediately.
- **Procedural knowledge:** build steps, restart patterns, deployment workflows, migration strategy → update this file.
- **Bugs & lessons:** log to `knowledge/ERRORS.md` immediately when encountered, with root cause and fix.
- **Code patterns:** new TanStack Query patterns, Realtime subscription patterns, type definitions → update this file.
- When you discover something new, **don't wait** — propose edits to CLAUDE.md and commit immediately.

---

## 17. Phase 2: Tauri Desktop App (Future)

Not yet started. Will include:
- `src-tauri/` directory with Rust backend
- IPC between Next.js and Rust for file operations
- Offline mode with local SQLite + sync
- Native window management
- Auto-update system

---

## 18. Current Status (as of 2026-04-19)

### ✅ Completed (Web MVP)
- Portix branding and logo
- Supabase PostgreSQL schema (17 tables, RLS, triggers)
- Supabase Auth (email/password, 3 roles)
- Container lifecycle (CRUD, status flows)
- Document management (upload, approval, rejection)
- Claims module with Realtime chat + file attachments
- Google Gemini AI summary generation (manual + nightly cron)
- Signed URL downloads (all 4 storage buckets)
- TanStack Query caching + Realtime invalidation
- Role-based access control (RLS + UI enforcement)

### 🔄 In Progress
- Full end-to-end testing (all claim scenarios)
- Customs agent permissions verification
- Accounts/invoices module (SWIFT upload, payment tracking)
- Import licenses CRUD (expiry warnings)
- Cargo media module (pre-loading photos/videos)

### ⏳ Not Yet Started (Phase 2)
- Tauri desktop app setup
- Offline mode + local sync
- Maersk API container tracking integration
- Advanced search & filtering
- Performance optimization (pagination, lazy load)

