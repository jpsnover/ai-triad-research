# Vocabulary Panel — Readability / Layout Fix

**Last updated:** 2026-08-21
**Author:** Design (Orca)
**Status:** Spec — ready to implement
**Reported by:** Jeffrey ("the design is hideous and unreadable"; screenshots t1.png Dictionary, t2.png Colloquial)
**Component:** `taxonomy-editor/src/renderer/components/shared/VocabularyPanel.tsx`

---

## 1. Root cause

`shared/VocabularyPanel.tsx` **imports no stylesheet, and none of its class names are defined anywhere** (`styles.css` has zero matches; the only `VocabularyPanel.css` in the tree belongs to the separate `debate-workspace/` panel and is not imported here). The panel therefore renders as **unstyled HTML** — every row is a run of adjacent inline `<span>`/`<code>` elements with no gap, no columns, no padding, no row separators. That is the entire bug:

- **Dictionary:** `accountability_algorithmic` (mono key) + `accountability (algorithmic)` (label) + `31` (count) render with **zero space between them** → `accountability_algorithmicaccountability (algorithmic)31`.
- **Colloquial:** term key + long "when" description + camp name (`accelerationist`/…) all concatenated; the colored camp name is glued to the sentence end.
- Header, tabs, and filters are likewise unspaced (`Dictionary (45)Colloquial (24)Lint`, title jammed against the doc-link and stats).

**Fix = author a co-located `VocabularyPanel.css`** (import it from the component) that lays the existing markup out in columns with spacing. The JSX structure is already correct (separate elements with sensible class names) — **this is a CSS-only fix; no JSX/logic change required** beyond the one-line `import './VocabularyPanel.css'` and the small a11y note in §7.

## 2. Design principles

- **Tokens only** — `--text-primary/secondary/muted`, `--border-color`, `--bg-secondary`, `--bg-hover`, `--radius-sm`; camp colors already applied inline via `POV_COLORS` (`--color-acc/saf/skp`). **No hard-coded hex.**
- **Columns, not run-on** — each row is a flex/grid with explicit gaps; the human-readable field is primary, the machine key is a muted monospace secondary, counts are right-aligned tabular-nums.
- **List rhythm** — 1px `--border-color` row separators + row padding + hover, matching the app's other list surfaces (`.debate-table`, `.oped-grounding-table`).
- **Four themes** inherited via tokens; **keyboard/focus** on the clickable rows.

## 3. Panel chrome (header, tabs, filters)

