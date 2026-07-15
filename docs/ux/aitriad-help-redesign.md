# Show-AITriadHelp — Redesigned Page IA/UX

**Author:** Design (Orca)
**Status:** Ready for implementation
**For:** t/1570 — auto-generated module reference for 158 cmdlets
**Constraint:** single self-contained HTML file, no external deps, works offline

---

## 1. Problem with the current layout

The existing page puts each cmdlet in a fully-expanded card: synopsis, full parameter table, and examples all visible at once. At 30-odd cmdlets this was tolerable; at 158 it produces an unusable scroll and a TOC that overflows the viewport. The fix is not "bigger TOC" — it is a different information architecture.

---

## 2. Information architecture

Two-pane layout: **sticky category sidebar** left, **searchable cmdlet list** right.

```
┌─────────────────────────────────────────────────────────────────────┐
│  AITriad Module Reference  v0.8.x     [🔍 filter cmdlets…]          │  ← sticky header
├──────────────────┬──────────────────────────────────────────────────┤
│ CATEGORIES       │  Taxonomy Data                         8 cmdlets │
│                  │  ─────────────────────────────────────────────── │
│  Taxonomy Data   │  ▸ Get-Tax          Load full taxonomy graph      │
│  8               │  ▸ Get-GraphNode    Look up a node by ID          │
│                  │  ▸ Get-Edge         Fetch edges (filter by type)  │
│  Organizations   │  ▸ Get-Policy       Look up policy actions        │
│  8               │  ▸ Get-TaxonomyHealth  Check structural health    │
│                  │  ▸ Compare-Taxonomy    Diff two taxonomy states   │
│  Graph &         │  ▸ Test-TaxonomyIntegrity                        │
│  Conflict        │  ▸ Test-OntologyCompliance                       │
│  7               │                                                  │
│                  │  Organizations                         8 cmdlets │
│  Debate Engine   │  ─────────────────────────────────────────────── │
│  11              │  ▸ Get-Organization    Look up org by id/name     │
│                  │  …                                               │
│  Sources &       │                                                  │
│  Ingestion       │                                                  │
│  8               │                                                  │
│                  │                                                  │
│  AI Enrichment   │                                                  │
│  8               │                                                  │
│                  │                                                  │
│  Health &        │                                                  │
│  Diagnostics     │                                                  │
│  14              │                                                  │
│                  │                                                  │
│  Config          │                                                  │
│  4               │                                                  │
│                  │                                                  │
│  ── 158 total ── │                                                  │
└──────────────────┴──────────────────────────────────────────────────┘
```

Clicking a cmdlet row expands it in-place. All other rows remain collapsed.

---

## 3. Category taxonomy

Seed directly from the AGENTS.md cmdlet catalog groupings. Suggested 8 groups (PowerShell to adjust counts from actual cmdlet list):

| Category | Key cmdlets (illustrative) |
|---|---|
| Taxonomy Data | Get-Tax, Get-GraphNode, Get-Edge, Get-Policy, Get-TaxonomyHealth, Compare-Taxonomy, Test-TaxonomyIntegrity, Test-OntologyCompliance |
| Organizations | Get-Organization, Find-OrganizationByPOV, Find-OrganizationByTopic, Get-OrganizationStakeholders, Import-Organization, Compare-OrganizationPositions, Get-OrganizationEdge, Import-OrganizationEdge |
| Graph & Conflict | Find-GraphPath, Find-Conflict, Invoke-GraphQuery, Invoke-CypherQuery, Invoke-QbafConflictAnalysis, Show-GraphOverview, Export-TaxonomyToGraph |
| Debate Engine | Show-TriadDialogue, Invoke-AITDebate, Resume-AITDebate, Get-AITDebate, Compare-DebateRuns, Compare-DebateQuality, Measure-DebateQuality, Invoke-DebateBatch, Watch-DebateProgress, Show-DebateDiagnostics, Repair-DebateOutput |
| Sources & Ingestion | Import-AITriadDocument, Save-AITSource, Find-AITSource, Get-IntellectualLineage, Get-PovLineage, Get-IngestionPriority, Invoke-AttributeExtraction, Invoke-EdgeDiscovery |
| AI Enrichment | Invoke-AIByUsage, Invoke-BatchSummary, Invoke-POVSummary, Invoke-BDIWeightAssignment, Invoke-EdgeWeightEvaluation, Invoke-VernacularBatch, Invoke-AphorismBatch, New-SyntheticCorpus |
| Health & Diagnostics | Test-TaxEditorHealth, Test-TaxEditorEndpoints, Test-AnonymousDebateFlow, Test-PersonaEndpoints, Test-ServiceWorkerHealth, Get-FreeTierStatus, Test-AzureHealth, Test-GitHubHealth, Get-ContainerAppRevision, Get-GitHubWorkflowRun, Remove-StaleContainerImages, Get-TaxonomySnapshot, Get-FlightRecorderDump, Get-AICostReport |
| Config | Get-TriadConfig, Set-TriadConfig, Register-AIBackend, Test-AIApiKey |

