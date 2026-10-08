// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/4085: impure "fetch" half for the flake-heal tripwire. Lists the last M main ci.yml
// runs, downloads each run's flake-heals-shard-* artifacts (if any), and prints the
// [{runId, status, healedTestIds}] array that operations/devops/flake-heal-tripwire.mjs's
// pure countRepeatHealers() consumes. Kept as its own file (not inlined in the workflow
// YAML) because a multi-line embedded script inside a YAML block scalar is exactly the
// indentation footgun the Shell Quoting Rule warns about — this is a real file instead.
//
//   node collect-flake-heal-runs.mjs <owner/repo> [M]

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { M_RECENT_RUNS } from './flake-heal-tripwire.mjs';

const repo = process.argv[2] || process.env.GITHUB_REPOSITORY;
const m = Number(process.argv[3]) || M_RECENT_RUNS;

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024 });

function listMainRunIds() {
  const json = gh(['api', `repos/${repo}/actions/workflows/ci.yml/runs?branch=main&event=push&status=completed&per_page=${m}`]);
  return (JSON.parse(json).workflow_runs ?? []).map((r) => String(r.id));
}

function collectHealedTestIds(runId) {
  const dir = mkdtempSync(join(tmpdir(), `flake-heals-${runId}-`));
  try {
    gh(['run', 'download', runId, '--repo', repo, '--dir', dir, '--pattern', 'flake-heals-shard-*']);
  } catch {
    // No artifact matched (nothing self-healed that run, OR the recording step itself never
    // ran/uploaded) — these are indistinguishable from here, so this run is UNKNOWN, never
    // "zero heals" (t/4085#1 AC2's CANNOT-EVALUATE requirement).
    rmSync(dir, { recursive: true, force: true });
    return null;
  }
  const ids = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      if (!entry.name.endsWith('.jsonl')) continue;
      for (const line of readFileSync(p, 'utf8').split('\n')) {
        const t = line.trim();
        if (!t) continue;
        try { ids.push(JSON.parse(t).TestId); } catch { /* skip a malformed line, don't abort the run */ }
      }
    }
  };
  walk(dir);
  rmSync(dir, { recursive: true, force: true });
  return ids;
}

const runIds = listMainRunIds();
const runs = runIds.map((runId) => {
  const ids = collectHealedTestIds(runId);
  return ids === null
    ? { runId, status: 'unknown', healedTestIds: [] }
    : { runId, status: 'ok', healedTestIds: ids };
});

process.stdout.write(JSON.stringify(runs) + '\n');
