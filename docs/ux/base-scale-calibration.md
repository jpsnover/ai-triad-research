# Base Type & Icon Scale Calibration

**Last updated:** 2026-08-10
**Author:** Design (Orca)
**Status:** Proposed — for Taxonomy Editor (Rosetta Stone) implementation
**Owner of files touched:** `taxonomy-editor/src/renderer/` (Rosetta Stone)

## Problem

At 100% zoom on the **web**, the UI (fonts and icons) reads too small. This is not a
per-window inconsistency (zoom applies uniformly to main and popout windows) — it is the
**baseline scale itself**. The type ramp was calibrated for a dense *native desktop* tool;
on the web, next to a 16px-baseline norm, it reads cramped.

## Current state (source of truth: `styles.css`)

Neither `html` nor `body` sets a base `font-size`, so the root is the browser default **16px**.
Every text token is anchored **below 1rem**, so almost nothing renders at 16px:

| Token | rem | px @ 16px root | Primary use |
|---|---|---|---|
| `--text-2xs` | 0.6875 | **11px** | badges, meta, captions |
| `--text-xs`  | 0.75   | **12px** | dense chrome, tables |
| `--text-sm`  | 0.8125 | **13px** | *most* UI text |
| `--text-md`  | 0.875  | **14px** | default UI / body-ish |
| `--text-prose` | 0.9375 | **15px** | reading text |
| `--text-lg`  | 1.0625 | **17px** | subheads |
| `--text-xl`  | 1.375  | **22px** | headings |
| `--text-2xl` | 1.75   | **28px** | page titles |

The bulk of the interface sits at **11–14px**.

**Icons are decoupled from the type ramp.** They use fixed-pixel props (lucide `size={n}`),
e.g. toolbar/nav `size={18..20}`, inline glyphs `size={14}`, `Ellipsis size={22}`. They do
**not** scale with root font-size, so they do not grow with the zoom control either — zooming
in grows rem text while icons stay put, making the mismatch worse. (Note: `design-system.md`
still says "no icon library / inline SVGs" — that is stale; the app now uses lucide. Reconcile
that doc as part of this work.)

Spacing/radii tokens (`--sp-*`, `--radius-*`) are **px**, not rem — so they will **not** scale
when the text baseline grows. That is the source of the main implementation risk (below).

## Proposed change

Two coupled parts — do both; part 1 alone shifts the text/icon balance the wrong way.

### 1. Raise the text baseline once

Set an explicit root scale so the whole rem ramp grows uniformly, proportions preserved:

```css
html { font-size: 112.5%; }   /* 18px root */
```

Resulting baseline (×1.125):

| Token | before | after |
|---|---|---|
| `--text-2xs` | 11px | ~12.4px |
| `--text-xs`  | 12px | ~13.5px |
| `--text-sm`  | 13px | ~14.6px |
| `--text-md`  | 14px | ~15.75px |
| `--text-prose` | 15px | ~16.9px |
| `--text-lg`  | 17px | ~19.1px |
| `--text-xl`  | 22px | ~24.75px |

This preserves the existing hierarchy and the dense-table character (relative sizes unchanged);
it only moves the anchor to a web-comfortable baseline.

**Interaction with the zoom control:** the zoom effect (`App.tsx` — `documentElement.style.fontSize
= ${zoomLevel}%`) overwrites the inline `font-size` on `<html>`. Setting it in CSS on `html` is
fine because the zoom effect sets an **inline** style that wins; but the two must agree on the
meaning of "100%". Recommended: keep the CSS `html { font-size: 112.5% }` as the true baseline
**and** make the zoom effect multiply against it rather than replace it — e.g. apply zoom to a
wrapper, or compute `document.documentElement.style.fontSize = ${112.5 * zoomLevel/100}%`. The
implementer should pick whichever keeps "zoom 100%" == the new comfortable baseline. Confirm the
`taxonomy-editor-zoom` localStorage value still round-trips (default stays 100).

### 2. Tokenize icon sizes so they track the type ramp

Introduce icon-size tokens tied to the ramp and convert the fixed-px `size={n}` call sites:

```css
:root {
  --icon-sm: 1em;      /* inline-with-text glyphs (was ~14px) */
  --icon-md: 1.25em;   /* default UI/nav/toolbar (was ~18–20px) */
  --icon-lg: 1.5em;    /* emphasis (was ~22px) */
}
```

Using `em` makes icons scale with their surrounding text (and thus with both the new baseline
and the zoom control). The outcome must be: **icon size tracks adjacent text size.**

**⚠️ `size={n}` is polymorphic — do NOT bulk-convert call sites (post-epic-t2409 correction).**
`size={n}` resolves to ≥4 different components, only one of which is lucide. Passing an `em`
string to the numeric-prop components produces `NaN` and breaks them (this would kill the
doc-link books shipped in #778). Handle the two families differently:

- **True lucide icons** (`ArrowLeft`, `Ellipsis`, chevrons… in `Toolbar`, `HamburgerMenu`,
  `BottomNav`): tokenize **per-site**. lucide's `size` prop is numeric px, so apply the token
  via CSS `width`/`height: var(--icon-md)` (a className), not the `size` prop.
- **Numeric-prop components** (`TheoryLink` size clamped 12–16, `CampGlyph`, `OrgLogo`):
  **leave every call site untouched.** Instead make the component *render* in `em`: convert its
  internal `${size}px` to `${size / 16}em` (e.g. `TheoryLink` sets the control's
  `fontSize = ${size/16}em` and the 1em glyph follows). This preserves the numeric API + clamp,
  needs zero call-site edits, can't `NaN`, and makes the glyph scale with baseline + zoom.
  Update the components' unit tests (px → em assertions).

Preserve deliberate one-offs (e.g. favicon `16×16` raster) as-is. This part is lucide-per-site +
custom-component em-render — a careful, Design-verified pass, not a codemod.

## Acceptance criteria

- [ ] At 100% zoom on web, default UI text renders ≈15–16px (up from 13–14px); ramp proportions unchanged.
- [ ] Icons scale with adjacent text at the new baseline **and** when the zoom control changes (grow/shrink together).
- [ ] Zoom control still works; "100%" == the new comfortable baseline; `taxonomy-editor-zoom` persists; default 100.
- [ ] No layout regressions on dense surfaces from text growing inside px padding/fixed-width containers — visually verify: node tree, POV tables, NodeDetail, SituationDetail, debate workspace, **debate diagnostics window**, debate list tables, Settings/Help dialogs.
- [ ] Media-query breakpoints (px) still trigger correctly; no horizontal overflow introduced at common widths.
- [ ] WCAG: text remains resizable/zoomable to 200% without loss of content (only improved); contrast tokens unchanged.
- [ ] `design-system.md` updated: corrected icon section (lucide + `--icon-*` tokens) and the new root baseline; typography table reconciled to the actual `--text-*` tokens.

## Risks & notes

- **Text grows, px chrome does not.** `--sp-*`/`--radius-*` are px and won't scale, so raised
  text sits in the same padding — dense tables/rows are the likeliest to tighten or clip. The
  diagnostics window and POV/debate tables are the highest-risk surfaces; verify them explicitly.
  If any surface breaks, prefer loosening that surface's px padding over abandoning the baseline.
- Same text-vs-chrome effect applies whether we raise the root (recommended, one line) or edit
  each `--text-*` value; raising the root is lower-churn and keeps the ramp definitions readable.
- This is a global visual change — run the `/design-review-workflow` visual pass before Done.
