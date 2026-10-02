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
 * testable. Returns { kind: 'none' | 'alarm' | 'info', problems: string[], stale: bool,
 * diverged: bool }.
 */
function evaluate(state) {
  const { isWorkTree, isMainCheckout, ahead, behind, dirtyCount, branch, fetchAgeHours, fetchMode } = state;

  // Only the shared MAIN checkout is in scope; non-work-trees and linked worktrees are silent.
  if (!isWorkTree || !isMainCheckout) return { kind: 'none', problems: [], stale: false, diverged: false };

  const problems = [];
  // t/3841: ahead-and-behind means `merge --ff-only` is impossible by definition. Surfacing it
  // only inline on the existing behind-triggered alarm — a purely-ahead tree (committed, not yet
  // pushed) is normal in `direct` mode and must not become a new standalone alarm trigger.
  const diverged = behind > 0 && ahead > 0;
  if (behind > 0) {
    problems.push(diverged
      ? `${behind} commit(s) behind origin/main (and ${ahead} ahead — diverged)`
      : `${behind} commit(s) behind origin/main`);
  }
  if (dirtyCount > 0) problems.push(`${dirtyCount} uncommitted tracked file(s)`);
  if (branch === null) problems.push('detached HEAD (not on a branch)');
  else if (branch !== 'main') problems.push(`on branch '${branch}', not 'main'`);

  const stale = !fetchMode && fetchAgeHours != null && fetchAgeHours > FETCH_STALE_HOURS;

  if (problems.length === 0 && !stale) return { kind: 'none', problems: [], stale: false, diverged: false };
  if (problems.length > 0) return { kind: 'alarm', problems, stale, diverged };
  return { kind: 'info', problems: [], stale: true, diverged: false };
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

  // t/3841: left-right gives ahead AND behind in one call — the prior behind-only count let
  // the advice assume a pure fast-forward was always possible, which fails whenever the tree
  // is also ahead (diverged).
  let ahead = 0, behind = 0;
  const leftRight = git('rev-list --left-right --count HEAD...origin/main');
  if (leftRight) {
    const m = /^(\d+)\s+(\d+)$/.exec(leftRight);
    if (m) { ahead = Number(m[1]); behind = Number(m[2]); }
  }

  const dirty = git('status --porcelain --untracked-files=no');
  const dirtyLines = dirty ? dirty.split('\n').filter(Boolean) : [];
  const dirtyCount = dirtyLines.length;
  // t/3841: classify dirty tracked files against origin/main (not HEAD) before advising —
  // a line-ending/whitespace-only diff is a phantom safe to restore; anything else is real
  // work that must be committed (or moved to a worktree), never stashed on the shared tree.
  // Only runs when there's something dirty, so the common clean-tree path stays zero-cost.
  const dirtyPhantom = [];
  const dirtyReal = [];
  if (dirtyCount > 0) {
    for (const line of dirtyLines) {
      const path = parsePorcelainPath(line);
      if (!path) continue;
      const fileDiff = git(`diff --ignore-cr-at-eol --ignore-all-space origin/main -- "${path}"`);
      // null (git call failed) is a safe default toward "real" — never silently wave through
      // something we couldn't actually verify as a phantom.
      if (fileDiff === '') dirtyPhantom.push(path);
      else dirtyReal.push(path);
    }
  }

  const branch = git('symbolic-ref --quiet --short HEAD'); // null when detached

  let fetchAgeHours = null;
  if (!fetchMode) {
    const p = git('rev-parse --git-path FETCH_HEAD');
    if (p) {
      try { fetchAgeHours = (Date.now() - fs.statSync(p).mtimeMs) / 3_600_000; } catch { /* no fetch yet */ }
    }
  }

  return { isWorkTree, isMainCheckout, ahead, behind, dirtyCount, dirtyPhantom, dirtyReal, branch, fetchAgeHours, fetchMode };
}

/** Porcelain v1 status line → the file path, taking the destination side of a rename. */
function parsePorcelainPath(line) {
  const rest = line.slice(3);
  const arrow = rest.indexOf(' -> ');
  return (arrow === -1 ? rest : rest.slice(arrow + 4)).trim();
}

function ageStr(h) {
  if (h == null) return 'unknown';
  return h < 1 ? `${Math.round(h * 60)}m` : `${Math.round(h)}h`;
}

// t/3841: takes the full state (not just fetchAgeHours) so the divergence/classification
// advice below can read it directly — report() stays the only impure consumer of these
// fields; evaluate() remains pure and only decides kind/problems/stale/diverged.
function report(result, state) {
  const red = (s) => `\x1b[1;31m${s}\x1b[0m`;
  const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
  const dim = (s) => `\x1b[2m${s}\x1b[0m`;
  const out = (s) => process.stderr.write(s + '\n');

  if (result.kind === 'alarm') {
    out('');
    out(red('  ⚠  SHARED CHECKOUT DRIFT — you may be serving stale code'));
    for (const p of result.problems) out(yellow('     • ' + p));
    if (result.stale) out(dim(`     • origin data is ${ageStr(state.fetchAgeHours)} old — the behind-count may be under-reported`));

    // t/3841: `merge --ff-only` only works when the tree is purely behind. When it's also
    // ahead, ff-only is refused by definition — point at the owned escalation path instead
    // of printing a command the user cannot run.
    if (result.diverged) {
      out(dim('     Diverged from origin/main (ahead AND behind) — `merge --ff-only` cannot work.'));
      out(dim('     See docs/shared-tree-divergence.md — DevOps-owned; do not improvise a resolution.'));
    } else if (state.behind > 0) {
      out(dim('     Sync: git merge --ff-only origin/main   (see t/2450 / t/2449)'));
    }

    // t/3841: stash is a prohibited worktree-only verb on the shared checkout (root
    // AGENTS.md), and it buries real work in a stash the next drift check can't see.
    // Classified dirty files get the right verb for what they actually are.
    if (state.dirtyReal && state.dirtyReal.length > 0) {
      out(dim(`     Real uncommitted work — commit it, or move it to a worktree. NEVER stash on the shared checkout: ${state.dirtyReal.join(', ')}`));
    }
    if (state.dirtyPhantom && state.dirtyPhantom.length > 0) {
      out(dim(`     Line-ending/whitespace-only noise, safe to discard: git restore -- ${state.dirtyPhantom.join(' ')}`));
    }
    out('');
  } else if (result.kind === 'info') {
    out('');
    out(dim(`  ℹ  origin/main last fetched ${ageStr(state.fetchAgeHours)} ago — run \`git fetch\` (or \`npm run dev:fresh\`) to confirm you're current.`));
    out('');
  }
  // kind === 'none' → zero output (load-bearing silence).
}

function main() {
  const state = gatherState();
  const result = evaluate(state);
  report(result, state);
}

// Never let the guard break dev.
if (require.main === module) {
  try { main(); } catch { /* warn-only */ }
  process.exit(0);
}

module.exports = { evaluate, report, FETCH_STALE_HOURS };
