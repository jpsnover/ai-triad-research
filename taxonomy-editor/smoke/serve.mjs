// Render-smoke server launcher (t/3026). Playwright's `webServer` runs this; running the
// server *in this process* (via import, not a child) means Playwright's teardown kills the
// server cleanly — a spawned child would survive as a zombie holding the port (the shell:true
// kill on Windows only reaps the wrapper, not the grandchild).
//
// It first mirrors the Dockerfile's renderer symlink (Dockerfile:196): the server serves the
// SPA from `<server.js>/../renderer` but `build:web` emits to `dist/renderer`. Without the link
// `/` 404s and Playwright can't load the app.
import { existsSync, lstatSync, rmSync, symlinkSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Run the render smoke under the ELECTRON flag env (t/3299 B). All CSS clusters the invariance leg
// covers (lineage, summaries, debate-popout) are electron-app surfaces; the web build is only a
// convenient render harness. Specifically, this makes the env:electron-scoped `env-electron-summaries`
// seed resolve TRUE so the lazy SummariesTab chunk mounts + injects its CSS when the spec navigates to
// the summaries tab. Safe: no smoke surface depends on an env:web flag (attributes + the active
// invariance clusters probe only POV [data-tab]s, which are never flag-gated). `??=` so an explicit
// override still wins. Must be set BEFORE importing server.js (featureFlags reads it at resolve time).
process.env.FEATURE_FLAG_ENV ??= 'electron';

const DIR = dirname(fileURLToPath(import.meta.url));
const APP = resolve(DIR, '..');
const target = join(APP, 'dist', 'renderer');
const link = join(APP, 'dist', 'server', 'taxonomy-editor', 'src', 'renderer');
const serverJs = join(APP, 'dist', 'server', 'taxonomy-editor', 'src', 'server', 'server.js');

if (!existsSync(target)) {
  console.error(`[serve] dist/renderer missing — run \`npm run build:container\` first (${target})`);
  process.exit(1);
}
if (lstatSync(link, { throwIfNoEntry: false })) rmSync(link, { recursive: true, force: true });
mkdirSync(dirname(link), { recursive: true });
// 'junction' → dir junction on Windows (needs absolute target), plain symlink on POSIX.
symlinkSync(target, link, 'junction');

await import(`file://${serverJs.replace(/\\/g, '/')}`);
