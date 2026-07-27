**Date:** 2026-07-27
**Working on:** t/1717 — fact-check diagnostics: `partially_accurate` must not fold into a clean pass (parent t/1701; consumes FactVerdict from t/1715).
**Status:** Complete. Marked Done. Landed on origin/main via worktree, SHA `0137cc57` (4 files, +177/-2). Full `npm run verify` green.
**Key context:**
- Worked in isolated worktree off origin/main (`../wt-t1717`) because the FactVerdict types (t/1715, 43dbb301) only exist on origin/main and my shared local HEAD is badly diverged (135/183). Double `npm ci` (root + taxonomy-editor). Rebased onto advancing origin/main (all CL docs commits, zero overlap), ff-pushed.
- Change: VerdictChip gained a 4th `caveat` bin (distinct warm color, NOT green/pass). `mapFactCheckVerdict`: `partially_accurate → caveat`; VERDICT_ORDER gains it between supported/disputed. Parse `discrepancy` from fact-check metadata defensively (needs claimed+actual+source + valid dimension/severity); surface severity via MAJOR/MINOR tag in row header + full discrepancy block in expanded detail.
- **Cross-scope gap (flagged on ticket):** fact-check WRITE sites (`synthesisSlice.ts`, `argumentNetwork.ts` — DebateWorkspace scope) don't emit `discrepancy` into transcript metadata yet, so the severity UI is forward-compatible (lights up once they do). Also t/1715#1 flagged adopting `validateFactCheckResult` at the renderer parse site (`synthesisSlice.ts` — DebateWorkspace) — not my scope.
- FactDiscrepancy type imported from `@lib/debate/types` (never redefined locally). VerificationSection.tsx on origin/main already had the t/1798 `verified→supported` migration; my change is additive on top.
**Next:** Re-check queue (drain-until-budget). Sibling t/1716 (DebateWorkspace StatementCard) is the parallel display follow-up.
