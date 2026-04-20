# Context Rules for Portix Development

> **Critical context for all future Claude sessions.**
> Reference this document when spinning up a new conversation to avoid repeating mistakes.

---

## 1. Architecture Map: Critical Files & Their Roles

### Supabase Configuration
- **`supabase/migrations/`** — Immutable DDL. Every schema change = new migration. Never edit applied migrations.
  - `00001_initial_schema.sql` — Core tables (profiles, containers, documents, shipments)
  - `00314_00316_*` — Claims module additions (claim_messages, claim_attachments, AI summary cron)
- **`supabase/functions/generate-claim-summary/index.ts`** — Deno runtime, Gemini API, CORS headers required
- **`.env.local`** — Must contain `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### Data Layer
- **`lib/supabase.ts`** — Type definitions + Supabase client factory (replaces old `lib/db.ts`)
  - All interfaces (Claim, Container, ClaimMessage, ChatAttachment) live here
  - getClaimMessages() includes profile join for sender.full_name
  - getClaimDocuments() queries claim_attachments, not claim_documents
- **NO `lib/mock-data.ts`** — Portix uses live DB, not mock arrays. Ignore KILO-era patterns.

### Claims Module (Most Complex)
- **`components/claim-detail-page.tsx`** — Shared by all roles, renders claim thread + attachments
  - msg.sender_role must be "importer" or "supplier" (enum validation)
  - Display `msg.sender?.full_name`, not role labels
  - handleSend() must pass role as senderRole parameter
- **`components/claims/claim-overview-block.tsx`** — AI summary block with "Generate Now" button
  - Calls `supabase.functions.invoke("generate-claim-summary", { body: { claim_id: claimId } })`
  - Invalidates query cache on success to pull fresh summary
  - Must handle CORS errors gracefully (check function deployment)
- **`components/claims/claim-documents-panel.tsx`** — Read-only attachment viewer
  - Groups attachments by media_type (image/video/document)
  - NO upload UI — files only come from chat (claim-chat.tsx)
- **`components/claims/document-upload-zone.tsx`** — Signed URL preview + download
  - resolveUrl() generates 1-hour signed URLs from "documents" bucket
  - Lightbox for images, window.open() for PDFs
- **`hooks/use-claim-messages.ts`** — Realtime subscription using postgres_changes
  - Listens for INSERT on claim_messages, pushes directly to TanStack Query cache (no refetch)
  - Must call `queryClient.setQueryData()`, not `invalidateQueries()`

### TanStack Query Integration
- **Cache keys** — Standardized pattern: `["claim", claimId]`, `["claimMessages", claimId]`, `["container", containerId]`
- **Realtime updates** — Use `setQueryData()` for instant UI updates, `invalidateQueries()` only for large refetches
- **Query dependencies** — Claim messages depend on Realtime subscription; claims depend on manual refresh or nightly cron

---

## 2. Schema Patterns You'll See Repeatedly

### Role Detection
```ts
// WRONG: Assume user_metadata.role exists
const role = session.user.user_metadata?.role;

// RIGHT: Query portix.profiles
const { data: profile } = await supabase
  .from("profiles")
  .select("role")
  .eq("id", userId)
  .single();
```

### Signed URL Pattern
```ts
// ALWAYS use 3600 (1 hour) expiry for temporary access
const { data, error } = await supabase.storage
  .from("documents")
  .createSignedUrl(storagePath, 3600);
```

### Message Identity in Claims
```ts
// WRONG: msg.sender_role to display name
// RIGHT: msg.sender?.full_name from profile join

