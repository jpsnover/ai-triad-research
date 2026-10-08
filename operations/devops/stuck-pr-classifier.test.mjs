// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// All-arms proof for the t/4115 stuck-PR classifier. Run:
//   node --test operations/devops/stuck-pr-classifier.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyBlocker, escalationLevel, detectSweepSignature, classifySweepHits,
  REQUIRED_CONTEXTS, STUCK_RUN_MINUTES, OWNER_SLA_HOURS, TL_SLA_HOURS, SWEEP_WINDOW_SECONDS, SWEEP_BURST_SECONDS,
} from './stuck-pr-classifier.mjs';

const NOW = Date.parse('2026-10-08T12:00:00Z');
const minsAgo = (m) => new Date(NOW - m * 60000).toISOString();
const hoursAgo = (h) => new Date(NOW - h * 3600000).toISOString();

function allGreenRuns(overrides = {}) {
  return REQUIRED_CONTEXTS.map((name) => ({
    name, status: 'completed', conclusion: 'success', createdAt: hoursAgo(1), ...(overrides[name] ?? {}),
  }));
}

function basePr(overrides = {}) {
  return {
    mergeableState: 'clean',
    isConflicting: false,
    autoMergeEnabled: false,
    labels: [],
    runs: allGreenRuns(),
    mergeRefusalText: null,
    lastActivityAt: minsAgo(5),
    ...overrides,
  };
}

// ── held ──
test('held: consult-hold label never escalates, reports age only', () => {
  const pr = basePr({ labels: ['consult-hold'], isConflicting: true /* would otherwise be merge-conflict */ });
  const v = classifyBlocker(pr, NOW);
  assert.equal(v.class, 'held');
  assert.equal(escalationLevel(v.class, 100), 'none'); // even at 100h, never escalates
});
test('held: joint-gv label also never escalates', () => {
  const pr = basePr({ labels: ['joint-gv'] });
  assert.equal(classifyBlocker(pr, NOW)?.class, 'held');
});

// ── merge-conflict ──
test('merge-conflict: isConflicting true, no hold label', () => {
  const pr = basePr({ isConflicting: true });
  assert.equal(classifyBlocker(pr, NOW).class, 'merge-conflict');
});

// ── stuck-required-run (the #3062 class) ──
test('stuck-required-run: queued past the 30-min threshold', () => {
  const pr = basePr({ runs: allGreenRuns({ 'joint-gv-guard': { status: 'queued', conclusion: null, createdAt: minsAgo(STUCK_RUN_MINUTES + 1), id: 999 } }) });
  const v = classifyBlocker(pr, NOW);
  assert.equal(v.class, 'stuck-required-run');
  assert.equal(v.detail.context, 'joint-gv-guard');
  assert.equal(v.detail.runId, 999);
  assert.match(v.detail.remedy, /re-trigger/i);
});
test('stuck-required-run: in_progress past threshold also matches', () => {
  const pr = basePr({ runs: allGreenRuns({ 'ci-gate': { status: 'in_progress', conclusion: null, createdAt: minsAgo(45), id: 1 } }) });
  assert.equal(classifyBlocker(pr, NOW).class, 'stuck-required-run');
});
test('BOUNDARY: queued exactly at 30 min is NOT yet stuck', () => {
  const pr = basePr({ runs: allGreenRuns({ 'ci-gate': { status: 'queued', conclusion: null, createdAt: minsAgo(STUCK_RUN_MINUTES), id: 1 } }) });
  const v = classifyBlocker(pr, NOW);
  assert.notEqual(v?.class, 'stuck-required-run');
});
test('BOUNDARY: queued at 30 min + 1 second IS stuck', () => {
  const createdAt = new Date(NOW - (STUCK_RUN_MINUTES * 60 + 1) * 1000).toISOString();
  const pr = basePr({ runs: allGreenRuns({ 'ci-gate': { status: 'queued', conclusion: null, createdAt, id: 1 } }) });
  assert.equal(classifyBlocker(pr, NOW).class, 'stuck-required-run');
});
test('an older green run does NOT mask a stuck queued run (#3062 blind spot) -- queued is checked, not the rollup', () => {
  // The whole point: byName keeps only the NEWEST run per name, so a stuck queued run that
  // is genuinely the newest for its context must be seen even though an older run succeeded.
  const pr = basePr({ runs: allGreenRuns({ 'joint-gv-guard': { status: 'queued', conclusion: null, createdAt: minsAgo(40), id: 2 } }) });
  assert.equal(classifyBlocker(pr, NOW).class, 'stuck-required-run');
});

// ── required-check-failed ──
test('required-check-failed: a required context concluded failure', () => {
  const pr = basePr({ runs: allGreenRuns({ CodeQL: { status: 'completed', conclusion: 'failure', createdAt: minsAgo(10), id: 5 } }) });
  const v = classifyBlocker(pr, NOW);
  assert.equal(v.class, 'required-check-failed');
  assert.equal(v.detail.context, 'CodeQL');
});

// ── armed-but-blocked ──
test('armed-but-blocked: auto-merge armed, everything green, still BLOCKED', () => {
  const pr = basePr({ autoMergeEnabled: true, mergeableState: 'blocked', mergeRefusalText: 'Required status check "joint-gv-guard" is expected' });
  const v = classifyBlocker(pr, NOW);
  assert.equal(v.class, 'armed-but-blocked');
  assert.match(v.detail.mergeRefusalText, /joint-gv-guard/);
});
test('NOT armed-but-blocked: armed and green but mergeableState is clean (normal in-flight merge)', () => {
  const pr = basePr({ autoMergeEnabled: true, mergeableState: 'clean' });
  assert.notEqual(classifyBlocker(pr, NOW)?.class, 'armed-but-blocked');
});

