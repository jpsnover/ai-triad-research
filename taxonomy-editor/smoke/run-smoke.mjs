// Render-smoke orchestrator (t/3026): start:server → wait for :7862 → run the Playwright
// spec → tear down. Assumes `npm run build:container` has produced dist/ (prod web artifact +
// server). Exits non-zero on any failed assertion. DevOps owns the CI job wiring (t/3026#4).
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SMOKE_DIR = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(SMOKE_DIR, '..');
const PORT = process.env.PORT || '7862';
const BASE = `http://localhost:${PORT}`;
const useShell = process.platform === 'win32';

function launch(cmd, args, opts = {}) {
  return spawn(cmd, args, { stdio: 'inherit', shell: useShell, cwd: APP_DIR, ...opts });
}
const waitExit = (child) => new Promise((res) => child.on('exit', (c) => res(c ?? 1)));

const server = launch('node', ['dist/server/taxonomy-editor/src/server/server.js']);
let code = 1;
try {
  const waited = await waitExit(launch('npx', ['wait-on', '-t', '120000', BASE]));
  if (waited !== 0) throw new Error(`wait-on failed for ${BASE} (exit ${waited}) — is build:container built?`);
  code = await waitExit(
    launch('npx', ['playwright', 'test', '-c', 'smoke/playwright.config.mjs'], {
      env: { ...process.env, SMOKE_BASE_URL: BASE },
    }),
  );
} catch (err) {
  console.error(`[run-smoke] ${err instanceof Error ? err.message : String(err)}`);
} finally {
  server.kill();
}
process.exit(code);
