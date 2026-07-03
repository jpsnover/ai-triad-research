# Repository Review — Findings

**Date:** 2026-07-02 · **Reviewer:** Technical Lead (Fable 5) · **Scope:** full repo, read-only
**Method:** Pass 1 script-driven measurement (inventory, git churn, tracked-size audit) + 6 parallel deep-dive audits (map-drift, duplication/jscpd, staleness, code coherence, orientation trace, conceptual coherence). All numbers measured 2026-07-02 unless noted.

Severity: critical / high / medium / low. Velocity contribution: direct / indirect / none.

---

## Ground truth (measured baseline)

- 2,203 git-tracked files. Working tree (excl. node_modules/dist/build/.git): taxonomy-editor 331 MB, research 264 MB, debates 121 MB, management 22 MB, docs 14 MB, lib 8.5 MB, scripts 6.9 MB.
- Tracked weight: `research/` **259.9 MB**, `management/` **15.1 MB**. `.git` pack = 200 MB.
- Top churn since 2026-04-01 (commits): `server.ts` 184, `debateEngine.ts` 145, `prompts.ts` 121, `styles.css` 114, `types.ts` 108, `useDebateStore.ts` 100.
- Monolith LOC (re-measured during review; both figures given where they moved during the review window): `debateEngine.ts` 5,436→**6,046**, `server.ts` 4,460→**4,938**, `styles.css` 16,653→**18,605**, `prompts.ts` 3,833→**4,572**.

---

## A. Context pollution & dead weight

### F-001 · critical · Two-repo policy violated by ~275 MB of tracked data — velocity: direct
`research/comp-linguist/` has **259.9 MB tracked in git**: `fine_tuned_model/best_model/model.safetensors` 86.7 MB, `training_corpus*.json` 65.8 MB (3 files), `results/` **91 MB across 62 experiment-output JSONs** (`injection-experiment-*` up to 12.3 MB each, in the pack — not LFS). `management/` adds 15.1 MB (a single 15 MB pptx). README.md:16 claims this is the "~10 MB" code repo. Cost: 200 MB git pack (clone time), grep/Glob noise across 339 tracked research files, and agents treating experiment outputs as live code.

### F-002 · high · ~1.3 GB of regenerable weight on disk polluting searches — velocity: direct
Untracked but present: `taxonomy-editor/release/` 284 MB (full Mac Electron build), `taxonomy-editor/dist/` 43 MB, `debates/` **122 MB / 67 generated debate JSONs** (data-repo content sitting in the code repo), `workflow-app/node_modules` + dist 766 MB (app touched once since mid-June). Any un-scoped filesystem search, `Get-ChildItem -Recurse`, or agent Glob pays this tax; `debates/*.json` (up to 9.4 MB each) actively pollute content searches for debate logic.

### F-003 · high · ~170 tracked dead files that read as live — velocity: direct
- 26 zero-reference scripts in `scripts/` (e.g., `backfill-fallacy-tiers.mjs`, `migrate-edges.mjs`, `rewrite-descriptions.mjs` — last touched 2026-03/04) + 8 zero-reference Python (`cluster_policies.py`, `dedup_policies.py`, …). A `scripts/archive/` convention already exists (10 files) but stopped being used.
- 65 tracked scratch scripts `research/comp-linguist/_*.py` (`_debug_gemini.py`, `_count_nodes.py`…), nothing invokes them.
- ~30–40 superseded/one-off docs in flat `docs/` (108 root-level .md): executed migration plans, dated code reviews, explicitly superseded plans (`bfo-prompt-recommendations.md` says so in its header). No `docs/archive/` exists.
- 12 one-off migration/repair CLIs inside `lib/debate/` reported by the repo's own orphan detector (`migrate-phase-names.ts`, `backfill-evidence-qbaf.ts`, `repairTranscript.ts`, …).
- Single-file top-level dirs that read as load-bearing: `specs/` (1 stale spec, see F-028), root `prompts/` (2 April-era hand-run prompts, unrelated to the active `scripts/AITriad/Prompts/`), `calibration/` (1 generated log), empty `roles/`, stray `sources/src-1775218096565-bstsbk/` (metadata.json = `{}`).

