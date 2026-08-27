// Render-smoke entry (t/3026): run the Playwright spec against the prod web artifact.
// Playwright's `webServer` (see playwright.config.mjs) owns the server: it runs smoke/serve.mjs
// — which symlinks the renderer and starts the server in-process — waits for `/` to answer,
// and tears it down afterward. Assumes `npm run build:container` has produced dist/.
//
// We resolve the LOCAL @playwright/test CLI instead of shelling to `npx playwright`: npx on
// some machines fails to find the local binary and downloads a mismatched playwright into its
// cache, which then can't resolve @playwright/test (ERR_MODULE_NOT_FOUND). require.resolve
// pins the exact installed CLI. DevOps owns the CI job wiring (t/3026#4).
import { spawn } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Direct file path, not require.resolve('@playwright/test/cli.js'): that subpath is not in the
// package's `exports` map (ERR_PACKAGE_PATH_NOT_EXPORTED) — the .bin shim execs the file directly.
const cli = join(APP_DIR, 'node_modules', '@playwright', 'test', 'cli.js');
if (!existsSync(cli)) {
  console.error(`[run-smoke] @playwright/test not installed at ${cli} — run \`npm install @playwright/test\` + \`npx playwright install chromium\``);
  process.exit(1);
}

const child = spawn(process.execPath, [cli, 'test', '-c', 'smoke/playwright.config.mjs'], {
  stdio: 'inherit',
  cwd: APP_DIR,
});
child.on('exit', (code) => process.exit(code ?? 1));
