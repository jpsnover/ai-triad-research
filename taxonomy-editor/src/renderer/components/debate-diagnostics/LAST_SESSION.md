**Date:** 2026-07-28
**Working on:** t/1849 — reduce `local/no-inline-style` ESLint warnings 25% (parent role: Taxonomy Editor). Took the debate-diagnostics portion (biggest lever, ~1,600 warnings) at parent's request (p/102).
**Status:** Complete. Landed on origin/main via worktree, SHA `90817076` (8 files: 4 tsx migrated + 4 new co-located CSS). My contribution: **−639 warnings** (project-wide 3684 → 3045).
**Key context:**
- Migrated the top 4 offenders, all → 0 inline-style warnings: DraftTab (223), OverviewTabRouter (142), EntryView (128), OverviewView (123). Static `style={{}}` hoisted verbatim into co-located `<Component>.css` (values incl. `var(--*)`/`color-mix` preserved exactly → no theme change; styles.css untouched — frozen). 93 genuinely-dynamic styles kept inline with justified `eslint-disable-next-line local/no-inline-style -- reason`.
- Delegated per-file migration to 4 parallel general-purpose subagents (one per file, distinct files = no conflict), then verified centrally: rigorous stash-based before/after (3684→3045, delta 639 fully attributable to my 4 files), full `npm run verify`.
- **Verify:** tsc main+server, eslint, depcruise, vite build all green. The ONE vitest failure (`configInvariant.test.ts` — dangling ai-models.json model refs: gemini-2.5-*/gemini-3.1-flash-lite) is **pre-existing on origin/main** (proven by re-running it with my changes stashed) — DebateTool/model-config scope, causally unrelated to a CSS-only change.
- Pre-existing latent bug observed & preserved verbatim (not fixed — would be a visual change): `DraftTab` had `borderLeft: '2px solid var(--danger)44'` (invalid `var()+hex-alpha` → renders no border). Fileable separately.
- Combined with parent's landed −350 (674b8d63), total −989 clears the −918 the 25% target needs (3671 → ≤2753). Parent aggregates on t/1849 (their tracker).
- Remaining debate-diagnostics headroom if more needed: EvidenceTab (101) + long tail (~860 more across the scope).
**Next:** Re-check queue (drain-until-budget). t/1849 stays In Progress on the parent as the single tracker.