### F-004 · medium · Generated artifacts committed as code — velocity: indirect
Root `proposals-{acc,saf,skp}-2026-05-28.json` (245 KB — evades the `taxonomy-proposal-*` ignore pattern), `cc-prefix-baseline.txt`, `calibration/calibration-log.json`, `scripts/lineage-*-{results,remaining,report}.json` (~350 KB), `docs/baseline-*.json` + `debate-baseline-post-phase-{1,2,3}.json`, 3 tracked `.pptx` (15.4 MB). Each is a "what is this? is it current?" stop for an agent.

---

## B. Docs-vs-reality coherence

### F-005 · critical · REPO_MAP.md is silently truncated — 27% coverage, all of src/server absent — velocity: direct
The committed REPO_MAP.md ends with a literal `_... truncated at 200 lines_` marker (line 211). It covers 144 of ~536 non-test TS files; **`src/server/` (45 files), renderer stores/lib/hooks, and everything alphabetically late are absent**, and the map is generated only from taxonomy-editor's import graph, so **summary-viewer and poviewer don't exist in it at all**. Precision is perfect (144/144 listed paths exist; 18/18 sampled symbols verified) — which makes the recall failure worse, because nothing looks broken. Root AGENTS.md sells it as the tool for "finding which file defines a symbol"; the orientation trace (F-008) hit it as a hard dead-end on both viewer questions. Cause is the generator/redirect, not staleness — regenerating does not fix it.

### F-006 · high · README.md: every path is right, every number is wrong — velocity: direct
Audited claim-by-claim (35 claims): paths/cmdlets ~100% accurate; quantitative/topology claims systematically stale or wrong:
- "~10 MB code repo" (L16) — off >25× (F-001). "ai-triad-data ~410 MB" — actual 4.8 GB on disk.
- "two repositories" (L12) — `.aitriad.json` declares a **third** (`sources_root: ../ai-triad-sources`, 680 document dirs); README L37 says sources live in ai-triad-data with "134 ingested documents" — **wrong repo and wrong count**.
- "92 AI-generated POV summaries" → 705. "713 conflicts" → 1,250. "Should show 318 nodes" (L73) → 785 POV nodes (1,197 incl. situations). `.aitriad.json` sample (L80-89) omits 4 keys the real file has.
Trust score 5/10: an agent following its topology claims searches the wrong repo for sources.

