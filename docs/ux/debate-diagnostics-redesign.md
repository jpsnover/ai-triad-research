# Debate Diagnostics — Design Review & Improvement Plan

**Author:** Design (Orca)
**Status:** Proposed, pending prioritization
**Evidence base:** screenshots of Transcript detail, Brief tab, Convergence, and Arg Net views; `src/renderer/components/debate-diagnostics/` (DiagnosticsWindow.tsx 492 lines, EntryDetailRouter.tsx 834 lines, 12 entry-tab components); `styles.css` `.diag-*` rules (~140, from line 8468).
**Relationship to DESIGN-ELEVATION.md:** this plan applies the elevation guide's token system and restraint rule to the diagnostics surface. Phase D1 below depends on elevation Phase 1 (tokens) landing first. The rest can proceed independently.

---

## 1. What this surface is for

Debate Diagnostics is a power-user instrument. It exposes the debate engine's internals (utility scores, dialectical moves, argument network, convergence metrics, injected prompts) so a researcher can audit *why* the engine produced what it produced. Density is appropriate here. The problems below are not "too much information." They are information without hierarchy, color without meaning, and internal artifacts presented without any reading affordance.

## 2. Diagnosis

Numbered for traceability. Every plan item in §3 references these.

### D-1. Score soup: numbers with no frame of reference

The utility row renders `0.825 · i 0.599 · pro 0.846 · adju 0.846 · evid 0.727` as bare decimals in tiny mono. Nothing says whether 0.825 is good, what the components mean, or what range they live in. The same applies to Turn Validation's `score 0.76` and every QBAF weight. A researcher new to the engine cannot interpret a single number on this screen without reading the source code.

### D-2. Color overload with semantic collision

Each view uses six to ten saturated hues at once. Camp colors are green, red, and yellow. Move chips add blue (CONCEDE AND PIVOT), purple (UNDERCUT), and orange (REFRAME). Verdict chips add green (accept) and amber (flag). Node-type chips add red (CA-node) and more green (EA-node), QBAF attribution adds green and red signs, and status chips add green (Taken) and red (Missed). Green alone carries six meanings on these screens. The elevation guide's §4 fix, which moves camp colors to orange/blue/violet and reserves red/green for danger/success, collides head-on with this chip palette. Diagnostics must be re-colored in the same pass or the collision gets worse.

### D-3. Raw internal artifacts dumped as body content

"Commitments Injected" renders the literal prompt text (`=== PRIOR ARGUMENTS === POINTS YOU HAVE ALREADY MADE...`) as unstyled monospace filling half the panel. The Brief tab ends with a raw prompt section. These are legitimately useful artifacts, but they need document treatment. A collapsed-by-default code block with a copy button and a line count would serve; an open wall of uppercase text competing with the analysis around it does not.

### D-4. The Convergence summary cards break the theme