PowerShell assigns each cmdlet to a category at generation time (a static lookup table in the generator script is fine). Cmdlets not yet in the table fall into an **Uncategorized** group rather than being silently dropped.

---

## 4. Search behavior

- Single `<input type="search">` in the sticky header. Placeholder: `filter cmdlets…`
- Filtering is **client-side and instant** — no submit, no network call. A small embedded JSON blob holds all cmdlet data; JS filters on every `input` event.
- Match fields (in priority order): cmdlet name, synopsis, parameter names.
- **While a search is active:**
  - The sidebar shows each category's match count in muted text: `Taxonomy Data (3)`. Categories with zero matches show `0` and their nav entry is muted (but still visible — don't hide them; the user scanning for a category needs to see it's empty rather than wondering why it vanished).
  - The main panel shows only matching cmdlets, grouped under their category headers. Category headers with zero matches are hidden from the main panel (not the sidebar).
  - A small result count appears below the search box: `12 of 158 cmdlets`.
- **Clearing the search** returns to the full view. `Escape` clears and returns focus to the search input.
- No fuzzy matching needed. Substring match on name/synopsis/parameter names is sufficient.

---

## 5. Cmdlet row anatomy (collapsed)

```
▸  Get-Organization     Look up organization by id or search by name/type
```

- `▸` triangle rotates to `▾` when expanded.
- Cmdlet name: monospace (or semibold sans), `--text-sm` equivalent.
- Synopsis: regular weight, muted, same line. Truncated to one line with `text-overflow: ellipsis` — the full synopsis appears in the expanded view.
- Row is keyboard-focusable; `Enter` or `Space` expands.
- Row click anywhere expands/collapses.
- Clicking a different row collapses the currently-open one (one open at a time per category).

---

## 6. Cmdlet detail anatomy (expanded)

```
▾  Get-Organization     Look up organization by id or search by name/type
   ────────────────────────────────────────────────────────────────────
   SYNOPSIS
   Look up organization by id or search by name/type. Returns the
   full organization record.

   SYNTAX
   Get-Organization [-Id <String>] [-Name <String>] [-Type <String>]
                    [-DataRoot <String>] [<CommonParameters>]

   PARAMETERS
   ┌─────────────┬──────────┬──────────────────────────────────────┐
   │ Name        │ Type     │ Description                          │
   ├─────────────┼──────────┼──────────────────────────────────────┤
   │ -Id         │ String   │ Organization ID (org-NNN)            │
   │ -Name       │ String   │ Partial name search (case-insensitive│
   │ -Type       │ String   │ Filter by type (think_tank, …)       │
   └─────────────┴──────────┴──────────────────────────────────────┘

   EXAMPLES
   ┌───────────────────────────────────────────────────────────────┐
   │  Get-Organization -Id org-001                                 │
   │  Get-Organization -Name "Brookings" -Type think_tank          │
   └───────────────────────────────────────────────────────────────┘

   SEE ALSO
   Find-OrganizationByPOV · Find-OrganizationByTopic · Get-OrganizationStakeholders
```

Field-by-field spec:

**SYNOPSIS** — full text from `.SYNOPSIS` block, unwrapped into a prose paragraph.

**SYNTAX** — the auto-generated syntax line from `Get-Help -Full`. Display in a `<pre>` block, monospace, soft-wrapping allowed.

**PARAMETERS** — one row per non-common parameter from the `.PARAMETER` blocks. Columns: Name (with leading dash, monospace), Type, Description. Mandatory parameters are marked with a `*` suffix on the Name. CommonParameters row not needed; a small muted note "Supports -WhatIf, -Confirm" where applicable.

**EXAMPLES** — each `.EXAMPLE` block as a `<pre>` code snippet followed by the example description as a prose paragraph. Code on a slightly darker background, rounded corners.

**SEE ALSO** — the `.LINK` entries from the RELATED LINKS block (commit df0583f8 added these). Render as inline text links that scroll-to and expand the target cmdlet in the same page. If a link target isn't in the module (e.g. an external URL), open in a new tab.

---

## 7. Sidebar behavior

- **Fixed-position** beside the scrolling main panel. Sidebar does not scroll away.
- Category items are **jump links** — clicking scrolls the main panel to that category's section header and briefly highlights it (200ms background flash, `--bg-hover`).
- The **active category** in the sidebar is highlighted (left border tick, `--text-primary` weight) based on scroll position (Intersection Observer on each category header).
- At viewport heights < 600px (unlikely for a PS help page, but cover it), the sidebar collapses to a `<select>` dropdown with the same jump behavior.