### F-007 · high · Root AGENTS.md: structural claims excellent, versioned claims rotten — velocity: direct
30/38 audited claims accurate. The rot: module "v0.8.0" → actual **0.8.6** (both manifests — violating the doc's own Version Update Checklist item 3); "40+ cmdlets in Public/" → **145** (the same doc says "110+" elsewhere — self-contradiction); "Electron 35" → ^41.1.1; "lib/debate/, **22** TypeScript files" → **182** (8× — an agent budgeting a sweep is off by an order of magnitude); `Get-Policy` and `Test-TaxonomyIntegrity` marked "planned — not yet implemented" → **both fully implemented** in `Public/` (an agent would re-implement or route around tested cmdlets); Organization type enum — **6 of 9 documented values don't exist** (doc says `company, nonprofit, government_agency, international_org, research_institution, industry_alliance`; code's ValidateSet at `Import-Organization.ps1:48` says `think_tank, advocacy, regulatory, academic, corporate, research_lab` — using documented values fails validation); OrganizationEdgeTypes example `partners_with` doesn't exist (`ALLIED_WITH`); CI "two jobs" → 4 (`changes`, `test-powershell`, `test-electron`, `test-container`).

### F-008 · high · Orientation trace: 12 steps, 5 raw-grep fallbacks, ~1,300 lines burned for one medium task — velocity: direct
A fresh-agent trace of "add `confidence_rationale` to a POV summary schema and propagate it" (full log in review evidence, Axis B):
- Outcome counts: 4 LED-CORRECTLY, 2 MISLED, 2 DEAD-END, 5 OMITTED (raw-search fallback).
- Worst failures: (1) README points to `taxonomy/schemas/` for schemas, but the POV summary "schema" is actually `scripts/AITriad/Prompts/pov-summary-schema.prompt` — an exemplar prompt, not a JSON Schema, and summaries are never schema-validated (only structural checks in `Private/Invoke-DocumentSummary.ps1:440-461`); (2) REPO_MAP dead-ends on both viewers (F-005); (3) the propagation surface is undocumented and duplicated — `KeyPoint` defined independently in `SummariesTab.tsx:27` and `summary-viewer/src/renderer/types/types.ts:23`, prompt list mirrored in `promptCatalog.ts:560`, real pipeline in 3 undocumented `Private/` files.
- The single best doc for the task, `docs/document-processing-pipeline.md` (accurate to file:line), is **linked from nowhere** — found only by a last-resort docs/ sweep.
- What worked: data-path story (.aitriad.json → summaries) fully accurate; cmdlet names real; honest "no test suites" claim for the viewers.

### F-009 · medium · Cross-doc contradictions on production facts — velocity: indirect
Production URL: 13 scripts hardcode `taxonomy-editor.yellowbush-aeda037d.eastus...` (e.g., `Test-TaxEditorHealth.ps1:24`) while `engineering/tech-lead/AGENTS.md` documents `gentlecoast-20f0bd5b.eastus2...` — one is stale; no shared constant. Same tech-lead AGENTS.md references `deploy/azure/AGENTS.md`, which does not exist (the real file is `operations/devops/azure/AGENTS.md`). CHANGELOG.md versions the taxonomy-editor app (0.13.x) without saying so, while the PS module is 0.8.x and root package.json 0.1.0.

### F-010 · medium · Test discovery is undocumented — velocity: direct (it gates every task's verify step)
AGENTS.md's Test Tiers table prescribes `Invoke-Pester -Tag <subsystem>` but **no tag registry exists anywhere**; summary-pipeline tests turn out to be tagged `ingestion` (discoverable only by grepping test files). Which vitest tests cover a component is likewise grep-only.

---

## C. Duplication (one behavior = N edits)

### F-011 · high · N-edit constants with live drift — velocity: direct
Measured definition sites (production code):
| Constant | N | Note |
|---|---|---|
| POV label maps (`acc → Accelerationist`) | **~24 files** (13 TE, 8 poviewer, 2 SV, lib) | |
| POV display colors | **≥9 in TE alone** | **Drift is live**: safetyist is `#3b82f6` in some files, `#E74C3C` in others (e.g., `PolicyAlignmentPanel.tsx:8` vs `debate-diagnostics/window/shared/constants.ts:34`) |
| `cosineSimilarity` | **12 definitions** (4 inside lib/ itself; byte-identical pair TE/SV `utils/similarity.ts`) | |
| Gemini endpoint URL | 11 files | lib provider + 4 PS + TE×4 + SV×2 |
| Anthropic endpoint/SDK | 9 files | |
| POV id set / node-ID regex | ~12 sites (incl. same-app twice: TE main + server `SYNTHETIC_POV_KEYS`) | sanctioned source `POV_KEYS`/`AI_POVERS` (`lib/debate/types.ts:1714-1717`) is minority-adopted |
| Default model names | ~8 | hardcoded fallbacks despite ai-models.json being nominal SoT |
| Conflict stance enum | 4 (TE types, TE zod, 2 PS cmdlets) | |

### F-012 · high · Three parallel Electron shells; ~4,500–5,500 redundant LOC — velocity: direct
jscpd (min-tokens 70, prod code): 367 clones / 45,102 duplicated tokens. Per-pair similarity of structural files: `diagnosePython.ts` TE↔SV **94%**, `utils/similarity.ts` **100% byte-identical**, `modelDiscovery.ts` **56%** (567 vs 344 LOC forks), `ApiKeyDialog.tsx` SV↔TE **81%**, `errorMessages.ts` 78%, `DescriptionToggle.tsx` TE↔PO 74%. Each app carries its own main/preload/ipcHandlers/apiKeyStore. **Three independent AI-client implementations** (TE server `aiBackends.ts` + TE main; PO `aiEngine.ts` 373 LOC; SV `generateContent.ts` 491 LOC) — none uses `lib/ai-client`. Consolidating PO+SV into one shell with views eliminates an estimated **~4,500–5,500 LOC (~35% of their combined 14,400 prod LOC)**. Mitigation pattern already proven: `lib/electron-shared/` exists and PO/SV consume 5 modules from it via re-export shims — it just covers ~5 of ~15 parallel files.

### F-013 · medium · lib↔taxonomy-editor vendored forks — velocity: direct
428 exact-clone lines (jscpd) between lib/ and TE: `src/renderer/types/taxonomy.ts` ↔ `lib/debate/taxonomyTypes.ts` 51% similar incl. duplicated `interpretationText()`; `useDebateStore/helpers.ts` (2,642 LOC) shares ~220 lines with `lib/debate/helpers.ts`/`debateEngine.ts` incl. duplicated exports `hashString`, `looksTruncated`; store slices re-implement engine phase logic (~135 cloned lines); `computeEmbeddings` defined 4×. TE already imports `@lib` from 176 renderer files — no plumbing obstacle, just unfinished adoption.

### F-014 · medium · TE main↔server duplication (Electron vs web doing the same job twice) — velocity: direct
270 exact-clone lines / 17 clones: `src/main/fileIO.ts` ↔ `src/server/storage/fileIO.ts` (123 clone lines, 255 common) and `src/main/communityReviewIO.ts` ↔ `src/server/community/admin/communityReviewHandler.ts` (92). Every storage behavior change is a 2-edit task with drift risk (this exact pattern caused the t/1273 CI breakage in June).

### F-015 · medium · Prompt text forked across languages — velocity: direct
`summary-viewer/src/renderer/prompts/{attributeExtraction,edgeDiscovery,hierarchyPlacement}.ts` are near-verbatim TS forks of `scripts/AITriad/Prompts/*.prompt` (same enumerated vocabularies, ~350 L/pair). Changing extraction vocabulary = ≥2 edits in 2 languages. Additionally `taxonomy-editor/src/renderer/data/promptCatalog.ts:560,577` mirrors the prompt-file list — a third undocumented propagation point (hit in the F-008 trace).

### F-016 · low · Duplicated view types — velocity: indirect
`KeyPoint` defined independently in TE `SummariesTab.tsx:27` and SV `types/types.ts:23`; no shared type despite the repo's own Shared Utility Rule.

---

## D. Internal code coherence

### F-017 · critical · Monolith convergence: the top-churn files are the biggest files, and they're still growing — velocity: direct (primary mechanism)
The four highest-churn files are the four largest code files, and all grew during the review window (June→July): `debateEngine.ts` 6,046 LOC — **one god class** (`DebateEngine`, ~88 methods, 128 private members, 40+ `// ──` section banners: checkpoint resume, doctrinal anchoring, perturbation testing, sycophancy guard, calibration…), importing **46 sibling modules** — satellites got extracted repeatedly but the orchestrator keeps absorbing growth. `server.ts` 4,938 LOC — hand-rolled router with **177 route registrations in one file** (admin 35, sync 17, debates 9); the routes array is module-local and unexported, so no route group can be extracted without restructuring; 0 TODO/refactor markers. `styles.css` 18,605 LOC / 3,253 rule blocks (the co-located per-component .css pattern exists — 14 files — but core-UI growth still lands in the monolith). `prompts.ts` 4,572 LOC / 65 prompt builders. The completed decomposition (useDebateStore → 8 slices) demonstrates the failure mode: mass moved, and two new near-monoliths formed inside it (`helpers.ts` 2,642, `debateLoopSlice.ts` 2,231). Every feature PR merges through these files: they are the contention point for multi-agent work, the context-window burn for every read, and the merge-conflict surface.

### F-018 · high · Configuration: 14 live mechanisms, 3 dead, and an 8-way answer to "which model?" — velocity: direct
Census: ai-models.json (31 files read it), ai-usages.json, .aitriad.json (PS reads it; TS ignores it and uses the env var), ~35 distinct env vars TS-side + `$env:AI_MODEL` ×19 PS-side, `{dataRoot}/admin/runtime-config.json` (~52 params, hot-reload), proxy-tiers.json, quotas, 14 renderer localStorage keys, sessionStorage, duplicated `modelDiscovery.ts` (567+344 LOC), `~/.aitriad-env`, featureFlags, providerBinding, usePromptConfigStore. "Which model do we use?" is answerable from **≥8 places** (defaults / debateTiers / fallbackChains / per-usage / `$env:AI_MODEL` / pinnedModel / localStorage / proxy-tier constraints) **with no documented precedence**. Dead config: `config/translation.yml` (0 readers), `debate-validation-config.json` (0 readers), `ai-usages.json:turn.brief` (0 call sites).

### F-019 · high · ADR-003 (flight recorder in every catch) is soft inside TE and fictional outside — velocity: direct (diagnostic blind spots slow incident-driven work)
The enforcing ESLint rule is `'warn'` not `'error'` (`taxonomy-editor/eslint.config.mjs:42`) though ADR-003 claims enforcement. Measured: 377 of 1,119 catch blocks (33.7%) in lib+TE non-test code lack a recorder call — concentrated exactly in the churn hotspots (`server.ts` 66, `storage/fileIO.ts` 36, `web-bridge.ts` 29, `debateEngine.ts` 24). poviewer/summary-viewer: **0 flight-recorder imports; 81/81 catches non-compliant**. ADR-001: lib 23% bare throws, TE 27% (worst: web-bridge.ts 8 — the most-imported renderer module), poviewer partial, summary-viewer clean.

### F-020 · medium · UsageID migration stalled at the trailhead — velocity: indirect
19 usage IDs in ai-usages.json vs 65 prompt builders in prompts.ts; only 4 debateEngine call sites use `generateViaUsage`; 3/4 spot-checked usages are `"{{prompt}}"` passthroughs (config holds model/temp only, templates stay in TS). Two parallel prompt systems must both be understood for any prompt change.

### F-021 · medium · PowerShell surface entropy (module is otherwise healthy) — velocity: direct but small
All 28 verbs approved; help coverage 97.9% (the 3 gaps are the whole config family: `Get-TriadConfig`, `Set-TriadConfig`, `Invoke-TriadConfigReload`); Public/Private split principled (0 live leakage). The entropy: **5 names for input path** (`Path`/`ConfigPath`/`DocPath`/`File`/`From`), 4 for output (`OutputPath`/`OutputFile`/`OutputDirectory`/`OutputDir`); the POV-file load loop inlined in **24 Public cmdlets** with no Private helper; export drift — `Get-AICostReport` exported in psm1:638 but missing from psd1 `FunctionsToExport` (invisible via manifest import); prod URL hardcoded 13× (see F-009); `Get-TriadConfig` has 0 cmdlet consumers.

### F-022 · low (positive) · Module boundaries are the model citizen — velocity: none
dependency-cruiser: **0 violations across 905 modules / 4,113 dependencies**; 5 error-severity rules (lib-not-to-app, renderer-not-to-server/main, etc.) wired into `npm run verify`; independently confirmed by grep. This is the existence proof that this repo *can* enforce architecture rules — F-019's problem is a rule set to `warn`, not an inability to enforce.

### F-023 · low · Organization entropy at the edges — velocity: indirect
lib/debate: 182 files flat (108 source + 74 `*.test.ts` interleaved) **plus** a `__tests__/` dir — two test-location conventions in one directory. hooks/: `useTaxonomyStore/` slice-dir and `useTaxonomyStore.ts` file coexist at the same level (the .ts is an orphan per the repo's own depgraph). renderer/components: mostly clean feature folders; 1 PascalCase outlier (`PovProgression/`); `analysis/` (44 files) and `shared/` (43) approaching junk-drawer size. depgraph tool defect: counts `types` and `types.ts` import specifiers as separate nodes, splitting centrality stats.

---

## E. Conceptual coherence (spec vs implementation)

### F-024 · critical · cc-/sit- identity split-brain with a loaded collision hazard — velocity: direct (misleads every situations-adjacent task)
`situations.json` contains **246 `cc-*` + 166 `sit-*` nodes**; the situations schema requires `^sit-\d{3}$` (`situations-taxonomy.schema.json:94`) → **60% of situation nodes violate their own schema**, undetected because nothing executes it (F-025). Code disagrees with itself: handles both (`topicCritique.ts:189,217,338,728`, `SummariesTab.tsx:255`); **sit-only** — silently missing 60% of situations — in `debateEngine.ts:415,418,1678,1682` (citation tracking), `calibrationLogger.ts:707,746`, `situationRefs.ts:83`, and 4 diagnostics tabs; **cc-only** in `summary-viewer/src/main/fileIO.ts:374` (comment claims "per the taxonomy schema" while contradicting it). The sanctioned "single source of truth" `nodePovFromId`/`nodeTypeFromId` (`nodeIdUtils.ts:38-58`) returns **null for cc-***. Loaded gun: `normalizeNodeId` (`lib/debate/index.ts:87`) maps `cc-NNN → sit-NNN`, but **all 166 sit numbers collide with cc numbers naming different nodes** (verified: cc-001 ≠ sit-001); no live callers today, but `nodeIdUtils.ts:68` explicitly directs developers to it. Any adoption silently rewires 5,047 cc-touching edges to unrelated nodes.

### F-025 · high · The JSON Schemas are executed by nothing, and the real validators contradict them — velocity: direct
Zero ajv/`Test-Json`/jsonschema usage repo-wide; the only code touching `taxonomy/schemas/` is SBOM/size tooling. Real validation is parallel and drifted: renderer zod (`utils/validation.ts`) validates ~40% of the node schema's fields (no ID pattern — accepts any string; entire enrichment layer unvalidated); **conflict validators are mutually exclusive** — schema `status: [open, closed, resolved]` vs zod `['open','resolved','wont-fix']`, schema `human_notes: string[]` vs zod `{author,date,note}[]` — any non-empty value valid under one is invalid under the other. **4 of 11 `conflicts/*.json` are invalid under both** (missing required fields; nothing ever ran either validator against them). Schema self-staleness: `pov-taxonomy.schema.json:93` example `"acc-goals-001"` violates its own line-70 pattern (pre-BDI-rename leftover); the shipped mac release bundles the pre-migration schema; `docs/sre-data-integrity-review-guide.md:66` documents the old ID pattern as current. Consolidator writes `_schema_version: "2.0"` (`scripts/consolidate_conflicts.py:424`) for which no schema exists.

### F-026 · high · Edge types: no schema, three competing vocabularies, 32% of edges semantically inert — velocity: direct
No edges schema exists (edges.json = 31,810 edges, the argumentation backbone). Canonical 8 types live only in a PS array (`Resolve-EdgeType.ps1:10-19`), enforced on PS write paths only. `edges.json` top-level `edge_types` registry lists **74 types including typo `CONTRIBUES_TO`** — never reconciled; actual instances use 7 canonical types (CONVERGES_WITH: 0 instances). The TS editor's `checkEdgeDomainRange` (`validators.ts:160-197`) has **no default case** — unknown edge types pass the save gate silently. QBAF/confidence code maps only 4/8 types to attack/support (`modulateEdgeWeights.ts:59-60`): TENSION_WITH (6,344 edges), RESPONDS_TO (2,836), INTERPRETS (938) — **~32% of all edges have no argumentation semantics**, with no documented decision.

### F-027 · medium · QBAF claims vs implementation — velocity: indirect
`conflict.schema.json:278-281` hardcodes `algorithm: ["df-quad"]`; the implementation (`lib/debate/qbaf.ts:59-66`) is a deliberate custom semantics (sum-and-clamp, documented in `docs/aggregative-semantics-review.md:47-50`) — fine — but `Invoke-QbafConflictAnalysis.ps1:253-281` writes an output shape incompatible with the schema (flat `{claims, edges,...}` vs required `{graph:{nodes,edges}, algorithm,...}`; `label`/`category` vs `text`/`source_pov`) and never writes the algorithm field. Every stored output in `ai-triad-data/qbaf-conflicts/` is non-conforming. `qbaf-bridge.mjs` silently drops `oscillationDetected`/`dampingLevel` before PS sees them.

### F-028 · medium · specs/ is one stale spec — velocity: indirect
`specs/debate-turn-validation-impl.md` vs reality: phase names that no longer exist (`thesis-antithesis/exploration/synthesis` vs code's `confrontation/argumentation/concluding`, types.ts:30), `maxRetries` default 2 vs code 0 (turnValidator.ts:235), obsolete score formula (code: `0.4·stageA + 0.6·judgeQuality`, turnValidator.ts:750-756), 3 unspecced validation rules, retry loop relocated to `orchestration.ts:959-1202` with best-of-N — and spec'd PS flags `-DisableTurnValidation`/`-MaxTurnRetries` **never implemented** in `Show-TriadDialogue.ps1`. An agent implementing against this spec produces wrong config referencing nonexistent phases.

### F-029 · low (positive) · BDI is substantive and aligned — velocity: none
Three vocabulary registers consistently mapped with normalization shims; ID↔category enforced (validateNodeId.ts:114-133 + PS mirror); data 100% clean (785 nodes: 433 B / 74 D / 278 I); per-category weight regimes identical in PS and TS and fed into debate prompts. Minor: `Invoke-BDIWeightAssignment.ps1:7` synopsis omits Intentions. The claimed "four POV camps with BDI categories" is doc-wrong though: the design is **3 debating POVs + shared situations**, and cc/sit nodes have no BDI segment (feeds F-007/F-024).

### F-030 · low · Assorted spec/prompt drift — velocity: indirect
`situation-candidates-schema.prompt:10-14` shows legacy string interpretations while its own instruction prompt (lines 18-27) demands BDI 4-field objects — contradictory shape guidance to the model. `edge-discovery-batch-schema` has an undocumented `new_edge_types` field whose content is silently dropped downstream. `attribute-extraction` emits 11 graph_attributes fields, 3 documented. Dead pattern in `PovProgressionView.tsx:221` matches an ID scheme (`^(?:acc|saf|skp|cc)-([BDI])-`) that never existed.

---

## Velocity-contribution summary

| Mechanism | Findings | Verdict |
|---|---|---|
| Monolith convergence (churn = LOC) | F-017 | **Confirmed — primary** |
| Navigation cost / doc drift | F-005–F-010 | **Confirmed — primary** |
| Duplication (N-edit changes) | F-011–F-016 | **Confirmed — major** |
| Context pollution / dead weight | F-001–F-004 | **Confirmed — major** |
| Missing/contradictory verification | F-019, F-025, F-026, F-010 | **Confirmed — moderate** |
| Config ambiguity | F-018, F-020 | **Confirmed — moderate** |
| Conceptual drift misleading agents | F-024, F-027, F-028, F-030 | **Confirmed — task-specific** |
| Coupling / boundary decay | F-022 | **Ruled out** (0 violations; boundaries exemplary) |
| PS module hygiene as major drag | F-021, F-029 | **Ruled out as major** (minor entropy only; module is the healthiest large surface) |
| Convention entropy (naming/layout) | F-023 | **Ruled out as major** (edges only) |

See VELOCITY-DIAGNOSIS.md for the causal narrative and BACKLOG.md for remediation.
