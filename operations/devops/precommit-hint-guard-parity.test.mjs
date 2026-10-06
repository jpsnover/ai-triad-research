// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Parity: every `git worktree add` command that .githooks/pre-commit TELLS a refused agent to run
// must PASS the worktree-path-guard (operations/devops/worktree-target-guard.mjs). The hook's help
// text is the line every blocked agent copy-pastes; it said `../wt-<ticket>`, which the guard
// blocks — so following the hook's own advice got the agent blocked again (TL p/331#1877).
// This reads the real hook file and runs the real guard predicate (test == runtime), so the two
// cannot drift apart silently. Run:  node --test operations/devops/precommit-hint-guard-parity.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { worktreeTargetVerdict } from './worktree-target-guard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOOK = path.join(ROOT, '.githooks', 'pre-commit');

/** The hook's suggested commands, with placeholders filled the way an agent would fill them. */
function suggestedCommands() {
  return readFileSync(HOOK, 'utf8')
    .split(/\r?\n/)
    .filter((l) => /git\s+worktree\s+add\s/.test(l) && !/^\s*#/.test(l))
    .map((l) => l.trim()
      .replace('<type>/<slug>-t<ticket>', 'fix/example-t1234')
      .replace('<name>', 'example')
      .replace(/<ticket>/g, '1234'));
}

test('the hook still suggests a worktree-add command (floor: both BLOCKED messages)', () => {
  // A floor, so deleting the suggestions (or renaming the command) can't make this suite vacuous.
  assert.ok(suggestedCommands().length >= 2, `found ${suggestedCommands().length} suggestion(s)`);
});

test('every worktree-add the hook suggests PASSES the worktree path guard', () => {
  for (const cmd of suggestedCommands()) {
    const v = worktreeTargetVerdict(cmd, ROOT);
    assert.equal(v.fire, false, `pre-commit suggests a command the guard blocks: ${cmd} (${v.reason})`);
  }
});

test('red arm: the old `../wt-<ticket>` suggestion is one the guard blocks', () => {
  // Proves this suite can fail: had the hook kept the old text, the test above would have fired.
  const old = 'git worktree add -b fix/example-t1234 ../wt-1234 origin/main';
  assert.equal(worktreeTargetVerdict(old, ROOT).fire, true);
});
