// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2450 — Active drift guard for the fleet's shared `main` checkout, run as a
// `predev` hook before `npm run dev`. Prints a loud banner when the checkout is behind
// origin/main, has uncommitted tracked changes, or is on a detached / non-main HEAD —
// the conditions that let a 25-commit-stale tree serve "already-fixed" code and burn
// several verify cycles (e/86 / t/2449).
//
// Contract (TL-approved, e/86#4):
//   • WARN-ONLY: always exits 0; every git call is best-effort (failure → skip). Can
//     never block, fail, or meaningfully slow `npm run dev`.
//   • SILENT on a clean + current + freshly-fetched MAIN checkout (zero output) —
//     silence-on-clean is load-bearing: a banner that fires on a good tree trains
//     everyone to ignore it.
//   • MAIN-CHECKOUT ONLY: in a linked worktree a feature branch / dirty tree / being
//     behind are all normal, so the guard stays silent there (no false alarms).
//   • FAST by default: no network. Compares against the last-fetched origin/main ref and
//     surfaces fetch-age staleness so the behind-count isn't silently under-reported.
//     Opt into an accurate bounded fetch with CHECK_DRIFT_FETCH=1 (or `npm run dev:fresh`).

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');

const FETCH_STALE_HOURS = 6;

function git(args, timeout) {
  try {
    return execSync('git ' + args, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', timeout: timeout || 2000 }).trim();
  } catch {
    return null;
  }
}

/**
 * Pure decision from a git-state snapshot — no I/O, so every arm is deterministically
 * testable. Returns { kind: 'none' | 'alarm' | 'info', problems: string[], stale: bool }.
 */
function evaluate(state) {
  const { isWorkTree, isMainCheckout, behind, dirtyCount, branch, fetchAgeHours, fetchMode } = state;

  // Only the shared MAIN checkout is in scope; non-work-trees and linked worktrees are silent.
  if (!isWorkTree || !isMainCheckout) return { kind: 'none', problems: [], stale: false };

  const problems = [];
  if (behind > 0) problems.push(`${behind} commit(s) behind origin/main`);
  if (dirtyCount > 0) problems.push(`${dirtyCount} uncommitted tracked file(s)`);
  if (branch === null) problems.push('detached HEAD (not on a branch)');
  else if (branch !== 'main') problems.push(`on branch '${branch}', not 'main'`);

  const stale = !fetchMode && fetchAgeHours != null && fetchAgeHours > FETCH_STALE_HOURS;

  if (problems.length === 0 && !stale) return { kind: 'none', problems: [], stale: false };
  if (problems.length > 0) return { kind: 'alarm', problems, stale };
  return { kind: 'info', problems: [], stale: true };
}

function gatherState() {
  const isWorkTree = git('rev-parse --is-inside-work-tree') === 'true';
  if (!isWorkTree) return { isWorkTree: false };

  const fetchMode = process.env.CHECK_DRIFT_FETCH === '1' || process.argv.includes('--fetch');
  if (fetchMode) git('fetch --quiet origin main', 3000); // bounded, best-effort

  // Main checkout iff the git-dir and the common-dir coincide (they differ in a worktree).
  let isMainCheckout = true;
  const dirs = git('rev-parse --path-format=absolute --git-dir --git-common-dir');
  if (dirs) {
    const [gd, cd] = dirs.split('\n');
    isMainCheckout = !!gd && gd === cd;
  }

  const behindRaw = git('rev-list --count HEAD..origin/main');
  const behind = behindRaw && /^\d+$/.test(behindRaw) ? Number(behindRaw) : 0;

  const dirty = git('status --porcelain --untracked-files=no');
  const dirtyCount = dirty ? dirty.split('\n').filter(Boolean).length : 0;

  const branch = git('symbolic-ref --quiet --short HEAD'); // null when detached

  let fetchAgeHours = null;
  if (!fetchMode) {
    const p = git('rev-parse --git-path FETCH_HEAD');
    if (p) {
      try { fetchAgeHours = (Date.now() - fs.statSync(p).mtimeMs) / 3_600_000; } catch { /* no fetch yet */ }
    }
  }

  return { isWorkTree, isMainCheckout, behind, dirtyCount, branch, fetchAgeHours, fetchMode };
}

function ageStr(h) {
  if (h == null) return 'unknown';
  return h < 1 ? `${Math.round(h * 60)}m` : `${Math.round(h)}h`;
}

function report(result, fetchAgeHours) {
  const red = (s) => `\x1b[1;31m${s}\x1b[0m`;
  const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
  const dim = (s) => `\x1b[2m${s}\x1b[0m`;
  const out = (s) => process.stderr.write(s + '\n');

  if (result.kind === 'alarm') {
    out('');
    out(red('  ⚠  SHARED CHECKOUT DRIFT — you may be serving stale code'));
    for (const p of result.problems) out(yellow('     • ' + p));
    if (result.stale) out(dim(`     • origin data is ${ageStr(fetchAgeHours)} old — the behind-count may be under-reported`));
    out(dim('     Sync: git stash → git merge --ff-only origin/main   (see t/2450 / t/2449)'));
    out('');
  } else if (result.kind === 'info') {
    out('');
    out(dim(`  ℹ  origin/main last fetched ${ageStr(fetchAgeHours)} ago — run \`git fetch\` (or \`npm run dev:fresh\`) to confirm you're current.`));
    out('');
  }
  // kind === 'none' → zero output (load-bearing silence).
}

function main() {
  const state = gatherState();
  const result = evaluate(state);
  report(result, state.fetchAgeHours);
}

// Never let the guard break dev.
if (require.main === module) {
  try { main(); } catch { /* warn-only */ }
  process.exit(0);
}

module.exports = { evaluate, FETCH_STALE_HOURS };
