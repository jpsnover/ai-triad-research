// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { execFileSync } from 'node:child_process'; // used only by the --jointgv CLI fetch shim

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

/**
 * Auto-merge-on-joint-GV guard (t/3318, TL gate design t/3318#1 — prevention for the t/3307 incident).
 *
 * FAILURE CLASS it closes: `gh pr merge --auto` was enabled on a PR that was part of a JOINT GV
 * (co-merge group — #1947 had to land WITH ElectronMain #1940 per a locked cross-role contract).
 * Auto-merge fired the moment #1947's checks went green and merged it ALONE on its pre-consolidation
 * head — jumping the joint GV (main briefly broken) and stranding the reviewed consolidation. The
 * "gated PRs stay draft / never --auto a gated PR" rule is a convention auto-merge does not honor.
 *
 * DESIGN (t/3247 split, per TL): key on a MARKER, not draft-ness — a *solo* draft legitimately uses
 * --auto (TL recommends it). The hazard is the co-merge grouping. Marker = a `joint-gv` LABEL applied
 * when a PR is in a co-merge group / gated on a joint TL-GV. This decision is a PURE predicate
 * `(isAutoMerge ∧ isJointGvLabeled) → block`; the ONLY impure part is the label lookup, isolated in a
 * fetch shim (kept out of the pure predicate so both arms stay unit-testable, t/2971). Unlike the
 * t/3270 head-guard (which stays pure-string to avoid fail-open), this NEEDS PR-state I/O — so it
 * fails CLOSED on a gh error (blocks --auto with a distinct "couldn't verify" message), because
 * --auto-enable is rare + overridable and letting the t/3307 hazard through on a transient gh blip is
 * the worse failure. `--match-head-commit` manual self-merge is entirely unaffected (no --auto).
 */
export function jointGvAutoMergeVerdict({ isAutoMerge, isJointGvLabeled } = {}) {
  if (isAutoMerge && isJointGvLabeled) return { block: true, reason: 'auto-merge-on-joint-gv' };
  if (isAutoMerge) return { block: false, reason: 'auto-merge-unlabeled-ok' };
  return { block: false, reason: 'not-auto-merge' };
}

// Is this an auto-merge enable of a `gh pr merge`? (reuses the t/3270 --auto detection verbatim)
export function isAutoMergeCommand(command) {
  const cmd = command || '';
  if (!/\bgh(?:\.exe)?\s+pr\s+merge\b/.test(cmd)) return false;
  return /(?:^|\s)--auto(?:[=\s]|$)/.test(cmd);
}

// Extract the PR ref from a `gh pr merge <ref> …` command: a pull URL, else a numeric id, else null
// (null → the caller lets `gh pr view` default to the current branch's PR). Only the leading ref
// position is read, so a `--match-head-commit <sha>` value can't be mistaken for the ref (and --auto
// commands can't carry that flag anyway — gh rejects the combination).
export function parsePrRef(command) {
  const cmd = command || '';
  const url = cmd.match(/\bpr\s+merge\s+(\S*\/pull\/\d+)/);
  if (url) return url[1];
  const num = cmd.match(/\bpr\s+merge\s+(\d+)(?:\s|$)/);
  if (num) return num[1];
  return null;
}

// CLI shim (t/3270#4 / t/3318, TL GV): the feedback rules invoke THIS module directly so the rule
// runs the exact logic the both-arms test proves — test == runtime. (A hand-copied inline node -e
// would let a typo in the un-tested copy brick every merge or silently negate the gate; TL's
// load-bearing fix.) Convention: BLOCK == write 'fire' to stdout; ALLOW == exit 0, no stdout — the
// worktree-path-guard blocking contract. The endsWith guard makes this fire only on direct
// invocation (any path form), never when imported by the test.
//
// Two modes, both feed the same 'fire' contract but from DIFFERENT rules (distinct remediation text):
//   node <path>/merge-guard-predicate.mjs "<command>"              → t/3270 head-guard (pre-self-merge-verify)
//   node <path>/merge-guard-predicate.mjs --jointgv "<command>"    → t/3318 auto-merge joint-GV guard
// The head-guard path is byte-identical to before (its 13/13 test stays green); --auto is
// 'auto-exempt' there, so the two guards never double-fire on one command.
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('merge-guard-predicate.mjs')) {
  if (process.argv[2] === '--jointgv') {
    const cmd = process.argv[3] || '';
    if (isAutoMergeCommand(cmd)) {
      // Fetch shim (the only impure part): look up the PR's labels. Fail CLOSED on a gh error (after
      // one retry) — a joint-GV PR must not auto-merge, and an unverifiable label is treated as unsafe.
      let labeled;
      try {
        const ref = parsePrRef(cmd);
        const args = ['pr', 'view', ...(ref ? [ref] : []), '--json', 'labels', '-q', '.labels[].name'];
        let out = '';
        for (let attempt = 1; attempt <= 2; attempt++) {
          try { out = execFileSync('gh', args, { encoding: 'utf8', timeout: 8000 }); break; }
          catch (e) { if (attempt === 2) throw e; }
        }
        labeled = out.split(/\r?\n/).some((l) => l.trim() === 'joint-gv');
      } catch {
        process.stdout.write('fire'); // fail-closed: couldn't verify → block --auto
        labeled = null;
      }
      if (labeled !== null && jointGvAutoMergeVerdict({ isAutoMerge: true, isJointGvLabeled: labeled }).block) {
        process.stdout.write('fire');
      }
    }
  } else if (mergeGuardVerdict(process.argv[2] || '').block) {
    process.stdout.write('fire');
  }
}
