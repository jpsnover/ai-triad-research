// Computed-style invariance manifest (t/2940 — TL Option C, t/2940#5/#6).
//
// A CSS *source-split* is a pure move (delete rule from styles.css → co-locate in a component
// sheet, NO value change), so its invariant is byte-identical getComputedStyle per theme. This
// manifest enumerates, per smoke-covered cluster that was split in the t/2989 push WITHOUT the
// automated visual leg (t/2940#3), the probe-injectable single-class selectors whose computed
// style must not drift. The invariance spec captures PROPS × THEMES for each into a committed
// fixture (baseline), then asserts equality on every run — a real value change (non-pure split)
// fires the gate; a pure move passes.

/** The 4 explicit themes (data-theme on <html>). `system` resolves to light/dark, not a distinct value. */
export const THEMES = ['light', 'dark', 'bkc', 'harvard'];

/**
 * Fixed computed-style property set — TL's t/2940#5 visual-meaning categories (grid / border /
 * color / background / padding / margin / font). Captured for every selector × theme.
 */
export const PROPS = [
  'display', 'position', 'grid-template-columns', 'flex-direction',
  'border-top-width', 'border-bottom-width', 'border-radius',
  'color', 'background-color',
  'padding-top', 'padding-left', 'margin-top',
  'font-size', 'font-weight', 'text-transform', 'text-decoration-line',
];

/**
 * Covered clusters → { openTab, selectors, [excluded] }. Reachability was VERIFIED against a real
 * build:container + serve.mjs at :7862 (t/2940#9) — replacing the earlier speculative assumption
 * that all four load on a POV tab. Two clusters' co-located CSS is eagerly bundled (loaded app-wide
 * on start, NOT lazy-per-surface), so the computed-style probe is navigation-independent; the other
 * two are NOT reachable from the web smoke and are EXCLUDED here at point of use (see `excluded`),
 * carried to the t/3299 follow-up. Representative selectors only (container/badge/header/button rules
 * that carry visual styling), not all 97, per t/2940#6.
 *
 * `openTab` = the stable landing surface the harness clicks before probing; for the eager clusters it
 * is navigation-independent (the sheet is already loaded), so it just needs to be a valid `[data-tab]`
 * the SPA exposes (POV tabs: accelerationist/safetyist/skeptic). A cluster whose CSS is NOT loaded on
 * the probed surface would capture pure CSS defaults — a vacuous gate — so it is `excluded`, never
 * silently captured (the trap t/2940#9 caught before it shipped).
 *
 * `excluded`: a string = the reason + re-inclusion trigger, kept HERE (gate-co-located, TL t/2940 GV)
 * so removing the marker IS the decision to re-include; the invariance spec skips any cluster with it.
 */
export const CLUSTERS = {
  // ── ACTIVE (eager CSS, reachable + capturing meaningful theme-varying values, t/2940#9) ──
  lineagePanel: {
    css: 'analysis/LineagePanel.css',
    openTab: 'accelerationist', // eager CSS → navigation-independent; any valid POV tab suffices.
    selectors: [
      'lineage-panel', 'lineage-panel-header', 'lineage-category-badge',
      'lineage-panel-item', 'lineage-l2-header', 'lineage-detail-section',
    ],
  },
  lineageDetail: {
    css: 'shared/LineageDetailView.css',
    openTab: 'accelerationist', // eager CSS → navigation-independent; any valid POV tab suffices.
    selectors: [
      'lineage-detail-pov-badge-sm', 'lineage-detail-filter-btn',
      'lineage-detail-ctx-menu', 'lineage-detail-ref-id',
    ],
  },

  // ── EXCLUDED from the web invariance leg (gate-co-located, TL t/2940). Carried to t/3299. ──
  summaries: {
    css: 'analysis/SummariesTab.css',
    excluded:
      "SummariesTab mounts only when activeTab==='summaries' AND useFlag('env-electron-summaries') " +
      "is on (App.tsx); its chunk does NOT load on the POV tabs the web smoke reaches, so a probe " +
      "captures only CSS defaults (vacuous gate, t/2940#9). RE-INCLUDE (t/3299 B) once the spec " +
      "enables env-electron-summaries + navigates to the summaries tab before probing.",
    selectors: [
      'sumt-card', 'sumt-detail-panel', 'sumt-pov-badge', 'sumt-tag',
      'sumt-stance', 'sumt-tab-bar', 'sumt-node-item', 'sumt-viewmode-btn',
    ],
  },
  debatePopout: {
    css: 'debate/DebatePopoutWindow.css',
    excluded:
      "Rendered in a SEPARATE BrowserWindow (popout) — unreachable from the web smoke's single page, " +
      "so its CSS never loads here (probe = defaults, t/2940#9). RE-INCLUDE (t/3299 C) once the " +
      "harness opens the popout route/window, or cover via a popout-specific smoke; else it stays on " +
      "the manual four-theme + LOC-ratchet guard.",
    selectors: [
      'debate-popout-shell', 'debate-popout-error-box',
      'debate-popout-error-title', 'debate-popout-hint',
    ],
  },
};
