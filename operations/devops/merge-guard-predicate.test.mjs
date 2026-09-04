// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Guard Testability (t/2971) for the pre-self-merge head-guard (t/3270). The predicate keys on a
// merge-time condition PR-CI cannot exercise, so both arms are proven here directly. Run:
//   node --test operations/devops/merge-guard-predicate.test.mjs
// This proves the SAME logic the type:block feedback rule inlines (INLINE_FOR_RULE in the module).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  mergeGuardVerdict,
  jointGvAutoMergeVerdict,
  isAutoMergeCommand,
  parsePrRef,
} from './merge-guard-predicate.mjs';

const MODULE = fileURLToPath(new URL('./merge-guard-predicate.mjs', import.meta.url));
// Invoke the module the SAME way the feedback rule does — proves runtime (CLI shim) == the tested
// function (test==runtime, TL GV t/3270#4). Returns the shim's stdout: 'fire' to block, '' to allow.
function runShim(command) {
  return execFileSync(process.execPath, [MODULE, command], { encoding: 'utf8' });
}

test('BLOCK arm: manual merge without --match-head-commit', () => {
  const v = mergeGuardVerdict('gh pr merge 1901 --squash');
  assert.equal(v.block, true);
  assert.equal(v.reason, 'missing-match-head-commit');
});

test('ALLOW arm: manual merge WITH --match-head-commit <SHA> (space form)', () => {
  const v = mergeGuardVerdict('gh pr merge 1901 --squash --match-head-commit 1578b0a0');
  assert.equal(v.block, false);
  assert.equal(v.reason, 'guarded');
});

test('ALLOW arm: --match-head-commit=<SHA> (equals form — must not false-block)', () => {
  // TL robustness condition: the = form is a correct merge; missing it would false-block.
  const v = mergeGuardVerdict('gh pr merge 1901 --squash --match-head-commit=1578b0a0');
  assert.equal(v.block, false);
  assert.equal(v.reason, 'guarded');
});

test('ALLOW arm: --auto is EXEMPT (TL ruling t/3270#2)', () => {
  const v = mergeGuardVerdict('gh pr merge 1901 --auto --squash');
  assert.equal(v.block, false);
  assert.equal(v.reason, 'auto-exempt');
});

test('NO-OP: a non-merge command is never blocked', () => {
  for (const c of ['gh pr view 1901 --json headRefOid', 'git status', 'gh pr checks 1901', 'ls -la']) {
    const v = mergeGuardVerdict(c);
    assert.equal(v.block, false, `should not fire on: ${c}`);
    assert.equal(v.reason, 'not-a-merge');
  }
});

test('robustness: gh.exe (win32 fleet) is matched', () => {
  assert.equal(mergeGuardVerdict('gh.exe pr merge 1901 --squash').block, true);
  assert.equal(mergeGuardVerdict('gh.exe pr merge 1901 --squash --match-head-commit=abc').block, false);
});

test('robustness: flag ordering — head flag before the PR number', () => {
  const v = mergeGuardVerdict('gh pr merge --match-head-commit abcdef0 --squash 1901');
  assert.equal(v.block, false);
});

test('robustness: --auto exempt regardless of flag order / trailing position', () => {
  assert.equal(mergeGuardVerdict('gh pr merge 1901 --squash --auto').block, false);
});

test('edge: a bare --match-head-commit with NO value does NOT count as guarded (still blocks)', () => {
  // A value-less flag would be a malformed merge; must not pass the guard.
  const v = mergeGuardVerdict('gh pr merge 1901 --squash --match-head-commit');
  assert.equal(v.block, true);
  assert.equal(v.reason, 'missing-match-head-commit');
});

test('edge: empty / undefined command is a no-op', () => {
  assert.equal(mergeGuardVerdict('').block, false);
  assert.equal(mergeGuardVerdict(undefined).block, false);
});

// --- CLI shim: prove the RUNTIME the feedback rule invokes (test==runtime, TL GV t/3270#4) ---

test('CLI shim: BLOCKs (emits "fire") on a manual merge missing the flag', () => {
  assert.equal(runShim('gh pr merge 1901 --squash'), 'fire');
});

