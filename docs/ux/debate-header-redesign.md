# Debate Window Header Redesign

**Ticket:** t/2293
**Author:** Design (Orca)
**Status:** Spec — ready for implementation
**Implements:** `DebateWorkspace.tsx` → `DebateTopicInfo` (and the header wrapper at ~line 1385)
**Mockup:** `docs/ux/assets/debate-header-redesign-mockup.png` (source `c:\tmp\t3.png`)

## Goal

Replace the current single-line debate header (phase pill · timestamp · audience · model · id · coverage, then a topic line) with a structured three-band header: **title + source**, **status + metadata**, and a **DEBATERS strip** summarizing each POV's participation.

The one deliberate departure from the mockup: the mockup draws all three POV accent bars in the same green. **That is wrong.** Each POV keeps its own color token so Accelerationist / Safetyist / Skeptic remain visually distinct and consistent with the rest of the app (SituationDetail tabs, statement cards, etc.).

## Scope

- **In:** the header region rendered by `DebateTopicInfo` and the row that pairs it with the action bar. New CSS in the debate header stylesheet.
- **Out:** the app menu bar ("Debate … File Edit View Help") — that's Electron window chrome. The action-bar buttons themselves (Text/Analysis toggle, Comments, Share, Diagnostics, Detailed) already exist from `debate-view-mode-controls.md` and `debate-action-bar-redesign.md` — this spec only positions them, it does not restyle them.

## Layout — three bands

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Why New Mexico v. Meta Matters              [ Text | Analysis ]  [Comments N] │  ← Band 1: Title
│  techpolicy.press/why-new-mexico-v-meta-matters   [Share] [Diagnostics] [Detl▾]│
├──────────────────────────────────────────────────────────────────────────────┤
│  ● CLOSED   Grounding 100%          Aug 8, 2026 · 06:18  General Public  model  id │  ← Band 2: Status
├──────────────────────────────────────────────────────────────────────────────┤
│  DEBATERS  ┃ Accelerationist   ┃ Safetyist        ┃ Skeptic                     │  ← Band 3: Debaters
│  3 positions┃ 5 turns          ┃ 4 turns          ┃ 3 turns                      │
└──────────────────────────────────────────────────────────────────────────────┘
   (accent bars ┃ are per-POV colored — NOT uniform green)
