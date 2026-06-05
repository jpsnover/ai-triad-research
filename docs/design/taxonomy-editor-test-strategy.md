# Taxonomy Editor Test Strategy

**Ticket:** t/417  
**Author:** Technical Lead  
**Date:** 2026-06-05  
**Status:** Proposed  
**Related:** t/415 (Decomposition Plan)

## 0. MCP Server Setup

### Selected Server: `@kanishka-namdeo/electron-mcp-server` v1.0.4

44 tools across 6 categories: App Lifecycle (4), Element Interaction (10), Main Process & Window Control (8), Visual Testing & Accessibility (11), Advanced CDP (12), Codegen & Recording (3).

**Install** (already done globally):
```bash
npm install -g @kanishka-namdeo/electron-mcp-server
```

**MCP Configuration** — add to Claude Code / Orca MCP settings:
```json
{
  "mcpServers": {
    "electron-mcp": {
      "command": "electron-mcp-server",
      "env": {
        "LOG_LEVEL": "info",
        "NODE_ENV": "production"
      }
    }
  }
}
```

### App-Side Change: Enable CDP Attachment

The taxonomy-editor main process needs a `--debug-cdp` flag to enable Chrome DevTools Protocol attachment. Without this, the MCP server cannot connect.

**File:** `taxonomy-editor/src/main/main.ts` — add before `app.whenReady()`:

```typescript
// Enable CDP for MCP-based GUI testing (--debug-cdp flag)
if (process.argv.includes('--debug-cdp')) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222');
  console.log('[main] CDP enabled on port 9222 (--debug-cdp)');
}
```

**Launch for testing:**
```bash
cd taxonomy-editor && npm run dev -- --debug-cdp
```

**Connection flow:**
1. App starts with CDP on port 9222
2. MCP server's `connect_to_electron_cdp` tool connects via `http://localhost:9222`
3. All subsequent tools operate against the connected session

---

## 1. Smoke Test Suite (Pre-Refactoring Baseline)

Quick health checks — run these before AND after each refactoring phase to catch regressions. ~5 minutes total.

| # | Test | MCP Tools Used | Validates |
|---|------|---------------|-----------|
| S1 | App launches, main window appears | `connect_to_electron_cdp`, `get_main_window_info` | Electron bootstrap, main process |
| S2 | Title bar shows app name | `get_page_info` | Renderer loaded, React mounted |
| S3 | Settings dialog opens and closes | `click` (gear icon), `wait_for_selector` (.dialog-overlay), `screenshot`, `click` (Close) | Dialog lifecycle, overlay z-index |
| S4 | Backend dropdown has all 6 backends | `click` (.settings-select), `execute` (query options), `get_text` | useTaxonomyStore AI_BACKENDS |
| S5 | Create new debate dialog opens | `click` (New Debate button), `wait_for_selector` (.new-debate-dialog) | NewDebateDialog render |
| S6 | Tab navigation — all tabs render | `click` each tab, `wait_for_selector` (tab content), `screenshot` | Tab routing, lazy load |
| S7 | Theme switching (light → dark → BKC) | `click` settings, `select` theme, `screenshot`, `compare_screenshots` | CSS variables, theme persistence |
| S8 | Diagnostics window opens | `click` diagnostics trigger, `get_main_window_info` (check 2nd window) | BrowserWindow creation, IPC |
| S9 | Responsive layout at phone width | `set_viewport_size` (375×667), `screenshot`, `wait_for_selector` (.bottom-nav) | Responsive breakpoints |
| S10 | Console has no errors on load | `get_console_messages` (filter level=error) | No runtime errors |

### Visual Baseline Capture

Before Phase 1, capture baseline screenshots for all 10 smoke tests using `take_screenshot`. Store in `taxonomy-editor/test-baselines/smoke/`. After each phase, `compare_screenshots` detects unintended visual changes.

---

## 2. Extensive Test Suite (Module-Mirrored)

Organized to mirror the target directory structure from the decomposition plan. Each module directory gets a corresponding test section.

### 2.1 `debate-workspace/` Tests

