// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Both-arms proof for the t/3699 feedback-rule drift detector. Run:
//   node --test operations/devops/worker/feedback-rule-drift-predicate.test.mjs
// This proves the SAME logic the CLI shim runs (test == runtime, t/3270#4 discipline).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  diffFeedbackRules,
  listOnDiskRuleNames,
  buildDriftCheckSinkRecord,
} from './feedback-rule-drift-predicate.mjs';

test('BLOCK-equivalent arm: an on-disk name absent from loaded is flagged as discarded', () => {
  const v = diffFeedbackRules(
    ['worktree-path-guard', 'claim-before-work', 'auto-merge-jointgv-guard'],
    ['claim-before-work'],
  );
  assert.deepEqual(v.discarded.sort(), ['auto-merge-jointgv-guard', 'worktree-path-guard']);
});

test('ALLOW-equivalent arm: every on-disk name is loaded → empty/clean', () => {
  const v = diffFeedbackRules(['claim-before-work', 'doc-metadata'], ['claim-before-work', 'doc-metadata', 'extra-loaded-only']);
  assert.deepEqual(v.discarded, []);
});

test('edge: no on-disk names → nothing to diff, clean', () => {
  assert.deepEqual(diffFeedbackRules([], ['claim-before-work']).discarded, []);
});

test('edge: no loaded names at all → everything on disk is discarded', () => {
  assert.deepEqual(diffFeedbackRules(['a', 'b'], []).discarded, ['a', 'b']);
});

test('edge: non-array inputs default to empty, never throw', () => {
  assert.deepEqual(diffFeedbackRules(undefined, undefined).discarded, []);
  assert.deepEqual(diffFeedbackRules(null, null).discarded, []);
});

// ── listOnDiskRuleNames: reads real .yaml basenames from a temp dir ──

test('listOnDiskRuleNames: returns sorted .yaml basenames, ignores non-yaml files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't3699-'));
  const rulesDir = path.join(dir, '.orca', 'feedback-rules');
  fs.mkdirSync(rulesDir, { recursive: true });
  fs.writeFileSync(path.join(rulesDir, 'zeta.yaml'), 'name: zeta');
  fs.writeFileSync(path.join(rulesDir, 'alpha.yaml'), 'name: alpha');
  fs.writeFileSync(path.join(rulesDir, 'README.md'), '# not a rule');
  assert.deepEqual(listOnDiskRuleNames(dir), ['alpha', 'zeta']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('listOnDiskRuleNames: missing directory returns [] (never throws)', () => {
  assert.deepEqual(listOnDiskRuleNames(path.join(os.tmpdir(), 'nope-t3699-does-not-exist')), []);
});

// ── LIVE fixture: proves the detector currently reproduces the known-dead set (t/3699 AC-2) ──
// Snapshot taken 2026-09-28 via `list_feedback_rules` against this repo's on-disk
// `.orca/feedback-rules/*.yaml`. security-secrets-block is EXCLUDED here — it was already
// re-registered/fixed by t/3698 v3 and is confirmed present in the live loaded set.

test('LIVE fixture: reproduces the t/3698 known-dead set (worktree-path-guard, auto-merge-jointgv-guard, pre-self-merge-verify)', () => {
  const onDiskSnapshot = [
    'worktree-path-guard',
    'auto-merge-jointgv-guard',
    'pre-self-merge-verify',
    'security-secrets-block',
    'claim-before-work',
    'doc-metadata',
  ];
  const loadedSnapshot = ['security-secrets-block', 'claim-before-work', 'doc-metadata'];
  const v = diffFeedbackRules(onDiskSnapshot, loadedSnapshot);
  assert.deepEqual(
    v.discarded.sort(),
    ['auto-merge-jointgv-guard', 'pre-self-merge-verify', 'worktree-path-guard'],
  );
});

// ── buildDriftCheckSinkRecord: durable execution-record shape (t/2070 telemetry-sink principle) ──

test('sink record: clean run → discarded empty, counts recorded', () => {
  const r = buildDriftCheckSinkRecord({ nowIso: '2026-09-28T00:00:00.000Z', onDiskCount: 30, loadedCount: 30, discarded: [] });
  assert.equal(r.check, 'feedback-rule-drift');
  assert.equal(r.onDiskCount, 30);
  assert.equal(r.loadedCount, 30);
  assert.deepEqual(r.discarded, []);
});

test('sink record: dirty run → discarded names carried through; empty args never throw', () => {
  const r = buildDriftCheckSinkRecord({ nowIso: 'x', onDiskCount: 32, loadedCount: 29, discarded: ['a', 'b'] });
  assert.deepEqual(r.discarded, ['a', 'b']);
  const empty = buildDriftCheckSinkRecord();
  assert.equal(empty.check, 'feedback-rule-drift');
  assert.deepEqual(empty.discarded, []);
  assert.equal(empty.onDiskCount, null);
});

// --- CLI shim: prove the RUNTIME the scheduled harness invokes (test==runtime) ---

const MODULE = fileURLToPath(new URL('./feedback-rule-drift-predicate.mjs', import.meta.url));

test('CLI shim: clean run (all on-disk names loaded) → exit 0, no stdout', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't3699-cli-'));
  fs.mkdirSync(path.join(dir, '.orca', 'feedback-rules'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.orca', 'feedback-rules', 'claim-before-work.yaml'), 'name: claim-before-work');
  const out = execFileSync(process.execPath, [MODULE, JSON.stringify(['claim-before-work']), dir], { encoding: 'utf8' });
  assert.equal(out, '');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI shim: dirty run (an on-disk name is not loaded) → exit 1, prints the discarded name', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't3699-cli-'));
  fs.mkdirSync(path.join(dir, '.orca', 'feedback-rules'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.orca', 'feedback-rules', 'worktree-path-guard.yaml'), 'name: worktree-path-guard');
  let threw = false;
  let stdout = '';
  try {
    execFileSync(process.execPath, [MODULE, JSON.stringify([]), dir], { encoding: 'utf8' });
  } catch (e) {
    threw = true;
    stdout = e.stdout;
    assert.equal(e.status, 1);
  }
  assert.equal(threw, true);
  assert.equal(stdout, 'worktree-path-guard\n');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI shim: always appends a durable telemetry record, clean or dirty (t/2070 — provably runs)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't3699-cli-'));
  fs.mkdirSync(path.join(dir, '.orca', 'feedback-rules'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.orca', 'feedback-rules', 'claim-before-work.yaml'), 'name: claim-before-work');
  execFileSync(process.execPath, [MODULE, JSON.stringify(['claim-before-work']), dir], { encoding: 'utf8' });
  const telemetryFile = fileURLToPath(new URL('./.gate-telemetry/feedback-rule-drift.jsonl', import.meta.url));
  assert.equal(fs.existsSync(telemetryFile), true);
  const lines = fs.readFileSync(telemetryFile, 'utf8').trim().split('\n');
  const last = JSON.parse(lines[lines.length - 1]);
  assert.equal(last.check, 'feedback-rule-drift');
  fs.rmSync(dir, { recursive: true, force: true });
});
