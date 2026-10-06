#!/usr/bin/env node
// t/3975 — Run dependency-cruiser and fail on ANY error-severity violation.
//
// Why a wrapper: `depcruise` exits with the NUMBER of violations, and a process exit status keeps only
// its low 8 bits. 600 violations exit 88; 256 or 512 exit 0, and the gate PASSES. Observed with a probe
// on 2026-10-06: 512 violations → exit 0 (t/3975, SO e/250). `reachable: true` rules make large counts
// ordinary (one bad shared import reports once per renderer file), so the wrap is no longer theoretical.
//
// t/3982 (SO e/251#4, TL e/251#6, p/336#580/#582): three more invariants, because a green run must mean
// the boundaries were actually checked, not only that nothing violated what happened to be checked:
//   1. Required rules exist at severity 'error'. Deleting or downgrading one is a deliberate two-file
//      change (the config AND this list). Exit 1, reported like a violation.
//   2. A module floor. Narrowing the cruise roots / includeOnly shrinks what is checked. Exit 2.
//   3. An unresolved-alias ceiling. A broken resolver, alias or tsConfig makes alias imports unresolvable,
//      which silently drops every edge they carry (and blinds `reachable` rules) while the module count
//      RISES, so the floor cannot see it (measured t/3982#2: 679 unresolved, 0 violations, green). Exit 2.
// Not covered, and still review-only: a rule NARROWED by editing its from/to regex (t/3982).
//
// Exit 0 = clean. Exit 1 = error violations or a missing/downgraded required rule (listed).
// Exit 2 = the cruise could not run, or did not check what it claims to check.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Boundary rules that must exist in .dependency-cruiser.cjs at severity 'error' (t/3982). */
export const REQUIRED_RULES = [
  'lib-not-to-app',
  'renderer-not-to-server',
  'renderer-not-to-main',
  'server-not-to-renderer',
  'main-not-to-renderer',
  'debate-shared-not-to-slices',
  'renderer-not-to-soulDocLoader',
  'main-not-to-tagSoulRegistry',
  'server-not-to-tagSoulRegistry',
  'lib-debate-not-to-soul-loaders',
];

/** Fewest modules a full cruise of src/ + ../lib/ may report. ~2180 on 2026-10-06; the floor leaves ~15%
 *  headroom for refactors and catches GROSS narrowing only (excluding one subtree can stay above it). */
export const MODULE_FLOOR = 1800;

/** Most unresolved alias imports allowed. 0 since t/3982 fixed the last two (both type-only imports
 *  through undeclared @lib/ paths). Raise it only with a reason recorded here. */
export const UNRESOLVED_ALIAS_CEILING = 0;

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(appDir, 'package.json'));

/** Required rules that are missing from `forbidden` or not at severity 'error'. Pure. */
export function ruleProblems(forbidden, required = REQUIRED_RULES) {
  const byName = new Map((forbidden ?? []).map(r => [r.name, r]));
  return required.flatMap(name => {
    const rule = byName.get(name);
    if (!rule) return [`required rule "${name}" is missing from .dependency-cruiser.cjs`];
    if (rule.severity !== 'error') return [`required rule "${name}" has severity "${rule.severity}", must be "error"`];
    return [];
  });
}

/**
 * A matcher for alias-shaped specifiers, built from tsconfig `paths` keys. A specifier counts if it
 * matches a declared key (`@lib/debate/*` by prefix, `@bridge` exactly) OR sits under a declared alias
 * root (`@lib/…`, `@renderer/…`, `@bridge/…`), so an UNDECLARED path like `@lib/brief/types` counts too
 * (the declared-keys-only form missed both of the 2026-10-06 baseline imports). Pure.
 */
export function aliasMatcher(pathKeys) {
  const prefixes = pathKeys.filter(k => k.endsWith('/*')).map(k => k.slice(0, -1));
  const exact = new Set(pathKeys.filter(k => !k.endsWith('/*')));
  const roots = new Set(pathKeys.filter(k => k.startsWith('@')).map(k => k.split('/')[0]));
  return spec => exact.has(spec) || prefixes.some(p => spec.startsWith(p)) || roots.has(spec.split('/')[0]);
}