const senderName = msg.sender?.full_name ?? "Unknown";
const isSupplier = msg.sender_role === "supplier";
```

### Attachment Lifecycle
```
1. File uploaded to supabase.storage.from("documents").upload()
2. Row inserted to claim_attachments with storage_path
3. claim_messages.attachments JSONB field updated (or left null if manually joined)
4. UI calls resolveUrl() to get signed URL for preview/download
```

---

## 3. Pitfalls That Have Broken Things Before

### Migration Mistakes
❌ **Editing an applied migration** — Causes schema desync  
✅ Create a **new migration** to fix issues

❌ **Missing `IF NOT EXISTS` clauses** — Fails on reapplication  
✅ Use `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`

❌ **Forgetting `NOTIFY pgrst, 'reload schema'`** — PostgREST cache stale  
✅ Always include NOTIFY after schema changes

### Query Mistakes
❌ **`.select("*")` on table with many JOINs** — PostgREST returns NULL for unjoined columns  
✅ Use explicit `.select("id, claim_id, ..., sender:profiles!sender_id(full_name)")`

❌ **No `@single()` on single-row queries** — Returns array, not object  
✅ Always `.eq(...).single()` for expected 1-row results

❌ **Trusting client-side role** — RLS will reject unauthorized reads anyway  
✅ RLS enforces permissions server-side; UI can assume role is correct after auth

### Component Mistakes
❌ **Storing `last_summary_at` in local state** — Goes stale on manual refresh  
✅ Always refetch from database after AI generation

❌ **Using `attachments` array directly without Realtime** — Messages appear stale  
✅ Hook into postgres_changes INSERT event, push to TanStack cache

❌ **Showing sender role label ("supplier") instead of name** — Poor UX  
✅ Always profile-join to get `.full_name`

### CORS Mistakes (Edge Functions)
❌ **Missing `if (req.method === 'OPTIONS') return ...`** — Preflight requests fail  
✅ Add CORS handler as **first check** in serve() block

❌ **Forgetting `Access-Control-Allow-Headers: authorization`** — Bearer token stripped  
✅ Always include full header list in corsHeaders const

❌ **Not spreading corsHeaders into Response** — Only first request gets CORS headers  
✅ Spread into **all** Response() constructor calls

---

## 4. Testing Checklist Before Marking "Done"

### Claims Module (Most Fragile)
- [ ] Importer can view claim thread, send message, attach file
- [ ] Supplier can view claim thread, send message, attach file
- [ ] Customs agent CANNOT access claims (RLS blocks read)
- [ ] File preview works: images in lightbox, PDFs in new tab
- [ ] Manual "Generate Now" button works, toast shows status
- [ ] Nightly cron ran successfully (check Supabase logs at 23:00 UTC)
- [ ] Summary text is complete sentences (not truncated mid-word)
- [ ] Sender names display correctly (not role labels)
- [ ] Realtime message delivery works (no page refresh needed)

### Database & RLS
- [ ] Create test importer, supplier, customs_agent users
- [ ] Importer can only read own containers (RLS enforces)
- [ ] Supplier can only read own containers (RLS enforces)
- [ ] Customs agent can only read containers in `waiting_customs_review` status
- [ ] Customs agent cannot read invoices or claims (RLS blocks)
- [ ] Document rejection without reason fails (CHECK constraint)
- [ ] Container auto-advances to ready_for_clearance when all docs approved (trigger fires)

### Deployment
- [ ] `npm run build` passes TypeScript check
- [ ] `npm run lint` has no errors
- [ ] Environment variables set in Supabase dashboard: GEMINI_API_KEY
- [ ] Edge Function deployed: `npx supabase functions deploy generate-claim-summary --no-verify-jwt`
- [ ] Function can be invoked from browser (test manual button)
- [ ] Cron job enabled in Supabase: SELECT cron.schedule(...)

---

## 5. Decision Tree: "Which File Do I Edit?"

**"I need to display a claim"**  
→ Edit `components/claim-detail-page.tsx` (shared, role-aware)

**"I need to add a field to the claim thread"**  
→ (1) Add column to `portix.claim_messages` via migration, (2) Update `ClaimMessage` type in `lib/supabase.ts`, (3) Update `.select()` in query, (4) Update UI component

**"Gimme summary isn't generating"**  
→ (1) Check `supabase/functions/generate-claim-summary/index.ts` for Deno syntax, (2) Check GEMINI_API_KEY is set in Edge Function secrets, (3) Check CORS headers, (4) Check Supabase logs for runtime errors

**"Realtime messages not appearing"**  
→ (1) Check Realtime subscription in `hooks/use-claim-messages.ts` is listening for INSERT, (2) Verify `queryClient.setQueryData()` is called (not invalidateQueries), (3) Check postgres_changes table/column filters

**"Sender name showing as 'undefined'"**  
→ (1) Verify message query includes profile join: `.select("..., sender:profiles!sender_id(full_name)")`, (2) Check msg.sender exists before calling `.full_name`

**"File download doesn't work"**  
→ (1) Check storagePath is correct (should be `documents/{claimId}/...`), (2) Verify signed URL endpoint is reachable, (3) Check bucket name is "documents" not "docs", (4) Verify auth.user has permission (PostgREST RLS)

---

## 6. Environment & Secrets Checklist

### `.env.local` (Frontend)
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
```

