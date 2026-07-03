# Repository Review — Backlog

**Date:** 2026-07-02 · **Companion to:** FINDINGS.md, VELOCITY-DIAGNOSIS.md, EXECUTION-NOTES.md
Effort: S (<2h agent) / M (2–8h) / L (multi-session). Executor: **sonnet-safe** = closed file list + mechanical verification; **fable-required** = architectural judgment. PowerShell public-surface items default fable-required per rubric. AGENTS.md edits are overlay-tracked — commit via `pwsh ./scripts/ogit.ps1` from repo root, never `git`.

---

## Phase 1 — Velocity recovery

### B-101 · Fix REPO_MAP generator truncation and regenerate the full map
- **Problem:** REPO_MAP.md truncated at 200 lines; 27% coverage; all of `src/server/` and both other apps absent (F-005).
- **Change:** In `taxonomy-editor/scripts/depgraph.mjs`, locate the 200-line cap in the `--repomap` output path and remove it (or raise to unlimited). Extend the generator to also traverse `poviewer/src` and `summary-viewer/src` if a `--all-apps` flag is trivial; otherwise add a header line to REPO_MAP.md stating explicitly: "Covers taxonomy-editor + lib only; poviewer/summary-viewer not indexed." Regenerate: `cd taxonomy-editor && node scripts/depgraph.mjs --repomap > ../REPO_MAP.md`.
- **Effort:** S · **Risk:** low (generated artifact; breakage mode = malformed map, caught by eyeball)
- **Executor:** sonnet-safe
- **Verification:** `grep -c "truncated" REPO_MAP.md` returns 0; `grep "src/server/server.ts" REPO_MAP.md` returns a hit; map lists >500 files.
- **Depends on:** none · **Velocity impact:** high

### B-102 · Correct README.md quantitative and topology claims
- **Problem:** Every number and the repo topology are stale/wrong (F-006).
- **Change:** Edit README.md: (1) L12 area — describe **three** repos (code, `../ai-triad-data`, `../ai-triad-sources`); (2) remove "~10 MB" claim or replace with "code repo" (no size); (3) L37 — sources live in `../ai-triad-sources` (680 documents); (4) update counts: summaries 705, conflicts 1,250, POV nodes 785 (L73 example: replace "318 nodes" with current `Get-Tax | Measure-Object` output at edit time); (5) sync the `.aitriad.json` sample (L80-89) with the real file including `sources_root`, `queue_file`, `version_file`; (6) "40+ cmdlets" → "140+ cmdlets"; (7) add `lib/` to the repo tree sketch.
- **Effort:** S · **Risk:** low (docs only)
- **Executor:** sonnet-safe
- **Verification:** re-run the map-drift checks: each edited claim matches a fresh measurement (`git ls-files | wc -l`, `ls ../ai-triad-data/summaries | wc -l`, `ls scripts/AITriad/Public | wc -l`).
- **Depends on:** none · **Velocity impact:** high

### B-103 · Correct root AGENTS.md stale facts (overlay commit)
- **Problem:** F-007 — version, counts, enums, planned-flags all wrong; agents mis-budget and re-implement shipped cmdlets.
- **Change:** Edit root AGENTS.md: module v0.8.0→0.8.6 (re-check psd1 at edit time); "40+ cmdlets"→"145 (see `ls scripts/AITriad/Public`)"; Electron 35→41; "lib/debate/, 22 TypeScript files"→"~180 files (flat)"; remove "*(planned — not yet implemented)*" from `Get-Policy` and `Test-TaxonomyIntegrity` rows; replace Organization type enum values with the real ValidateSet from `scripts/AITriad/Private/../Public/Import-Organization.ps1:48` (`think_tank, advocacy, regulatory, academic, corporate, intergovernmental, civil_society, standards_body, research_lab`); replace `partners_with` example with `ALLIED_WITH`; CI section: list all 4 jobs; in the Repository Map section add: "REPO_MAP covers taxonomy-editor+lib only" (align with B-101 outcome); fix "four POV camps with BDI categories" → "three POV camps (acc/saf/skp) with BDI categories, plus shared situation nodes (`sit-*`, legacy `cc-*`)". Commit via `pwsh ./scripts/ogit.ps1 add ... / commit` from repo root.
- **Effort:** S · **Risk:** low (docs; breakage mode = committing via wrong repo — instructions above prevent it)
- **Executor:** sonnet-safe
- **Verification:** `pwsh ./scripts/ogit.ps1 log -1` shows the commit; grep AGENTS.md for "0.8.0", "Electron 35", "22 TypeScript", "not yet implemented" (for the two cmdlets), "government_agency" — all return nothing.
- **Depends on:** none · **Velocity impact:** high

