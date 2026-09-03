// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Pure command-string predicate for the pre-self-merge head-guard (t/3270, TL GV t/3270#2).
 *
 * FAILURE CLASS it closes: a manual `gh pr merge` completes against a CACHED/stale head that is
 * BEHIND the latest push, stranding later-pushed commits off main (#701/#830/#1810/#1868 — #1868
 * bypassed a TL-conditioned parity test). The root-AGENTS Pre-Self-Merge head-match check was only
 * ADVISORY (the pre-self-merge-verify hook merely nudged).
 *
 * DESIGN (why a command-string predicate, not an OID compare): requiring `gh pr merge
 * --match-head-commit <SHA>` lets GITHUB enforce head==SHA atomically at merge time — race-free, no
 * check-then-merge window, no fail-open. A hook that shelled out to compare `gh pr view headRefOid`
 * vs the local tip would be racy (head moves between check and merge) and must fail-open on a `gh`
 * error, defeating the gate. So the ONLY thing this predicate decides is a pure string question:
 * does a manual merge carry the flag? GitHub does the rest.
 *
 * `--auto` IS EXEMPT (TL ruling t/3270#2): every recurrence was a self/manual merge; `--auto` is
 * stale-head-safe by construction (GitHub re-targets on a new push and waits for the later commit's
 * required checks), and it CANNOT carry `--match-head-commit` (it queues pre-green). Its only
 * residual risk — auto-merging a *gated* PR — is owned by the SEPARATE draft-discipline (gated PRs
 * stay draft → `--auto` can't complete on a draft), not this gate; a command-string predicate can't
 * see gatedness without PR-state I/O, which would reintroduce the fail-open problem this avoids.
 *
 * Returns { block:boolean, reason:string }. The feedback-rule run-gate inlines the SAME logic (see
 * INLINE_FOR_RULE below) and emits 'fire' to stdout iff block (the worktree-path-guard convention).
 * This module is the source of truth the both-arms test proves; the rule's inline copy must match.
 */
export function mergeGuardVerdict(command) {
  const cmd = command || '';
  // Only manual `gh pr merge` (or gh.exe) is in scope — flag order / PR-number-optional tolerant.
  if (!/\bgh(?:\.exe)?\s+pr\s+merge\b/.test(cmd)) return { block: false, reason: 'not-a-merge' };
  // `--auto` exempt (see header) — matches boolean `--auto` and defensively `--auto=true`.
  if (/(?:^|\s)--auto(?:[=\s]|$)/.test(cmd)) return { block: false, reason: 'auto-exempt' };
  // Guarded iff the head-match flag carries a value — BOTH `--match-head-commit SHA` and
  // `--match-head-commit=SHA` forms (a bare flag with no value would false-pass, so require \S).
  if (/--match-head-commit(?:=|\s+)\S/.test(cmd)) return { block: false, reason: 'guarded' };
  // Manual merge, no head guard → BLOCK (the stranding vector).
  return { block: true, reason: 'missing-match-head-commit' };
}

// CLI shim (t/3270#4, TL GV): the pre-self-merge-verify feedback rule invokes THIS module directly
//   node <path>/merge-guard-predicate.mjs "<command>"
// so the rule runs the exact logic the both-arms test proves — test == runtime. (A hand-copied
// inline node -e would let a typo in the un-tested copy brick every merge or silently negate the
// gate; TL's load-bearing fix.) Convention: BLOCK == write 'fire' to stdout; ALLOW == exit 0, no
// stdout — the worktree-path-guard blocking contract. The endsWith guard makes this fire only on
// direct invocation (any path form), never when imported by the test.
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('merge-guard-predicate.mjs')) {
  if (mergeGuardVerdict(process.argv[2] || '').block) process.stdout.write('fire');
}
