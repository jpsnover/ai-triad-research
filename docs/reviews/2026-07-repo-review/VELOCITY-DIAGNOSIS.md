# Velocity Diagnosis — Why Changes Keep Getting Slower

**Date:** 2026-07-02 · **Companion to:** FINDINGS.md (evidence), BACKLOG.md (remediation)

## The presenting symptom

Every task — human- or agent-executed — takes longer than it used to. This document is the causal theory, ranked by evidence strength. The short version:

> **Work per change has been growing on three compounding axes: every change is *routed through* ever-larger monoliths (write cost), *located via* maps that cover a shrinking fraction of an ever-noisier tree (search cost), and *propagated to* an ever-growing number of duplicate sites (edit-count cost). Verification gaps then convert uncertainty into caution, and caution into re-verification labor. None of these is dramatic alone; multiplied, they produce exactly the observed "everything is slower" signature without any single scapegoat.**

---

## Confirmed mechanisms, ranked by evidence strength

### 1. Monolith convergence — every change funnels through the same four growing files
**Evidence strength: very strong** (direct measurement, F-017)

The four highest-churn files since April are the four largest code files, and all four grew *during the two-week review window*:

| File | LOC (June → July) | Commits since Apr |
|---|---|---|
| `lib/debate/debateEngine.ts` | 5,436 → 6,046 | 145 |
| `taxonomy-editor/src/server/server.ts` | 4,460 → 4,938 | 184 |
| `renderer/styles.css` | 16,653 → 18,605 | 114 |
| `lib/debate/prompts.ts` | 3,833 → 4,572 | 121 |

Why this decays velocity specifically:
- **Read cost scales with file size.** An agent touching any debate feature must orient inside a 6,046-line god class with ~88 methods and 40+ responsibility sections. That's a context-window budget item on *every* debate task, and it grows ~10%/month.
- **Merge contention scales with churn concentration.** In a multi-agent environment, 184 commits landing in one file is a serialization point: agents queue, rebase, and re-verify against each other's changes. The June incidents (t/1273 breaking 59 tests; the amend-clobber incident in the lessons log) are this mechanism expressing itself.
- **Extraction attempts haven't bent the curve.** debateEngine has 46 satellite modules — leaf logic keeps getting extracted, but the orchestrator absorbs all new growth. The one completed decomposition (useDebateStore → 8 slices) reformed two new near-monoliths inside itself (`helpers.ts` 2,642 LOC, `debateLoopSlice.ts` 2,231). Decomposition without a growth-arresting rule doesn't stick.

**Affected workflows:** every debate feature, every server endpoint, every core-UI style change — i.e., the majority of current work.
**Addressed by:** B-209, B-210, B-211, B-212 (Phase 2); growth-arrest gate B-408 (Phase 4).

### 2. Navigation cost — the maps cover 27% of the territory and lie about the rest
**Evidence strength: very strong** (map-drift audit F-005–F-007 + required orientation trace F-008)

The orientation trace is the smoking gun: a fresh agent given a routine task ("add a field to the POV summary schema and propagate it") needed **12 steps, of which only 4 were doc-led-correctly**; 2 were actively misled, 2 dead-ended, and 5 required abandoning the docs for raw grep — ~25 files and ~1,300 lines of context burned before the first productive edit. Multiply that by every task by every agent, and note that context burned on orientation is context unavailable for the actual change (forcing summarization cycles, which are themselves slow and lossy).

The specific decay pattern matters: **structural claims (paths, names, commands) are ~100% accurate, while every quantitative/versioned claim is stale** — sizes off 25×, counts off 8×, enums 6/9 fabricated, "planned" cmdlets that shipped months ago. This is the signature of docs hand-patched at feature time but never re-measured. It's worse than uniformly bad docs, because agents learn to trust the docs (the paths always work!) and then get burned precisely on the claims that guide *budgeting and routing* decisions — how many files to expect, which repo holds the data, whether a cmdlet exists.

REPO_MAP.md is the sharpest case: 100% precision, 27% recall, silently truncated at 200 lines with all of `src/server/` and both other apps absent — sold by AGENTS.md as the cross-scope discovery tool. An agent who uses it concludes files don't exist. That's not friction; that's active misdirection.