### B-104 · Move tracked research/management data out of the code repo
- **Problem:** F-001 — 259.9 MB tracked in `research/`, 15.1 MB in `management/`; two-repo policy violated; 200 MB pack.
- **Change:** Move to `../ai-triad-data/research-artifacts/` (create): `research/comp-linguist/fine_tuned_model/`, `training_corpus*.json` (3 files), `results/` (62 files), `_annotation_template.json`; move `management/project-manager/*.pptx` to ai-triad-data or a non-repo location. `git rm -r --cached` + physical move + update `.aitriad.json`/any referencing scripts (grep `training_corpus` and `fine_tuned_model` for path references first — the comp-linguist scripts that read them need path updates). Add `.gitignore` entries preventing recurrence. Decide (human): whether to also rewrite history to reclaim pack size (separate, optional, coordinate with all agents — see EXECUTION-NOTES).
- **Effort:** M · **Risk:** medium (breakage mode: comp-linguist scripts with hardcoded relative paths to corpora/model — must grep and update; history rewrite, if chosen, breaks all clones)
- **Executor:** fable-required
- **Verification:** `git ls-files research | ForEach-Object {(Get-Item $_).Length} | Measure -Sum` < 10 MB; comp-linguist smoke: the moved-path readers resolve (grep updated paths, run one loader script if runnable).
- **Depends on:** none · **Velocity impact:** high

### B-105 · Dead-weight archive sweep (closed list)
- **Problem:** F-003 — ~170 tracked dead files read as live.
- **Change:** (1) `git mv` to `scripts/archive/`: the 26 zero-ref scripts + 8 zero-ref Python listed in FINDINGS F-003 (exact list in the staleness scan section; includes `backfill-*.mjs`, `migrate-edges.mjs`, `retry-steelmans.mjs`, `rewrite-descriptions.mjs`, `run-crux/calibration/validation-debates.sh`, `Analyze-EdgeThresholds.ps1`, `Measure-EmbeddingSimilarity.ps1`, `Migrate-*.ps1`, `cluster_policies.py`, `dedup_policies.py`, etc.). (2) Create `docs/archive/` and `git mv` the ~35 superseded/one-off docs (lit reviews, executed migration plans, dated code reviews — list from staleness scan §5). (3) `research/comp-linguist/_*.py` (65 files) → `research/comp-linguist/archive/`. (4) Delete: empty `roles/`, stray `sources/src-1775218096565-bstsbk/`, root `cc-prefix-baseline.txt`, `proposals-{accelerationist,safetyist,skeptic}-2026-05-28.json` (and widen the `taxonomy-proposal-*` gitignore pattern to catch this naming). (5) Fold `specs/debate-turn-validation-impl.md` into `docs/archive/` WITH a header pointing to current code (coordinates with B-306); move root `prompts/` 2 files to `docs/archive/`; move `calibration/calibration-log.json` to ai-triad-data. (6) Move the 12 one-off migration CLIs in `lib/debate/` (orphan-detector list) to `lib/debate/archive/` — EXCEPT verify each has no import first (`node scripts/depgraph.mjs --reverse <name>`).
- **Effort:** M · **Risk:** low-medium (breakage mode: a "zero-ref" script actually invoked by an undiscovered caller — mitigated by depgraph reverse-check per file and by moving, not deleting)
- **Executor:** sonnet-safe (the list is closed; the per-file reverse-check command is specified)
- **Verification:** `npm run verify` green in taxonomy-editor; `Invoke-Pester ./tests/` green; `node scripts/depgraph.mjs --orphans` count decreases; CI green after push.
- **Depends on:** B-306 for the specs/ file (can proceed without, leaving that one file) · **Velocity impact:** high

### B-106 · Purge on-disk regenerable weight and relocate debates/
- **Problem:** F-002 — ~1.3 GB untracked junk polluting searches.
- **Change:** Delete `taxonomy-editor/release/` (284 MB), `taxonomy-editor/dist/` (43 MB), `workflow-app/node_modules` + `workflow-app/dist` (766 MB). Move `debates/*.json` (67 files, 122 MB) to `../ai-triad-data/debates/` (merge with existing dir; skip name collisions and report them). Confirm `.gitignore` already covers all (it does per staleness scan §7 — verify before delete).
- **Effort:** S · **Risk:** low (all regenerable/relocatable; breakage mode: a running local server holding a dist file open — retry after stopping)
- **Executor:** sonnet-safe
- **Verification:** dirs absent; `git status --porcelain` shows no new deletions of tracked files; debate files present in data repo.
- **Depends on:** none · **Velocity impact:** medium

### B-107 · AGENTS.md orientation upgrade: pipeline pointers, tag registry, schema-of-record map
- **Problem:** F-008/F-010 — the gold docs are unlinked; test tags undocumented; "schema" locations misleading.
- **Change:** Add to root AGENTS.md (overlay commit): (1) a "Key Pipelines" list linking `docs/document-processing-pipeline.md` and `docs/architecture-overview.md`; (2) a Pester tag registry (enumerate actual tags: grep `-Tag` across tests/ and list them with one-line scope each); (3) a "Schemas of record" table: pov/situations/conflict JSON Schemas in `taxonomy/schemas/` (note: not runtime-enforced — see F-025 status), POV summary shape = `scripts/AITriad/Prompts/pov-summary-schema.prompt` (exemplar prompt), edge types = `Resolve-EdgeType.ps1`; (4) the POV-summary propagation map from the Axis B trace (generation cmdlets + Private core + promptCatalog.ts + both viewer render sites). Correct the `Invoke-POVSummary`/`Invoke-BatchSummary` one-liners (they operate on documents, not single POVs/nodes).
- **Effort:** M · **Risk:** low
- **Executor:** fable-required (content judgment: what to include vs link)
- **Verification:** re-run the Axis B benchmark trace (same task, fresh agent): target ≤6 steps, 0 dead-ends.
- **Depends on:** B-101 (map caveat wording), B-103 · **Velocity impact:** high

