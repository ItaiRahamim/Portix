# CODE_REVIEW_Draft

> Review snapshot generated on 2026-04-29 from the current repository state.

## Findings

### 1. Realtime claim messages lose sender profile data on insert

**Severity:** High  
**Files:** [hooks/use-claim-messages.ts](/Users/itairahamim/Desktop/KILO/hooks/use-claim-messages.ts:33), [components/claim-detail-page.tsx](/Users/itairahamim/Desktop/KILO/components/claim-detail-page.tsx:401)

The realtime subscription appends `payload.new` directly into the `["claim-messages", claimId]` cache. That row does not include the joined `sender:profiles!sender_id(full_name)` object that the initial query returns. The chat UI then falls back to `"Supplier"` / `"Importer"` labels when `msg.sender?.full_name` is missing, so newly-arrived messages can temporarily violate the product requirement of showing real sender names until a full refetch occurs.

**Why it matters**

- realtime messages are the normal path for the chat experience
- the UI regresses from named-party chat to role-label chat
- this creates inconsistent rendering between initial load and live updates

**Suggested fix**

- enrich the inserted cache row before storing it, or
- invalidate/refetch after insert, or
- subscribe to a server-side projection that already includes sender name

### 2. External summary updates do not advance `last_summary_at`

**Severity:** High  
**Files:** [supabase/functions/update-claim-summary/index.ts](/Users/itairahamim/Desktop/KILO/supabase/functions/update-claim-summary/index.ts:72), [components/claims/claim-overview-block.tsx](/Users/itairahamim/Desktop/KILO/components/claims/claim-overview-block.tsx:15)

`update-claim-summary` writes `claim_summary` and `updated_at`, but not `last_summary_at`. The UI explicitly uses `last_summary_at` as the “Last generated” timestamp, and the bulk summary flow also uses it for change detection. Any summary written through this webhook path will therefore look stale in the UI and may be unnecessarily regenerated later.

**Why it matters**

- the review timestamp shown to users becomes incorrect
- bulk/nightly logic can no longer reliably tell whether the latest activity was already summarized
- two summary-writing paths now disagree on the source of truth

**Suggested fix**

- update `last_summary_at` in this function the same way `generate-claim-summary` does

### 3. `track-containers` is not browser-call ready

**Severity:** Medium  
**Files:** [supabase/functions/track-containers/index.ts](/Users/itairahamim/Desktop/KILO/supabase/functions/track-containers/index.ts:4)

The function only returns `Access-Control-Allow-Origin` on the `OPTIONS` response. The actual success and error responses omit CORS headers entirely. If this function is invoked from the browser, the preflight can pass and the real response can still be blocked by the browser.

**Why it matters**

- it prevents the tracking function from becoming a drop-in frontend integration
- it reinforces that carrier tracking is only scaffolding today, not a reliable shipped feature

**Suggested fix**

- define shared `corsHeaders`
- spread them into every success and error response
- ideally align the function structure with the other Edge Functions in this repo

### 4. `AGENTS.md` had stale PRD source references

**Severity:** Low  
**Files:** [AGENTS.md](/Users/itairahamim/Desktop/KILO/AGENTS.md:11)

The workflow guide referenced deleted `src/imports/*` PRD files as the source PRDs. That would send future review or implementation passes to missing files and create unnecessary confusion.

**Status**

- fixed in the current pass by pointing the guide at existing docs

## Open Questions

- Should the claims system standardize on `claim_attachments` rows, or is `claim_messages.attachments` now the intended long-term source of truth?
- Is `update-claim-summary` still part of the intended production flow, or is `generate-claim-summary` the only supported path now?
- Is the normalized `companies` / `transactions` model still the target architecture, or should the product docs formally describe `account_transactions` as the live ledger model?

## Residual Risks

- I did not run `npm run build`, `npm run lint`, or live Supabase integration tests in this pass.
- This is a static code review, so RLS behavior and Edge Function behavior were assessed from code and migrations, not from executing against a live project.
