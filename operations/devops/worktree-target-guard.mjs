// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Pure predicate for worktree-path-guard (t/3254, harden of t/3154; TL GV Option A t/3254#2).
 *
 * The guard blocks `git worktree add` whose target isn't under the repo-root `.worktrees/` — the
 * cwd-reset nested-worktree pollution class (t/2222). The ORIGINAL guard was a raw string-prefix
 * check `^\.worktrees[\/\\]`, which FALSE-FIRES on a correct ABSOLUTE target (`<root>/.worktrees/x`)
 * — blocking a legitimate add. Option A fixes exactly that: an absolute target is judged by whether
 * it resolves UNDER `<repo-root>/.worktrees/`, not by the prefix.
 *
 * SCOPE (TL ruling t/3254#1/#2): absolute-path correctness only. The relative-target arm is
 * UNCHANGED (a bare relative `.worktrees/x` still passes) — its true correctness depends on the
 * invocation cwd, which the feedback-rule run-gate cannot see; that residual is owned by the t/3145
 * DETECTIVE drift guard (lists + auto-cleans nested `.worktrees/` hourly), not this add-time gate.
 *
 * FAIL-OPEN (TL cond. 2, deliberately OPPOSITE the t/3270 merge-guard's fail-closed): the RULE's
 * run-gate wraps this in try/catch and does NOT fire on error. Risk-matched — `git worktree add` is
 * common + low-danger + t/3145-backstopped, so a broken guard must never block all worktree adds.
 *
 * Normalization (TL cond. 3): OS-independent — slash-fold, lowercase (Win case-insensitive), and a
 * pure `.`/`..` segment collapse (NOT path.resolve, which treats `C:/` as relative on Linux CI). A
 * `..` that escapes `<root>/.worktrees/` therefore fires.
 *
 * Returns { fire:boolean, reason:string }. The rule invokes this module (test==runtime, the t/3270
 * lesson) and emits 'fire' to stdout iff fire (the worktree-path-guard blocking convention).
 */
import { fileURLToPath } from 'node:url';

const SINGLE_ARG_OPTS = new Set(['-b', '-B', '--branch', '--force-branch', '--reason']);

/** Extract the `<target>` from a `git worktree add [opts] <target>` command (mirrors the original
 *  guard's parse: skip single-arg opts + flags, honor `--`). Returns '' if none / not a worktree-add. */
export function extractWorktreeAddTarget(command) {
  const cmd = String(command || '');
  if (!/git\s+worktree\s+add/.test(cmd)) return '';
  const parts = cmd.trim().split(/\s+/);
  const wtIdx = parts.findIndex((p) => p === 'worktree');
  const addIdx = wtIdx >= 0 ? parts.indexOf('add', wtIdx) : -1;
  if (addIdx < 0) return '';
  const rest = parts.slice(addIdx + 1);
  let i = 0;
  while (i < rest.length) {
    if (rest[i] === '--') { i++; break; }
    if (SINGLE_ARG_OPTS.has(rest[i])) { i += 2; continue; }
    if (rest[i] && rest[i].startsWith('-')) { i++; continue; }
    return rest[i];
  }
  return i < rest.length ? rest[i] : '';
}

/** OS-independent canonical form: forward slashes, lowercase, `.`/`..` collapsed, no trailing slash.
 *  Preserves a leading drive (`c:`) or unix root. Used to compare an absolute target to the wt-root. */
export function canonAbs(p) {
  const s = String(p).replace(/\\/g, '/').toLowerCase();
  const driveM = s.match(/^([a-z]:)\//);
  const prefix = driveM ? driveM[1] : (s.startsWith('/') ? '' : null);
  if (prefix === null) return null; // not absolute
  const body = driveM ? s.slice(driveM[0].length) : s.slice(1);
  const out = [];
  for (const seg of body.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { out.pop(); continue; }
    out.push(seg);
  }
  return prefix + '/' + out.join('/');
}

function isAbsolute(target) {
  const s = target.replace(/\\/g, '/');
  return /^[a-zA-Z]:\//.test(s) || s.startsWith('/');
}

/** Repo root inferred from this module's install location (<root>/operations/devops/…) — repo-root-
 *  anchored, so it's correct wherever the module is invoked from. Overridable for tests. */
export function repoRootFromHere(metaUrl) {
  const here = fileURLToPath(metaUrl).replace(/\\/g, '/');
  // <root>/operations/devops/worktree-target-guard.mjs → drop 3 trailing segments
  return here.split('/').slice(0, -3).join('/');
}

/**
 * @param {string} command  the git command string
 * @param {string} [repoRoot]  absolute repo root (defaults to this module's inferred root)
 */
export function worktreeTargetVerdict(command, repoRoot) {
  const target = extractWorktreeAddTarget(command);
  if (!target) return { fire: false, reason: 'not-a-worktree-add' };

  const root = canonAbs(repoRoot ?? repoRootFromHere(import.meta.url));
  const wtRoot = `${root}/.worktrees`;

  if (isAbsolute(target)) {
    const resolved = canonAbs(target);
    if (resolved === wtRoot || resolved.startsWith(`${wtRoot}/`)) {
      return { fire: false, reason: 'abs-under-root' }; // Option A: correct absolute target PASSES
    }
    return { fire: true, reason: 'abs-outside-root' }; // incl. `..`-escapes (collapsed above)
  }

  // Relative arm UNCHANGED from the original guard (residual owned by t/3145): pass iff `.worktrees/`.
  const rel = target.replace(/\\/g, '/');
  if (/^\.worktrees\//.test(rel)) return { fire: false, reason: 'rel-worktrees' };
  return { fire: true, reason: 'rel-outside' };
}

// CLI shim (test==runtime, t/3270): the worktree-path-guard rule invokes
//   node <path>/worktree-target-guard.mjs "<command>"
// BLOCK == write 'fire' to stdout; ALLOW == exit 0 no stdout. The rule wraps this in try/catch and
// fails OPEN (no fire) on any error (TL cond. 2). endsWith-guard → fires only on direct invocation.
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('worktree-target-guard.mjs')) {
  if (worktreeTargetVerdict(process.argv[2] || '').fire) process.stdout.write('fire');
}
