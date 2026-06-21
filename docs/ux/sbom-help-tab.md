# SBOM Tab in Help Dialog — UX Spec

**Author:** Design (Orca)
**Status:** Ready for implementation

## Overview

Add an "SBOM" (Software Bill of Materials) tab to the Help dialog that presents the 285 third-party packages in a searchable, sortable, copy-enabled table. This replaces or supplements the existing Licenses tab which groups packages by license type in an accordion — useful for reading license text but poor for package discovery and inventory.

## Placement

Add "SBOM" as a new tab in the HelpDialog tab bar, between "Shortcuts" and "Licenses":

```
About │ Overview │ Documentation │ Methods │ Shortcuts │ SBOM │ Licenses
```

The existing Licenses tab remains — it serves a different purpose (reading full license text grouped by license type). SBOM is for inventory and lookup.

## Data source

`oss-licenses.json` is already imported in `HelpDialog.tsx`. The `summary[]` array has 285 entries, each with:
- `name` — package name (e.g., `@azure/core-auth`)
- `version` — semver string (e.g., `1.10.1`)
- `license` — license type string (e.g., `MIT`, `Apache License`, `Copyright (c) Microsoft Corporation.`)

Use `summary[]` for the SBOM table. The `groups[]` array (with full license text) stays with the Licenses tab.

## Table design

### Layout

```
┌──────────────────────────────────────────────────────────────┐
│  SBOM                                                        │
│                                                              │
│  285 packages                                                │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 🔍 Filter packages...                                 │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  Package ▾              Version    License                   │
│  ─────────────────────────────────────────────────────────── │
│  @azure/abort-controller  2.1.2    MIT                       │
│  @azure/core-auth         1.10.1   Copyright (c) Micro...   │
│  @azure/core-client       1.10.1   Copyright (c) Micro...   │
│  @azure/core-http-compat  2.4.0    Copyright (c) Micro...   │
│  @azure/core-lro          2.7.2    Copyright (c) Micro...   │
│  @electron/asar           3.3.1    MIT                       │
│  @emotion/hash            0.9.2    MIT                       │
│  ...                                                         │
│                                                              │
│                        [Copy All as TSV]                      │
└──────────────────────────────────────────────────────────────┘
```

### Columns

| Column | Width | Sortable | Content |
|---|---|---|---|
| Package | flex: 2 (min 200px) | Yes, A-Z default | Package name, monospace font |
| Version | 90px fixed | Yes, semver sort | Version string |
| License | flex: 1 (min 120px) | Yes, A-Z | License type, truncated with ellipsis + tooltip for full text |

### Styling

- **Table:** `font-size: 0.8rem`, `line-height: 1.4`
- **Header row:** `font-weight: 600`, `color: var(--text-secondary)`, `border-bottom: 1px solid var(--border)`, sticky (`position: sticky; top: 0; background: var(--bg-primary)`)
- **Body rows:** alternating background (`var(--bg-primary)` / `var(--bg-secondary)`) for scanability
- **Row hover:** `background: rgba(var(--accent-rgb, 59,130,246), 0.06)`
- **Package name:** `font-family: monospace` — these are npm package identifiers
- **License column:** `text-overflow: ellipsis; overflow: hidden; white-space: nowrap` with `title` attribute showing full text
- **Row height:** `28px` — compact for scanning 285 rows
- **Scrollable body:** The table body scrolls within the Help dialog's content area (already has `overflowY: auto`)
- **Total count:** "{N} packages" (or "{N} of 285 packages" when filtered) above the filter input, `font-size: 0.78rem, color: var(--text-muted)`

### Search / filter

A text input at the top filters across all three columns. Matches against package name, version, and license type. Case-insensitive substring match.

- **Placeholder:** "Filter packages..."
- **Style:** Same as the existing Licenses tab filter input (reuse `.settings-key-input` or similar pattern from line 91-100 of current `LicensesPanel`)
- **Debounce:** None needed — 285 items filter instantly
- **Count updates:** Shows "N of 285 packages" when filtered