| # | Test | Tools | Validates |
|---|------|-------|-----------|
| DW1 | StatementCard renders speaker name + content | `get_text` (.statement-card .speaker), `get_text` (.statement-card .content) | StatementCard.tsx |
| DW2 | StatementCard shows model badge in multi-provider mode | `get_text` (.model-badge) | Multi-provider t/408 |
| DW3 | TopicCritique radar chart renders | `wait_for_selector` (.radar-chart svg), `screenshot` | TopicCritique/ |
| DW4 | ClarificationPanel shows questions and accepts answers | `wait_for_selector` (.clarification-panel), `fill` (answer inputs), `click` (submit) | ClarificationPanel.tsx |
| DW5 | OpeningPanel shows all 3 POV openers | `wait_for_selector` (.opening-panel), `get_text` (per-speaker sections) | OpeningPanel.tsx |
| DW6 | DebateActionBar: @mention autocomplete | `fill` (debate input, "@"), `wait_for_selector` (.mention-dropdown) | DebateActionBar.tsx |
| DW7 | ClaimsView: AN nodes render per statement | `click` (expand claims), `wait_for_selector` (.claim-node-row) | ClaimsView.tsx |
| DW8 | VocabularyPanel: lineage terms display | `click` (vocabulary tab), `wait_for_selector` (.vocab-term-card) | VocabularyPanel.tsx |
| DW9 | TaxonomyRefs: pills render with correct POV colors | `wait_for_selector` (.taxonomy-pill), `execute` (check computed styles) | TaxonomyRefs.tsx |
| DW10 | Full debate lifecycle (clarification → opening → debate → synthesis) | Sequential flow using `click`, `fill`, `wait_for_selector`, `screenshot` at each phase | End-to-end integration |

### 2.2 `debate-diagnostics/window/` Tests

| # | Test | Tools | Validates |
|---|------|-------|-----------|
| DDW1 | DiagnosticsWindow opens as separate BrowserWindow | `get_main_window_info` (count windows) | Shell, IPC broadcast |
| DDW2 | Overview tab: Argument Network renders SVG | `click` (AN tab), `wait_for_selector` (svg.argument-network) | ArgumentNetworkTab.tsx |
| DDW3 | Overview tab: Adaptive Staging timeline | `click` (staging tab), `wait_for_selector` (.stage-timeline) | AdaptiveStagingTab.tsx |
| DDW4 | Overview tab: Reflections display | `click` (reflections tab), `get_text` (.reflection-entry) | ReflectionsTab.tsx |
| DDW5 | Overview tab: Utility scores per turn | `click` (utility tab), `wait_for_selector` (.utility-row) | UtilityTab.tsx |
| DDW6 | Entry detail: Draft tab shows pipeline stages | `click` (entry row), `click` (draft tab), `wait_for_selector` (.draft-stage) | DraftTab.tsx |
| DDW7 | Entry detail: Claims tab shows extracted claims | `click` (claims tab), `wait_for_selector` (.claim-item) | ClaimsTab.tsx |
| DDW8 | Entry detail: Evidence tab shows items + QBAF | `click` (evidence tab), `wait_for_selector` (.evidence-item) | EvidenceTab.tsx |
| DDW9 | Entry detail: Citations tab shows resolution status | `click` (citations tab), `wait_for_selector` (.citation-row) | CitationsTab.tsx |
| DDW10 | Search filters entries across all tabs | `fill` (search input), `get_text` (result count), verify filtered | useDiagnosticsState.ts |
| DDW11 | Keyboard navigation: arrow keys move between entries | `execute` (dispatch keydown), `get_text` (.selected-entry) | useDiagnosticsState.ts |
| DDW12 | Shared: ScoreBreakdown renders validation scores | `wait_for_selector` (.score-breakdown), `get_text` | shared/ScoreBreakdown.tsx |
| DDW13 | Shared: CommitmentsPanel visualization | `wait_for_selector` (.commitments-panel) | shared/CommitmentsPanel.tsx |

### 2.3 `debate-diagnostics/panel/` Tests

| # | Test | Tools | Validates |
|---|------|-------|-----------|
| DDP1 | DiagnosticsPanel renders in main window sidebar | `wait_for_selector` (.diagnostics-panel) | Shell layout |
| DDP2 | EntryView shows per-entry diagnostics | `click` (entry), `wait_for_selector` (.entry-diagnostics) | EntryView.tsx |
| DDP3 | WhatIfSection: counterfactual QBAF | `click` (what-if toggle), `wait_for_selector` (.what-if-section) | WhatIfSection.tsx |
| DDP4 | DocumentCoverageSection: per-claim coverage | `wait_for_selector` (.coverage-status) | DocumentCoverageSection.tsx |
| DDP5 | VerificationSection: grouped by verdict | `wait_for_selector` (.verification-group) | VerificationSection.tsx |

### 2.4 `debate-diagnostics/chat/` Tests

| # | Test | Tools | Validates |
|---|------|-------|-----------|
| DDC1 | Chat sidebar opens | `click` (chat toggle), `wait_for_selector` (.chat-sidebar) | DiagnosticsChatSidebar.tsx |
| DDC2 | Slash command autocomplete | `fill` (chat input, "/"), `wait_for_selector` (.slash-commands) | Slash command registry |
| DDC3 | Chat sends message and shows response | `fill` + `click` (send), `wait_for_selector` (.chat-message.assistant) | Chat flow |

### 2.5 `hooks/useDebateStore/` Tests

State transition tests using `execute` to call store actions and verify state.