### B-108 · Resolve the production-URL contradiction and dangling doc ref
- **Problem:** F-009 — `yellowbush` (13 scripts) vs `gentlecoast` (tech-lead AGENTS.md); `deploy/azure/AGENTS.md` referenced but nonexistent.
- **Change:** Determine the live URL: run `Import-Module ./scripts/AITriad/AITriad.psm1; Test-TaxEditorHealth` (uses yellowbush default) and `Test-TaxEditorHealth -BaseUrl https://taxonomy-editor.gentlecoast-20f0bd5b.eastus2.azurecontainerapps.io`; whichever returns healthy is live. Then: add a single `Get-TaxEditorBaseUrl` private helper (or module-scope variable in AITriad.psm1) holding the URL, update the 13 hardcoding files to use it, and fix the stale doc (tech-lead AGENTS.md via ogit, or the scripts — whichever side was wrong). Fix `engineering/tech-lead/AGENTS.md` reference `deploy/azure/AGENTS.md` → `operations/devops/azure/AGENTS.md` (ogit commit).
- **Effort:** M · **Risk:** low (breakage mode: health checks against wrong host — the verification IS the health check)
- **Executor:** fable-required (touches PS public cmdlet defaults = public surface per rubric)
- **Verification:** `Test-TaxEditorHealth` green with no `-BaseUrl` override; `grep -r "yellowbush\|gentlecoast" scripts/` shows only the single helper.
- **Depends on:** none · **Velocity impact:** medium

---

## Phase 2 — Structural consolidation

### B-201 · Create `lib/electron-shared/povMeta.ts` and migrate all POV label/color sites
- **Problem:** F-011 — labels in ~24 files, colors in ≥9 with live drift (`#3b82f6` vs `#E74C3C` for safetyist).
- **Change:** (a) Human/fable decision: canonical color per POV (audit both palettes in situ; likely the debate-diagnostics `constants.ts:34` set is newer — confirm with the owner). (b) Create `lib/electron-shared/povMeta.ts` exporting `POV_META: Record<PovKey,{label,color,shortLabel}>` re-using `POV_KEYS` from `lib/debate/types.ts`. (c) Migrate the 24 label sites + 9 color sites (full list from duplication scan §4) to import it; delete local maps.
- **Effort:** M · **Risk:** medium (breakage mode: visual regression where the non-canonical color was intended; snapshot-test or eyeball each migrated view)
- **Executor:** fable-required for (a)+(b); the (c) migration can be split off sonnet-safe once (b) lands with the closed 33-file list
- **Verification:** `grep -rn "Accelerationist'" --include="*.tsx" taxonomy-editor poviewer summary-viewer` returns only povMeta consumers; `npm run verify` green in all three apps; visual smoke via `/smoke-ui`.
- **Depends on:** none · **Velocity impact:** high

### B-202 · Consolidate cosineSimilarity to one TS export
- **Problem:** F-011 — 12 definitions (4 inside lib/).
- **Change:** Keep `lib/debate/taxonomyRelevance.ts`'s export (or move to `lib/embeddings/similarity.ts` — single decision). Replace the private re-implementations in `lib/debate/phaseTransitions.ts`, `relinkVocabulary.ts`, `lib/translation/ensemble.ts`, and the TE/SV `utils/similarity.ts` pair with imports. PS (`Get-FilteredCandidates.ps1`, `Remove-DuplicateClaims.ps1`) and Python (`cluster_policies.py` — archived by B-105 anyway) keep one implementation per runtime.
- **Effort:** S · **Risk:** low (pure function; breakage mode: subtle normalization differences between copies — diff the bodies before unifying, tests cover the debate paths)
- **Executor:** sonnet-safe (closed list, mechanical)
- **Verification:** `grep -rn "function cosineSimilarity" --include="*.ts"` returns 1 hit in lib/, 0 in apps; `npm run verify` + `npm test` green in TE and SV.
- **Depends on:** none · **Velocity impact:** medium

