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

  // ── RE-INCLUDED t/3299 B (lazy chunk — reached via forced flag + store-nav) ──
  summaries: {
    css: 'analysis/SummariesTab.css',
    // Unlike the eager clusters above, SummariesTab is a LAZY chunk that App.tsx mounts only when
    // activeTab==='summaries' AND useFlag('env-electron-summaries') is on — so its CSS is NOT
    // navigation-independent. Two enablers make it reachable from the web smoke (t/3299 B):
    //   1. FLAG: the smoke server runs with FEATURE_FLAG_ENV=electron (serve.mjs), so the
    //      env:electron-scoped `env-electron-summaries` seed resolves TRUE → both the App.tsx render
    //      gate AND SummariesTab's own useFlag pass.
    //   2. NAV: `switchTab` drives useTaxonomyStore.setActiveTab(...) directly (via the
    //      window.__ZUSTAND_STORES__.taxonomy handle) instead of clicking a [data-tab] — the
    //      summaries nav button lives behind the advanced-view "Other Tools" popover (Toolbar.tsx),
    //      so store-nav is the selector-stable way in. The spec WAITS for the lazy chunk's CSS to
    //      inject before probing (a bare click would race the dynamic import).
    // All 8 selectors are single-class styled rules in SummariesTab.css (verified) carrying
    // theme-varying vars (--border-color / --bg-secondary / --text-muted), so the 4-theme capture
    // is meaningful, not a vacuous defaults snapshot.
    switchTab: 'summaries',
    selectors: [
      'sumt-card', 'sumt-detail-panel', 'sumt-pov-badge', 'sumt-tag',
      'sumt-stance', 'sumt-tab-bar', 'sumt-node-item', 'sumt-viewmode-btn',
    ],
  },

  // ── RE-INCLUDED t/3299 C (separate popout WINDOW in Electron, but a web-reachable HASH ROUTE) ──
  debatePopout: {
    css: 'debate/DebatePopoutWindow.css',
    // In Electron the popout is a separate BrowserWindow, but in the WEB build it's just a hash
    // route: App.tsx early-returns <DebatePopoutWindow/> when location.hash starts with
    // '#debate-window' (needs only bridgeReady — no electronAPI, no debate id), and the component
    // lazy-imports DebatePopoutWindow.css at module top. So a fresh page navigated to
    // BASE + '#debate-window' loads the CSS even with no debate loaded (it renders LoadingProgress).
    // The old `excluded` premise ("unreachable from the web smoke's single page") only held for the
    // Electron path — the web hash route was always reachable.
    // `gotoHash` = a FULL-DOCUMENT route (distinct from switchTab/openTab, which stay in the main
    // app), so the spec/harness probe it on a THROWAWAY page that doesn't clobber the shared page.
    // All 4 selectors are single-class styled rules in DebatePopoutWindow.css (verified) carrying
    // theme-varying vars (--bg / --text-primary / --text-muted / --danger) → meaningful 4-theme
    // capture, not a vacuous defaults snapshot.
    gotoHash: '#debate-window',
    selectors: [
      'debate-popout-shell', 'debate-popout-error-box',
      'debate-popout-error-title', 'debate-popout-hint',
    ],
  },
};
