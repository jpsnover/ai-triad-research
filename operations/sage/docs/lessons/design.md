# Design Patterns

Failure patterns related to architectural decisions and design assumptions.

---

## [Design] Fast Paths Must Handle Edge-Case Inputs

**Pattern:** Optimization fast paths bypass logic that handles special-case inputs, causing incorrect results when those inputs hit the fast path instead of the general path.

**Instances:**
- 2026-05-22 — Debate engine: all-concession turns fell through to full-network evaluation instead of resolving with delta 0, and the single-claim fast path in `evaluateLookaheadPerClaim` skipped concession detection entirely. Fixed by adding an all-concession branch in `evaluateLookahead` and an `isConcessionClaim` check before the single-claim fast path (t/58, p/5#3).

**Root Cause:** Fast paths were designed for the common case (regular claims) and didn't account for special-case inputs (concessions). When special inputs hit the fast path, they skipped the detection logic that only existed in the general path.

**Prevention:**
1. When adding fast paths or short-circuit logic, enumerate all input categories and verify each is handled — not just the common case.
2. Place special-case checks (concessions, empty inputs, sentinel values) *before* fast paths, so they resolve before the fast path has a chance to mishandle them.
3. Tests should cover edge-case inputs through every code path, including fast paths.

**Status:** Active

**Applies To:** All agents working on the debate engine or adding optimization fast paths to existing logic.

---

## [Design] Score-Zeroing Is Not Removal — an Excluded Item Resurfaces When a Downstream Selector Ignores the Threshold

**Pattern:** Excluding a candidate by **setting its score to 0** (a soft/marker exclusion) is NOT equivalent to **removing it from the candidate set** — unless *every* downstream selector honors the exclusion threshold. If any later stage selects by **rank / top-N / quota refill / diversity floor** rather than by "score > floor," it picks the zeroed item anyway and the exclusion silently leaks. The item you thought you excluded re-enters the result.

**Instances:**
- 2026-07-29 — DebateTool (t/1981, fixed f1b09440, p/234#3): `hardExclude` set excluded nodes to score 0 but left them in the `candidateNodes` array. Two downstream selectors — `minPerCategory` refill and the POV-diversity floor — both pick by **top-score regardless of threshold**, so the score-0 excluded nodes **re-entered** selection. Fix: filter the excluded IDs OUT of `candidateNodes` before grouping and before the diversity-floor scan (remove, don't just zero).

**Root Cause:** Score-zeroing encodes exclusion as a *value* that only stages comparing against a floor will respect. Stages that rank-and-take (top-N, per-category quotas, a diversity floor that grabs the best available) read the item as merely low-scored, not excluded — so they resurface it. The exclusion invariant ("this node must not appear") is enforced at ONE site (the score) but assumed at ALL sites (selection); the mismatch is a silent correctness bug. General rule: an exclusion expressed by mutating a rank-signal is only as strong as the weakest downstream consumer's respect for that signal.

**Prevention:**
1. **Exclude by REMOVAL from the working set, not by zeroing a score** — filter excluded IDs out of the candidate array before any grouping/refill/diversity pass. Removal can't be bypassed by a rank-based selector.
2. **If you must keep excluded items in the array** (e.g. for logging/telemetry), carry an explicit `excluded` flag and make EVERY selector skip it — audit each selection site (top-N, quota refill, diversity floor) to confirm it honors the flag, not just the primary threshold.
3. **When adding a new selection stage, ask what "excluded" means to it** — a stage that picks "best available" ignores a score floor, so treat score-zeroing as advisory and removal as authoritative.

**Status:** Active — exclusion-by-marking ≠ exclusion-by-removal; a soft-exclusion signal leaks through any rank/quota/diversity selector that ignores the threshold.

**Applies To:** All code that excludes candidates via a score/flag while multiple downstream stages select by rank, quota, or diversity (debate node selection, ranking pipelines, refill/recommendation logic).