**Affected workflows:** the first 10–30 minutes of *every* task, for *every* agent, forever.
**Addressed by:** B-101–B-103, B-107, B-108 (Phase 1) — this is why Phase 1 is doc accuracy.

### 3. Duplication — one behavioral change is 2–24 edits
**Evidence strength: strong** (jscpd + manual similarity measurement, F-011–F-016)

Measured N-edit surfaces: POV labels ~24 files; POV colors ≥9 files *with the drift already live* (safetyist rendered `#3b82f6` in some panels, `#E74C3C` in others); `cosineSimilarity` 12 definitions; Gemini endpoint 11; three fully independent AI-client implementations across the apps; prompt vocabulary forked between PowerShell `.prompt` files and summary-viewer TS; TE's Electron-vs-web split duplicating fileIO/community logic (270 exact-clone lines — the direct cause of June's t/1273 CI break, where a change landed in one twin but the test mocked the other).

Velocity effect is twofold: (a) the *known* N-edit case costs N edits plus discovery of all N sites; (b) the *unknown* case — an agent edits 1 of N, tests pass locally, and the divergence surfaces later as a bug, a re-opened ticket, and a second full task. The color drift proves case (b) is already happening. The orientation trace independently rediscovered this (duplicate `KeyPoint` types, mirrored prompt catalog) without looking for it.

**Affected workflows:** any cross-cutting change: model/endpoint updates, POV metadata, prompt vocabulary, storage behavior.
**Addressed by:** B-201–B-205, B-213 (Phase 2).

### 4. Context pollution — ~275 MB of tracked data + ~1.3 GB of on-disk junk + ~170 dead-but-live-looking files
**Evidence strength: strong** (direct measurement, F-001–F-004)

Three distinct costs, often conflated:
- **Clone/pack cost:** 200 MB git pack, dominated by `research/` experiment outputs (91 MB), training corpora (66 MB), and model weights. One-time per clone/CI-cache-miss, real but bounded.
- **Search noise:** un-scoped greps and Globs traverse `debates/` (122 MB of debate JSON — content that *matches debate-related searches*), `release/` (284 MB), `workflow-app/node_modules` (766 MB). This one taxes agents per-search.
- **Attention cost (the expensive one):** ~170 tracked files that read as live but are dead — 26 zero-ref scripts named like active tooling (`migrate-edges.mjs`), 65 scratch `_*.py`, ~35 superseded docs in a flat 108-file `docs/`, one-file top-level dirs (`specs/`, `prompts/`, `calibration/`). Every one is a "do I need to understand this?" stop. The staleness scan found the repo *has* the right conventions (`scripts/archive/` exists, gitignore is comprehensive) — they just stopped being applied.

**Affected workflows:** every search-driven discovery step; CI cache/clone; agent context budgets.
**Addressed by:** B-104–B-106 (Phase 1).

### 5. Verification gaps — schemas that nothing runs, validators that contradict each other, and a soft ADR
**Evidence strength: strong for existence, moderate for velocity contribution** (F-019, F-025, F-026, F-010)

The JSON Schemas in `taxonomy/schemas/` are executed by *nothing* (zero ajv/Test-Json/jsonschema hits repo-wide); the real validators (renderer zod, PS write-path checks) have drifted from them to the point of mutual exclusivity in the conflict schema (`closed`/`wont-fix`; string-notes vs object-notes) — and 4/11 production conflict files are invalid under **both**. 60% of situation nodes violate their own schema, undetected. The flight-recorder ADR is enforced at `warn`, with 33.7% of catch blocks non-compliant, concentrated in exactly the high-churn files, and 0% adoption in the two smaller apps.

Velocity mechanism: an agent that cannot trust validation must *manually re-verify* — read the data, read both validators, decide which is authoritative — before any schema-adjacent change. Agents are being *correctly* cautious; the caution is the cost. The missing Pester tag registry (F-010) adds a small constant tax to every verify step.

**Affected workflows:** anything touching taxonomy data, conflicts, edges, or schema-shaped output; incident diagnosis (recorder gaps).
**Addressed by:** B-302–B-304 (Phase 3), B-401–B-405 (Phase 4).

### 6. Configuration ambiguity — 14 mechanisms, 8-way model resolution, no precedence
**Evidence strength: moderate** (census is hard fact, F-018/F-020; velocity contribution partially inferred)

