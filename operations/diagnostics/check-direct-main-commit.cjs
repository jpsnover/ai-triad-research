'use strict';
// PreToolUse hook: warn when an agent commits directly to `main` in the shared
// working tree.  Direct shared-tree-main commits strand the work: the commit
// never reaches origin, diverges local main, and gets swept into the next
// agent's commit.  Land via /land-from-worktree instead.
//
// Invoked as: node -e INLINE_SCRIPT {command}  →  process.argv[1] = command
//
// Exit 0 + stdout  = fire warning (show guidance)
// Exit 1           = suppress (not a relevant commit)
//
// Detection (5-step, short-circuits early):
//   1. command matches /\bgit\b.*\bcommit\b/      → else suppress
//   2. command has --git-dir=                      → suppress (overlay / ogit)
//   3. command has `cd ` or `git -C `             → suppress (directory-change = likely worktree land)
//   4. git-dir == git-common-dir                  → else suppress (linked worktree)
//   5. current branch == main                     → else suppress (feature branch)
//   → all pass → WARN

const { execSync } = require('child_process');
const path = require('path');

// argv[1] = command when called as `node -e INLINE_SCRIPT {command}` (hook form)
// argv[1] = script path, argv[2] = command when called as `node script.cjs {command}` (test form)
const cmd = process.argv.slice(1).find(a => !a.endsWith('.cjs') && a.length > 0) || '';

// Step 1: must be a git commit
if (!/\bgit\b.*\bcommit\b/.test(cmd)) process.exit(1);

// Step 2: overlay / ogit commits use --git-dir= explicitly
if (/--git-dir=/.test(cmd)) process.exit(1);

// Step 3: directory-changing commands (cd / git -C) target a different cwd —
// almost always a worktree land; runner cwd won't reflect the target dir, so
// we can't probe git state reliably.  Suppress to avoid false-reds.
if (/\bcd\s/.test(cmd) || /git\s+-C\s/.test(cmd)) process.exit(1);

// Steps 4-5: probe git state from runner cwd
try {
  const o = { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] };

  // Step 4: in a linked worktree, --git-dir differs from --git-common-dir.
  // path.resolve() normalizes both — git-dir returns absolute, git-common-dir
  // may return relative (repo-root-relative), so string compare fails without it.
  const gitDir    = path.resolve(execSync('git rev-parse --git-dir',        o).trim());
  const commonDir = path.resolve(execSync('git rev-parse --git-common-dir', o).trim());
  if (gitDir !== commonDir) process.exit(1);

  // Step 5: only warn on main
  const branch = execSync('git rev-parse --abbrev-ref HEAD', o).trim();
  if (branch !== 'main') process.exit(1);

  console.log(
    'Direct commit to shared-tree `main` — work will be stranded.\n' +
    'This commit stays local-only, diverges `main`, and gets swept into the next agent\'s commit.\n' +
    'Land via /land-from-worktree instead: commit in a worktree off origin/main, push HEAD:main.'
  );
} catch {
  // Not in a git repo, detached HEAD, or git unavailable — suppress silently
  process.exit(1);
}

process.exit(0);
