// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Both-arms proof (t/3254, TL GV cond. 1) for the worktree-path-guard harden. The abs-correct→PASSES
// arm is LOAD-BEARING (it's the false-fire this ticket removes). Also covers TL cond. 3: normalize
// (Win `\`↔`/`, drive-case) + a `..`-escapes-root case. Run:
//   node --test operations/devops/worktree-target-guard.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { worktreeTargetVerdict, canonAbs, extractWorktreeAddTarget } from './worktree-target-guard.mjs';

const ROOT = 'C:/repo'; // deterministic test root (real root is inferred from the module in prod)
const v = (cmd) => worktreeTargetVerdict(cmd, ROOT);

test('LOAD-BEARING: absolute-correct target UNDER root .worktrees PASSES', () => {
  const r = v('git worktree add -b feat C:/repo/.worktrees/foo');
  assert.equal(r.fire, false);
  assert.equal(r.reason, 'abs-under-root');
});

test('absolute target OUTSIDE root .worktrees FIRES', () => {
  assert.equal(v('git worktree add -b feat C:/somewhere-else/.worktrees/foo').fire, true);
  assert.equal(v('git worktree add C:/repo/notworktrees/foo').fire, true);
});

test('absolute `..`-escape out of root .worktrees FIRES (collapsed, TL cond. 3)', () => {
  const r = v('git worktree add C:/repo/.worktrees/../../evil');
  assert.equal(r.fire, true);
  assert.equal(r.reason, 'abs-outside-root');
});

test('absolute `..`-that-stays-under root PASSES', () => {
  assert.equal(v('git worktree add C:/repo/.worktrees/foo/../bar').fire, false);
});

test('normalize: Windows backslash absolute PASSES', () => {
  assert.equal(v('git worktree add C:\\repo\\.worktrees\\foo').fire, false);
});

test('normalize: drive-case difference PASSES (case-insensitive compare)', () => {
  assert.equal(v('git worktree add c:/REPO/.worktrees/Foo').fire, false);
});

test('relative arm UNCHANGED: `.worktrees/…` still PASSES', () => {
  assert.equal(v('git worktree add -b feat .worktrees/foo').reason, 'rel-worktrees');
  assert.equal(v('git worktree add -b feat .worktrees/foo').fire, false);
});

test('relative arm UNCHANGED: bare name / `../` / sibling still FIRE', () => {
  assert.equal(v('git worktree add foo').fire, true);
  assert.equal(v('git worktree add ../foo').fire, true);
  assert.equal(v('git worktree add worktrees/foo').fire, true);
});

test('honors `--` separator and single-arg opts when extracting target', () => {
  assert.equal(extractWorktreeAddTarget('git worktree add -b br --reason x -- C:/repo/.worktrees/z'), 'C:/repo/.worktrees/z');
  assert.equal(v('git worktree add -b br --reason x -- C:/repo/.worktrees/z').fire, false);
});

test('non-worktree-add command is never fired', () => {
  for (const c of ['git status', 'git commit -m x', 'gh pr merge 1 --squash', 'ls .worktrees']) {
    assert.equal(v(c).fire, false, `should not fire: ${c}`);
    assert.equal(v(c).reason, 'not-a-worktree-add');
  }
});

test('canonAbs collapses . and .. and lowercases; returns null for relative', () => {
  assert.equal(canonAbs('C:/a/b/../c/./d'), 'c:/a/c/d');
  assert.equal(canonAbs('/x/y/../z'), '/x/z');
  assert.equal(canonAbs('rel/path'), null);
});

// --- CLI shim: prove the RUNTIME the rule invokes (test==runtime, t/3270) ---
const MODULE = fileURLToPath(new URL('./worktree-target-guard.mjs', import.meta.url));
const shim = (cmd) => execFileSync(process.execPath, [MODULE, cmd], { encoding: 'utf8' });

test('CLI shim: bare relative name FIRES (emits "fire")', () => {
  assert.equal(shim('git worktree add foo'), 'fire');
});

test('CLI shim: correct root-relative `.worktrees/…` is SILENT', () => {
  assert.equal(shim('git worktree add -b feat .worktrees/foo'), '');
});

test('CLI shim: non-worktree-add is SILENT', () => {
  assert.equal(shim('git status'), '');
});
