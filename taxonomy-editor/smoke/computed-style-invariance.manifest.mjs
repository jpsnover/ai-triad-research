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
 * Covered clusters → { openTab, selectors }. `openTab` is the tab whose lazy chunk loads the
 * cluster's co-located CSS (probe needs the rule loaded). SummariesTab/LineagePanel/LineageDetail
 * render via ToolbarPaneRenderer ← PovTab, so they load on a POV tab (same chunk reachability the
 * existing harness proved for DataSourceCard/ApiKeyErrorMessage). Representative selectors only
 * (container/badge/header/button rules that carry visual styling), not all 97, per t/2940#6.
 *
 * NOTE (CI-validated): exact reachability + the captured values are determined by the CI capture
 * run (Node-22 real browser) — the @playwright/test runner hangs on local Node-24 (t/3026). If a
 * cluster's CSS is NOT reachable on `openTab` (values come back at CSS defaults / identical across
 * themes), the capture surfaces it and the openTab/surface is corrected. debate-popout is a
 * separate BrowserWindow — flagged as likely NOT reachable in the web smoke; its leg may need the
 * popout route opened, to be confirmed by the capture run.
 */
export const CLUSTERS = {
  summaries: {
    css: 'analysis/SummariesTab.css',
    openTab: 'accelerationist',
    selectors: [
      'sumt-card', 'sumt-detail-panel', 'sumt-pov-badge', 'sumt-tag',
      'sumt-stance', 'sumt-tab-bar', 'sumt-node-item', 'sumt-viewmode-btn',
    ],
  },
  lineagePanel: {
    css: 'analysis/LineagePanel.css',
    openTab: 'accelerationist',
    selectors: [
      'lineage-panel', 'lineage-panel-header', 'lineage-category-badge',
      'lineage-panel-item', 'lineage-l2-header', 'lineage-detail-section',
    ],
  },
  lineageDetail: {
    css: 'shared/LineageDetailView.css',
    openTab: 'accelerationist',
    selectors: [
      'lineage-detail-pov-badge-sm', 'lineage-detail-filter-btn',
      'lineage-detail-ctx-menu', 'lineage-detail-ref-id',
    ],
  },
  debatePopout: {
    css: 'debate/DebatePopoutWindow.css',
    openTab: 'accelerationist',
    reachabilityUnconfirmed: true, // separate window — CI capture confirms whether the CSS loads in web
    selectors: [
      'debate-popout-shell', 'debate-popout-error-box',
      'debate-popout-error-title', 'debate-popout-hint',
    ],
  },
};
