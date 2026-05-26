# CLAUDE.md — Portix Project Entry Point

> **Full context lives in `PORTIX_MASTER.md` (project root).**
> Read that file before any complex task. This file exists solely because Claude Code auto-reads `CLAUDE.md` on session start.

---

## First-Session Checklist

1. Read `/PORTIX_MASTER.md` — schema, RLS, AI architecture, error ledger.
2. Project name is **Portix** exclusively. "KILO" is deprecated — never use it.
3. All DB tables live in the `portix` schema. Never create tables without `portix.` prefix.
4. Migrations are immutable. Fix errors in a new migration, never edit applied ones.

## Critical Quick-Reference

| Rule | Detail |
|---|---|
| Operational unit | **Container** — not shipment. Never show a shipments table. |
| Role detection | Query `portix.profiles.role`. Never hardcode or assume `user_metadata`. |
| File downloads | Always signed URLs (1-hour expiry). No public bucket URLs. |
| Edge Functions | Must have CORS `corsHeaders` + OPTIONS handler as first check. |
| Tailwind v4 | Config in `app/globals.css @theme {}`. Never create `tailwind.config.ts`. |
| Global Copilot | Two-phase Gemini (Phase 1 tool calls, Phase 2 stream). Phase 1 MUST NOT push final model turn into `contents`. See `PORTIX_MASTER.md §2`. |
| Chunk retrieval | Two-pass relational pull (keyword ilike first, fallback second). Never blind `.limit(N)`. See `PORTIX_MASTER.md §2`. |
| Semantic mapping | Zero hardcoded word=word rules. Agent uses Contextual Deduction via live DB. See `PORTIX_MASTER.md §2`. |

## Key Files

```
PORTIX_MASTER.md                             ← FULL project context (read this)
supabase/functions/global-copilot/index.ts   ← Porty AI copilot (Agentic RAG)
supabase/functions/generate-claim-summary/   ← Claims AI summaries
lib/supabase.ts                              ← All type definitions + Supabase client
app/(dashboard)/                             ← Role-based dashboards
components/container-detail-page.tsx         ← Shared container detail (role-aware)
```
