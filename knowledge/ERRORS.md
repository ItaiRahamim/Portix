# ERRORS.md — KILO Project

> Log bugs here as they're discovered. Each entry: what happened, why, how it was fixed.
> Deterministic errors → conclude immediately. Infrastructure errors → log and watch for patterns.

---

## [2026-03-16] Stale `.next` Build Cache — White/Unstyled Page

**What happened:**
After adding `new-shipment-modal.tsx`, the preview server showed a completely unstyled page (no CSS, plain HTML). The browser error was `Cannot find module './61.js'`.

**Why:**
The dev server was still running with the old `.next` chunk manifest. When a new component file is added, webpack generates new chunk IDs. The running server had cached the old chunk map and couldn't resolve the new one.

**Fix:**
Stop the dev server → restart with `npm run dev`. The server recompiles cleanly.

**Rule added to CLAUDE.md:**
> Always restart the dev server after adding new component files. Stale `.next` cache causes `MODULE_NOT_FOUND` chunk errors.

---

## [2026-03-16] `useMemo` with Empty Deps — Doesn't Reflect Mutations

**What happened:**
After calling `mockContainers.push(newContainer)` in the new-shipment modal, the importer dashboard table didn't show the new row. The data appeared stale.

**Why:**
`enrichedContainers` was memoized with `[]` as dependencies:
```ts
const enrichedContainers = useMemo(() => mockContainers.map(...), []);
```
React caches the result and never re-runs the function because no reactive dependency changed — even though the underlying array mutated.

**Fix:**
Add a `refreshKey` state and include it as a dependency:
```ts
const [refreshKey, setRefreshKey] = useState(0);
const enrichedContainers = useMemo(() => mockContainers.map(...), [refreshKey]);
// After mutation:
setRefreshKey(k => k + 1);
```

**Rule added to CLAUDE.md:**
> Mutating mock arrays does not trigger React re-renders. Always use a `refreshKey` pattern when the UI needs to reflect a push.

---

_Add new entries above this line._