test('CLI shim: ALLOWs (no output) on a guarded merge — both flag forms', () => {
  assert.equal(runShim('gh pr merge 1901 --squash --match-head-commit 1578b0a0'), '');
  assert.equal(runShim('gh pr merge 1901 --squash --match-head-commit=1578b0a0'), '');
});

test('CLI shim: ALLOWs --auto (exempt) and non-merge commands', () => {
  assert.equal(runShim('gh pr merge 1901 --auto'), '');
  assert.equal(runShim('gh pr view 1901 --json headRefOid'), '');
});

// ── t/3318: auto-merge-on-joint-GV guard (TL gate design t/3318#1) ──
// The pure predicate is the both-arms unit under test; the label lookup (fetch shim) is impure and
// proven by the real fire-drill (labeled test PR + --auto → blocks). Here we prove the 4-combo truth
// table + the command parsers, and the CLI --jointgv mode's gh-free early-exits.

test('jointGv BLOCK arm: --auto + joint-gv label → block', () => {
  const v = jointGvAutoMergeVerdict({ isAutoMerge: true, isJointGvLabeled: true });
  assert.equal(v.block, true);
  assert.equal(v.reason, 'auto-merge-on-joint-gv');
});

test('jointGv ALLOW arm: --auto + NOT labeled → allow (solo draft may auto-merge)', () => {
  const v = jointGvAutoMergeVerdict({ isAutoMerge: true, isJointGvLabeled: false });
  assert.equal(v.block, false);
  assert.equal(v.reason, 'auto-merge-unlabeled-ok');
});

test('jointGv ALLOW arm: manual (no --auto) + joint-gv label → allow (manual co-merge is the intent)', () => {
  const v = jointGvAutoMergeVerdict({ isAutoMerge: false, isJointGvLabeled: true });
  assert.equal(v.block, false);
  assert.equal(v.reason, 'not-auto-merge');
});

test('jointGv ALLOW arm: manual + not labeled → allow', () => {
  const v = jointGvAutoMergeVerdict({ isAutoMerge: false, isJointGvLabeled: false });
  assert.equal(v.block, false);
  assert.equal(v.reason, 'not-auto-merge');
});

test('isAutoMergeCommand: true only for a `gh pr merge` carrying --auto', () => {
  assert.equal(isAutoMergeCommand('gh pr merge 1947 --auto --squash'), true);
  assert.equal(isAutoMergeCommand('gh pr merge 1947 --squash --auto'), true);
  assert.equal(isAutoMergeCommand('gh.exe pr merge --auto'), true);
  assert.equal(isAutoMergeCommand('gh pr merge 1947 --squash'), false); // manual
  assert.equal(isAutoMergeCommand('gh pr view 1947 --json labels'), false); // not a merge
  assert.equal(isAutoMergeCommand('gh pr merge 1947 --squash --auto-delete'), false); // not the --auto flag
});

test('parsePrRef: numeric id, pull URL, else null (→ current branch)', () => {
  assert.equal(parsePrRef('gh pr merge 1947 --auto'), '1947');
  assert.equal(parsePrRef('gh pr merge https://github.com/jpsnover/ai-triad-research/pull/1947 --auto'),
    'https://github.com/jpsnover/ai-triad-research/pull/1947');
  assert.equal(parsePrRef('gh pr merge --auto --squash'), null); // no ref → gh uses current branch
  // a --match-head-commit value is never mistaken for the ref (leading-position only)
  assert.equal(parsePrRef('gh pr merge --match-head-commit deadbeef --squash 1947'), null);
});

// CLI --jointgv mode: the gh-free early-exits are deterministic (no PR lookup performed).
function runShimJointGv(command) {
  return execFileSync(process.execPath, [MODULE, '--jointgv', command], { encoding: 'utf8' });
}

test('CLI --jointgv: no gh call + no fire on a MANUAL merge (not --auto)', () => {
  assert.equal(runShimJointGv('gh pr merge 1947 --squash --match-head-commit abc'), '');
});

test('CLI --jointgv: no gh call + no fire on a non-merge command', () => {
  assert.equal(runShimJointGv('gh pr view 1947 --json labels'), '');
});
