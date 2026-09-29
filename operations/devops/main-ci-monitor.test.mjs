// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// All-arms proof for the main-CI monitor verdict (t/3737), observe-what-ran model (TL p/331#1626/
// #1629). The shim keys on live gh state it can't exercise in unit tests, so the pure classifier is
// proven here directly. Run:  node --test operations/devops/main-ci-monitor.test.mjs
// Proves the SAME logic the workflow acts on (test == runtime).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyMainCI, runState, dedupeLatestByWorkflow, DEADLINE_MS, HEALTH_WORKFLOW } from './main-ci-monitor.mjs';

// A push-event run: {name, status, conclusion}. Helpers for the common shapes.
const passed = (name) => ({ name, status: 'completed', conclusion: 'success' });
const failed = (name, c = 'failure') => ({ name, status: 'completed', conclusion: c });
const running = (name) => ({ name, status: 'in_progress', conclusion: null });
const CI = HEALTH_WORKFLOW; // 'CI'
const FRESH = 60 * 1000;
const OLD = DEADLINE_MS + 60 * 1000;

// ── runState ──
test('runState: completed+success → passed; skipped/neutral also non-failing', () => {
  assert.equal(runState(passed(CI)), 'passed');
  assert.equal(runState({ name: CI, status: 'completed', conclusion: 'skipped' }), 'passed');
  assert.equal(runState({ name: CI, status: 'completed', conclusion: 'neutral' }), 'passed');
});
test('runState: completed+failure/cancelled/timed_out → failed', () => {
  for (const c of ['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure']) {
    assert.equal(runState(failed(CI, c)), 'failed', c);
  }
});
test('runState: queued / in_progress → pending', () => {
  assert.equal(runState({ name: CI, status: 'queued', conclusion: null }), 'pending');
  assert.equal(runState(running(CI)), 'pending');
});

// ── dedupeLatestByWorkflow (re-runs) ──
test('dedupeLatestByWorkflow: keeps the latest run per workflow name by createdAt', () => {
  const runs = [
    { name: CI, status: 'completed', conclusion: 'failure', createdAt: '2026-09-29T10:00:00Z' },
    { name: CI, status: 'completed', conclusion: 'success', createdAt: '2026-09-29T11:00:00Z' }, // a re-run that fixed it
    { name: 'Other', status: 'completed', conclusion: 'success', createdAt: '2026-09-29T10:30:00Z' },
  ];
  const d = dedupeLatestByWorkflow(runs);
  assert.equal(d.length, 2);
  assert.equal(runState(d.find((r) => r.name === CI)), 'passed', 'latest CI re-run (success) wins over the earlier failure');
});

// ── classifyMainCI — the observe-what-ran states ──
test('RED — CI concluded failure → FULL alert, regardless of head age', () => {
  const v = classifyMainCI({ runs: [failed(CI), passed('Other')], headAgeMs: FRESH });
  assert.equal(v.severity, 'red');
  assert.equal(v.alert, true);
  assert.deepEqual(v.failedHealth, [CI]);
});
test('RED — CI failure also reports co-failing non-CI workflows', () => {
  const v = classifyMainCI({ runs: [failed(CI), failed('Debate-Tested Sweep')], headAgeMs: FRESH });
  assert.equal(v.severity, 'red');
  assert.deepEqual(v.failedOther, ['Debate-Tested Sweep']);
});
test('LOW NOTICE — a non-CI push workflow failed while CI passed → notice, not green, not full', () => {
  const v = classifyMainCI({ runs: [passed(CI), failed('Debate-Tested Sweep')], headAgeMs: FRESH });
  assert.equal(v.severity, 'notice');
  assert.equal(v.state, 'other-red');
  assert.equal(v.alert, true);
  assert.deepEqual(v.failedOther, ['Debate-Tested Sweep']);
});
test('LOW NOTICE — non-CI failure surfaces even when CI is absent (never silently dropped)', () => {
  const v = classifyMainCI({ runs: [failed('Debate-Tested Sweep')], headAgeMs: FRESH });
  assert.equal(v.severity, 'notice');
  assert.match(v.reason, /absent/);
});
test('GREEN — CI passed, nothing failed → no alert', () => {
  const v = classifyMainCI({ runs: [passed(CI), passed('Other')], headAgeMs: OLD });
  assert.equal(v.severity, 'none');
  assert.equal(v.state, 'green');
  assert.equal(v.alert, false);
});
test('UNRESOLVED within deadline — CI in flight does NOT alert', () => {
  const v = classifyMainCI({ runs: [running(CI)], headAgeMs: FRESH });
  assert.equal(v.state, 'unresolved');
  assert.equal(v.alert, false);
});
test('STUCK — CI created but unconcluded past deadline → alert (hung run)', () => {
  const v = classifyMainCI({ runs: [running(CI)], headAgeMs: OLD });
  assert.equal(v.state, 'stuck');
  assert.equal(v.severity, 'red');
  assert.equal(v.alert, true);
  assert.match(v.reason, /CREATED but has not concluded|hung|stuck/);
});

// ── the load-bearing TL ruling (p/331#1629): ABSENT → UNKNOWN, NO alert, EVEN past deadline ──
test('UNKNOWN — CI absent entirely does NOT alert even past deadline (docs-only merge: push-runs=0)', () => {
  const v = classifyMainCI({ runs: [], headAgeMs: OLD });
  assert.equal(v.state, 'unknown');
  assert.equal(v.alert, false, 'the every-docs-merge false-fire this whole model exists to prevent');
  assert.equal(v.severity, 'none');
});
test('UNKNOWN — CI absent with only a passing non-CI run past deadline still does NOT alert', () => {
  const v = classifyMainCI({ runs: [passed('Some-Other-Push-Workflow')], headAgeMs: OLD });
  assert.equal(v.state, 'unknown');
  assert.equal(v.alert, false);
});
