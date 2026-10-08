// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// All-arms proof for the t/4085 flake-heal tripwire (AC3). Run:
//   node --test operations/devops/flake-heal-tripwire.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countRepeatHealers, N_REPEAT_HEALS, M_RECENT_RUNS } from './flake-heal-tripwire.mjs';

const ok = (runId, healedTestIds = []) => ({ runId, status: 'ok', healedTestIds });
const unknown = (runId) => ({ runId, status: 'unknown', healedTestIds: [] });

test('flagged: one test id healed in 3 of 10 runs', () => {
  const runs = [ok('r1', ['A']), ok('r2', ['A']), ok('r3', ['A']), ok('r4'), ok('r5'), ok('r6'), ok('r7'), ok('r8'), ok('r9'), ok('r10')];
  const v = countRepeatHealers({ runs });
  assert.equal(v.flagged.length, 1);
  assert.equal(v.flagged[0].testId, 'A');
  assert.equal(v.flagged[0].count, 3);
  assert.deepEqual(v.flagged[0].runIds, ['r1', 'r2', 'r3']);
});

test('not flagged: one heal in 10 runs', () => {
  const runs = [ok('r1', ['A']), ok('r2'), ok('r3'), ok('r4'), ok('r5'), ok('r6'), ok('r7'), ok('r8'), ok('r9'), ok('r10')];
  assert.deepEqual(countRepeatHealers({ runs }).flagged, []);
});

test('not flagged: three different test ids healing once each', () => {
  const runs = [ok('r1', ['A']), ok('r2', ['B']), ok('r3', ['C'])];
  assert.deepEqual(countRepeatHealers({ runs }).flagged, []);
});

test('boundary: exactly N-1 heals -> not flagged', () => {
  const runs = [ok('r1', ['A']), ok('r2', ['A'])];
  assert.deepEqual(countRepeatHealers({ runs, n: N_REPEAT_HEALS }).flagged, []);
});

test('boundary: exactly N heals -> flagged', () => {
  const runs = [ok('r1', ['A']), ok('r2', ['A']), ok('r3', ['A'])];
  assert.equal(countRepeatHealers({ runs, n: N_REPEAT_HEALS }).flagged.length, 1);
});

test('CANNOT EVALUATE: a run with missing artifacts is excluded from every count, never read as zero heals', () => {
  // Without the fix this would otherwise be "A healed in r1/r2, 'healed' 0 times in r3" (still
  // only 2/3 -> not flagged by coincidence). The real point: r3 being unknown must not silently
  // count as evidence AGAINST A being a repeat healer, and must be surfaced to the caller.
  const runs = [ok('r1', ['A']), ok('r2', ['A']), unknown('r3')];
  const v = countRepeatHealers({ runs, n: 2 });
  assert.equal(v.flagged.length, 1, 'A healed in both EVALUABLE runs, which already meets n=2');
  assert.deepEqual(v.unknownRuns, ['r3']);
  assert.equal(v.evaluableRuns, 2);
});

test('CANNOT EVALUATE: unknown runs are reported even when nothing is flagged', () => {
  const runs = [ok('r1'), unknown('r2'), unknown('r3')];
  const v = countRepeatHealers({ runs });
  assert.deepEqual(v.flagged, []);
  assert.deepEqual(v.unknownRuns, ['r2', 'r3']);
  assert.equal(v.evaluableRuns, 1);
});

test('a test id healing in the SAME run twice (two shards) counts once for that run', () => {
  // Realistic for a data-driven test split across two shards by -ForEach row; the tripwire
  // counts DISTINCT RUNS, not raw occurrences, so this must not double-count run r1.
  const runs = [{ runId: 'r1', status: 'ok', healedTestIds: ['A', 'A'] }, ok('r2', ['A'])];
  const v = countRepeatHealers({ runs, n: 2 });
  assert.equal(v.flagged[0].count, 2);
});

test('empty input -> no flags, no unknowns', () => {
  const v = countRepeatHealers({ runs: [] });
  assert.deepEqual(v.flagged, []);
  assert.deepEqual(v.unknownRuns, []);
  assert.equal(v.evaluableRuns, 0);
});

test('constants are named and sane (Gate Co-Location)', () => {
  assert.equal(typeof N_REPEAT_HEALS, 'number');
  assert.equal(typeof M_RECENT_RUNS, 'number');
  assert.ok(N_REPEAT_HEALS >= 2 && N_REPEAT_HEALS <= M_RECENT_RUNS);
});