```

Bands are separated by 1px `var(--border-color)` hairlines. Header card sits on `var(--bg-primary)`; the DEBATERS strip may use `var(--bg-secondary)` to set it apart (implementer's choice — keep contrast subtle).

### Band 1 — Title row

- **Left:** the topic as a heading — `<h2>` (or role-appropriate heading), `activeDebate.topic.final`.
  - Font: body sans stack, weight **700**, size ~`1.1rem`, `color: var(--text-primary)`.
  - Directly beneath: the source as a muted subtitle — `activeDebate.source_ref` when present, `color: var(--text-muted)`, size `0.75rem`. When `source_ref` is absent, omit the subtitle line entirely (do not reserve blank space).
- **Right:** the existing action bar — the Text/Analysis view-mode toggle followed by Comments / Share / Diagnostics / Detailed. No visual change to those controls; just anchor them top-right, vertically aligned to the title block, wrapping to a second line on narrow widths.
- Title left cluster and action cluster use `justify-content: space-between`; both `flex-wrap` so nothing clips.

### Band 2 — Status + metadata row

- **Left cluster (pills):**
  - **Phase pill** — reuse the existing `debate-phase-indicator`. When phase is `closed` it reads `CLOSED` with a leading `●` dot. Neutral styling: `var(--text-secondary)` text on `var(--bg-tertiary)`, uppercase, letter-spacing ~0.04em, size `0.72rem`. (Non-closed phases keep their current label via `PHASE_TITLES`.)
  - **Grounding pill** — the existing `CoverageBadge` (`Grounding N%`), rendered only when `coverageMap` exists. Keep its success-tinted styling but ensure the foreground uses `var(--success-text)`, not `var(--success)` (AA — see design-system §Semantic).
- **Right cluster (muted metadata, `var(--text-muted)`, size `0.72rem`):** date `·` time (from `created_at`, existing format), audience label (`DEBATE_AUDIENCES` lookup), model badge (`activeDebate.debate_model`, monospace), and the short debate id (`activeDebate.id`, monospace, `user-select: all`). Preserve current title/tooltip affordances.
- `justify-content: space-between`; the whole row wraps gracefully — on narrow widths the metadata cluster drops below the pills.

### Band 3 — DEBATERS strip

A horizontal strip of cells divided by vertical `var(--border-color)` hairlines.

- **Summary cell (first):**
  - Tiny uppercase label `DEBATERS` — `0.65rem`, letter-spacing 0.06em, `var(--text-muted)`.
  - Below it: `{N} positions`, `0.85rem`, `var(--text-secondary)`. N = number of POVs present (i.e. `AI_POVERS.length`, normally 3).
- **One cell per POV**, in canonical order Accelerationist → Safetyist → Skeptic (`AI_POVERS` order):
  - A **left accent bar** (3–4px wide vertical rule) in the POV's color token.
  - POV name — bold `0.85rem`, `var(--text-primary)` (use `POVER_INFO[pover].label`).
  - Turn count — `{turns} turns`, `0.75rem`, `var(--text-muted)`. Turns = count of that speaker's substantive transcript entries (openings + statements + cross-responses; the same set the transcript renders as that speaker's cards). Singular `1 turn`; `0 turns` when the POV hasn't spoken yet.

## POV color mapping — REQUIRED

Use the design-system tokens (design-system.md §POV Colors, lines 28–30). Do **not** hardcode hex — tokens resolve per theme automatically across all four themes.

| POV | `pover` id | Token |
|---|---|---|
| Accelerationist | `accelerationist` | `--color-acc` |
| Safetyist | `safetyist` | `--color-saf` |
| Skeptic | `skeptic` | `--color-skp` |

The accent bar is `background: var(--color-xxx)`. If the POV name is also tinted, tint it with the same token — but verify the name text still meets AA on the cell background in every theme; if a token fails as text (e.g. bright fills on light bg), keep the **name** in `var(--text-primary)` and let only the **bar** carry the color. The bar is decorative, so its contrast is not gated, but it must be visually distinct in all four themes.

`POVER_INFO` in `types/debate` already maps pover → label (and color where defined); prefer sourcing the token from there if present, else the mapping above.

## States & edge cases

- **No source_ref** — omit the subtitle line; title sits alone in Band 1.
- **No coverageMap** — omit the Grounding pill; phase pill sits alone at left of Band 2.
- **Non-closed phases** (setup, clarification, debating, synthesis) — phase pill shows the live `PHASE_TITLES` label; the `●` dot and neutral treatment still apply. The DEBATERS strip shows live turn counts as they accrue (a POV mid-debate may show fewer turns; `0 turns` before it speaks).
- **Long title** — wraps to 2 lines max, then ellipsis; never pushes the action bar off-screen (action bar wraps below first).
- **Long source URL** — single line, `text-overflow: ellipsis`; full value in `title`.
- **Exploration / single-perspective sessions** — if fewer than 3 POVs, render only the present cells and set the summary count accordingly. Do not render empty POV cells.
- **2-POV / >3-POV** — strip is data-driven over the present POVs; the summary count follows.

## Accessibility

- Title is a real heading element (screen-reader landmark for the debate).
- Phase and Grounding pills: text ≥ AA (4.5:1) against their pill background per theme. Grounding uses `--success-text`.
- The `●` phase dot is decorative; the word `CLOSED`/phase label carries the meaning (never color-only).
- POV cells are not color-only: the POV **name** is always present as text, so colorblind users are unaffected if a bar is ambiguous.
- Metadata id remains keyboard-selectable (`user-select: all`).
- Respect `(prefers-reduced-motion)` — no animated transitions on the header.

## Responsive

- **desktop / tablet-lg:** all three bands as drawn; DEBATERS strip is a single horizontal row.
- **tablet and below:** action bar wraps under the title; metadata cluster wraps under the pills; the DEBATERS strip may wrap POV cells to a second row or become horizontally scrollable — keep the summary cell first and never clip a POV name.
- **phone:** stack vertically; POV cells become full-width rows (accent bar stays on the left edge).

## Implementation notes

- Primary edit site: `DebateTopicInfo` (`DebateWorkspace.tsx:582`) and the wrapper at `:1385` that renders it alongside `DebatePhaseHeader`. The action bar (`DebateActions` / view-mode toggle) is already rendered nearby — coordinate placement so it lands in Band 1's right cluster.
- Turn counts: derive by grouping `activeDebate.transcript` by `speaker`, counting the substantive entry types the transcript already treats as that speaker's cards. Reuse any existing per-speaker tally helper rather than re-deriving if one exists.
- New CSS classes live with the existing debate header styles; use tokens throughout (no literal colors).
- After implementation, Design verifies visually across all four themes via `/design-review-workflow` before the ticket goes Done — confirming, specifically, that the three POV bars are acc-green / saf-red / skp-gold (per theme), not uniform green.