/** Unresolved dependencies whose specifier is alias-shaped, as [from, specifier]. Pure. */
export function unresolvedAliases(modules, isAlias) {
  return modules.flatMap(m => (m.dependencies ?? [])
    .filter(d => d.couldNotResolve && isAlias(d.module))
    .map(d => [m.source, d.module]));
}

/** tsconfig.json `compilerOptions.paths` keys, read with TypeScript's own (JSONC-aware) reader. */
function readPathKeys() {
  const ts = require('typescript');
  const file = path.join(appDir, 'tsconfig.json');
  const read = ts.readConfigFile(file, ts.sys.readFile);
  if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
  return Object.keys(read.config?.compilerOptions?.paths ?? {});
}

function fail(code, message) {
  console.error(message);
  process.exit(code);
}

function main() {
  // 1. Rule presence: cheap, and independent of the cruise.
  let config;
  try {
    config = require(path.join(appDir, '.dependency-cruiser.cjs'));
  } catch (err) {
    fail(2, `depcruise could not run: .dependency-cruiser.cjs did not load (${err.message})`);
  }
  const missing = ruleProblems(config.forbidden);
  for (const p of missing) console.error(`  error ${p}`);
  if (missing.length > 0) fail(1, `\n✘ ${missing.length} required boundary rule(s) missing or downgraded (t/3982).`);

  let pathKeys;
  try {
    pathKeys = readPathKeys();
  } catch (err) {
    fail(2, `depcruise could not run: tsconfig.json paths could not be read (${err.message})`);
  }

  // The package doesn't export package.json, so require.resolve can't locate it; use the app's own install.
  const bin = path.join(appDir, 'node_modules', 'dependency-cruiser', 'bin', 'dependency-cruiser.mjs');
  if (!existsSync(bin)) fail(2, `depcruise could not run: ${bin} not found (run pnpm install)`);
  const args = ['--config', '.dependency-cruiser.cjs', '--output-type', 'json', 'src/renderer/utils/'];

  const run = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, cwd: appDir });
  if (run.error || !run.stdout) fail(2, `depcruise could not run: ${run.error?.message ?? run.stderr?.trim() ?? 'no output'}`);

  let result;
  try {
    result = JSON.parse(run.stdout);
  } catch (err) {
    fail(2, `depcruise output was not JSON (${err.message}); stderr: ${run.stderr?.trim() ?? ''}`);
  }
  const { summary, modules } = result;

  const errors = summary.violations.filter(v => v.rule.severity === 'error');
  for (const v of errors) console.error(`  error ${v.rule.name}: ${v.from} → ${v.to}`);
  const warnings = summary.violations.length - errors.length;
  if (errors.length > 0) {
    fail(1, `\n✘ ${errors.length} dependency violation error(s), ${warnings} warning(s). ${summary.totalCruised} modules cruised.`);
  }

  // 2. Scope floor.
  if (summary.totalCruised < MODULE_FLOOR) {
    fail(2, `✘ cruise scope shrank: ${summary.totalCruised} modules < floor ${MODULE_FLOOR} (t/3982). The boundaries were not checked across the whole app.`);
  }

  // 3. Unresolved-alias ceiling.
  const unresolved = unresolvedAliases(modules ?? [], aliasMatcher(pathKeys));
  if (unresolved.length > UNRESOLVED_ALIAS_CEILING) {
    for (const [from, spec] of unresolved.slice(0, 20)) console.error(`  unresolved alias: ${from} → ${spec}`);
    fail(2, `✘ ${unresolved.length} alias import(s) did not resolve (ceiling ${UNRESOLVED_ALIAS_CEILING}; t/3982). A broken alias, resolver or tsConfig drops their edges, so boundary rules cannot see them.`);
  }

  console.log(`✔ no dependency violation errors (${warnings} warning(s)); ${summary.totalCruised} modules, ${summary.totalDependenciesCruised} dependencies cruised; ${REQUIRED_RULES.length} required rules present; ${unresolved.length} unresolved alias imports.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
