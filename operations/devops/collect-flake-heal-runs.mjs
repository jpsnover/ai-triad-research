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

// MUST-fix (Lead review, t/4085 PR #3134): counts the run's ACTUAL test-powershell shard
// jobs, read from the jobs API, so a shard-count change (t/4095's 4->5->6 escalation is the
// exact case) never requires editing this file. Used below to tell a PARTIAL upload (some
// shards' artifacts missing) from a COMPLETE one -- a partial upload must read as unknown,
// never as "the missing shards healed nothing" (that would silently undercount).
function countTestPowershellJobs(runId) {
  const json = gh(['api', `repos/${repo}/actions/runs/${runId}/jobs?per_page=100`]);
  const jobs = JSON.parse(json).jobs ?? [];
  return jobs.filter((j) => /^test-powershell \(\d+\)$/.test(j.name)).length;
}

/**
 * Downloads this run's flake-heals-shard-* artifacts and parses them.
 * @returns {null|{shardArtifactCount:number, ids:string[], badLines:number}}
 *   null = no artifact matched at all (nothing to distinguish "all shards healed nothing"
 *   from "the recording step broke everywhere" -- unknown by the caller).
 */
function collectHealedTestIds(runId) {
  const dir = mkdtempSync(join(tmpdir(), `flake-heals-${runId}-`));
  try {
    gh(['run', 'download', runId, '--repo', repo, '--dir', dir, '--pattern', 'flake-heals-shard-*']);
  } catch {
    rmSync(dir, { recursive: true, force: true });
    return null;
  }
  // gh run download makes one subdirectory per artifact name (flake-heals-shard-N), each
  // holding that shard's single .jsonl -- count the FILES, not raw lines, so an empty
  // (zero-heal) shard still counts toward shardArtifactCount.
  const ids = [];
  let shardArtifactCount = 0;
  let badLines = 0;
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      if (!entry.name.endsWith('.jsonl')) continue;
      shardArtifactCount += 1;
      for (const line of readFileSync(p, 'utf8').split('\n')) {
        const t = line.trim();
        if (!t) continue;
        // SHOULD-fix (Lead review): a malformed line undercounts silently if just skipped --
        // count it instead, so the caller can mark the whole run unknown rather than reporting
        // a confidently-wrong (too-low) heal count.
        try { ids.push(JSON.parse(t).TestId); } catch { badLines += 1; }
      }
    }
  };
  walk(dir);
  rmSync(dir, { recursive: true, force: true });
  return { shardArtifactCount, ids, badLines };
}

/**
 * PURE. Decides ok/unknown for one run from already-gathered facts, so the artifact-count-
 * must-match-job-count rule (MUST 2) and the malformed-line rule (SHOULD 3) are unit-tested
 * directly rather than only reachable through a live `gh` call.
 * @param {{shardArtifactCount:number, expectedShards:number, badLines:number}} facts
 * @returns {'ok'|'unknown'}
 */
export function classifyRunArtifacts({ shardArtifactCount, expectedShards, badLines }) {
  if (expectedShards === 0 || shardArtifactCount !== expectedShards) return 'unknown'; // partial/unresolvable upload
  if (badLines > 0) return 'unknown'; // at least one record unreadable -- true count may be higher
  return 'ok';
}

// Guarded like the other CLI shims in this directory (main-ci-monitor.mjs,
// flake-heal-tripwire.mjs): importing classifyRunArtifacts for unit tests must NOT also
// execute the impure gh-calling pipeline below.
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('operations/devops/collect-flake-heal-runs.mjs')) {
  const runIds = listMainRunIds();
  const runs = runIds.map((runId) => {
    const result = collectHealedTestIds(runId);
    if (result === null) return { runId, status: 'unknown', healedTestIds: [] };

    const expectedShards = countTestPowershellJobs(runId);
    const status = classifyRunArtifacts({ shardArtifactCount: result.shardArtifactCount, expectedShards, badLines: result.badLines });
    return status === 'ok'
      ? { runId, status: 'ok', healedTestIds: result.ids }
      : { runId, status: 'unknown', healedTestIds: [] };
  });

  process.stdout.write(JSON.stringify(runs) + '\n');
}
