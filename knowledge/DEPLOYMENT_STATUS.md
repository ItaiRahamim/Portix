# Portix Deployment Status & Next Steps

**Last Updated:** 2026-04-19  
**Status:** Web MVP ready for testing · Phase 2 (Tauri) not started

---

## Phase 1: Web MVP (✅ COMPLETE)

### ✅ Infrastructure
- [x] Supabase PostgreSQL project created
- [x] PostgreSQL schema (17 tables, portix namespace, RLS, triggers) deployed
- [x] Supabase Auth (email/password) configured
- [x] Role-based access control (RLS policies) implemented
- [x] 4 storage buckets (documents, cargo-media, swift-documents, license-files) created
- [x] Supabase Vault for encrypted secrets
- [x] pg_cron extension enabled

### ✅ Backend (Edge Functions)
- [x] `generate-claim-summary` Edge Function created (Deno runtime)
  - Calls Google Gemini 2.5 Flash API
  - Change detection (compares last_summary_at vs latest message)
  - CORS headers + OPTIONS preflight handler
  - maxOutputTokens: 500 (prevents truncation)
- [x] Daily cron job scheduled (pg_cron, 23:00 UTC)
  - Uses Supabase Vault for secrets
  - Calls Edge Function via pg_net HTTP POST
- [x] All migrations applied (00001–00316)

### ✅ Frontend (Next.js 15 App Router)
- [x] Portix branding (logo, color scheme)
- [x] Supabase Auth flow (signup, login, role selector)
- [x] Role-based dashboards (importer, supplier, customs_agent)
- [x] Container lifecycle UI (CRUD, status management)
- [x] Document management UI (upload, approve, reject)
- [x] Claims module (threaded chat, file attachments, AI summaries)
- [x] TanStack Query v5 (caching, cache invalidation)
- [x] Realtime message delivery (postgres_changes subscription)
- [x] Signed URL file downloads (1-hour expiry)

### ✅ Code Quality
- [x] TypeScript strict mode (all types defined)
- [x] ESLint passing
- [x] Build passing (`npm run build`)
- [x] Components well-structured (shared, role-aware)

---

## Critical Files Deployed

| File | Status | Purpose |
|---|---|---|
| `supabase/migrations/00001_initial_schema.sql` | ✅ Applied | Core schema (containers, documents, etc.) |
| `supabase/migrations/00314_add_claims_and_messages.sql` | ✅ Applied | Claims module tables |
| `supabase/migrations/00315_fix_claim_messages_schema.sql` | ✅ Applied | sender_role column + schema fixes |
| `supabase/migrations/00316_setup_daily_ai_summary.sql` | ✅ Applied | Cron job + Vault setup |
| `supabase/functions/generate-claim-summary/index.ts` | ✅ Deployed | Deno function, Gemini API |
| `lib/supabase.ts` | ✅ Done | Type defs + client factory |
| `components/claim-detail-page.tsx` | ✅ Done | Claim thread UI (role-aware) |
| `components/claims/claim-overview-block.tsx` | ✅ Done | AI summary + "Generate Now" button |
| `hooks/use-claim-messages.ts` | ✅ Done | Realtime subscription + cache push |
| `.env.local` | ⚠️ TODO | Must populate from Supabase dashboard |

---

## Pre-Launch Verification Checklist

### Database & RLS (Critical)
- [ ] **Test importer user** can view own containers, cannot view supplier's
- [ ] **Test supplier user** can view own containers, upload documents, upload attachments
- [ ] **Test customs_agent user** can view only containers in `waiting_customs_review` status
- [ ] **Test customs_agent** cannot read invoices, licenses, or claims (RLS blocks)
- [ ] Document rejection without reason fails (CHECK constraint enforces)
- [ ] Container auto-advances to `ready_for_clearance` when all 7 docs approved (trigger fires)

### Claims Module (Most Complex)
- [ ] Importer can create a claim
- [ ] Importer can send message in claim thread
- [ ] Importer can upload file attachment (image/PDF/document)
- [ ] Supplier receives message in realtime (no page refresh needed)
- [ ] Supplier can reply and upload attachment
- [ ] File preview works: images in lightbox, PDFs in new tab
- [ ] "Generate Summary Now" button works (click → toast shows status)
- [ ] Summary appears in AI overview block (refreshes after generation)
- [ ] Summary text is complete sentences (not truncated mid-sentence)
- [ ] Sender names display as real names, not role labels

### Edge Function & Cron Job
- [ ] GEMINI_API_KEY set in Supabase Edge Function secrets
- [ ] Manual Edge Function call succeeds: `supabase.functions.invoke("generate-claim-summary", { body: { claim_id: "..." } })`
- [ ] Nightly cron job ran (check Supabase logs for 23:00 UTC execution)
- [ ] Cron job successfully processed at least one claim
- [ ] Summaries auto-refresh nightly without manual intervention

### Authentication & Session
- [ ] User can sign up → auth.users row created → profiles row auto-created
- [ ] User can log in → session persists across page refresh
- [ ] User can switch roles → dashboard updates to correct role
- [ ] User can log out → session cleared, redirect to login

