# PORTIX_MASTER.md — Single Source of Truth

> **Last Updated:** 2026-05-26
> **Authority:** This file supersedes AGENTS.md, CONTEXT_RULES.md, DEPLOYMENT_STATUS.md, and ERRORS.md.
> **Identity rule:** The project name is exclusively **Portix**. "KILO" is deprecated — never use it in code, comments, or conversation.

---

## Table of Contents

1. [Project Identity & Tech Stack](#1-project-identity--tech-stack)
2. [Global Copilot — Agentic RAG Architecture](#2-global-copilot--agentic-rag-architecture)
3. [Database Schema & RLS Rules](#3-database-schema--rls-rules)
4. [Frontend & UI Patterns](#4-frontend--ui-patterns)
5. [Error Ledger](#5-error-ledger)

---

## 1. Project Identity & Tech Stack

**Portix** is an Import/Export Logistics Management Platform.
Stack: **Next.js 15 App Router** + **Supabase PostgreSQL** (live database).

**Core design goal:** Minimize importer manual work.
- Supplier opens shipments and uploads all documents independently.
- Customs agent reviews and approves/rejects without manual handoffs.
- Importer monitors only — rarely needs to act.

### Three Roles

| Role | Responsibility | Schema |
|---|---|---|
| `importer` | Monitors containers, manages accounts/claims/licenses. | `portix.profiles` role='importer' |
| `supplier` | Creates shipments, uploads docs, replaces rejected docs. | `portix.profiles` role='supplier' |
| `customs_agent` | Reviews/approves/rejects documents, manages clearance. | `portix.profiles` role='customs_agent' |

**The operational unit is the CONTAINER, not the shipment.**
Shipments are just grouping wrappers. Never show a "shipments table."

### Tech Stack

| Layer | Value |
|---|---|
| Framework | Next.js 15.5 (App Router) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v4 (config in `app/globals.css @theme {}` — never create `tailwind.config.ts`) |
| Components | shadcn/ui + Radix UI (treat `components/ui/` as read-only) |
| Icons | Lucide React |
| Database | Supabase PostgreSQL (portix schema) |
| Auth | Supabase Auth (email/password) |
| Storage | Supabase Storage (4 private buckets) |
| AI | Google Gemini 2.5 Flash + gemini-embedding-2 (via Edge Functions) |
| State Mgmt | TanStack Query v5 |
| Realtime | Supabase Realtime (postgres_changes) |

### Dev Commands

```bash
npm run dev      # Start dev server (port 3000)
npm run build    # TypeScript check + build — run before every commit
npm run lint     # ESLint

npx supabase migration new <description>   # Create migration
npx supabase migration up                  # Apply locally
npx supabase functions deploy <name>       # Deploy Edge Function
```

### Critical Dev Rules

- **Restart dev server after adding files.** Stale `.next` cache → `MODULE_NOT_FOUND` chunk errors.
- **Migrations are immutable.** Never edit an applied migration. Create a new one to fix it.
- **Tailwind v4:** Config lives in `app/globals.css` inside `@theme {}`. Never create `tailwind.config.ts`.

---

## 2. Global Copilot — Agentic RAG Architecture

**File:** `supabase/functions/global-copilot/index.ts` (Deno runtime)
**Persona:** "Porty" — animated shipping container AI assistant
**Models:** `gemini-2.5-flash` (generation), `gemini-embedding-2` (768-dim embeddings)
**Frontend contract:** Plain text stream deltas via `TextStreamChatTransport` (@ai-sdk/react)

### Architecture: Two-Phase Gemini Request

```
client → edge fn
  ↓
[Phase 1: :generateContent — non-streaming, up to MAX_ROUNDS=3]
  systemInstruction + conversation history + tool declarations
  ↓
  Gemini returns: functionCall(s) OR final text
  ↓
  if functionCall → execute tool → append functionResponse → loop
  if no functionCall → break (DO NOT append model turn to contents)
  ↓
[Phase 2: :streamGenerateContent?alt=sse]
  Re-send full contents (history + all tool calls + tool responses)
  toolConfig: NONE (no more tool calls)
  Stream deltas back to client
```

#### CRITICAL: Phase 1 Must NOT Append Final Text to Contents

When Phase 1 produces a response with `functionCalls.length === 0` (final answer ready), **do not** push that `modelTurn` into the `contents` array. Phase 2 must receive a conversation ending at the last `functionResponse`. If the final model turn is appended, Phase 2 sees a completed answer and emits an empty stream.

```typescript
if (functionCalls.length === 0) {
  // DO NOT: contents.push(modelTurn)  ← causes empty Phase 2 stream
  producedText = textInTurn.length > 0;
  break;
}
```

### Two Tool Declarations

**`get_live_containers_summary`**
- Call FIRST for: counting, listing, filtering, status overviews, vessels, ETAs, ports, importers, suppliers — anything fleet-level.
- Implementation: queries `portix.v_containers` view (pre-joined containers + shipments + profiles).
- Returns: `{ count, containers: [{ container_number, product, hs_code, vessel, status, etd, eta, port_of_loading, port_of_destination, importer, supplier, shipment_number }] }`
- Privacy: `supabaseAnon` (user JWT) — RLS scopes to caller's containers automatically.

**`search_container_documents`**
- Call for: weights, carton counts, HS codes, seal numbers, invoice amounts, cert dates, missing documents — any PDF-level fact.
- Parameters: `search_query` (required), `container_numbers` (optional ISO 6346 array).
- Privacy boundary: container_numbers → UUIDs via `supabaseAnon` BEFORE any `supabaseAdmin` call.

### Hybrid Search: Two-Pass Relational Pull

When `container_numbers` is provided, the relational query runs two passes to prevent T&C boilerplate from crowding out measurement data:

**Pass 1 — Keyword-targeted (limit 40):**
```typescript
const filterExpr = relKeywords.map(k => `content.ilike.%${k}%`).join(",");
supabaseAdmin.from("document_chunks")
  .in("container_id", containerIds)
  .or(filterExpr)
  .limit(40)
```
`extractRelKeywords(query)` tokenizes the search_query (strips stop-words, returns ≤5 tokens). Chunks matching any keyword are fetched first. Assigned `similarity: 0.01` so they rank above fallback.

**Pass 2 — Unfiltered fallback (fills remaining slots up to 60):**
```typescript
supabaseAdmin.from("document_chunks")
  .in("container_id", containerIds)
  .limit(remaining + seenRel.size)  // over-fetch to compensate for dedup
```

A blind `.limit(60)` without ordering is deprecated — it grabs sequential insertion order (often T&C boilerplate), leaving the weight/measurement chunk unreachable.

### Vector Similarity (Global / No Container Filter)

When `container_numbers` is omitted, the RPC `portix.match_user_document_chunks` runs cosine similarity over all containers the caller can see:
```typescript
supabaseAnon.rpc("match_user_document_chunks", {
  query_embedding: embedding,  // 768-dim from gemini-embedding-2
  match_threshold: 0.4,
  match_count: 12,
})
```
RPC enforces `auth.uid()` server-side — no additional RLS needed.

### Agent Reasoning Directives (in PORTY_SYSTEM_PROMPT)

**CONTEXTUAL DEDUCTION — Zero Hardcoding**
The agent MUST NOT rely on hardcoded semantic mappings (e.g., "בצל סגול = Red Onion"). Instead:
1. Call `get_live_containers_summary` first.
2. Read the actual `product` values in the live DB.
3. Use native trade knowledge to map the user's informal term to the closest existing DB value.

This is scalable; hardcoded rules are maintenance debt that breaks silently.

**ZOOM OUT FALLBACK**
If a specific `search_query` (e.g., "net weight") yields no useful chunks:
- Do NOT retry with more synonyms.
- Next call: query by document TYPE — `search_query: "Bill of Lading, Packing List, Commercial Invoice"`.
- This retrieves raw document chunks for direct scanning.
- Max 2 attempts (specific → zoom-out) before declaring not found.

**FAIL-SAFE**
After zoom-out scan exhausted: stop searching. Inform the user which document types were checked (e.g., "I scanned the Packing Lists and Bill of Lading") but the data point is missing or illegible. Never invent numbers.

### MAX_ROUNDS = 3

Hard cap at 3 Phase 1 rounds prevents Edge Function gateway timeouts. On round 3, a nudge is appended: `"Now answer the user using the data above. Do not call any more tools."` Phase 2 then streams the answer.

### Security Boundaries

1. `supabaseAnon` (user JWT): all container ownership checks, `v_containers` queries, `match_user_document_chunks` RPC.
2. `supabaseAdmin` (service role): ONLY used inside `toolSearchDocuments` for chunk fetch AFTER ownership verified via `supabaseAnon`. Bypasses RLS on `document_chunks` — safe because `containerIds` are already privacy-filtered.
3. Container UUIDs never leave the server. Tool parameters use ISO 6346 numbers only.
4. `scrubIdentifiers()` strips UUIDs and bare hex tokens from chunk content before returning to the model.

### Helper Functions

| Function | Purpose |
|---|---|
| `embedQuery(text, apiKey)` | Calls gemini-embedding-2, returns 768-dim float array |
| `extractRelKeywords(query)` | Tokenizes query, strips stop-words, returns ≤5 tokens for ilike filter |
| `scrubIdentifiers(text)` | Strips UUID-shaped strings and 8-char hex tokens |
| `chunkContainerNumber(content)` | Extracts first ISO 6346 number declared in chunk body |
| `findContainerNumbers(text)` | Extracts all ISO 6346 numbers from arbitrary text |
| `streamFixedText(text)` | Returns a ReadableStream with a fixed error message (fallback) |
| `extractDelta(sseLine)` | Parses SSE line from Phase 2 stream, returns text delta |
| `toGeminiContents(messages)` | Normalizes client messages to Gemini content format |
| `messageText(m)` | Extracts text from ClientMessage (content string or parts array) |

### Edge Function Deployment

```bash
npx supabase functions deploy global-copilot
# Requires GEMINI_API_KEY in Edge Function secrets
# Requires SUPABASE_SERVICE_ROLE_KEY (auto-injected by Supabase)
```

---

## 3. Database Schema & RLS Rules

### Critical: All Tables in `portix` Schema

Every table uses the `portix.` prefix. All DDL through migrations in `supabase/migrations/`.

### Key Tables & Relationships

```
portix.profiles              ← extends auth.users; FK→supplier_orgs(optional)
portix.supplier_orgs         ← company-level supplier entity
portix.shipments             ← vessel/voyage grouping (FK→importer, supplier, customs_agent)
portix.containers            ← PRIMARY ENTITY (FK→shipment, importer, supplier)
  portix.documents           ← 7 per container (FK→container)
  portix.document_chunks     ← RAG chunks (FK→container, document); has `embedding vector(768)`
  portix.pre_loading_media   ← cargo photos/videos (FK→container)
  portix.claims              ← disputes (FK→importer, supplier)
    portix.claim_messages    ← threaded messages (FK→claim, sender)
      portix.claim_attachments ← files on messages (FK→message)
portix.invoices              ← financial (FK→importer, supplier)
portix.payments              ← payment records (FK→invoice)
portix.import_licenses       ← per importer-supplier pair
```

### Key Views

| View | Purpose |
|---|---|
| `portix.v_containers` | Pre-joined containers + shipments + profiles. Columns: `container_number, product_name, hs_code, vessel_name, status, eta, etd, port_of_loading, port_of_destination, origin_country, importer_company, supplier_company, shipment_number` |
| `portix.documents_public` | `portix.documents` with `internal_note` hidden from non-customs-agents (column-level RLS) |

### Key RPC Functions

| Function | Purpose |
|---|---|
| `portix.match_user_document_chunks(query_embedding vector(768), match_threshold float, match_count int)` | Cosine similarity search across all chunks the caller can see. Enforces `auth.uid()` server-side. Returns: `(id, document_id, container_id, content, similarity, metadata)` |
| `portix.get_user_role()` | Returns caller's role from `portix.profiles`. Used by RLS policies. |
| `portix.rpc_create_shipment(...)` | Atomic shipment + container creation |
| `portix.handle_make_invoice_draft(...)` | Make.com OCR auto-draft creation |

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

### DB Design Patterns

1. `profiles` extends `auth.users` — every FK references `profiles.id`. Role stored in `profiles.role`.
2. `license_status` is COMPUTED (`GENERATED ALWAYS AS` from `expiration_date`) — never stale.
3. Denormalized counters on `containers`: `docs_uploaded`, `docs_approved`, `docs_rejected` kept by trigger.
4. Auto-advance triggers: all docs approved → `ready_for_clearance`; any rejected → `rejected_documents`.
5. DB-enforced: rejected document must have reason (CHECK constraint). importer ≠ supplier (CHECK). etd < eta (CHECK).
6. Column-level RLS on `documents.internal_note`: only `customs_agent` can read (via `documents_public` view).

### RLS Policy Matrix

| Table | Importer | Supplier | Customs Agent |
|---|---|---|---|
| `profiles` | Own row | Own row | Own row |
| `containers` | `importer_id = uid()` | `supplier_id = uid()` | `status = 'waiting_customs_review'` |
| `documents` | Read own containers | Read+UPDATE own (not `internal_note`) | Read+UPDATE all in review |
| `document_chunks` | RLS blocks direct read — use `match_user_document_chunks` RPC | Same | Same |
| `claims` | Own (`importer_id`) | Own (`supplier_id`) | ❌ No access |
| `invoices` | Own (`importer_id`) | Own (`supplier_id`) | ❌ No access |

### Role Detection in Code

```ts
// NEVER hardcode roles or assume user_metadata
const { data: { user } } = await supabase.auth.getUser();
const { data: profile } = await supabase
  .from("profiles")
  .select("role")
  .eq("id", user.id)
  .single();
const role = profile?.role; // "importer" | "supplier" | "customs_agent"
```

### Migration Conventions

- File naming: `00NNN_description.sql` — sequential, no gaps.
- Never edit an applied migration. Create a new one to fix.
- Use `IF NOT EXISTS` on CREATE TABLE / ADD COLUMN.
- Include `NOTIFY pgrst, 'reload schema';` after schema changes.
- Test locally: `npx supabase migration up`

### Migrations Log

| Migration | Purpose |
|---|---|
| 00301 | Initial schema (23 tables, views, enums) |
| 00302 | RLS policies for all tables |
| 00303 | Auto-advance status triggers |
| 00304 | Dev seed data |
| 00305 | RPC create_shipment (atomic) |
| 00306–00313 | Incremental fixes + customs agent role |
| 00314 | Claims + Realtime + Storage |
| 00315 | Fix claim_messages schema |
| 00316 | pg_cron + Vault nightly AI summaries |
| 00317 | Companies + account_transactions table |
| 00318 | Make.com OCR auto-draft RPC |
| 00319 | Add container_id to transactions |
| 00320 | swift-documents bucket + RLS |
| 00321 | UUID partner transactions (target_profile_id) |
| 00322 | Backfill target_profile_id (3-pass legacy rescue) |
| 00323 | license product_type + license-files bucket |
| 00327 | bl_number on shipments |
| 00331 | carrier on shipments |
| 00341 | document_chunks table + container-scoped vector search RPC |
| 00343 | match_user_document_chunks — user-scoped fleet-wide vector search |

### Storage Buckets

| Bucket | Path | Access | Expiry |
|---|---|---|---|
| `documents` | `documents/{container_id}/{document_type}/{uuid}.ext` | Supplier upload, signed URL read | 1 hr |
| `cargo-media` | `cargo-media/{container_id}/{uuid}.ext` | Supplier upload, signed URL read | 1 hr |
| `swift-documents` | `swift-documents/{invoice_id}/{uuid}.ext` | Importer upload/read, Supplier read | 1 hr |
| `license-files` | `license-files/{importer_id}/{license_id}/{uuid}.ext` | Importer upload/read | 1 hr |

All buckets **private** — no public URLs. Always signed URLs.

```ts
const { data, error } = await supabase.storage
  .from("documents")
  .createSignedUrl(storagePath, 3600);
```

### Business Rules

**The 7 Required Documents (per container):**
commercial_invoice · packing_list · phytosanitary_certificate · bill_of_lading · certificate_of_origin · cooling_report · insurance_certificate

**Document status flow:**
```
missing → uploaded → under_review → approved
                                  ↘ rejected (reason required) → uploaded → under_review → ...
```

**Container status flow:**
```
documents_missing → waiting_customs_review → rejected_documents ↩
                                           ↓
                              ready_for_clearance → in_clearance → released
```

---

## 4. Frontend & UI Patterns

### Project Structure

```
Portix/
├── app/
│   ├── layout.tsx                  # Root layout (fonts, Toaster, Supabase session)
│   ├── page.tsx                    # Role selector landing page
│   ├── auth/                       # Supabase Auth flows (signup, login, callback)
│   └── (dashboard)/                # Route group (no URL segment)
│       ├── importer/               # Container Control dashboard + accounts/claims/licenses
│       ├── supplier/               # Supplier dashboard + accounts
│       └── customs-agent/          # Review queue dashboard + accounts
├── components/
│   ├── ui/                         # shadcn/ui — READ-ONLY
│   ├── claims/                     # claim-overview-block, claim-detail-page, claim-chat
│   ├── dashboard-layout.tsx        # Sidebar nav — role-aware
│   ├── container-detail-page.tsx   # Shared across all 3 roles
│   └── GlobalChatbot.tsx           # Porty floating chat UI
├── lib/
│   ├── supabase.ts                 # Supabase client + all type definitions
│   ├── utils.ts                    # cn() helper
│   └── helpers.ts                  # Date formatting, role labels
├── hooks/
│   ├── use-claim-messages.ts       # Realtime postgres_changes subscription
│   ├── use-containers.ts           # TanStack Query with caching
│   └── use-auth.ts                 # Current user + role detection
└── supabase/
    ├── migrations/                 # Immutable DDL
    └── functions/
        ├── global-copilot/         # Porty AI — Agentic RAG (see Section 2)
        ├── generate-claim-summary/ # Gemini 2.5 Flash claim summaries
        ├── extract-license-data/   # Gemini multimodal license OCR
        └── embed-document/         # Generates 768-dim embeddings for RAG chunks
```

### TanStack Query Cache Key Conventions

```ts
["containers", { role, importerId }]  // dashboard list
["container", containerId]            // detail page
["containerDocuments", containerId]   // documents only
["claims", containerId]               // all claims for container
["claim", claimId]                    // single claim + metadata
["claimMessages", claimId]            // messages thread
```

### Invalidation vs setQueryData

```ts
// Realtime INSERT → use setQueryData (no refetch, instant):
queryClient.setQueryData(
  ["claimMessages", claimId],
  (old: any) => [...(old || []), payload.new]
);

// After mutation → use invalidateQueries (triggers refetch):
queryClient.invalidateQueries({ queryKey: ["container", containerId] });
```

### Component Patterns

**Role-aware shared components** (`container-detail-page.tsx`, `claim-detail-page.tsx`):
```tsx
interface Props {
  role: "importer" | "supplier" | "customs_agent";
  containerId: string;
}
```
Always edit the shared component — never duplicate per role.

**Modal reset pattern:**
```tsx
const handleClose = () => {
  setState(defaultState);  // Reset before closing
  onClose();
};
<Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
```

**Sender display in claims chat:** Always `msg.sender?.full_name` from profile join, never role label.

### Edge Function Requirements

All Edge Functions must have:
```ts
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
// First check in serve():
if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
// Spread corsHeaders into ALL Response() calls
```

### Anti-Patterns

| ❌ Don't | ✅ Do |
|---|---|
| Use `mockData` arrays | Query `portix.*` via Supabase |
| Hardcode role strings | Query `portix.profiles.role` |
| Use `invalidateQueries` for realtime | `setQueryData` for INSERT events |
| Store secrets in `.env.local` | Supabase Vault for Edge Functions |
| Create `tailwind.config.ts` | Tailwind v4 uses `globals.css` |
| Show `sender_role` label in chat | Use `sender.full_name` from profile join |
| Reject document without reason | DB CHECK constraint + UI validation required |
| Download files without signed URL | Always signed URL, 1-hour expiry |
| Edit `components/ui/*.tsx` | shadcn/ui is read-only |
| Infer relationships from `container.status` | Use explicit FKs (e.g., `shipments.customs_agent_id`) |
| Blind `.limit(N)` on chunk relational pull | Two-pass keyword-targeted pull (see Section 2) |
| Hardcode semantic mappings (word = word) | Use Contextual Deduction via live DB lookup (see Section 2) |

### Realtime Subscription Pattern

```ts
useEffect(() => {
  const channel = supabase
    .channel(`claim-${claimId}`)
    .on("postgres_changes", {
      event: "INSERT",
      schema: "portix",
      table: "claim_messages",
      filter: `claim_id=eq.${claimId}`,
    }, (payload) => {
      queryClient.setQueryData(
        ["claimMessages", claimId],
        (old: any) => [...(old || []), payload.new]
      );
    })
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}, [claimId]);
```

### Deployment Checklist

- [ ] `npm run build` passes TypeScript
- [ ] `npm run lint` clean
- [ ] `GEMINI_API_KEY` set in Supabase Edge Function secrets
- [ ] `global-copilot` deployed: `npx supabase functions deploy global-copilot`
- [ ] `generate-claim-summary` deployed
- [ ] Migrations applied and `NOTIFY pgrst` ran
- [ ] Vault secrets set for cron job (`supabase_project_url`, `service_role_key`)

---

## 5. Error Ledger

> Log format: `[YYYY-MM-DD] Title — Root cause + fix.`

---

### [2026-05-26] Phase 2 Empty Stream (Agentic RAG)

**File:** `supabase/functions/global-copilot/index.ts`

**What happened:** Porty produced visible tool-call reasoning in logs (`textLen=199`) but the UI received empty chat bubbles.

**Root cause:** In the Phase 1 loop, when `functionCalls.length === 0` (model finished reasoning and produced final text), the code was calling `contents.push(modelTurn)` before `break`. Phase 2 (`streamGenerateContent`) then received a conversation history that already ended with the model's final answer — so Gemini emitted an empty stream (nothing new to say).

**Fix:** Remove `contents.push(modelTurn)` from the `functionCalls.length === 0` branch. Phase 2 must receive `contents` ending exactly at the last `functionResponse` (or the initial user prompt if no tools were used). This forces Phase 2 to fresh-generate and stream the answer.

```typescript
// WRONG:
if (functionCalls.length === 0) {
  contents.push(modelTurn);  // ← causes empty Phase 2 stream
  break;
}

// RIGHT:
if (functionCalls.length === 0) {
  // Do NOT push — Phase 2 regenerates from last functionResponse
  producedText = textInTurn.length > 0;
  break;
}
```

---

### [2026-05-26] Blind Relational Limit (Retrieval Truncation)

**File:** `supabase/functions/global-copilot/index.ts` → `toolSearchDocuments`

**What happened:** "What is the tare weight of SEGU9467227?" returned no data. SQL inspection confirmed chunks exist with exact values (`Tare Weight: 4,540 kgs. NETTO WEIGHT: 27500 KG`) but LLM received 60 chunks of shipping T&C boilerplate.

**Root cause:** The relational pull was `supabaseAdmin.from("document_chunks").in("container_id", containerIds).limit(60)` — no ordering, no filtering. With 150+ chunks per container, Postgres returned the first 60 in insertion order: Terms & Conditions text, page headers, footer boilerplate. The measurement chunk was insertion position 80+ and never returned.

**Fix:** Replaced blind `.limit(60)` with a two-pass hybrid pull:
- **Pass 1** (limit 40): `.or("content.ilike.%weight%,content.ilike.%tare%,...")` — keyword-filtered by `extractRelKeywords(search_query)`. Targeted chunks get `similarity: 0.01` to rank above fallback.
- **Pass 2** (fills remaining): Unfiltered fallback, capped at `60 - results.length`. Over-fetches to compensate for dedup losses.

---

### [2026-05-26] Semantic Mapping Brittle Rules

**File:** `supabase/functions/global-copilot/index.ts` → `PORTY_SYSTEM_PROMPT`

**What happened:** Hardcoded mappings in the system prompt (e.g., `"בצל סגול" → "red onion"`) created maintenance debt. Any new product term not in the hardcode list silently failed. Query for "purple onion" fell through when the actual DB `product_name` was "Red Onion" (different capitalization/spelling variant).

**Root cause:** Hardcoding specific linguistic mappings is unscalable. A logistics platform ships hundreds of commodity types across languages. Maintaining an enumerated list in a prompt is impossible.

**Fix:** Removed all hardcoded `QUERY EXPANSION` mappings from `PORTY_SYSTEM_PROMPT` and tool descriptions. Replaced with `CONTEXTUAL DEDUCTION` directive:
1. Agent calls `get_live_containers_summary` FIRST.
2. Reads actual `product` values from live DB.
3. Uses native trade/linguistic intelligence to map user's informal term to the closest DB value.
4. Only then calls `search_container_documents` with the correct canonical term observed in live data.

This is zero-maintenance and handles any language, slang, or abbreviation the model was trained on.

---

### [2026-04-XX] column containers.product does not exist

**File:** `supabase/functions/global-copilot/index.ts` → `toolGetLiveContainers`

**Root:** Query used `.select("...product...")` directly on `portix.containers`. Actual column is `product_name`; `vessel_name` lives on `portix.shipments`, not `containers`.

**Fix:** Switched to `portix.v_containers` view which pre-joins all tables. Correct column names: `product_name`, `vessel_name`, `importer_company`, `supplier_company`.

---

### [2026-04-XX] REL 1c relational chunks: 0 (RLS block on document_chunks)

**File:** `supabase/functions/global-copilot/index.ts`

**Root:** Relational chunk pull used `supabaseAnon` (user JWT). RLS on `document_chunks` blocked direct reads even for valid container owners.

**Fix:** Created `supabaseAdmin` (service role key) client. Used ONLY for chunk fetch after container ownership verified via `supabaseAnon`. Privacy preserved: `containerIds` list is already caller-scoped.

---

### [2026-03-16] Stale `.next` Build Cache — White/Unstyled Page

**Root:** Dev server running with old `.next` chunk manifest after adding new component file.
**Fix:** Stop dev server → `npm run dev`. Always restart after adding files.

---

### [2026-03-16] `useMemo` with Empty Deps Doesn't Reflect Mutations

**Root:** `useMemo(() => data.map(...), [])` — empty deps array, never re-runs after array push.
**Fix:** Use TanStack Query instead of mock arrays. For legacy patterns: `refreshKey` state as dep.

---

### [2026-03-XX] "Could not find the table 'portix.claim_documents'"

**Root:** Old component queried deprecated table name. Schema uses `claim_attachments` joined via `claim_messages`.
**Fix:** `.from("claim_attachments")` with `message_id` FK.

---

### [2026-05-26] activity_logs INSERT forgery (`WITH CHECK (true)`)

**Root:** Original `00334_add_activity_logs.sql` INSERT policy used `WITH CHECK (true)`. Any authenticated user could insert audit-log rows for containers they did not own → audit-trail poisoning, false attribution of doc rejections/approvals.
**Fix:** Migration `00344_security_and_rls_fixes.sql` drops the broad policy and replaces with container-ownership check: importer/supplier must own the target `container_id`; customs_agent must be assigned to the parent shipment (`shipments.customs_agent_id = auth.uid()`). Same JOIN logic mirrors `container_costs`.

---

### [2026-05-26] View RLS bypass — missing `security_invoker`

**Root:** `v_containers`, `v_documents_public`, `v_import_licenses` created with default `SECURITY DEFINER` semantics. Views ran with the view-owner's privileges → RLS on `containers`, `documents`, `import_licenses` was bypassed for any caller querying the view. A supplier could read importer-only rows by going through the view.
**Fix:** Migration `00344_security_and_rls_fixes.sql` recreates all three views with `WITH (security_invoker = true)`. RLS on base tables now evaluated against the calling user's identity. `CREATE OR REPLACE VIEW` used (no DROP) to avoid cascading dependency failures. Safe because `profiles` has a broad `USING (true)` SELECT policy for cross-user display.

---

### [2026-05-26] Dual-approval timestamp loop — replaced doc auto-approves

**Root:** `uploadDocumentRecord` and `resetDocumentRecord` in `lib/db.ts` did not null out `importer_approved_at` and `agent_approved_at` when a dual-approval document (`bl_draft`, `proforma_invoice`) was replaced or removed. Old timestamps persisted → DB trigger `handle_dual_approval` saw both columns still set → fresh unreviewed upload was auto-promoted to `status = 'approved'` with no human review.
**Fix:** Both update payloads now explicitly set `importer_approved_at: null` and `agent_approved_at: null` alongside the existing `status: 'uploaded'` / `'missing'` reset. Trigger now sees both NULL on re-upload → no auto-approval; document re-enters normal review flow.

---

### [2026-05-26] container_costs customs_agent over-read

**Root:** `00335_add_container_costs.sql` customs_agent SELECT policy used `USING (portix.get_user_role() = 'customs_agent')` only → agent could read landed-cost data for every container in the system, even containers on shipments assigned to other agents.
**Fix:** Migration `00344_security_and_rls_fixes.sql` tightens the policy to require `container_id IN (SELECT c.id FROM containers c JOIN shipments s ... WHERE s.customs_agent_id = auth.uid())`. Agent now sees costs only for their assigned shipments.

---

### [2026-03-XX] "Response to preflight request doesn't pass access control check"

**Root:** Edge Function missing CORS headers or OPTIONS handler.
**Fix:** Add `corsHeaders` const with `Access-Control-Allow-Origin: *`; OPTIONS handler as first check in `serve()`.

---

### [2026-03-XX] Gemini summaries truncated mid-sentence

**Root:** `maxOutputTokens: 300` too low.
**Fix:** Increase to `maxOutputTokens: 500` (claim summaries) / `2048` (global-copilot). Prompt: "Do not cut off mid-sentence."

---

### [2026-03-XX] "ALTER DATABASE: permission denied"

**Root:** Supabase project role lacks superuser privileges.
**Fix:** Use Supabase Vault: `vault.create_secret()` for secrets, `vault.decrypted_secrets` to read them.

---

### [2026-03-XX] Zod v4 breaks @hookform/resolvers

**Root:** Zod v4 `z.coerce.number()` produces `unknown` type, incompatible with Resolver.
**Fix:** Downgrade to `zod@^3.22.0`.

---

### [2026-03-XX] Nightly cron job not running

**Root:** pg_cron not enabled, or Vault secrets missing.
**Fix:** `CREATE EXTENSION IF NOT EXISTS pg_cron` (auto in Supabase). Verify `vault.decrypted_secrets` has `supabase_project_url` and `service_role_key`.

---

### [2026-03-XX] URL %20 encoding on ledger pages

**Root:** Partner company name used raw in URL path; spaces encoded as `%20`.
**Fix:** `decodeURIComponent()` on query param before use.

---

### [2026-03-XX] customs vs customs_agent dual-value role check

**Root:** Migration 00312 renamed role from `customs` to `customs_agent` but some RLS policies and code still checked old value.
**Fix:** Migration to update all `customs` references. Always use `customs_agent`.

---

_Add new entries at the top of this section._