"Which model will this call use?" has ≥8 possible answers spanning JSON configs, env vars, hot-reloaded runtime config, localStorage, and tier constraints — with no precedence document. Every AI-behavior task starts with re-deriving this. The UsageID system built to fix it is stalled at 19 usages vs 65 prompt builders, so both systems must now be understood. Two dead config files and a dead usage ID add noise.

**Affected workflows:** all AI-call changes, cost/experiment work, debugging "why did it use model X."
**Addressed by:** B-207/B-208 (Phase 2), B-213.

### 7. Conceptual drift — task-specific landmines
**Evidence strength: strong for existence; velocity contribution is episodic, not chronic** (F-024, F-027, F-028)

The cc-/sit- split-brain (60% of situations invisible to sit-only code paths; a documented-but-uncalled normalizer that would silently rewire 5,047 edges to *wrong* nodes) and the stale turn-validation spec don't slow every task — they detonate under specific ones, converting a routine change into an investigation ("why are situation citations undercounted?") or, worse, into silently wrong output an agent ships confidently. These are velocity *variance* more than velocity *mean* — but agent trust, once burned, raises the caution tax everywhere (feeding mechanism 5).

**Addressed by:** B-301, B-305, B-306 (Phase 3).

---

## Mechanisms investigated and ruled out

- **Coupling / boundary decay — RULED OUT.** dependency-cruiser reports 0 violations across 905 modules / 4,113 dependencies; five error-severity rules (lib≁app, renderer≁server/main, …) run inside `npm run verify`; grep independently confirms no lib→app or renderer→server imports. Boundaries are this repo's healthiest large-scale property, and the existence proof that enforcement works here when rules are set to `error`. (F-022)
- **PowerShell module hygiene as a major drag — RULED OUT as major.** 145 cmdlets, 100% approved verbs, 97.9% help coverage, principled Public/Private split with zero live leakage. Real but minor entropy (5 input-path parameter names, 24× inlined POV-load loop, one export drift) earns small backlog items, not a diagnosis. The sacred constraint is not implicated: the PS layer is the *best*-maintained large surface in the repo. (F-021, F-029)
- **Convention entropy as a broad mechanism — RULED OUT as major.** Renderer components are consistently feature-foldered and PascalCased; naming entropy is confined to specific edges (lib/debate's flat 182-file namespace with dual test conventions, one PascalCase folder outlier). The flat lib/debate directory is real friction but is subsumed under mechanism 1's remediation rather than being an independent cause. (F-023)
- **Test *absence* as the primary brake — PARTIALLY ruled out.** The core is decently covered (vitest suite ~4,700 tests, 527 Pester tests, golden evals, persona/E2E health checks). The verification problem is *contradiction and non-execution* (mechanism 5), plus zero coverage specifically in poviewer/summary-viewer — not a general absence. Agents aren't slow because they can't run tests; they're slow because passing tests doesn't settle the questions the schemas were supposed to settle.

## Why it feels like *everything* got slower

The five confirmed chronic mechanisms multiply on a typical task timeline:

> orient (mechanism 2: misleading maps) → search (4: noise) → read (1: monolith context burn) → change (3: N edit sites) → verify (5: can't trust validators; which tests?) → merge (1: contention in hot files)

A 20% tax at each of five stages compounds to ~2.5× task duration — with no single stage looking catastrophic in isolation. That matches the reported experience: no dramatic failure, everything just drags. It also predicts the fix profile: **Phase 1 of the backlog attacks stages "orient" and "search" first because their cost is paid by 100% of future tasks including the remediation tasks themselves** — doc accuracy and dead-weight removal make the rest of the backlog cheaper to execute.

## Falsifiable checkpoints

If this theory is right, after Phase 1 (docs/maps fixed, weight removed) you should measure:
1. Orientation-trace length for the same benchmark task drops from 12 steps / ~1,300 lines to ≤6 steps / ≤500 lines.
2. Repo pack size drops ~60% (200 MB → ~80 MB); tracked file count drops ~10% (2,203 → ~1,980).
3. Time-to-first-edit on routine tickets (observable in session transcripts) drops measurably even *before* any Phase 2 structural work lands.

If (3) does *not* move after Phase 1, weight the monolith mechanism (1) higher and pull B-209/B-210 forward.