### UI/UX
- [ ] Logo displays correctly in header and login page
- [ ] Responsive design works on tablet (768x1024) and mobile (375x812)
- [ ] Dark mode not needed (light mode only)
- [ ] All toasts fire correctly (success/error messages)
- [ ] No console errors in browser DevTools

### Build & Deployment
- [ ] `npm run build` passes (no TypeScript errors)
- [ ] `npm run lint` passes (no ESLint errors)
- [ ] `.env.local` populated with Supabase credentials
- [ ] No hardcoded secrets in code or environment
- [ ] Edge Function deployment succeeds: `npx supabase functions deploy generate-claim-summary --no-verify-jwt`

---

## Known Issues & Workarounds

### Issue 1: "Response to preflight request doesn't pass access control check"
**Root:** Edge Function CORS headers not set or OPTIONS handler missing  
**Status:** ✅ Fixed (see supabase/functions/generate-claim-summary/index.ts)  
**Verification:** Manual function call should return 200, not 403

### Issue 2: "Could not find the table 'portix.claim_documents'"
**Root:** Migration 00314 created claim_documents but actual schema uses claim_attachments  
**Status:** ✅ Fixed (migration 00315 reconciled schema)  
**Verification:** Query `SELECT * FROM portix.claim_attachments` should return rows

### Issue 3: "Gemini summaries truncated mid-sentence"
**Root:** maxOutputTokens: 300 insufficient  
**Status:** ✅ Fixed (increased to 500)  
**Verification:** Generated summaries should be 2-3 complete sentences

### Issue 4: "ALTER DATABASE: permission denied"
**Root:** Supabase project role lacks superuser privileges  
**Status:** ✅ Fixed (switched to Supabase Vault)  
**Verification:** Check migration 00316 creates vault secrets correctly

### Issue 5: Logo rendering at full screen width
**Root:** Next.js Image component doesn't constrain with width={0}; inline style overrides Tailwind  
**Status:** ✅ Fixed (switched to `<img>` tag, className-driven sizing)  
**Verification:** Logo in header should be h-8 (not full screen)

---

## Environment Setup (Must Do Before Testing)

### 1. Create `.env.local` File
```bash
cp .env.local.example .env.local
```

Then populate:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
```

Get these from: Supabase Dashboard → Settings → API Keys → Project URL & anon key

### 2. Set Edge Function Secret
In Supabase Dashboard → Edge Functions → generate-claim-summary → Secrets:
```
GEMINI_API_KEY=AIzaSyD...
```

Get this from: Google Cloud Console → APIs & Services → Credentials → API Key (Gemini API)

### 3. Verify Migrations Applied
```bash
npx supabase migration list
# Should show: 00001, 00002, 00003, 00004, 00314, 00315, 00316
```

### 4. Verify Function Deployed
```bash
npx supabase functions list
# Should show: generate-claim-summary ✓
```

### 5. Start Dev Server
```bash
npm run dev
# Visit http://localhost:3000
```

---

## Phase 2: Tauri Desktop App (NOT STARTED)

Estimated scope:
- [ ] Set up `src-tauri/` directory with Rust backend
- [ ] Implement IPC between Next.js and Rust for file operations
- [ ] Add offline mode with local SQLite + sync queue
- [ ] Native window management (custom titlebar, system tray)
- [ ] Auto-update system

Expected timeline: **Post web MVP stabilization**

---

## Immediate Next Steps (Before Declaring "Done")

1. **Populate `.env.local`** with Supabase credentials
2. **Set Edge Function secret** (GEMINI_API_KEY)
3. **Run full verification checklist** above (especially claims module and RLS)
4. **Document any blockers** in `knowledge/ERRORS.md`
5. **Test with real users** (importer, supplier, customs_agent roles)
6. **Monitor Supabase logs** for errors after first nightly cron run (23:00 UTC)
7. **Gather feedback** on UX and business logic

---

## Rollback Procedures (If Needed)

### Rollback a Migration
```bash
# Check which migrations are applied
npx supabase migration list

# If migration has errors, create a new migration to FIX it
# Never edit an applied migration!
npx supabase migration new "fix_<problem>"

# Apply the new migration
npx supabase migration up
```

### Rollback Edge Function
```bash
# Remove the current function
npx supabase functions delete generate-claim-summary

# Or redeploy an older version (if you have version control)
npx supabase functions deploy generate-claim-summary --no-verify-jwt
```

### Rollback Database (Full Nuke)
```bash
# WARNING: This deletes all data!
# Only do this in development
supabase db reset
```

---

## Contact / Questions

If you encounter issues:
1. Check `knowledge/ERRORS.md` for known issues
2. Reference `knowledge/CONTEXT_RULES.md` for decision tree
3. Read relevant section in `CLAUDE.md` (section numbers in error messages)
4. Check Supabase dashboard logs (Realtime, Edge Functions, SQL)
5. Search browser DevTools console for runtime errors

