// Architecture boundary rules enforced by dependency-cruiser.
// Run: npx depcruise --config .dependency-cruiser.cjs src/ ../lib/
// See docs/architecture-boundaries.md for rationale.

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // ── lib → app: shared libraries must not import application code ──
    // Matches only the top-level shared lib/ (../lib/), not src/renderer/lib/.
    {
      name: 'lib-not-to-app',
      comment: 'Shared lib/ must not import from the taxonomy-editor app (src/).',
      severity: 'error',
      from: { path: '^\\.\\.[\\\\/]lib[\\\\/]' },
      to: { path: '(^|/)src/' },
    },

    // ── renderer → server: renderer must go through bridge, never import server directly ──
    {
      name: 'renderer-not-to-server',
      comment: 'Renderer code must access the server through @bridge, not import server modules directly.',
      severity: 'error',
      from: { path: '(^|/)src/renderer/' },
      to: { path: '(^|/)src/server/' },
    },

    // ── renderer → main: renderer must not import Electron main process modules ──
    {
      name: 'renderer-not-to-main',
      comment: 'Renderer must not import main process modules — use IPC via @bridge.',
      severity: 'error',
      from: { path: '(^|/)src/renderer/' },
      to: { path: '(^|/)src/main/' },
    },

    // ── server → renderer: server must not import renderer/UI code ──
    {
      name: 'server-not-to-renderer',
      comment: 'Server must not depend on renderer (UI) code.',
      severity: 'error',
      from: { path: '(^|/)src/server/' },
      to: { path: '(^|/)src/renderer/' },
    },

    // ── main → renderer: main process must not import renderer code ──
    {
      name: 'main-not-to-renderer',
      comment: 'Main process must not import renderer code — use IPC.',
      severity: 'error',
      from: { path: '(^|/)src/main/' },
      to: { path: '(^|/)src/renderer/' },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.json',
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
    reporterOptions: {
      text: {
        highlightFocused: true,
      },
    },
  },
};
