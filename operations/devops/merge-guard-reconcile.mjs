// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Merge-guard advisory-cycle reconciler (t/3695#25-27). The blocking flip of pre-self-merge-verify
// is gated on Live-Fire Proof from its own execution record (.gate-telemetry/merge-guard.jsonl):
//   - every MANUAL merge in the window appears in the record (coverage),
//   - ≥10 judged merges with 0 false positives, ≥1 true positive.
// This module answers the coverage half mechanically and lists every block for a human FP/TP call.
//
// Pure core (`reconcileMergeGuardCoverage`) + an impure CLI shim (GitHub fetch + file read), so the
// core is unit-tested in merge-guard-predicate.test.mjs under the CI floor (t/3871).
//
//   node operations/devops/merge-guard-reconcile.mjs --since 2026-10-07T00:00:00Z \
//     [--until <iso>] [--repos jpsnover/ai-triad-research,jpsnover/ai-triad-data] [--file <jsonl>]

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Clause reasons that mean "a real merge was attempted by hand" — the population coverage is about.
// auto-exempt arms auto-merge (GitHub merges later); disable-auto merges nothing.
const JUDGED = new Set(['guarded', 'missing-match-head-commit']);

// '22' or 'https://github.com/o/r/pull/22' → { repo, number }
export function parsePrRefKey(prRef, repo) {
  if (prRef == null) return null;
  const url = String(prRef).match(/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/);
  if (url) return { repo: url[1], number: Number(url[2]) };
  if (/^\d+$/.test(String(prRef))) return { repo: repo || null, number: Number(prRef) };
  return null;
}

/**
 * PURE. records: parsed merge-guard.jsonl lines. mergedPrs: [{ repo, number, mergedAt, autoMerge }]
 * where autoMerge = an auto_merge_enabled event exists (GitHub, not an agent, performed the merge).
 *
 * Returns counts plus the lists a reviewer needs:
 *   manual            — merged PRs in the window that were NOT auto-merged (the coverage population)
 *   covered / missing — manual merges with / without a judged clause in the record
 *   unparseableRefs   — judged clauses whose PR ref could not be parsed (TL condition 2: own count)
 *   ambiguous         — judged clauses with a bare number and no -R that match PRs in >1 repo
 *   legacyRecords     — in-window records written before per-clause fields existed (no `clauses`)
 *   blocks            — every judged clause the guard would have blocked, for the FP/TP call
 */
export function reconcileMergeGuardCoverage({ records = [], mergedPrs = [], since, until } = {}) {
  const inWin = (ts) => !!ts && (!since || ts >= since) && (!until || ts <= until);
  const manual = mergedPrs.filter((p) => inWin(p.mergedAt) && !p.autoMerge);

  let legacyRecords = 0;
  const judged = [];
  for (const r of records) {
    if (!r || r.mode !== 'head-guard' || !inWin(r.ts)) continue;
    if (!Array.isArray(r.clauses)) { legacyRecords++; continue; }
    for (const c of r.clauses) if (JUDGED.has(c.reason)) judged.push({ ts: r.ts, ...c });
  }

  const unparseableRefs = [];
  const ambiguous = [];
  const coveredKeys = new Set();
  for (const c of judged) {
    const key = parsePrRefKey(c.prRef, c.repo);
    if (!key) { unparseableRefs.push(c); continue; }
    const hits = mergedPrs.filter((p) => p.number === key.number && (!key.repo || p.repo === key.repo));
    if (!key.repo && new Set(hits.map((p) => p.repo)).size > 1) { ambiguous.push(c); continue; }
    for (const p of hits) coveredKeys.add(`${p.repo}#${p.number}`);
  }

  const covered = manual.filter((p) => coveredKeys.has(`${p.repo}#${p.number}`));
  const missing = manual.filter((p) => !coveredKeys.has(`${p.repo}#${p.number}`));
  const blocks = judged.filter((c) => c.reason === 'missing-match-head-commit');
  return {
    judged: judged.length,
    manual: manual.length,
    covered: covered.length,
    missing,
    unparseableRefs,
    ambiguous,
    legacyRecords,
    blocks,
  };
}

// ── CLI shim (impure): read the record, fetch merged PRs + auto-merge evidence from GitHub ──
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('merge-guard-reconcile.mjs')) {
  const arg = (name, dflt) => {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
  };
  const since = arg('--since', null);
  if (!since) {
    console.error('usage: merge-guard-reconcile.mjs --since <iso> [--until <iso>] [--repos o/r,o/r] [--file <jsonl>]');
    process.exit(2);
  }
  const until = arg('--until', null);
  const repos = arg('--repos', 'jpsnover/ai-triad-research,jpsnover/ai-triad-data').split(',');
  const file = arg('--file', fileURLToPath(new URL('./.gate-telemetry/merge-guard.jsonl', import.meta.url)));
  const gh = (args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 }));

  let records = [];
  try {
    records = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    });
  } catch (e) {
    console.error(`cannot read record ${file}: ${e.message}`);
    process.exit(2);
  }

  const mergedPrs = [];
  for (const repo of repos) {
    const day = since.slice(0, 10);
    const list = gh(['pr', 'list', '-R', repo, '--state', 'merged', '--search', `merged:>=${day}`,
      '--limit', '500', '--json', 'number,mergedAt']);
    for (const p of list) {
      if (!(p.mergedAt >= since) || (until && p.mergedAt > until)) continue;
      // --paginate concatenates JSON pages, so filter per page with --jq instead of parsing the whole.
      // The REST event name carries the merge method: auto_squash_enabled / auto_merge_enabled /
      // auto_rebase_enabled (observed: #2933 has only auto_squash_enabled).
      const autoMerge = execFileSync('gh', ['api', '--paginate', `repos/${repo}/issues/${p.number}/timeline?per_page=100`,
        '--jq', '.[] | select(.event | test("^auto_(merge|squash|rebase)_enabled$")) | .event'],
      { encoding: 'utf8', windowsHide: true }).trim().length > 0;
      mergedPrs.push({ repo, number: p.number, mergedAt: p.mergedAt, autoMerge });
    }
  }

  const r = reconcileMergeGuardCoverage({ records, mergedPrs, since, until });
  console.log(JSON.stringify({ since, until, repos, ...r }, null, 2));
  // Coverage fails (exit 1) if any manual merge is missing from the record; exit 0 otherwise.
  process.exit(r.missing.length ? 1 : 0);
}
