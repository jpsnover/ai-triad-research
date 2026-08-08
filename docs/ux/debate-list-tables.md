# Debate List — My / Community Tables

**Ticket:** t/2305
**Author:** Design (Orca)
**Status:** Spec — ready for implementation (TL feasibility check recommended on the layout shift)
**Implements:** `taxonomy-editor/src/renderer/components/debate/DebateTab.tsx` — `DebateListPanel`, `DebateMyList` (~L523), `DebateCommunityList` (~L694), `DebateSessionListItem` (~L587), `CommunityListItem` (~L733)
**Reference (current state):** `docs/ux/assets/debate-list-tables-current.png`

## Goal

Replace the card-per-debate lists in the **My** and **Community** tabs with proper **tables** — one row per debate, sortable columns, and inline action controls. Columns: **Title · Status · Date · Turns · Model · Actions**. Title wraps; actions are real controls (not decoration).

## Confirmed decisions (from the user)

1. **Layout:** the debates table is a **full-width primary view** — it spans the whole Debate pane, not the current narrow left sidebar. (A 6-column table with three action controls per row does not fit the sidebar.)
2. **Open action:** `Open` launches the debate in a **popout window** (`api.openDebateWindow(id)`); the table stays visible behind it.

### Layout consequence (flag for TL/user confirmation)
Today the Debate section is master–detail (narrow list left, detail pane right). Making the list a full-width table **supersedes the inline detail pane for browsing** — you scan the table and `Open` into a popout. The right-hand `DebateWorkspace` detail is reached via the popout, not a side pane. This is an intentional navigation change implied by "full-width + Open-in-popout"; TL should confirm feasibility and that no flow depends on the always-present side detail.

## Table structure

Full-width `<table>` (semantic — `<thead>`/`<tbody>`, `scope="col"` headers) under the existing `DEBATES` header row (which keeps `Edit`, `+ New`, and the `My (n) / Community (n)` tab toggle) and the search box.

| Column | Source (My) | Source (Community) | Align | Wrap |
|---|---|---|---|---|
| **Title** | `s.title` | `cd.title` | left | **wraps** (2–3 lines, then ellipsis; full text in `title=`) |
| **Status** | `PHASE_LABELS[s.phase]` | `PHASE_LABELS[cd.phase]` | left | nowrap — status pill |
| **Date** | `formatDate(s.updated_at)` | `formatDate(cd.updated_at)` | left | nowrap |
| **Turns** | `s.turn_count` | `cd.turn_count` if present, else `—` | right (numeric) | nowrap |
| **Model** | `s.model` (mono) | `cd.model` if present, else `—`* | left | nowrap, ellipsis |
| **Actions** | Open · Export · Share | Open · Export · Copy | right | nowrap |

\* Community items carry a submitter (`community_metadata.submitted_by_display`) rather than a guaranteed model. Show the model when the payload has one; otherwise `—`. Do **not** repurpose the Model column for the submitter — surface the submitter in the Title cell's secondary line or a tooltip if needed (implementer's discretion; not required for v1).

### Status pill
Reuse the AA-safe neutral pill introduced for the header (`.debate-hdr-phase` pattern: `var(--text-secondary)` on `var(--bg-tertiary)`, uppercase, optional ● dot). Do **not** use `.debate-phase-badge`'s existing coloring without checking contrast per theme. One shared status-pill class across header + tables is preferable.

### Title wrapping (explicit user requirement)
Title cell: `white-space: normal; overflow-wrap: anywhere;` capped at ~2–3 lines via `-webkit-line-clamp` (or max-height), then ellipsis. Full topic in the cell's `title=` attribute. Give Title the flexible column (`width: auto`, others sized to content) so it absorbs slack and wraps rather than pushing the table wide.

## Actions column — controls, per tab

Each is an icon+label button (or icon-only with `aria-label` + tooltip on narrow widths), `stopPropagation` so a row-level click doesn't also fire selection.

**My tab:**
- **Open** → `api.openDebateWindow(s.id)` (popout). Primary emphasis.
- **Export** → the existing export flow (`api.exportDebateToFile` via the `ExportButtonInline` menu — PDF / Markdown / text). Render as the same dropdown, anchored to the row.
- **Share** → the existing `ShareToCommunityButton` behavior for `s.id`.

**Community tab:**
- **Open** → `api.openDebateWindow(cd.id)` (popout).
- **Export** → same export flow if supported for a community payload; else omit.
- **Copy** (replaces Share) → `copyItem('debates', cd.id)` then `loadSessions()` — the existing import-to-My action. **Share is N/A for community rows (already shared)** — do not render a disabled Share; show Copy instead. Hide Copy for anonymous users (as today, `!auth?.anonymous`).