- `.vocabulary-panel`: column flex, container padding (~12–16px), `gap`.
- `.vocab-header`: flex row, `align-items: baseline`, `gap: 8px`; `h3` no jam against the doc-link icon or `.vocab-stats` (push stats right with `margin-left: auto`, muted). `.lint-badge` = small pill (`--warning` bg tint, tabular-nums).
- `.vocab-tabs`: flex row, `gap: 4px`; each tab a real segmented/underlined button with an **active state** (reuse the app's tab treatment, e.g. `--focus-ring` underline or filled) — not three bare words.
- `.vocab-filters`: `.vocab-search` full-width input (token border/bg); `.vocab-filter-row` flex row with `gap: 8px` for the two `<select>`s.

## 4. Dictionary rows (`.vocab-entry` / `.vocab-entry-header`)

Row = one flex line, `align-items: baseline`, `gap: 8px`, `padding: 8px 10px`, `border-bottom: 1px solid --border-color`, `cursor: pointer`, hover `background: --bg-hover`.

| Element | Treatment |
|---|---|
| `.camp-dot` | fixed width (~1em), `flex-shrink: 0`, keeps its inline camp color; the status glyph (●/○/◐/×) needs a `title` (already set) |
| `.display-form` | **primary readable label** — `color: --text-primary`, `font-weight: 500`, `flex: 1 1 auto`, wraps |
| `.canonical` | **secondary machine key** — `font-family: monospace`, `font-size: 0.85em`, `color: --text-muted`, `flex-shrink: 0` |
| `.node-count` | right-aligned count — `margin-left: auto`, `color: --text-muted`, `font-variant-numeric: tabular-nums`, in a subtle pill (`--bg-secondary` bg, `--radius-sm`); its `title="Used by nodes"` stays |

Ordering note: the label is primary; place `.display-form` first (readable), `.canonical` as a muted mono chip after it, count far right. (The JSX order is camp-dot → canonical → display-form → count; either reorder in JSX or use flex `order` — implementer's choice, but the **visual hierarchy must be label-primary / key-muted / count-right**.)

Expanded detail (`.vocab-entry-detail`, `.detail-row`, `.phrase-tag`, `.see-also-link`, `.confusion-entry`): indent under the row, `--bg-secondary` panel, `.detail-row` stacked with `gap`; `.phrase-tag` and `.see-also-link` as chips (mono for the code ones), `--text-secondary` labels. `strong` labels get a trailing space already; ensure chips don't jam (gap between them).

## 5. Colloquial rows (`.colloquial-entry`)

- `.vocab-entry-header`: `.status-badge` = a real pill (border + padding + `--radius-sm`, muted/status-tinted, capitalized), `gap` before the `<strong>` term. Term = `--text-primary`, weight 600.
- `.resolves-to` / `.resolution`: **each resolution on its own row** — flex line, `gap: 8px`, `padding: 4px 0`:
  - `.see-also-link` (the `standardized_term`) — monospace, `--text-secondary`, clickable (hover underline), `flex-shrink: 0`;
  - `.when` — the readable description, `--text-primary`, `flex: 1`, wraps;
  - `.camp-tag` — colored camp chip at the **end**, `flex-shrink: 0`, `margin-left: 8px`, small-caps or capitalized, its inline camp color kept, small border so the color reads as a tag not glued text.
- `.ambiguous-when`: top margin, `--text-muted`, `em` italic already; set it apart with a left border/indent (`border-left: 2px solid --border-color; padding-left: 8px`).

## 6. Lint rows (`.lint-violation`, `.severity-*`)

- `.lint-header`: flex row, `gap: 8px`; `.severity` a status pill colored by `severity-error|warn|info` (map to `--danger` / `--warning` / `--text-muted` — **tokens, no hex**); `.constraint` mono; `.file` muted mono, truncates.
- `.lint-message` primary; `.lint-fix` `--text-secondary` in a `--bg-secondary` block.
- `.empty-state`: centered, `--text-muted`, padding.

## 7. Accessibility

- Rows are `<div onClick>` with no role/tabindex today — **make them keyboard-operable**: `role="button"`, `tabIndex={0}`, Enter/Space to toggle expand, `aria-expanded` on the expandable Dictionary rows, and a `:focus-visible` outline (`--focus-ring`). (This is the one small JSX touch beyond the CSS import.)
- Status/camp conveyed by color also carry `title`/text (camp-dot has `title`; camp-tag shows the camp name) — don't rely on color alone; keep the text label.
- `font-variant-numeric: tabular-nums` on all count columns.
- Wraps, never truncate the readable label/description; long mono keys may `overflow-wrap: anywhere`.

## 8. Acceptance

1. Every row reads as **separated columns** — machine key, readable label, and count (Dictionary) / term, description, camp (Colloquial) each visually distinct with clear gaps and row separators. No run-on concatenation.
2. Header, tabs (with active state), and filters are spaced and legible.
3. Tokens only (no hard-coded hex); renders correctly in light / dark / bkc / harvard.
4. Rows are keyboard-focusable and toggle on Enter/Space with a visible focus ring; `aria-expanded` on expandable rows.
5. Works at both narrow (sidebar-width) and full-width; readable label/description wrap rather than overflow.
6. Design signs off via `/design-review-workflow` (four themes) before Done.

## 9. What NOT to do

- Do **not** restyle by adding hard-coded colors — every value is a token.
- Do **not** reuse the `debate-workspace/VocabularyPanel.css` — that's a different component; author a co-located `shared/VocabularyPanel.css` and import it from `shared/VocabularyPanel.tsx`.
- Do **not** collapse the machine key entirely — it's the identifier/sort field; demote it to a muted mono secondary, don't delete it.
- Do **not** truncate the readable label or the "when" description — wrap.

---

*Scope note:* implementation is a co-located CSS file (+ the one-line import and the small a11y JSX touch) — a coding-agent task in the unowned `shared/` renderer tree → routed to TL. This document is the Design spec; Design reviews the result via `/design-review-workflow`.