---

## 8. Page header

```
AITriad Module Reference             v{moduleVersion}         [🔍 filter cmdlets…]
```

- Left: "AITriad Module Reference" — sans, `font-size: 1rem`, `font-weight: 600`.
- Right of title: version badge — `v0.8.6`, monospace, muted, `font-size: 0.75rem`. Value injected at generation time from `$ModuleVersion`.
- Far right: search input, `min-width: 220px`.
- Sticky, 1px bottom border, white/very-light background.

---

## 9. Visual style

This page lives outside the Electron app — it opens in the OS default browser. Do not use CSS custom properties that require `[data-theme]` setup. Use plain values that look clean in any browser:

| Element | Value |
|---|---|
| Page background | `#f8fafc` |
| Header background | `#ffffff`, 1px `#e2e8f0` border |
| Sidebar background | `#ffffff`, 1px `#e2e8f0` right border |
| Category header text | `#0f172a`, `font-size: 0.6875rem`, `font-weight: 600`, `letter-spacing: 0.06em`, uppercase |
| Row cmdlet name | `#0f172a`, monospace or `font-weight: 500` |
| Row synopsis | `#64748b`, same size |
| Expanded detail background | `#f8fafc` (slightly inset) |
| Code blocks | background `#f1f5f9`, `border-radius: 4px`, monospace |
| Active sidebar item | 2px left border `#3b82f6`, `color: #1e40af` |
| Search match highlight | `background: #fef9c3` (yellow highlight on the matched substring in name/synopsis) |
| Separator between category sections | 1px `#e2e8f0` |

No shadows except on the sticky header (1px bottom shadow `rgba(0,0,0,0.06)` when scrolled). No rounded cards on the rows themselves — the rows read as a list, not a card wall.

Font stack: `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`. Code: `ui-monospace, 'Cascadia Code', 'Fira Code', monospace`.

---

## 10. Implementation notes for PowerShell

The generator script should:

1. Call `Get-Command -Module AITriad -CommandType Function | Sort-Object Name` to get the cmdlet list.
2. For each cmdlet, call `Get-Help $cmdlet -Full` and extract: Name, Synopsis, Syntax, Parameters (non-common), Examples, Links (`.LINK` entries).
3. Build a JSON object (embedded in a `<script>` block) containing all cmdlet data keyed by name, plus a `categories` array mapping category names to cmdlet name lists.
4. Emit the HTML with the JSON blob and the filter/expand JS inline. No external `<script src>` or `<link href>`.
5. The category lookup table is a plain hashtable in the generator: `$CategoryMap = @{ 'Get-Organization' = 'Organizations'; … }`. Cmdlets absent from the map go to `'Uncategorized'`.

JS is minimal: ~100 lines. No framework. The filter function iterates the JSON blob, shows/hides rows by toggling a `hidden` attribute, updates sidebar counts.

**Preserve existing behavior:** `-PassThru` still returns the temp file path. The page still opens in the default browser via `Start-Process`. No behavioral change to the cmdlet's PowerShell interface.

---

## 11. Acceptance (Design criteria)

1. Page loads in the default browser without a network request; all styles and behavior are inline.
2. Search filters by cmdlet name, synopsis, and parameter names with instant response; result count displayed.
3. Each cmdlet collapses to a single row (name + synopsis); expands in-place to show parameters, examples, and related links.
4. Sidebar shows all categories with live match counts during search; active-category indicator tracks scroll.
5. All 158 cmdlets present; no reference to removed cmdlets (e.g. Find-CrossCuttingCandidates).
6. RELATED LINKS render as in-page jump links that expand the target cmdlet.
7. Visual style is clean, monochrome (no bright accents except the active-item indicator and search highlight), readable in both light and dark OS modes.
8. Keyboard-accessible: search reachable by Tab from page load; every row expandable with Enter/Space; Escape clears search.

**Not required:** mobile layout (this is a developer tool opened by PS in a desktop browser). Dark-mode auto-theming is a nice-to-have, not a requirement — a `@media (prefers-color-scheme: dark)` block swapping the grays is fine if PowerShell wants to add it.

---

## 12. What NOT to do

- No per-cmdlet "page" — keep it single-file, single scroll. The sidebar + search makes a flat list of 158 navigable.
- No accordion-within-accordion (categories > sub-categories > cmdlets). Two levels max: category section, then cmdlet row.
- No copy-paste of the current hand-maintained card style — the expanded detail is structured fields, not a prose blob.
- No loading spinners or async fetching — all data is in the embedded JSON blob, filter is synchronous.
