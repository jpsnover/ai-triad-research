#!/usr/bin/env node
// t/3975 — Run dependency-cruiser and fail on ANY error-severity violation.
//
// Why a wrapper: `depcruise` exits with the NUMBER of violations, and a process exit status keeps only
// its low 8 bits. 600 violations exit 88; 256 or 512 exit 0, and the gate PASSES. Observed with a probe
// on 2026-10-06: 512 violations → exit 0 (t/3975, SO e/250). `reachable: true` rules make large counts
// ordinary (one bad shared import reports once per renderer file), so the wrap is no longer theoretical.
//
// Exit 0 = no error violations. Exit 1 = error violations (listed). Exit 2 = could not run the cruise.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The package doesn't export package.json, so require.resolve can't locate it; use the app's own install.
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(appDir, 'node_modules', 'dependency-cruiser', 'bin', 'dependency-cruiser.mjs');
if (!existsSync(bin)) {
  console.error(`depcruise could not run: ${bin} not found (run pnpm install)`);
  process.exit(2);
}
const args = ['--config', '.dependency-cruiser.cjs', '--output-type', 'json', 'src/', '../lib/'];

const run = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
if (run.error || !run.stdout) {
  console.error(`depcruise could not run: ${run.error?.message ?? run.stderr?.trim() ?? 'no output'}`);
  process.exit(2);
}

let summary;
try {
  ({ summary } = JSON.parse(run.stdout));
} catch (err) {
  console.error(`depcruise output was not JSON (${err.message}); stderr: ${run.stderr?.trim() ?? ''}`);
  process.exit(2);
}

const errors = summary.violations.filter(v => v.rule.severity === 'error');
for (const v of errors) console.error(`  error ${v.rule.name}: ${v.from} → ${v.to}`);
const warnings = summary.violations.length - errors.length;
if (errors.length > 0) {
  console.error(`\n✘ ${errors.length} dependency violation error(s), ${warnings} warning(s). ${summary.totalCruised} modules cruised.`);
  process.exit(1);
}
console.log(`✔ no dependency violation errors (${warnings} warning(s)); ${summary.totalCruised} modules, ${summary.totalDependenciesCruised} dependencies cruised.`);
