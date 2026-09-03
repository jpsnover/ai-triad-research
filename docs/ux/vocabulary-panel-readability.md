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

**Fix approach — NAMESPACE the shared panel (option b; settled decision, t/3287#4–#6).** `debate-workspace/VocabularyPanel.css` **already defines every one of these class names** (`.vocabulary-panel`, `.vocab-entry`, `.vocab-entry-header`, `.canonical`, `.display-form`, `.node-count`, `.status-badge`, `.resolution`, `.camp-tag`, `.ambiguous-when`, `.lint-*`, …) as **global** selectors, and both sheets can co-persist in `<head>` in one session — so a *new* co-located sheet with the same names would cascade-collide. The fix:

- **Scope the shared panel's rules under a distinguishing root class** (e.g. add `vocab-standalone` to the shared panel's `.vocabulary-panel` root; prefix selectors `.vocab-standalone .vocab-entry …`). Single-scope (Rosetta owns `components/shared/`), self-cert, ships immediately, no collision with the debate panel's global names. **Author it token-clean per §3–§8** (columns/spacing/tokens/a11y) — the shared panel's new sheet has none of the legacy theme bugs.
- Rejected alternatives: authoring an *unscoped* duplicate (collides); the **unify/extract** into one shared sheet imported by both panels (option c) — cleaner DRY but crosses into DebateWorkspace scope + is architectural, so it must not gate this urgent readability fix. **Deferred** (revisit only if the two namespaced sheets duplicate painfully).
- **The debate-workspace theme bugs are handled separately** (not in this ticket): the existing sheet's `rgba(255,255,255,0.03/0.04/0.05)` white-alpha hovers (invisible/wrong on light + harvard) and hardcoded hex (`.lint-badge`/`.phrase-tag`/`.status-badge.*`/`.severity-*` → `--danger`/`--warning`/`--success`) are filed as a standalone **DebateWorkspace** ticket, fixed in place regardless of any future unify.

The JSX structure is already correct — **no logic change** beyond the scoped-stylesheet import + wrapper class and the small a11y touch in §7. The layout/column/spacing/token direction below (§3–§8) applies to the scoped shared sheet. Design review covers the shared panel (this ticket) and — when the DebateWorkspace theme-fix lands — that panel too, across four themes.

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
- Do **not** author a stylesheet with the debate panel's *unscoped* global class names — that cascade-collides (see §1). Scope the shared panel's rules under a distinguishing root class (`vocab-standalone`) so they can't collide.
- Do **not** collapse the machine key entirely — it's the identifier/sort field; demote it to a muted mono secondary, don't delete it.
- Do **not** truncate the readable label or the "when" description — wrap.

---

*Scope note:* implementation is the shared-stylesheet extraction (+ the import lines and the small a11y JSX touch) — a coding-agent task owned by **Rosetta Stone** (taxonomy-editor owns `components/shared/`; ticket t/3287). This document is the Design spec; Design reviews the result — **both** the shared main-tab panel and the debate-workspace panel — via `/design-review-workflow` across four themes.
