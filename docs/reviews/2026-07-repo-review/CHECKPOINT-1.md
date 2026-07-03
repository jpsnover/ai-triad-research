# Phase 1 Checkpoint — Velocity Indicators Re-measurement

**Date:** 2026-07-03 · **Baseline:** 2026-07-02 (FINDINGS.md / EXECUTION-NOTES.md) · **Main:** `47f6bdda` (CI: all 6 checks green)

## Quantitative indicators

| Indicator | Baseline | Target | Measured | Verdict |
|---|---|---|---|---|
| Orientation trace: steps | 12 | ≤6 | **11** | Partial |
| — doc-led-correctly | 4/12 | — | **6/11** | Improved |
| — misled | 2 | 0 | **1** | Improved |
| — dead-end | 2 | 0 | **2** (REPO_MAP now honestly self-disclaims; a Glob tool quirk) | Neutral-improved in kind |
| — omitted (raw-grep fallback) | 5 | — | **3** | Improved |
| — outcome quality | incomplete surface | — | **complete, correct 10-file touch list incl. all 4 display surfaces** | Materially better |
| REPO_MAP coverage | 144 files, silent truncation | full, no marker | **368 lines, 59 dirs, 0 truncation, explicit coverage header** | ✅ Met |
| On-disk weight (excl. node_modules/.git) | ~800 MB | ≤250 MB | **437 MB** | Partial (see below) |
| Tracked file count | 2,203 | ~1,950 | **2,203** | Pending t/1289 |
| Tracked size (`git ls-files`) | ~309 MB | <60 MB | **309 MB** | Pending t/1289 |
| Git pack size | 200 MB (103.7 MB primary pack) | — | 103.7 MB unchanged | Expected — no history rewrite (deliberate) |
| CI on main | red (test-powershell) | green | **green** (t/1287, `47f6bdda`) | ✅ Met |

## Interpretation

1. **The remaining weight is one delegated ticket.** On-disk 437 MB and tracked 309 MB are both dominated by `research/comp-linguist` (~250 MB tracked model/corpora/results) — that is t/1289, assigned to Computational Linguist and not yet landed. When it lands, tracked size drops to ~60 MB and on-disk to ~190 MB, beating both targets. No new mechanism needed; re-measure after t/1289.
2. **The orientation trace improved in *correctness* more than in *length*.** The re-run agent produced a complete and accurate propagation surface (10 files across 4 apps/layers — the baseline agent's list was incomplete), with misleads halved and raw-grep fallbacks down 5→3. Total lines read went *up* (~1,850 vs ~1,300) because the agent read the 627-line cmdlet in full — which is legitimate task work, not orientation waste.
3. **Discoverability gap found in the fix itself:** the re-run agent never used the new "POV Summary Propagation Map" / "Schemas of Record" sections added to AGENTS.md in B-107 — it re-derived those answers by grep and was still briefly misled by README's `taxonomy/schemas/` pointer. The content is right but placed too deep in the document (below Test Tiers). **Action: hoist a one-line pointer to "Key Pipelines / Schemas of Record" into the top Architecture section of AGENTS.md** (small follow-up, folded into normal doc upkeep — the sections themselves are correct).
4. **REPO_MAP is fixed in both precision and honesty**, and CI is green.

## Gate decision

**Phase 2 may proceed.** The two indicators still at baseline (tracked count/size) have a single, in-flight owner (t/1289) and don't block Phase 2's tracks (shared-metadata consolidation, server route extraction, config docs). Per EXECUTION-NOTES: start with the two decision items — **B-206** (app-consolidation HLD) and **B-213** (prompt-system ADR) — both requiring owner sign-off; and land **B-408** (growth-arrest CI gates) before any monolith surgery.

Re-measure tracked size + file count after t/1289 lands and append the numbers here.