### Supabase Dashboard → Edge Function Secrets
```
GEMINI_API_KEY=AIzaSyD...  (Google Cloud console)
```

### Supabase Vault (for Cron Job)
```sql
-- Function portix.run_daily_claim_summaries() reads:
vault.decrypted_secrets WHERE name = 'supabase_project_url'
vault.decrypted_secrets WHERE name = 'service_role_key'
```

---

## 7. Deployment Workflow

### Local Testing
```bash
# Start dev server
npm run dev

# Test Edge Function locally (uses local JWT token)
curl -X POST http://localhost:54321/functions/v1/generate-claim-summary \
  -H "Authorization: Bearer $(supabase auth admin create-user --email test@test.com --password password)" \
  -d '{"claim_id": "..."}'
```

### Deploying to Staging/Prod
```bash
# Create migration (tested locally first!)
npx supabase migration new <description>
npx supabase migration up

# Deploy Edge Function
npx supabase functions deploy generate-claim-summary --no-verify-jwt

# Set secrets if needed
npx supabase secrets set GEMINI_API_KEY=AIzaSyD...

# Verify in Supabase dashboard
# → Edge Functions → Logs tab → should show successful invocations
```

---

## 8. Git & Commit Hygiene

### What Goes in Each Commit

✅ **Migration + Feature**
```
Commit: "Add claims module with AI summaries"
- supabase/migrations/00314_*
- components/claims/*
- lib/supabase.ts (type updates)
- hooks/use-claim-messages.ts (realtime)
```

✅ **Just a Migration Fix**
```
Commit: "Fix claim_messages schema: add sender_role column"
- supabase/migrations/00315_*
```

❌ **Don't commit .env.local or secrets** — Use `.env.local.example` instead

### Testing Before Commit
```bash
npm run build  # Must pass TypeScript
npm run lint   # Must pass ESLint
```

---

## 9. When You're Stuck

### "I don't know where this field comes from"
1. Check the Supabase schema diagram (Dashboard → SQL Editor)
2. Look for table joins in `lib/supabase.ts` type definitions
3. Search component files for `.select("..., FK_name:table_name!...")` patterns

### "The error says column doesn't exist"
1. Check migration has been applied: `npx supabase db lint`
2. If migration is new, run: `npx supabase migration up`
3. If already applied, create a new migration to add it

### "RLS is blocking my read"
1. Check user's role: `SELECT role FROM portix.profiles WHERE id = auth.uid()`
2. Check RLS policy for that table/role combination in CLAUDE.md section 3
3. Try querying as admin (via dashboard) to confirm data exists
4. Policy might be too restrictive — create new policy or update conditions

### "Realtime isn't firing"
1. Check Supabase Realtime is enabled (Dashboard → Realtime)
2. Check your subscription filter matches inserted row (use Dashboard → SQL to INSERT row and watch logs)
3. Make sure `queryClient.setQueryData()` is in the callback, not just logging
4. Realtime has latency; if nothing happens in 5s, check browser console for errors

---

## 10. Communication Protocol for Next Sessions

When starting a new session, always:
1. **State your goal clearly** — "I need to implement X feature" not "help me with Portix"
2. **Describe what you've tried** — Avoids repeating dead ends
3. **Show exact error messages** — Not paraphrased versions
4. **Reference CLAUDE.md** — "According to section X, the pattern is..."
5. **Ask for specific patterns** — "How should I structure the TanStack Query hook?" not "help me code"

This repo has a lot of context; help me help you by being explicit.