Three near-black cards with white text sit on a light background. They are the only dark elements in the entire app and read as a different product pasted in. The cause is confirmed in code: `.diag-*` styles mix theme tokens with hardcoded hex (#3b82f6, #8b5cf6, #f59e0b, #22c55e, #ef4444), plus 123 inline `style={{}}` blocks across the three main components. This surface will visibly break in dark, BKC, and Harvard themes.

### D-5. Navigation overload, flat in both axes

The sidebar presents 17 flat sections (Topic Scope through Emotional Register) with no grouping. Debate-level analysis (Convergence, Arg Net, Gaps) is mixed with infrastructure (Flight Recorder, Prompt Diff) and per-turn machinery (Exclusion Guard, Agent Utility). The per-statement strip presents 13 tabs (Moderator-Pre through Taxonomy Refs), all equal weight, several near-empty for most statements (Lookahead, Cite, Exclusion, Affect). Two levels of 13–17 undifferentiated choices is a wayfinding failure even for experts.

### D-6. Charts without scaffolding

"Collaborative Ratio Over Time" has no y-axis labels, no gridlines, and a legend reduced to three colored words. The table's inline bars (Dialectical Engagement, Argument Redundancy) have no scale markers, so a 60%-filled bar is uninterpretable. The numbers exist in the data; the visualization hides them.

### D-7. Arg Net is a network rendered as a wall

The argument network is the most inherently *graphical* data in the product, and it renders as a nested text list with edge records interleaved between claims. Edge chips (`EA-node supports via INTEGRATE +1.00`), warrants, debater attributions, and QBAF attribution blocks stack vertically with no visual encoding of structure. There is no way to see the shape of the argument graph.

### D-8. Typographic uniformity at the floor

Nearly everything is 10–11px. Section headers, body analysis, chips, mono IDs, and prompt dumps sit within ~2px of each other. The Brief tab's genuinely interesting analysis prose ("Strongest Angles", "Key Tensions") gets the same size as chip metadata. This is diagnosis §2 of DESIGN-ELEVATION.md at its most acute.

## 3. Improvement plan

Five phases, each shippable. D1 is blocked by elevation Phase 1 (tokens); D2–D5 depend on D1.

### Phase D1 — Theme compliance and tokens (fixes D-4, part of D-8)

1. Replace all hardcoded hex in `.diag-*` rules with theme tokens. Hoist the 123 inline styles into CSS; the elevation guide's standing rule already requires this for any component touched.
2. Rebuild the Convergence summary cards on `--bg-secondary` with `--text-primary` as normal theme surfaces, with a 3px camp-colored left border for identity. Kill the dark slabs.
3. Apply the elevation type scale. Analysis prose moves to `--text-sm` (13px), section headers to `--text-xs` uppercase-tracked, chips and IDs to `--text-2xs`. Nothing below 11px.
4. Verify all four custom themes (light/dark/BKC/Harvard). Today's mix guarantees dark-theme breakage.

**Acceptance:** zero hardcoded colors in diagnostics CSS; screenshots in all four themes show a coherent surface; no text below 11px.

### Phase D2 — Score presentation (fixes D-1)

1. One `ScoreBadge` recipe used everywhere in diagnostics. It pairs the value with a tiny inline bar (0–1 scale implied by fill) and a label, so `0.825` becomes `utility ▓▓▓▓▓▓▓▓░░ 0.83`.
2. Hover/focus tooltip on every score with a one-sentence definition, the range, and how to read it. Content comes from the debate engine docs; I will write the microcopy table as a follow-up spec section once the engine team confirms definitions.
3. Component scores (i / pro / adju / evid) get their full names on first render per panel. Abbreviations appear only in the compact chip row.
4. Verdict chips (accept_with_flag) standardize to three levels (pass / flag / fail) colored via `--success` / `--warning` / `--danger`. Only these chips may use those colors in diagnostics.

**Acceptance:** every number on screen has a visible scale and a discoverable definition; a researcher who has never read the engine source can interpret the Overview tab.

### Phase D3 — Color discipline (fixes D-2)

1. Adopt the elevation §4 camp palette (orange/blue/violet) here in the same release as the main app. No split-brain period.
2. Chip taxonomy with exactly four color families:
   - **Camp identity** → camp colors (orange/blue/violet)
   - **Verdicts/status** → success/warning/danger
   - **Move types and node types** (CONCEDE AND PIVOT, EA-node, etc.) → neutral. `--bg-hover` background, `--text-secondary` text, differentiated by label rather than hue.
   - **QBAF +/− attribution** → success/danger (these are genuinely directional)
3. Everything else (Taken/Missed, drift %, edge chips) inherits from those four families. Delete all per-chip bespoke colors.

**Acceptance:** at most three hue families visible per screen at rest; green never means both "Accelerationist" and "accepted" (satisfied by the elevation palette, which leaves no camp color on green/red after §4 lands).

### Phase D4 — Navigation restructure (fixes D-5)

1. **Sidebar: group the 17 sections under three uppercase-tracked headers.** No accordion, just visual grouping; all items remain one click.
   - **Debate** — Topic Scope, Arg Net, Commitments, Transcript, Convergence, Gaps, Perspective Progression, Post-Debate Reflections
   - **Evidence** — Extraction, Grounding, Lineage, Taxonomy links
   - **Engine** — Agent Utility, Exclusion Guard, Emotional Register, Adaptive, Prompt Diff, Flight Recorder
2. **Per-statement tabs: 13 → 6 visible.** Keep Overview, Brief, Plan, Evidence, Claims, and Draft as tabs. Fold the long tail (Moderator-Pre, Lookahead, Cite, Citations, Exclusion, Affect, Taxonomy Refs) into a "More ▾" overflow menu. Tabs with no content for the current statement render disabled in the overflow rather than hidden, which preserves discoverability without noise.
3. Tab strip uses the elevation tab recipe. `--text-sm`, weight 600 active, single underline, no per-tab colors.

**Acceptance:** first-visible choices ≤ 6 at each level; every section still reachable in ≤ 2 clicks.

### Phase D5 — Data visualization and artifact treatment (fixes D-3, D-6, D-7)

1. **Charts:** y-axis labels (0–1 or %), horizontal gridlines at 0.25 intervals, proper legend chips, camp colors from the new palette. Applies to Collaborative Ratio and any sparkline.
2. **Table bars:** add a numeric value adjacent to every bar. The bar is the glance; the number is the read. Bars use one neutral fill, not per-row colors.
3. **Raw prompts/artifacts:** one `ArtifactBlock` recipe, collapsed by default. The collapsed state shows a `{n} lines · {label}` header with expand and copy buttons. The expanded state renders in `--font-mono --text-2xs` on `--bg-secondary` with `--radius-sm`, max-height 40vh with internal scroll.
4. **Arg Net minimap:** add a compact node-edge diagram at the top of the Arg Net section. Claims render as small camp-colored dots, support/attack edges as green/red hairlines, and clicking a node scrolls to its text record. The existing text list stays as the detail view; the diagram is orientation, not replacement. Feasibility flag for Tech Lead review: if a rendering library is needed, this sub-item alone escalates. Everything else in D5 is CSS and markup.

**Acceptance:** every chart readable without hovering; prompts occupy zero vertical space until requested; a user can see the argument graph's shape in one glance.

## 4. What NOT to do

- Do not reduce information. This is an expert instrument; density is a feature once hierarchy exists.
- Do not add a dashboard or landing page to diagnostics. The transcript-first entry is correct.
- Do not virtualize or paginate. Section content is bounded by debate length.
- Do not introduce a charting library for D5.1–D5.3. The existing hand-rolled SVG chart just needs axes and labels. The D5.4 minimap is the only item where a library question arises.

## 5. Sequencing and dependencies

| Phase | Blocked by | Effort feel | Risk |
|---|---|---|---|
| D1 tokens/theme | Elevation Phase 1 | Mechanical, large surface | Low |
| D2 scores | D1 | Small components + microcopy | Low |
| D3 color | Elevation Phase 2 (palette) | Mechanical | Low |
| D4 navigation | D1 | Structural, two components | Medium (muscle memory) |
| D5 dataviz/artifacts | D1 | Largest; minimap needs TL feasibility check | Medium |

Screenshot baseline: diagnostics views are not in `test-baselines/smoke/` today. Add DiagnosticsWindow captures (Transcript, Convergence, Arg Net) to the baseline set as part of D1 so later phases have regression cover.