Rationale for the divergence: the user's "Open, Export, Share" triad describes owned (My) debates; for Community the semantically correct third action is Copy/import, since Share would be a no-op. Flagged for confirmation.

## Preserve existing behavior (do not drop)

- **Search** — keep the search box above the table; filters rows (existing `searchQuery`).
- **Edit mode** (`Edit` toggle, My tab): map the current card affordances onto the table —
  - **Rename** → inline-edit the Title cell (double-click, as today) or a Rename control in an edit-mode Actions variant.
  - **Delete / bulk** → a leading checkbox column appears in edit mode; bulk-delete via the existing selection flow. The single-row `×` delete maps to a row action or the checkbox+delete.
  - **Reorder** (move up/down) → see Sorting.
- **Active/selected row** — highlight the row for `activeDebateId` / selected community item (`.selected` equivalent on `<tr>`).
- **Empty / loading states** — reuse existing copy (`Loading community debates…`, the Electron-mode community notice, no-match message) as full-width table-empty rows spanning all columns.

## Sorting (recommendation)

A table invites column sorting; the current My list also supports **manual reorder**. Recommended reconciliation:
- Columns **Title, Status, Date, Turns, Model** are click-to-sort (asc/desc, `aria-sort` on the header). View-only (not persisted).
- **Default sort:** the stored manual order for My (preserves today's behavior); Date-desc for Community.
- **Manual reorder** stays an **edit-mode** capability (drag handle or up/down in the Actions cell); it edits the persisted custom order, which is the default (unsorted) view. Selecting a column sort temporarily overrides; clearing returns to custom order.

Flagged as a decision — if manual reorder is deemed low-value at 223 rows, we can drop it in favor of pure column sorting. Recommend keeping it for parity.

## States & edge cases

- **No model / no turns** → `—` (don't render an empty cell).
- **Very long title** → wraps to the clamp, then ellipsis; row height grows to fit up to the clamp; `title=` holds the full text.
- **223 rows (My)** → virtualize or paginate if scroll perf suffers; the current list renders all — measure first, virtualize only if needed.
- **Community in Electron** → the existing "web app only" notice renders as a full-width empty state.
- **Anonymous** → Copy hidden (Community); Share still visible on My (its own auth handling unchanged).
- **Row click vs actions** → clicking a row selects it (edit-mode: toggles checkbox); action buttons `stopPropagation`. A double-click on Title enters rename (edit mode).

## Accessibility

- Real `<table>` with `<thead>`, `<th scope="col">`, `<caption class="sr-only">Debates</caption>`.
- Sortable headers are `<button>`s inside `<th>` with `aria-sort`.
- Every icon-only action has an `aria-label` (Open / Export / Share / Copy) and a tooltip.
- Row is keyboard-navigable; Enter on a focused row triggers the primary action (Open). Tab order reaches each action control.
- Status pill contrast ≥ AA per theme (reuse the header's AA-safe pill).
- Selected row indicated by more than color (e.g. a left accent bar + `aria-current="true"`), not color alone.
- Respect `(prefers-reduced-motion)`.

## Responsive

- **desktop / tablet-lg:** all six columns.
- **tablet:** collapse Model into the Title cell's secondary line; Actions become icon-only.
- **phone:** the table degrades to a stacked card-per-row (Title + status, meta line, action row) — i.e. the current card, but that's the small-screen fallback only; the table is the desktop default.

## Implementation notes

- Edit site: `DebateTab.tsx`. Replace `DebateMyList` / `DebateCommunityList` bodies with a shared `<DebateTable variant="my|community">`; keep `DebateListPanel`'s header/tabs/search. Extract row rendering to `DebateTableRow` (My) / `CommunityTableRow`.
- Handlers already exist — Open `api.openDebateWindow(id)`, Export `api.exportDebateToFile(...)` (wrap the existing `ExportButtonInline`), Share `ShareToCommunityButton`, Copy `copyItem('debates', id)`. No new IPC.
- New CSS in a co-located `DebateTable.css` (or the debate stylesheet); tokens only — Title/meta text `--text-primary`/`--text-muted`, borders `--border-color`, hover `--bg-hover`, selected accent a POV-neutral `--focus-ring`/left bar.
- Fields: `SessionSummary { id, title, phase, model, turn_count, updated_at }`; `CommunityDebate { id, title, phase, updated_at, community_metadata.submitted_by_display, (model?) }`.
- After implementation, Design verifies via `/design-review-workflow` (all 4 themes, keyboard, title-wrap, per-tab Actions) before Done.
