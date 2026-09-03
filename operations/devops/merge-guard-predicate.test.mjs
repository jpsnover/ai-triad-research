// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Guard Testability (t/2971) for the pre-self-merge head-guard (t/3270). The predicate keys on a
// merge-time condition PR-CI cannot exercise, so both arms are proven here directly. Run:
//   node --test operations/devops/merge-guard-predicate.test.mjs
// This proves the SAME logic the type:block feedback rule inlines (INLINE_FOR_RULE in the module).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeGuardVerdict } from './merge-guard-predicate.mjs';

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