| # | Test | Tools | Validates |
|---|------|-------|-----------|
| DS1 | Create debate → session appears in list | `execute` (call createDebate), `get_text` (.debate-list-item) | sessionSlice.ts |
| DS2 | Config changes persist across navigation | `execute` (set config), navigate away and back, `execute` (read config) | configSlice.ts |
| DS3 | Topic critique scoring returns structured results | Run critique flow, `execute` (read store state) | topicCritiqueSlice.ts |
| DS4 | Clarification → Opening phase transition | `execute` (verify phase changes) | clarificationSlice.ts |
| DS5 | Debate loop: cross-respond triggers claim extraction | Run cross-respond, `execute` (check AN state) | debateLoopSlice.ts |
| DS6 | Synthesis produces summary | Trigger synthesis, `wait_for_selector` (.synthesis-output) | synthesisSlice.ts |
| DS7 | Argument network: node creation and QBAF scores | `execute` (check AN node count, QBAF scores) | argumentNetworkSlice.ts |

### 2.6 `hooks/useTaxonomyStore/` Tests

| # | Test | Tools | Validates |
|---|------|-------|-----------|
| TS1 | Taxonomy data loads on startup | `execute` (check store has nodes) | taxonomyDataSlice.ts |
| TS2 | Text search filters nodes | `fill` (search bar), `get_text` (result count) | searchSlice.ts |
| TS3 | AI analysis triggers and completes | `execute` (trigger analysis), `wait_for_selector` (.analysis-result) | analysisSlice.ts |
| TS4 | Theme setting persists after reload | `execute` (set theme), reload page, `execute` (read theme) | settingsSlice.ts |

### 2.7 Cross-Cutting Tests

| # | Test | Tools | Validates |
|---|------|-------|-----------|
| CC1 | Responsive: phone breakpoint (375px) | `set_viewport_size`, `screenshot`, check bottom nav | Responsive layout |
| CC2 | Responsive: tablet breakpoint (768px) | `set_viewport_size`, `screenshot` | Responsive layout |
| CC3 | Keyboard shortcuts: Ctrl+K search, Ctrl+N new debate | `execute` (dispatch keyboard events) | Global shortcuts |
| CC4 | Multi-provider: tier badge shows on debate entries | Create multi-provider debate, `get_text` (.model-badge) | t/408 |
| CC5 | No console errors after full debate cycle | Run full debate, `get_console_messages` (filter errors) | Error-free operation |

---

## 3. Phase Gate Protocol

Before each migration phase:

1. **Capture baselines**: Run all smoke tests + relevant module tests, save screenshots to `test-baselines/phase-N-pre/`
2. **Execute the phase**: Extract modules per decomposition plan
3. **Run regression gate**:
   - All 10 smoke tests pass
   - Module-specific tests for the affected directories pass
   - `compare_screenshots` against pre-phase baselines — diff threshold < 1%
   - `get_console_messages` shows no new errors
4. **Archive**: Save post-phase screenshots to `test-baselines/phase-N-post/`

### Phase → Test Mapping

| Phase | Smoke Tests | Module Tests |
|-------|------------|-------------|
| Phase 1 (Scaffolding + Low-Risk) | All S1-S10 | DW1-DW9, DDW12-DDW13, DDP3-DDP5 |
| Phase 2 (DiagnosticsWindow Tabs) | S8, S10 | DDW1-DDW13 |
| Phase 3 (DebateWorkspace Actions) | S5, S6, S10 | DW1-DW10 |
| Phase 4 (useTaxonomyStore) | S3, S4, S6, S10 | TS1-TS4 |
| Phase 5 (useDebateStore) | S5, S6, S8, S10 | DS1-DS7, DW10 |
| Phase 6 (DiagnosticsPanel EntryView) | S8, S10 | DDP1-DDP5 |

---

## 4. Evaluation Summary

### Why `@kanishka-namdeo/electron-mcp-server`

| Criterion | Score | Notes |
|-----------|-------|-------|
| Electron compatibility | Excellent | Purpose-built, CDP + Playwright hybrid, Electron 34+ features |
| Selector support | Good | CSS selectors + accessibility tree + role-based interaction |
| Stability | Fair | v1.0.4, 4 releases in 2 days (Feb 2026), MIT licensed |
| MCP compliance | Excellent | Standard stdio transport, 44 tools, Zod validation |
| Automation scope | Excellent | Screenshots, element interaction, visual regression, main process, codegen |

### Runners-up

- **robertn702/playwright-mcp-electron** — Accessibility-tree-first (better for LLM), but no visual regression
- **laststance/electron-mcp-server** — Simpler (CDP-only), but no main process access or accessibility tree
- **microsoft/playwright-mcp** — Best maintained, but no Electron support (Issue #994 open)