### Sorting

Click any column header to sort. Click again to reverse. Visual indicator: `▴` (ascending) or `▾` (descending) appended to the header text.

- **Default sort:** Package name, ascending (A-Z)
- **Package:** Alphabetical (locale-aware)
- **Version:** Semver-aware sort — split on `.`, compare numerically per segment. `1.10.1` sorts after `1.9.0`.
- **License:** Alphabetical

**Active sort header style:** `color: var(--accent)` with the arrow indicator. Inactive headers show `color: var(--text-secondary)` with no arrow.

### Copy

Three copy mechanisms:

#### 1. Copy a single cell

Right-click (or long-press on touch) any cell → browser native context menu copies text. No custom implementation needed — the cells are plain text in the DOM.

#### 2. Copy a row

Click a row to select it (highlight with `background: rgba(var(--accent-rgb), 0.12); outline: 2px solid var(--accent)`). Selected rows can be copied with `Ctrl+C` / `Cmd+C`. Multiple rows via `Shift+Click` (range) or `Ctrl+Click` (toggle).

Copied format: tab-separated values (TSV), one row per line:
```
@azure/core-auth\t1.10.1\tCopyright (c) Microsoft Corporation.
```

TSV pastes cleanly into Excel, Google Sheets, and markdown table generators.

**Selection styling:**
- Selected row: `background: rgba(var(--accent-rgb), 0.12)`
- Multi-select: all selected rows highlighted
- Click empty area or press Escape to deselect all

#### 3. Copy All as TSV

A button below the table copies the entire (filtered) dataset as TSV to clipboard, with a header row:

```
Package\tVersion\tLicense
@azure/abort-controller\t2.1.2\tMIT
@azure/core-auth\t1.10.1\tCopyright (c) Microsoft Corporation.
...
```

- **Button label:** "Copy All as TSV" (or "Copy N rows as TSV" when filtered)
- **Style:** `btn btn-sm`, right-aligned below the table
- **After copy:** Button text changes to "Copied!" for 2 seconds, then reverts
- **Copies filtered set:** If the filter is active, only matching rows are copied. The button label reflects this: "Copy 12 rows as TSV"

## Component

New `SbomPanel` component within `HelpDialog.tsx` (or extracted to a separate file if preferred). Rendered when `activeTab === 'sbom'`.

**State:**
```typescript
const [filter, setFilter] = useState('');
const [sortCol, setSortCol] = useState<'name' | 'version' | 'license'>('name');
const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
const [selected, setSelected] = useState<Set<number>>(new Set());
```

**Data:** Import from `oss-licenses.json` (already imported as `ossData`). Use `ossData.summary`.

## Integration points

| File | Change |
|---|---|
| `HelpDialog.tsx` | Add 'sbom' to `HelpTab` union and `TABS` array; add `SbomPanel` component; render when active |
| No new data files | Uses existing `oss-licenses.json` `summary[]` array |

## What NOT to do

- No export to file (CSV/JSON download) — clipboard copy covers the use case; file export adds complexity for no clear benefit
- No inline license text viewing — that's what the existing Licenses tab is for
- No package detail panel or link to npm — keep it a flat inventory table
- No virtualized scrolling — 285 rows is well within DOM performance limits
- No column resize — fixed proportions work for 3 columns

## Accessibility

- Table uses `<table>` with `<thead>` and `<tbody>` — native table semantics
- Sort headers use `<th>` with `aria-sort="ascending"` / `"descending"` / `"none"`
- Filter input: `aria-label="Filter SBOM packages"`
- Selected rows: `aria-selected="true"`
- Copy All button: announces "Copied" via `aria-live="polite"` region
- Keyboard: Tab into table, arrow keys to navigate rows, Space/Enter to select, Ctrl+C to copy selection
