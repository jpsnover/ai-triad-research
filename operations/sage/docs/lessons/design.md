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
