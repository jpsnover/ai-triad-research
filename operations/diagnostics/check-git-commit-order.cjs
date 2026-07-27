#!/usr/bin/env node
/**
 * PreToolUse hook script for git-commit-pathspec-flag-order.
 *
 * Checks if a git commit command has `--` (pathspec separator) before
 * `-m` or `-F` flags, which turns the flags into pathspecs.
 *
 * Exit 0 + stdout message = fire the hook (show guidance).
 * Exit 1 = suppress (command is fine or not a git commit).
 */

const command = process.argv[2] || '';

// Match both `git commit …` and `git --git-dir=… --work-tree=… commit …` (overlay form)
if (!/\bgit\b.*\bcommit\b/.test(command) || !command.includes(' -- ')) {
  process.exit(1);
}

const dashDashIdx = command.indexOf(' -- ');
const afterDashDash = command.slice(dashDashIdx);

if (afterDashDash.includes(' -m ') || afterDashDash.includes(' -F ')) {
  console.log('MATCH: -- appears before -m/-F flag');
  process.exit(0);
}

process.exit(1);
