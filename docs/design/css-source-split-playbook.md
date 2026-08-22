# CSS Source-Split Playbook (Phase 3, t/2901 / t/2925)

**Status:** Active reference — every feature-cluster CSS-split PR follows this.
**Owner:** Technical Lead (design). Pattern-setter: `NewDebateDialog` (`ndd-*`), PR that established this doc.

Breaking the 16.6k-line `taxonomy-editor/src/renderer/styles.css` monolith into
component-co-located stylesheets, one feature-cluster per PR. Each PR self-certifies
against this playbook (the shared badges/states sheet is the exception — it routes to
Main TL).

## Mechanism — co-located plain CSS (NOT CSS Modules)

Move a cluster's rules from `styles.css` into `<Component>.css`, imported by
`<Component>.tsx`. **Plain CSS, global class names kept.** CSS Modules is rejected:
158 dynamically-assembled classNames (43 runtime prefixes like `` `conf-${x}` ``) can't
reference hashed names — Modules would silently break them. Plain co-location = zero
dynamic-class breakage by construction, zero JSX churn.

## Cluster boundaries

- **Feature-owned prefixes** (`ndd-*`, `harvest-*`, `oped-*`, `conflict-*`, `ga-*`,
  `chat-*`, `edge-*`/`node-*`, …) → co-locate with the owning component.
- **Cross-feature dynamic modifiers** (`cat-`/`conf-`/`severity-`/`verdict-`/`status-`/
  `coverage-claim-`/`mode-`/`tab-`/`camp-`/`pov-`) → a shared `badges.css`/`states.css`,
  **NOT** a feature file. These are the cascade trap. (Sequenced 2nd, routes to Main TL.)

## Mandatory per-PR checks

1. **Pre-move equal-specificity grep + duplicate-definition check.** Moving a rule shifts
   its cascade position (component CSS loads *after* `styles.css`). Two failure modes:
   - *Equal-specificity global collision:* a global rule of the same specificity also
     targets the moved element. Feature-scoped `.prefix-*` selectors rarely collide, but
     grep-verify. Compound states (`.ndd-x.active`, spec 0,2,0) outrank global `.active`
     (0,1,0) regardless of order — safe.
   - *Duplicate definition:* the selector is **already defined** (differently) in the
     target `<Component>.css`. Appending the monolith copy flips which wins. **Leave such
     stragglers in `styles.css` untouched** and file a dedup follow-up — do not move them.
     (The pattern-setter hit this with `.ndd-style-desc` / `.ndd-hint-error` → t/2939.)
2. **Deletion-only diff on `styles.css`** (0 insertions) — the move must not rewrite
   surviving rules. postcss preserves raws; verify `git diff --numstat`.
3. **Regression guard (see per-cluster rule below).**
4. **Line-ceiling ratchet.** `quality-gates.json` `loc_ceilings["…/styles.css"]` → set to
   the new `wc -l`. The ceiling only ever **decreases** (monotonic, enforced), so rules
   can't sneak back into the monolith.

## Per-cluster regression rule (t/2925#4)

- **Smoke-covered clusters** (on a `/smoke-ui` screen — today: Summaries tab, Intellectual
  Lineage panel, Debate Popout) **MUST add the `/smoke-ui` automated visual leg** for that
  screen — the durable, re-runnable guard.
- **Non-covered clusters** (dialogs/panels not in `/smoke-ui`, e.g. this pattern-setter's
  NewDebateDialog) use **four-theme manual screenshots** (light / dark / BKC / Harvard,
  before vs after — must be pixel-identical) **plus the ceiling ratchet.**

The automated smoke leg is established deliberately on the **first smoke-covered cluster**
(tracked: t/2940) — it is not silently dropped for non-covered clusters.

## Sequencing

Pattern-setter (`ndd-*`, this PR) → shared `badges.css`/`states.css` (Main TL review) →
feature clusters (self-cert against this doc) → **debate cluster last** (largest, sub-split).
Low priority / bandwidth-driven.
