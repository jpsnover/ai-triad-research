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