### B-203 · Promote taxonomy-editor↔lib forks to real @lib imports
- **Problem:** F-013 — vendored forks: `types/taxonomy.ts` (51% of `lib/debate/taxonomyTypes.ts`), `useDebateStore/helpers.ts` overlaps, `computeEmbeddings` ×4, duplicated `interpretationText`/`hashString`/`looksTruncated`.
- **Change:** Unify each pair: where TE's fork added fields, upstream them into lib's type (they serve the same data); re-export from `@lib`; delete TE-local copies. `computeEmbeddings`: settle on `lib/embeddings/onnxEmbedding.ts` as canonical, thin adapters in TE main/server if their signatures differ.
- **Effort:** L · **Risk:** medium (breakage mode: type unification surfacing latent mismatches — that's the point; tsc + full suite catch them)
- **Executor:** fable-required
- **Verification:** `npm run verify` (both tsconfigs) green; jscpd re-run shows lib↔TE clone lines drop from 428 toward ~0; depcruise still 0 violations.
- **Depends on:** B-201 (avoid rebasing over each other) · **Velocity impact:** high

### B-204 · Deduplicate summary-viewer's forked main-process modules
- **Problem:** F-012 — SV forks of TE's `modelDiscovery.ts` (56%), `embeddings.ts` (subset), `diagnosePython.ts` (94%), `errorMessages.ts` (78%), `ApiKeyDialog.tsx` (81%).
- **Change:** Move the shared implementations into `lib/electron-shared/` (the proven pattern — 5 modules already live there with re-export shims in PO/SV); SV and TE import them. Where TE's version is a superset (embeddings, apiKeyStore), lib gets the superset with capability flags.
- **Effort:** M · **Risk:** medium (breakage mode: SV's Electron main differs subtly in paths/env — test SV launch after)
- **Executor:** fable-required
- **Verification:** SV builds and launches (`cd summary-viewer && npm run dev` smoke); TE `npm run verify` green; jscpd SV↔TE clone lines drop materially (baseline 823).
- **Depends on:** B-206 decision — if consolidation (B-206) is approved and imminent, SKIP this item as moot · **Velocity impact:** medium

### B-205 · Un-fork prompt text: summary-viewer reads .prompt files
- **Problem:** F-015 — 3 prompt templates forked into SV TypeScript; vocabulary changes need 2 edits in 2 languages.
- **Change:** SV main process reads `scripts/AITriad/Prompts/{attribute-extraction,edge-discovery,hierarchy-placement}.prompt` at runtime (same repo-root resolution it already does for `.aitriad.json`) and exposes via IPC; delete `summary-viewer/src/renderer/prompts/*.ts`. Also document `taxonomy-editor/src/renderer/data/promptCatalog.ts` as a registry that must list new prompt files (or generate it — stretch).
- **Effort:** M · **Risk:** medium (breakage mode: template placeholder syntax differences between PS renderer and SV's substitution — diff rendered output on one fixture before/after)
- **Executor:** fable-required
- **Verification:** SV attribute-extraction produces identical prompt text pre/post for a fixture document; SV builds green.
- **Depends on:** B-206 decision (same moot-if-consolidated caveat) · **Velocity impact:** medium

### B-206 · DECISION + design: consolidate poviewer/summary-viewer into the taxonomy-editor shell
- **Problem:** F-012 — three parallel Electron shells; ~4,500–5,500 redundant LOC (~35% of PO+SV); three AI-client implementations.
- **Change:** Produce an HLD (this is a design ticket, not the migration): PO and SV become windows/routes in TE's shell, reusing its main process, bridge, apiKeyStore, modelDiscovery, and `lib/ai-client`; their genuinely distinct view logic (~9k LOC: PdfViewer/annotations, KeyPointsPane, …) ports as feature folders. Explicitly evaluate the alternative (status quo + B-204/205 dedup) with the measured numbers. Owner decision gate; if approved, decompose the migration into per-view tickets.
- **Effort:** L (design M + migration multi-session) · **Risk:** high (breakage mode: PO/SV workflows regress during port; mitigate with per-view migration and keep old apps until parity)
- **Executor:** fable-required + human review before any migration starts
- **Verification:** HLD reviewed and decision recorded as an ADR; if migrated: all three UX flows smoke-tested, old app dirs removed, `npm run verify` green.
- **Depends on:** B-201, B-202 (shared metadata/utils first) · **Velocity impact:** high (long-run)

### B-207 · Delete dead configuration
- **Problem:** F-018 — `config/translation.yml` (0 readers), `debate-validation-config.json` (0 readers), `ai-usages.json:turn.brief` (0 call sites).
- **Change:** `git rm config/translation.yml debate-validation-config.json` (re-verify 0 readers at execution time: `grep -rn "translation.yml\|debate-validation-config" --include="*.{ts,ps1,psm1,py,mjs,yml}"`); remove the `turn.brief` entry from ai-usages.json.
- **Effort:** S · **Risk:** low (breakage mode: an undiscovered reader — the pre-delete grep is the guard)
- **Executor:** sonnet-safe
- **Verification:** greps return nothing; `npm run verify` + Pester green.
- **Depends on:** none · **Velocity impact:** low

### B-208 · Write the configuration-precedence document
- **Problem:** F-018 — 14 mechanisms, 8-way model resolution, no precedence spec.
- **Change:** New `docs/configuration-precedence.md`: enumerate all 14 mechanisms (census in FINDINGS F-018), then trace and document actual model-resolution precedence in each entry path (server request, debate engine, PS cmdlet, renderer) by reading the code. Link from root AGENTS.md (ogit). Flag any *unintended* precedence discovered as new tickets.
- **Effort:** M · **Risk:** low (docs)
- **Executor:** fable-required (requires establishing truth from code)
- **Verification:** doc exists; for each entry path, cites file:line of the resolution chain; AGENTS.md links it.
- **Depends on:** none · **Velocity impact:** high

### B-209 · Make server.ts routes extractable; extract the top-3 route clusters
- **Problem:** F-017 — 177 routes in one 4,938-LOC file; module-local routes array blocks extraction; highest-churn file in the repo.
- **Change:** (1) Export a `registerRoutes(router)`-style registration seam from server.ts. (2) Extract the three biggest clusters to `src/server/routes/{admin,sync,debates}.ts` (35+17+9 routes), moving their inline handlers with them. (3) Adopt the rule: new route groups get their own file (add to AGENTS.md).
- **Effort:** L · **Risk:** medium (breakage mode: route-order sensitivity in the hand-rolled matcher and shared closure state — extract clusters that don't depend on registration order first; the persona/E2E suites are the net)
- **Executor:** fable-required
- **Verification:** `npm run verify` green; `Test-PersonaEndpoints` all 21 cells pass; `Test-TaxEditorEndpoints` green against local server; server.ts LOC < 3,000.
- **Depends on:** B-103 (docs current so the extraction is discoverable) · **Velocity impact:** high

### B-210 · debateEngine decomposition: extract 2–3 cohesive responsibility clusters
- **Problem:** F-017 — 6,046-LOC god class, 88 methods, top-2 churn; every debate feature merges through it.
- **Change:** Design-first (short HLD comment on the ticket): identify the 2–3 most separable of the 40+ sections (candidates from the section audit: checkpoint/resume + session persistence; topic-critique/clarification flow — already has `generateViaUsage` seams; calibration/quality-metrics emission) and extract each to a collaborator class taking the engine's deps explicitly. Target: engine < 4,000 LOC, no behavior change. Do NOT attempt a full rewrite in one pass — the useDebateStore lesson (F-017) is that mass moved without a growth rule reforms; pair with B-408.
- **Effort:** L · **Risk:** high (breakage mode: implicit state coupling among the 128 private members — extract only clusters whose member-access is closed, verified by tsc after making members explicit-injected)
- **Executor:** fable-required + human review
- **Verification:** full vitest suite green; `Compare-DebateRuns` on a fixture topic pre/post shows no behavioral diff; evals (`npm run evals`) green.
- **Depends on:** B-408 (gate first, so growth stops while surgery proceeds) · **Velocity impact:** high

### B-211 · styles.css: freeze the monolith, migrate top-churn sections to co-located CSS
- **Problem:** F-017 — 18,605 LOC, 114 commits; the co-located pattern exists (14 files) but core growth lands in the monolith.
- **Change:** (1) Rule (AGENTS.md + a grep-based CI check): no new selectors in styles.css — new styles go in co-located `<Component>.css`. (2) Migrate the 5 most-churned sections (identify via `git log -L` on section ranges) to co-located files. Do not attempt full migration.
- **Effort:** M · **Risk:** medium (breakage mode: cascade-order changes altering specificity — migrate leaf-component sections only, visual smoke each)
- **Executor:** fable-required (choosing safe sections); the per-section moves are sonnet-safe once listed
- **Verification:** `/smoke-ui` pass; styles.css line count strictly decreasing in CI check (B-408 hook).
- **Depends on:** B-408 · **Velocity impact:** medium

### B-212 · Split useDebateStore residual monoliths
- **Problem:** F-017 — `helpers.ts` 2,642 LOC and `debateLoopSlice.ts` 2,231 LOC reformed inside the completed decomposition; helpers.ts also overlaps lib (F-013).
- **Change:** After B-203 removes the lib-duplicated portions of helpers.ts, split the remainder by consumer slice (helpers used by exactly one slice move into that slice's file; shared ones into `useDebateStore/shared/`). debateLoopSlice: extract its phase-machine section if closed.
- **Effort:** M · **Risk:** medium (breakage mode: import cycles among slices — depcruise catches)
- **Executor:** fable-required
- **Verification:** `npm run verify` green; no file in useDebateStore/ > 1,500 LOC.
- **Depends on:** B-203 · **Velocity impact:** medium

### B-213 · DECISION: converge the two prompt systems
- **Problem:** F-020 — 65 TS prompt builders vs 19 UsageID entries; two systems to learn for any prompt change.
- **Change:** Decision doc (ADR): either (a) UsageID becomes config-of-record and builders migrate incrementally with a "new prompts must register a UsageID" rule, or (b) UsageID stays scoped to model/params routing and the doc says so explicitly. Either way, kill the ambiguity; if (a), file per-cluster migration tickets.
- **Effort:** S (decision) · **Risk:** low
- **Executor:** fable-required + owner sign-off
- **Verification:** ADR merged; AGENTS.md UsageID section updated to match.
- **Depends on:** none · **Velocity impact:** medium

---

## Phase 3 — Conceptual coherence

### B-301 · Defuse and resolve the cc-/sit- split-brain
- **Problem:** F-024 — 246 cc vs 166 sit nodes; 60% schema-violating; sit-only code paths undercount situations; `normalizeNodeId` would rewire 5,047 edges to wrong nodes if ever called.
- **Change:** Stage 1 (immediate, S): neutralize the loaded gun — delete `normalizeNodeId`'s cc→sit mapping (`lib/debate/index.ts:87`) or make it throw ActionableError, and fix the `nodeIdUtils.ts:68` comment directing people to it. Stage 2 (decision): adopt **cc- and sit- both canonical** (update `situations-taxonomy.schema.json:94` pattern to `^(sit|cc)-\d{3}$`) — this matches data reality and avoids a 5,047-edge data migration; document the two prefixes' provenance. Stage 3 (M): fix the one-prefix code sites — sit-only: `debateEngine.ts:415,418,1678,1682`, `calibrationLogger.ts:707,746`, `situationRefs.ts:83`, diagnostics tabs `BriefTab.tsx:372`/`CiteTab.tsx:159`/`PlanTab.tsx:274`/`TaxRefsTab.tsx:222`; cc-only: `summary-viewer/src/main/fileIO.ts:374`; and make `nodePovFromId`/`nodeTypeFromId` (`nodeIdUtils.ts:38-58`) handle cc-. Introduce one predicate `isSituationId()` in nodeIdUtils and use it at all 12+ sites.
- **Effort:** L · **Risk:** medium (breakage mode: situation-citation metrics will *change* — they'll become correct; flag in release notes that calibration counts shift)
- **Executor:** fable-required + human review of the Stage 2 decision
- **Verification:** unit tests for `isSituationId` both prefixes; grep shows no remaining bare `startsWith('sit-')`/`startsWith('cc-')` outside nodeIdUtils; `Measure-DebateQuality` on a fixture shows situation citations now counted for cc- refs.
- **Depends on:** none (Stage 1 immediately) · **Velocity impact:** medium

### B-302 · Reconcile the conflict validators and repair invalid data
- **Problem:** F-025 — schema and zod mutually exclusive (`status`, `human_notes`); 4/11 conflict files invalid under both.
- **Change:** Decide the canonical shape (recommend: zod's `wont-fix` + object-notes, since the editor writes it), update `taxonomy/schemas/conflict.schema.json` to match (add `_schema_version` property while there — its absence + `additionalProperties:false` makes versioned files invalid), create `conflict.schema.json` v2 entry for the consolidator's `_schema_version: "2.0"` wrapper or fix the consolidator; repair the 4 invalid files in ai-triad-data (add missing `status`/`linked_taxonomy_nodes`).
- **Effort:** M · **Risk:** low-medium (breakage mode: downstream conflict readers assuming the old status enum — grep `'closed'` in conflict-reading code)
- **Executor:** fable-required
- **Verification:** all 11 conflict files pass the reconciled schema via `Test-Json`/ajv one-shot script; zod and schema field lists diff-clean.
- **Depends on:** none · **Velocity impact:** medium

### B-303 · Create the edges schema and clean the edge-type registry
- **Problem:** F-026 — no edges schema; 74-type stale registry with typo; TS accepts unknown types silently.
- **Change:** (1) Author `taxonomy/schemas/edges.schema.json`: edge object shape + `edge_type` enum = the canonical 8 from `Resolve-EdgeType.ps1:10-19`. (2) Rewrite `edges.json`'s top-level `edge_types` registry to the canonical 8 (fixing `CONTRIBUES_TO` typo victims if any instances exist — scan first). (3) Add a default-case rejection (warning at minimum) for unknown edge types in `lib/debate/validators.ts:160-197` `checkEdgeDomainRange`. (4) Document the attack/support mapping decision for the 4 unmapped types (TENSION_WITH, RESPONDS_TO, INTERPRETS, CONVERGES_WITH) — even "deliberately neutral in QBAF" written down (feeds B-305).
- **Effort:** M · **Risk:** medium (breakage mode: latent non-canonical edge instances failing the new validation — scan `edges.json` instance types first and triage)
- **Executor:** fable-required
- **Verification:** edges.json validates against the new schema end-to-end; TE save-gate test with a bogus edge type now warns/rejects; Pester edge tests green.
- **Depends on:** none · **Velocity impact:** medium

### B-304 · Wire schema enforcement into save paths and CI
- **Problem:** F-025 — schemas executed by nothing; zod covers ~40% of node fields with no ID patterns.
- **Change:** (1) Align renderer zod (`utils/validation.ts`) with `pov-taxonomy.schema.json`: add the ID regex, `parent_relationship` enum, `situation_refs` pattern; decide field-by-field whether the enrichment layer is gate-validated or pass-through (document choices inline). (2) Add a CI job (or extend test-powershell) running ajv/`Test-Json` of the three (post-B-302/303: five) schemas against the data repo's current files — failing on drift. (3) Fix `pov-taxonomy.schema.json:93` stale `acc-goals-001` example. (4) Update `docs/sre-data-integrity-review-guide.md:66` old ID pattern.
- **Effort:** L · **Risk:** medium (breakage mode: production data that violates newly-enforced rules — run the validators in report-only mode first, triage violations, then flip to enforcing)
- **Executor:** fable-required
- **Verification:** CI schema job green against ai-triad-data HEAD; deliberately-malformed fixture fails it; TE save-gate rejects a bad-ID node in a unit test.
- **Depends on:** B-302, B-303 · **Velocity impact:** high (this is what makes agents fast *and* confident on data tasks)

### B-305 · True up the QBAF contract
- **Problem:** F-027 — schema promises DF-QuAD + a shape the PS cmdlet never writes; stored outputs non-conforming; bridge drops fields.
- **Change:** Update `conflict.schema.json`'s QbafAnalysis to describe reality: algorithm enum → the actual semantics name (pick one, e.g. `"sum-clamp-bipolar"`, referencing `docs/aggregative-semantics-review.md`), shape → what `Invoke-QbafConflictAnalysis.ps1:253-281` writes (or change the cmdlet to write the schema shape — decide by which consumers exist; grep readers of `qbaf-conflicts/` first). Pass `oscillationDetected`/`dampingLevel` through `scripts/qbaf-bridge.mjs`.
- **Effort:** M · **Risk:** low (breakage mode: qbaf-conflicts readers — grep first)
- **Executor:** fable-required
- **Verification:** fresh `Invoke-QbafConflictAnalysis` output validates against the updated schema; bridge output includes the two fields.
- **Depends on:** B-302 (same schema file) · **Velocity impact:** low

### B-306 · Retire or rewrite the turn-validation spec; settle the unshipped PS flags
- **Problem:** F-028 — spec references dead phase names, wrong defaults, obsolete formula; spec'd `-DisableTurnValidation`/`-MaxTurnRetries` flags never shipped.
- **Change:** Archive `specs/debate-turn-validation-impl.md` to `docs/archive/` with a header: "Superseded 2026-07; current behavior: turnValidator.ts + orchestration.ts:959-1202; config: types.ts:740". Decide the flags: either implement them in `Show-TriadDialogue.ps1` (they're reasonable operator controls) or delete them from all docs. Remove the now-empty `specs/` dir.
- **Effort:** S (archive) + M if flags implemented · **Risk:** low
- **Executor:** fable-required (flag decision touches PS public surface)
- **Verification:** specs/ gone; if flags shipped: Pester test invoking `Show-TriadDialogue -DisableTurnValidation` fixture passes.
- **Depends on:** coordinates with B-105 · **Velocity impact:** low

### B-307 · Fix low-severity spec/prompt drift (closed list)
- **Problem:** F-030 — self-contradicting situation-candidates schema prompt; undocumented `new_edge_types`; dead regex.
- **Change:** (1) `scripts/AITriad/Prompts/situation-candidates-schema.prompt:10-14`: replace legacy string interpretations with the BDI 4-field object shape its instruction prompt demands. (2) `edge-discovery-batch-schema`: either document `new_edge_types` as advisory-only in the prompt or remove the field. (3) Delete the dead regex branch in `PovProgressionView.tsx:221` (`[BDI]` single-letter category never existed). (4) `Invoke-BDIWeightAssignment.ps1:7`: synopsis mentions Intentions.
- **Effort:** S · **Risk:** low (breakage mode: prompt output shape shift — run one situation-candidates generation on a fixture and eyeball)
- **Executor:** sonnet-safe (exact edits specified)
- **Verification:** greps confirm edits; one fixture generation parses.
- **Depends on:** none · **Velocity impact:** low

---

## Phase 4 — Quality infrastructure

### B-401 · Flip flight-recorder ESLint rule to error; burn down the 377 non-compliant catches
- **Problem:** F-019 — ADR-003 enforced at `warn`; 33.7% catches non-compliant, concentrated in hot files.
- **Change:** (1) Triage pass (fable): classify the 377 into "must record" vs "legitimately silent" (add the rule's disable-comment with a reason string for the latter). (2) Fix the must-records (mechanical once classified — the fix is one `getGlobalRecorder()?.record(...)` line per catch; sonnet-safe with the classified list). (3) Flip `taxonomy-editor/eslint.config.mjs:42` to `'error'`.
- **Effort:** L (triage M + burn-down M) · **Risk:** low (additive logging; breakage mode: recorder calls in hot loops — the triage flags those)
- **Executor:** fable-required (triage); burn-down sonnet-safe after
- **Verification:** `npx eslint` clean with rule at error; `npm run verify` green.
- **Depends on:** none · **Velocity impact:** medium

### B-402 · Bring poviewer/summary-viewer to ADR-001/003 (contingent)
- **Problem:** F-019 — 0% recorder adoption, 81/81 catches bare in the two apps.
- **Change:** ONLY if B-206 decides against consolidation: wire `lib/flight-recorder` into both apps' main+renderer, convert the 4 poviewer bare throws, adopt the eslint rule. If consolidation approved: skip (moot).
- **Effort:** M · **Risk:** low
- **Executor:** fable-required
- **Verification:** recorder events visible in both apps' dumps; eslint rule active.
- **Depends on:** B-206 decision · **Velocity impact:** low

### B-403 · CI doc-accuracy gates
- **Problem:** F-005–F-007 — docs rot silently; nothing re-measures.
- **Change:** Add a CI step (script in `scripts/`): (1) REPO_MAP freshness — regenerate and diff; fail if drift > N lines or the truncation marker appears; (2) claims-lint — a small script asserting greppable doc claims against measurements (cmdlet count in AGENTS.md == `ls Public | wc -l`; module version in AGENTS.md == psd1 ModuleVersion; no "not yet implemented" marker for files that exist). Keep the assertion list in one data file so adding claims is cheap.
- **Effort:** M · **Risk:** low (breakage mode: flaky CI on legitimate doc lag — make it a soft-fail warning for the first two weeks)
- **Executor:** fable-required (designing the assertion set)
- **Verification:** CI job runs; deliberately breaking a claim fails it.
- **Depends on:** B-101–B-103 (docs true first) · **Velocity impact:** high (locks in Phase 1)

### B-404 · CI schema-validation gate over data-repo files
- **Problem:** F-025 — nothing runs the schemas; drift accumulates silently.
- **Change:** After B-304's report-only period: promote the schema-validation job to failing. Covers pov/situations/conflict/edges schemas vs ai-triad-data HEAD (checkout or fetch raw).
- **Effort:** S (job exists from B-304) · **Risk:** low
- **Executor:** sonnet-safe (flipping report-only to enforcing per B-304's runbook)
- **Verification:** intentionally-invalid fixture branch fails CI.
- **Depends on:** B-304 · **Velocity impact:** medium

### B-405 · Pester tag registry + tag the untagged
- **Problem:** F-010 — `-Tag <subsystem>` prescribed but no registry; discovery is grep.
- **Change:** Enumerate existing tags (`grep -rn "\-Tag" tests/`), write the registry table into AGENTS.md's Test Tiers section (ogit commit), tag untagged suites with their subsystem. One tag per suite minimum.
- **Effort:** S · **Risk:** low
- **Executor:** sonnet-safe
- **Verification:** `Invoke-Pester ./tests/ -Tag <each-registry-tag>` selects >0 tests for every listed tag.
- **Depends on:** none · **Velocity impact:** medium

### B-406 · PS parameter-name aliases for the 5-way/4-way entropy
- **Problem:** F-021 — `Path`/`ConfigPath`/`DocPath`/`File`/`From`; `OutputPath`/`OutputFile`/`OutputDirectory`/`OutputDir`.
- **Change:** Non-breaking: add `[Alias('Path')]` (input) and `[Alias('OutputPath')]` (output) to the non-conforming parameters (list from Axis A §3) so the canonical name works everywhere; document the canonical pair in AGENTS.md. No renames (public surface stability).
- **Effort:** M · **Risk:** low (aliases are additive; breakage mode: alias colliding with an existing param in the same cmdlet — Pester catches at import)
- **Executor:** fable-required (public surface per rubric)
- **Verification:** `Invoke-Pester ./tests/` green; `Get-Help` for each touched cmdlet shows the alias; module imports clean.
- **Depends on:** none · **Velocity impact:** low

### B-407 · Fix psd1/psm1 export drift + add a manifest-parity test
- **Problem:** F-021 — `Get-AICostReport` exported in psm1 but missing from psd1 FunctionsToExport.
- **Change:** Add `Get-AICostReport` to `scripts/AITriad/AITriad.psd1` FunctionsToExport; rebuild (`./scripts/Build-Module.ps1 -Clean`); add a Pester test asserting psm1 Export-ModuleMember set == psd1 FunctionsToExport set (prevents recurrence).
- **Effort:** S · **Risk:** low
- **Executor:** sonnet-safe
- **Verification:** new Pester test passes; `Test-ModuleManifest` green; `Import-Module` via manifest exposes Get-AICostReport.
- **Depends on:** none · **Velocity impact:** low

### B-408 · CI growth-arrest gates (monoliths + repo weight)
- **Problem:** F-017/F-001 — monoliths grow ~10%/month; data weight regressed into the code repo once already.
- **Change:** CI script asserting: (1) LOC ceilings on the four monoliths at their post-Phase-2 sizes (ratchet down as B-209/210/211 land — read ceilings from a checked-in `quality-gates.json`); (2) no tracked file > 5 MB added (git diff-based); (3) styles.css line count non-increasing. Soft-fail (warning) for two weeks, then enforce.
- **Effort:** S · **Risk:** low (breakage mode: legitimate large-file need — the gates file makes exceptions explicit and reviewable)
- **Executor:** sonnet-safe (the script logic is fully specified; ceilings read from config)
- **Verification:** CI shows the job; a test branch adding a 6 MB file fails it.
- **Depends on:** none (ceilings start at current sizes) · **Velocity impact:** high (protects everything else)
