#!/usr/bin/env node
// ─── CI dependency-audit checker (t/1800) ───
// A REAL security gate that runs independently of the Test gate (they used to
// share a job, so an audit failure silently skipped Test repo-wide — the t/1800
// false-green). This script hard-fails on any high/critical advisory in an app's
// PRODUCTION deps that is NOT explicitly baselined, so genuinely-new advisories
// still gate CI while known-and-tracked ones don't block the pipeline.
//
// Usage:  node .github/scripts/ci-audit.mjs <app-dir>
// Baseline: AUDIT_BASELINE env var, space/comma-separated GHSA IDs. Each
// baselined ID MUST carry a co-located rationale + owner-follow-up ticket in
// ci.yml at the matrix entry (Gate Co-Location rule) — never here, never in
// ticket history alone.
import { spawnSync } from 'node:child_process';

const appDir = process.argv[2] || '.';
const baseline = new Set(
  (process.env.AUDIT_BASELINE || '')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean),
);

// npm audit exits non-zero when advisories exist — that is not a script error, so
// capture stdout regardless of exit code. A non-JSON stdout means the audit
// itself failed to run (e.g. registry unreachable); fail loudly rather than
// false-green.
const res = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
  cwd: appDir,
  encoding: 'utf8',
  shell: process.platform === 'win32',
  maxBuffer: 32 * 1024 * 1024,
});

let report;
try {
  report = JSON.parse(res.stdout);
} catch {
  console.error(`::error::[${appDir}] npm audit did not return JSON — audit could not run.`);
  console.error((res.stderr || res.stdout || '').slice(0, 2000));
  process.exit(1);
}

const GHSA = /GHSA-[a-z0-9-]+/i;
const found = new Map(); // ghsaId -> { title, packages:Set }
for (const [name, v] of Object.entries(report.vulnerabilities || {})) {
  if (!['high', 'critical'].includes(v.severity)) continue;
  for (const via of v.via || []) {
    if (typeof via !== 'object' || !via.url) continue;
    const m = GHSA.exec(via.url);
    if (!m) continue;
    const id = m[0];
    if (!found.has(id)) found.set(id, { title: via.title || '', packages: new Set() });
    found.get(id).packages.add(name);
  }
}

const unbaselined = [...found.entries()].filter(([id]) => !baseline.has(id));
const staleBaseline = [...baseline].filter((id) => !found.has(id));

console.log(`── dependency-audit: ${appDir} ──`);
for (const [id, info] of found) {
  const tag = baseline.has(id) ? 'baselined' : 'NEW';
  console.log(`  [${tag}] ${id} — ${info.title} (via ${[...info.packages].join(', ')})`);
}
if (!found.size) console.log('  no high/critical advisories in production deps');

// A baseline entry that no longer matches any advisory is stale — warn (so it
// gets pruned) but do not fail: a resolved advisory must never turn the gate red.
for (const id of staleBaseline) {
  console.log(`::warning::[${appDir}] baselined advisory ${id} no longer present — remove it from the ci.yml baseline.`);
}

if (unbaselined.length) {
  console.error(
    `::error::[${appDir}] ${unbaselined.length} un-baselined high/critical advisory(ies): ${unbaselined
      .map(([id]) => id)
      .join(', ')}. Clear them (npm audit fix / override) or, if tolerated, add the ID to AUDIT_BASELINE in ci.yml with a co-located rationale + owner ticket.`,
  );
  process.exit(1);
}
console.log(`  OK — ${found.size} advisory(ies), all baselined.`);
