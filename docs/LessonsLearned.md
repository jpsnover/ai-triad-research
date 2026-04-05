# Lessons Learned

Recurring failure patterns and how to prevent them. Maintained by the Sage agent. Read this before designing or implementing anything — past mistakes are the cheapest teacher.

---

<!-- Entries added by the Sage as errors are reported and patterns emerge. -->
<!-- Format: ## [Category] Pattern Title -->
<!-- See roles/sage/AGENTS.md for full format specification. -->

## [PowerShell] `[PSCustomObject]` Type Constraint Fails on `ConvertFrom-Json` Output

**Pattern:** Explicit `[PSCustomObject]` parameter type constraints crash when receiving objects from `ConvertFrom-Json`, even though the output *is* technically a `PSCustomObject`.
**Instances:**
- 2026-04-02: `Invoke-SituationsMigration.ps1` Phase 2 dry-run — `Rename-JsonKey` helper declared `[PSCustomObject]$InputObject`, crashed on `ConvertFrom-Json` output (p/19#1).
**Root Cause:** PS7's `ConvertFrom-Json` emits `[PSCustomObject]` instances that do not satisfy the `[PSCustomObject]` type accelerator when used as a parameter constraint. This is a long-standing PS7 quirk — the accelerator checks for `System.Management.Automation.PSCustomObject` as a type name, but the runtime objects carry `System.Management.Automation.PSObject` as their actual type.
**Prevention:** Never use `[PSCustomObject]` as a parameter type constraint for data that may originate from `ConvertFrom-Json`. Use `[object]` or `[psobject]` instead. If validation is needed, assert inside the function body with `if ($InputObject -isnot [psobject]) { throw ... }`.
**Applies To:** All profiles writing PowerShell helpers that accept parsed JSON.

## [Process] Ticket Status Not Updated During Execution

**Pattern:** Agents execute work on tickets without transitioning them from Backlog/Todo to In Progress, making it impossible for the human and other agents to tell whether work is progressing or stalled.
**Instances:**
- 2026-04-02: Situations migration was ~80% complete but all tickets still showed Backlog/Todo status. Human had no visibility into progress (p/23#1).
**Root Cause:** No enforced rule requiring agents to transition tickets when picking up work. Agents focused on the implementation and skipped the coordination step.
**Prevention:** "Keep Tickets Current" rule added to root AGENTS.md. All agents must: transition to In Progress when starting, Done + summary comment when finished, add blocker comments when blocked, and note handoffs in comments. Ticket status is the coordination contract — if the status is wrong, the team is flying blind.
**Applies To:** All profiles.

## [Migration] Shared Function Output Changes Break Cross-Scope Tests

**Pattern:** Changing a shared function's output format (headers, section structure) without grepping for tests that assert on those strings — especially tests in other profiles' scopes — causes silent breakage discovered only later during unrelated work.
**Instances:**
- 2026-04-02: Shared Lib changed `formatTaxonomyContext()` section headers and split vulnerability sections (RE-7/RE-2/RE-3) without updating `taxonomyContext.test.ts` in taxonomy-editor scope. 9 test failures. Tests expected BDI headers ("BELIEFS", "DESIRES") but function now returns "YOUR EMPIRICAL GROUNDING". Surfaced during electron-builder upgrade validation — pre-existing from Phase 3, not caused by the upgrade. Fixed in 3c85054 (p/30#1, p/31#1).
**Root Cause:** The agent changing the function did not grep for cross-scope test files asserting on its output strings. The tests were in another profile's scope, so they weren't in the natural "change + verify" loop.
**Prevention:** When changing any shared function's output format: (1) grep the entire repo for test files that assert on the old output strings — `grep -r "OLD_HEADER" --include="*.test.*"`, (2) update or flag those tests in the same commit, even if they're outside your scope — your changes caused the breakage so you own the fix (per AGENTS.md collaboration rules), (3) run the affected test suite before committing.
**Applies To:** All profiles, especially Shared Lib and any profile owning functions consumed cross-scope.

## [Build] UI Regressions After Major Dependency Upgrade (Electron)

**Pattern:** Major framework upgrades (Electron, React, Vite) introduce UI regressions — panels render blank, unexpected UI elements appear — that are not caught until a human visually inspects the app.
**Instances:**
- 2026-04-02: Electron 41 upgrade caused edge browser, policy alignment, and policy dashboard to render blank; console panel gained an unwanted chat detail pane. Discovered by user before formal regression testing completed (p/19#3).
**Root Cause:** Pending — initial report, root cause analysis in progress. Likely candidates: breaking changes in Electron 41's renderer process, webContents API, or CSS defaults; or concurrent feature work (Situations migration, RE changes) conflicting with the upgrade.
**Prevention:** For major dependency upgrades: (1) complete a visual regression checklist of all panels/views *before* merging — automated tests catch logic errors but miss rendering blank, (2) do not bundle unrelated feature work into the same build as the upgrade — isolate the upgrade so regressions are clearly attributable, (3) maintain a "smoke test" list of every panel/view in the app to manually verify after upgrades.
**Applies To:** All profiles working on Electron apps, especially SRE and Technical Lead during upgrades.

## [Process] Duplicate Tickets After Archiving Parent Epics

**Pattern:** Archiving a parent epic orphans its child tickets, making completed work invisible. When remaining work is recreated under a new parent, already-completed items get duplicated because there's no check against prior completion.
**Instances:**
- 2026-04-02: OC-4 (Runtime Validation Layer) was created 3 times (t/40, t/70, t/93) — all duplicates of work already completed in commit c1cb555. The original parent epic was archived, orphaning OC-4's completion record. Recreating remaining work didn't include a check for prior completion (p/23#3).
**Root Cause:** Archiving epics severs the link to child ticket history. The agent recreating work searched for open/backlog tickets but not for completed ones under archived parents.
**Prevention:** Before creating tickets for work items from a prior plan: (1) search tickets by title/key across *all* statuses (including Done and Archived) — not just open items, (2) check git log for commits referencing the work item ID (e.g., `git log --grep="OC-4"`), (3) when archiving parent epics, first verify all children are either completed (and marked Done) or migrated to the new parent — do not orphan in-progress or completed work.
**Applies To:** All profiles, especially Orca Support and any profile managing epics and work breakdowns.

## [PowerShell] Standalone Scripts Calling Non-Exported Functions

**Pattern:** Standalone batch scripts (outside the module's `Public/`/`Private/` directories) call functions that are not exported by the module. The function appears to work during interactive sessions (where the module's internal scope leaks) but fails in clean script execution.
**Instances:**
- 2026-04-02: `Invoke-TemporalScopeBackfill.ps1` calls `Resolve-AIApiKey` (defined in `AIEnrich.psm1`, not exported). Caught during dry-run of t/94 (p/23#5).
- 2026-04-02 (investigation): Same bug found in `Invoke-ArgumentMapBackfill.ps1` (line 98) and `Invoke-DescriptionRewrite.ps1` (line 135) — all three call `Resolve-AIApiKey` without importing `AIEnrich.psm1`.
**Root Cause:** `Resolve-AIApiKey` lives in `AIEnrich.psm1` which is imported internally by `AITriad.psm1` at module load. Public functions within the module can call it because they run in module scope. Standalone scripts import `AITriad` but that doesn't re-export `AIEnrich`'s functions — they're only visible inside the module. Scripts worked in dev because the module was already loaded in the session.
**Prevention:** (1) Standalone scripts must explicitly import every module whose functions they call — do not rely on transitive imports, (2) for Private/ helper functions, dot-source them explicitly (as `Invoke-BDIMigration.ps1` correctly does), (3) when creating new batch scripts, verify each function call resolves by running `Get-Command <FunctionName>` in a clean session before committing.
**Applies To:** All profiles writing standalone `.ps1` scripts that use module functions.

## [Process] Reporting Status From Stale Session Context

**Pattern:** An agent reports ticket/work status to the user based on what it remembers from earlier in the session, without querying the ticket system for current state. The report is wrong because other agents completed the work in the meantime.
**Instances:**
- 2026-04-02: Orca Support reported t/72 as "in progress" to the user when all 5 sub-tickets were already Done. The tickets were correctly updated — the reporter just didn't check before answering (p/23#7).
**Root Cause:** Agent relied on stale session memory instead of querying the source of truth. Related to but distinct from the "Ticket Status Not Updated" pattern — here the tickets *were* current, the reporter wasn't.
**Prevention:** Always query the ticket system before reporting status to a human. Never answer "what's the status of X?" from memory — run `get_ticket` or equivalent. Session context decays fast in multi-agent environments where any colleague may have progressed the work since you last checked.
**Applies To:** All profiles, especially when responding to human status inquiries.

## [Design] Schema Restructuring Causes Cross-Category LLM Regression

**Pattern:** Restructuring the output schema of a multi-criteria AI prompt — even when the change is logically equivalent — causes the LLM to regress on unrelated criteria that weren't modified.
**Instances:**
- 2026-04-03: Q-0 QBAF base score calibration. Collapsing three independent correlated criteria (v3) into a single enum (v4) was theoretically cleaner but caused cross-category regression — scores on unrelated criteria degraded. v3 with three separate criteria outperformed v4 (p/19#5).
**Root Cause:** LLMs are sensitive to output schema structure, not just semantic content. Changing the shape of one part of the schema (e.g., merging fields, switching from multiple booleans to an enum) alters the generation context for downstream fields, causing unpredictable changes in quality on unrelated criteria.
**Prevention:** When iterating on multi-criteria prompts: (1) change one category at a time, (2) measure all criteria after each change — not just the one you modified, (3) do not assume logically equivalent restructurings are behaviorally equivalent for the LLM, (4) keep a baseline score per version so regressions are immediately visible.
**Applies To:** All profiles working on AI prompts, especially Comp Linguist and any profile tuning QBAF or scoring prompts.

## [Type System] `as` Type Assertions Hide Breakage After Upstream Format Changes

**Pattern:** A consumer uses `as TargetType` to cast a value whose upstream type has changed, silencing TypeScript and producing silent runtime corruption (`undefined` property access, `[object Object]` stringification). The cast worked when the types originally matched but becomes a lie after the upstream changes shape.
**Instances:**
- 2026-04-03: `selectRelevantNodes` returns `ScoredPovNode[]` (wrapped `{ node, score }`) while sibling `selectRelevantSituationNodes` returns unwrapped `SituationNode[]`. Consumer cast with `as PovNode[]`, so TS didn't catch the mismatch. All debate POV context rendered as `[undefined] undefined: undefined` — no taxonomy grounding on any debate turn (p/48#1).
- 2026-04-03: CQ-1 changed `metadata.questions` from `string[]` to `{ question, options }[]`. `submitAnswersAndSynthesize` in `useDebateStore.ts` still cast it as `string[]`. Synthesis prompt received `[object Object]` as question text, producing garbage refined topics. Only rendering consumers were updated — non-rendering consumers (prompt injection, synthesis) were missed (p/48#3).
**Root Cause:** `as` assertions bypass TypeScript's structural type checking. When an upstream type changes shape, the compiler cannot flag consumers that cast the old shape — they compile cleanly and fail at runtime. The second instance adds a compounding factor: format migrations that only verify the visible (rendered) consumers and miss non-visible consumers (prompt builders, serializers, API callers).
**Prevention:** (1) Never use `as` to cast a function's return value or a data field to a different shape — if the types don't align, fix the source or add a proper type guard, (2) sibling functions (same module, parallel purpose) must use consistent return types, (3) when changing a data format (e.g., `string[]` → `{ question, options }[]`), grep for ALL consumers of that field across the entire repo — not just rendering code, but also prompt builders, serializers, and API callers, (4) treat `as` casts in the codebase as tech debt — each one is a potential silent failure point after the next upstream change.
**Applies To:** All profiles. Two instances in one day — this is a systemic risk anywhere `as` is used on shared data structures.
