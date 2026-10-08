// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * t/4085 AC2: advisory tripwire over the test-powershell self-heal records (t/4080's
 * "treated as flake (self-healed)" events, recorded per-shard by the isolated sink in
 * ci.yml and uploaded as `flake-heals-shard-N` artifacts, 30-day retention).
 *
 * A test id that self-heals repeatedly across main runs is the surviving vector named in
 * the t/4080 gate verification (#3093): an order-dependent failure (state leaked from an
 * earlier file in the same shard) heals when its own file reruns in isolation, so the
 * per-run rerun verdict can never distinguish it from a genuine one-off flake. Aggregating
 * across main runs is the only way to see the pattern.
 *
 * GATE CO-LOCATION — constants live here, at the point of use, with their rationale:
 */
export const N_REPEAT_HEALS = 3;   // flag a test id healed in >= N of the last M main runs.
export const M_RECENT_RUNS = 10;   // the window of main push-event ci.yml runs considered.
// N=3/M=10 chosen as a first advisory threshold: one heal is ordinary rerun-flake noise: two
// is still plausibly coincidence across independent causes; three within a 10-run window is
// the point a shared root cause (the same order-dependent leak) becomes the likelier read.
// Revisit once real main data exists to calibrate against (this is reasoned, not yet observed
// — the advisory mode is deliberately forgiving while that calibration happens, t/4085#1).

/**
 * PURE. Counts, per test id, how many of the supplied main runs it self-healed in.
 *
 * @param {object} args
 * @param {Array<{runId:string, status:'ok'|'unknown', healedTestIds:string[]}>} args.runs
 *   One entry per main run considered. `status:'unknown'` means that run's flake-heal
 *   artifacts were missing or unreadable -- the run is EXCLUDED from every test id's count
 *   (CANNOT EVALUATE must never be silently read as "this run had zero heals", t/4085#1 AC3);
 *   it is surfaced separately via the returned `unknownRuns` so the caller can report it.
 * @param {number} [args.n] N_REPEAT_HEALS override (tests use this to probe boundaries).
 * @returns {{flagged: Array<{testId:string, count:number, runIds:string[]}>, unknownRuns: string[], evaluableRuns: number}}
 */
export function countRepeatHealers({ runs, n = N_REPEAT_HEALS } = {}) {
  const list = Array.isArray(runs) ? runs : [];
  const unknownRuns = list.filter((r) => r.status === 'unknown').map((r) => r.runId);
  const evaluable = list.filter((r) => r.status !== 'unknown');

  const byTestId = new Map(); // testId -> Set<runId>
  for (const run of evaluable) {
    for (const testId of run.healedTestIds ?? []) {
      if (!byTestId.has(testId)) byTestId.set(testId, new Set());
      byTestId.get(testId).add(run.runId);
    }
  }

  const flagged = [];
  for (const [testId, runIdSet] of byTestId) {
    if (runIdSet.size >= n) {
      flagged.push({ testId, count: runIdSet.size, runIds: [...runIdSet].sort() });
    }
  }
  flagged.sort((a, b) => b.count - a.count || a.testId.localeCompare(b.testId));

  return { flagged, unknownRuns, evaluableRuns: evaluable.length };
}

// ── CLI shim (impure — the ONLY part that touches disk). Prints a JSON verdict to stdout.
//    node flake-heal-tripwire.mjs < runs.json
// By design the workflow step does all the fetching (listing the last M main ci.yml runs,
// downloading each run's flake-heals-shard-* artifacts with actions/download-artifact, reading
// the extracted .jsonl files) and hands this shim the already-built
// [{runId, status:'ok'|'unknown', healedTestIds}] array on stdin — this file stays a pure
// function plus a thin reader, with no gh/API logic of its own to drift from the tests.
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('operations/devops/flake-heal-tripwire.mjs')) {
  const chunks = [];
  process.stdin.on('data', (c) => chunks.push(c));
  process.stdin.on('end', () => {
    let out;
    try {
      const runs = JSON.parse(Buffer.concat(chunks).toString('utf8') || '[]');
      const verdict = countRepeatHealers({ runs });
      out = { ok: true, runsConsidered: Array.isArray(runs) ? runs.length : 0, verdict };
    } catch (e) {
      out = { ok: false, error: String((e && e.message) || e) };
    }
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    process.exitCode = out.ok ? 0 : 3;
  });
}
