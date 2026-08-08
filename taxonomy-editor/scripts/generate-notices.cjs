#!/usr/bin/env node
// Generate THIRD-PARTY-NOTICES.txt for a pnpm workspace package.
//
// Why this exists: generate-license-file@4 walks the local node_modules tree and
// does NOT follow pnpm's symlinked virtual store, so under pnpm it silently drops
// every transitive dependency and lists only direct deps (t/2292 fallout). It was
// also effectively a no-op in CI/build: its "overwrite? (N)" prompt defaults to No
// in a non-TTY, so `npm run licenses` never actually regenerated the file.
//
// This script instead asks pnpm itself for the package's production closure
// (`pnpm --filter <pkg> licenses list --prod --json`) — correct and scoped to this
// importer — then reads each package's license text from the store and emits the
// same block format the old tool produced (so taxonomy-editor's
// scripts/parse-licenses.cjs keeps working).
//
// Output is deterministic (stable sort) so re-running is idempotent — no spurious
// diffs unless the dependency set actually changed.
//
// Usage: node generate-notices.cjs [--output THIRD-PARTY-NOTICES.txt] [--check]
//   --check : generate in memory and exit non-zero if it differs from --output
//             (for CI drift detection); does not write.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function parseArgs(argv) {
  const out = { output: 'THIRD-PARTY-NOTICES.txt', check: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--output') out.output = argv[++i];
    else if (argv[i] === '--check') out.check = true;
  }
  return out;
}

const LICENSE_FILE_RE = /^(LICEN[CS]E|COPYING|COPYRIGHT|NOTICE)(\.|$)/i;

/** Read the best-effort license text for a package from its installed directory. */
function readLicenseText(pkgDir, spdx) {
  try {
    const files = fs.readdirSync(pkgDir);
    // Prefer a plain LICENSE file; fall back to any LICENSE-* variant.
    const exact = files.filter(f => LICENSE_FILE_RE.test(f))
      .sort((a, b) => a.length - b.length || a.localeCompare(b));
    for (const f of exact) {
      const full = path.join(pkgDir, f);
      // Single fd (open → fstat → read → close) so the is-file check and the
      // read act on the same handle — no TOCTOU race (js/file-system-race).
      let fd;
      try {
        fd = fs.openSync(full, 'r');
        if (fs.fstatSync(fd).isFile()) {
          const txt = fs.readFileSync(fd, 'utf-8').replace(/\r\n/g, '\n').trim();
          if (txt) return txt;
        }
      } catch { /* unreadable — try next */ } finally {
        if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* already closed */ } }
      }
    }
  } catch { /* dir gone — fall through */ }
  // No license file shipped: fall back to the SPDX identifier so the package is
  // still disclosed (with its declared license) rather than dropped.
  return spdx && spdx !== 'Unknown' ? spdx : 'License text not provided by the package author.';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const pkgJsonPath = path.resolve('package.json');
  if (!fs.existsSync(pkgJsonPath)) {
    console.error('generate-notices: no package.json in the current directory');
    process.exit(1);
  }
  const pkgName = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8')).name;
  // Validate against the npm package-name charset before it reaches a subprocess.
  if (!pkgName || !/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(pkgName)) {
    console.error(`generate-notices: package.json "name" missing or not a valid npm name: ${pkgName}`);
    process.exit(1);
  }

  // Ask pnpm for this importer's production dependency closure with store paths.
  // On Windows `pnpm` is a .cmd shim which execFile can't spawn directly (EINVAL);
  // invoke it through cmd.exe with args as discrete argv entries (no shell:true,
  // so no DEP0190 arg-concatenation risk). pkgName is validated above.
  const isWin = process.platform === 'win32';
  const bin = isWin ? 'cmd.exe' : 'pnpm';
  const binArgs = (isWin ? ['/c', 'pnpm'] : [])
    .concat(['--filter', pkgName, 'licenses', 'list', '--prod', '--json']);
  let raw;
  try {
    raw = execFileSync(bin, binArgs, {
      encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'],
    });
  } catch (err) {
    console.error(`generate-notices: "pnpm --filter ${pkgName} licenses list" failed: ${err.message}`);
    process.exit(1);
  }

  const byLicenseType = JSON.parse(raw); // { "MIT": [ {name, versions, paths, license}, ... ], ... }

  // Flatten to one row per (name@version), resolving each to a store dir + text.
  const rows = [];
  for (const entries of Object.values(byLicenseType)) {
    for (const e of entries) {
      const versions = e.versions && e.versions.length ? e.versions : [''];
      const paths = e.paths && e.paths.length ? e.paths : [];
      versions.forEach((v, i) => {
        const dir = paths[i] || paths[0];
        if (!dir) return;
        rows.push({ id: v ? `${e.name}@${v}` : e.name, dir, spdx: e.license || 'Unknown' });
      });
    }
  }
  // Deduplicate identical name@version (a pkg can appear under multiple parents).
  const seen = new Set();
  const unique = rows.filter(r => (seen.has(r.id) ? false : seen.add(r.id)));

  // Group packages that share identical license text into one block.
  const groups = new Map(); // licenseText -> Set(id)
  for (const r of unique) {
    const text = readLicenseText(r.dir, r.spdx);
    if (!groups.has(text)) groups.set(text, new Set());
    groups.get(text).add(r.id);
  }

  // Deterministic ordering: sort ids in each block, blocks by their first id.
  const blocks = [...groups.entries()]
    .map(([text, ids]) => ({ text, ids: [...ids].sort((a, b) => a.localeCompare(b)) }))
    .sort((a, b) => a.ids[0].localeCompare(b.ids[0]));

  const header =
    'This file lists the licenses of the third-party npm packages bundled in this product.\n' +
    'Generated by scripts/generate-notices.cjs (pnpm-aware; see the script header for why).\n';

  const parts = [header];
  for (const block of blocks) {
    const plural = block.ids.length > 1;
    parts.push(
      '\n-----------\n\n' +
      `The following npm package${plural ? 's' : ''} may be included in this product:\n\n` +
      block.ids.map(id => ` - ${id}`).join('\n') + '\n\n' +
      (plural
        ? 'These packages each contain the following license:\n\n'
        : 'This package contains the following license:\n\n') +
      block.text + '\n',
    );
  }
  const output = parts.join('') + '\n';

  const outPath = path.resolve(args.output);
  if (args.check) {
    const existing = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf-8').replace(/\r\n/g, '\n') : '';
    if (existing.trim() !== output.trim()) {
      console.error(`generate-notices: ${args.output} is out of date — run "npm run licenses" and commit.`);
      process.exit(1);
    }
    console.log(`generate-notices: ${args.output} is up to date (${unique.length} packages).`);
    return;
  }
  fs.writeFileSync(outPath, output, 'utf-8');
  console.log(`generate-notices: wrote ${args.output} (${unique.length} packages, ${blocks.length} license blocks).`);
}

main();