// ── idle ──
test('idle: no other blocker, no activity for over the idle-detect threshold', () => {
  const pr = basePr({ lastActivityAt: hoursAgo(2) });
  assert.equal(classifyBlocker(pr, NOW).class, 'idle');
});
test('NOT idle: recent activity, no other blocker -> null (nothing to report)', () => {
  const pr = basePr({ lastActivityAt: minsAgo(5) });
  assert.equal(classifyBlocker(pr, NOW), null);
});

// ── escalation SLA ──
test('escalation: under 2h -> none', () => {
  assert.equal(escalationLevel('idle', 1), 'none');
});
test('escalation: at 2h -> owner', () => {
  assert.equal(escalationLevel('stuck-required-run', OWNER_SLA_HOURS), 'owner');
});
test('escalation: at 6h -> tl', () => {
  assert.equal(escalationLevel('stuck-required-run', TL_SLA_HOURS), 'tl');
});
test('escalation: held never escalates regardless of age', () => {
  assert.equal(escalationLevel('held', 1000), 'none');
});

// ── sweep-signature detector ──
test('sweep: ready_for_review then auto_merge_enabled within 15s -> a hit', () => {
  const events = [
    { prNumber: 101, event: 'ready_for_review', actor: 'agent-a', createdAt: '2026-10-08T10:00:00Z' },
    { prNumber: 101, event: 'auto_merge_enabled', actor: 'agent-a', createdAt: '2026-10-08T10:00:10Z' },
  ];
  const hits = detectSweepSignature(events);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].prNumber, 101);
  assert.equal(hits[0].deltaSeconds, 10);
});
test('sweep: a gap beyond the window is NOT a hit (legitimate owner flow)', () => {
  const events = [
    { prNumber: 101, event: 'ready_for_review', actor: 'tl', createdAt: '2026-10-08T10:00:00Z' },
    { prNumber: 101, event: 'auto_merge_enabled', actor: 'tl', createdAt: '2026-10-08T10:05:00Z' }, // 5 min later
  ];
  assert.equal(detectSweepSignature(events).length, 0);
});
test('sweep: auto_update_enabled also counts as the arm event', () => {
  const events = [
    { prNumber: 7, event: 'ready_for_review', actor: 'x', createdAt: '2026-10-08T10:00:00Z' },
    { prNumber: 7, event: 'auto_update_enabled', actor: 'x', createdAt: '2026-10-08T10:00:05Z' },
  ];
  assert.equal(detectSweepSignature(events).length, 1);
});

// ── sweep classification: burst vs single legitimate flow ──
test('sweep burst: 2+ PRs within the burst window -> both escalate', () => {
  const hits = [
    { prNumber: 1, readyAt: '2026-10-08T10:00:00Z', armedAt: '2026-10-08T10:00:05Z', actor: 'x' },
    { prNumber: 2, readyAt: '2026-10-08T10:01:00Z', armedAt: '2026-10-08T10:01:30Z', actor: 'x' },
  ];
  const verdicts = classifySweepHits(hits, new Map());
  assert.ok(verdicts.every((v) => v.escalate));
});
test('single legitimate owner flow: one PR, no hold, no burst -> confirm-only, no escalation', () => {
  const hits = [{ prNumber: 3121, readyAt: '2026-10-07T23:44:00Z', armedAt: '2026-10-07T23:44:05Z', actor: 'tl' }];
  const verdicts = classifySweepHits(hits, new Map());
  assert.equal(verdicts.length, 1);
  assert.equal(verdicts[0].escalate, false);
});
test('sweep: a hit on a held PR (consult-hold) escalates even alone', () => {
  const hits = [{ prNumber: 50, readyAt: '2026-10-08T10:00:00Z', armedAt: '2026-10-08T10:00:05Z', actor: 'x' }];
  const labelsByPr = new Map([[50, ['consult-hold']]]);
  const verdicts = classifySweepHits(hits, labelsByPr);
  assert.equal(verdicts[0].escalate, true);
});
test('sweep: a hit on a joint-gv PR escalates even alone', () => {
  const hits = [{ prNumber: 51, readyAt: '2026-10-08T10:00:00Z', armedAt: '2026-10-08T10:00:05Z', actor: 'x' }];
  const labelsByPr = new Map([[51, ['joint-gv']]]);
  assert.equal(classifySweepHits(hits, labelsByPr)[0].escalate, true);
});
test('two hits on the SAME PR far apart do not count as a burst (burst needs 2+ DISTINCT PRs)', () => {
  const hits = [
    { prNumber: 9, readyAt: '2026-10-08T10:00:00Z', armedAt: '2026-10-08T10:00:05Z', actor: 'x' },
    { prNumber: 9, readyAt: '2026-10-08T10:01:00Z', armedAt: '2026-10-08T10:01:05Z', actor: 'x' },
  ];
  const verdicts = classifySweepHits(hits, new Map());
  assert.ok(verdicts.every((v) => !v.escalate));
});

test('constants are sane (Gate Co-Location)', () => {
  assert.ok(STUCK_RUN_MINUTES > 0);
  assert.ok(OWNER_SLA_HOURS < TL_SLA_HOURS);
  assert.ok(SWEEP_WINDOW_SECONDS > 0 && SWEEP_WINDOW_SECONDS < SWEEP_BURST_SECONDS);
  assert.deepEqual(REQUIRED_CONTEXTS, ['ci-gate', 'CodeQL', 'joint-gv-guard', 'consult-hold-guard']);
});
