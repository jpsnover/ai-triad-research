// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { execFileSync } from 'node:child_process'; // used only by the CLI shim's git query

/**
 * Pure verdict for the done-requires-EVIDENCE gate (t/3360, G1 cross-check audit).
 *
 * FAILURE CLASS it closes: a ticket transitions to Done with a bare "done" and no evidence, so a
 * closed ticket isn't traceable to a landed commit. The pre-existing `done-requires-commit` rule was
 * context-ONLY (a static reminder, condition:"true") — it nudged but verified nothing.
 *
 * DESIGN (Orca Support t/3360#2): the `transition_ticket` PreToolUse payload carries only
 * { ticket_id, status } — NOT the closing comment — and there is no comments API nor an extensible
 * transition param. So evidence is checked against GIT, not comments: a Done transition requires a
 * commit on `origin/main` whose message references the ticket key (the fleet's `t/KEY` commit
 * convention). `ticket_type` is NOT in the payload, so carve-outs (chore/docs/no-code) CANNOT be
 * mechanical — that gap is sized during the warn phase before any blocking flip.
 *
 * Split (merge-guard pattern, t/3270/t/3318, Guard Testability t/2971): the impure `git log` query
 * lives in the CLI shim; `doneEvidenceVerdict` is a PURE function of { statusTarget, hitCount, gitOk }
 * so both arms stay unit-testable (test == runtime). Returns { block, reason }.
 *
 * git-error mode = FAIL-OPEN (warn-phase proposal; TL confirms at the flip, t/3360#3): a git hiccup
 * must not brick EVERY Done transition — this gate is an evidence backstop, not the record of truth,
 * and its blast radius (all Done transitions, all roles) is far wider than the merge-guard's. That is
 * the risk-matched opposite of the merge-guard's fail-CLOSED.
 */
export function doneEvidenceVerdict({ statusTarget, hitCount, gitOk } = {}) {
  // Self-scope: only a transition whose TARGET status is Done is in scope (case-insensitive).
  if (String(statusTarget).toLowerCase() !== 'done') return { block: false, reason: 'not-done-transition' };
  // FAIL-OPEN on any git failure / unparseable key (gitOk=false) — see header.
  if (!gitOk) return { block: false, reason: 'git-unavailable-fail-open' };
  // A landed commit references the ticket key → committed evidence exists.
  if (hitCount > 0) return { block: false, reason: 'evidence-present' };
  // Done + git OK + zero commits referencing the ticket → no committed evidence.
  return { block: true, reason: 'no-committed-evidence' };
}

/**
 * Normalize a payload `ticket_id` to the `t/KEY` form used in commit messages.
 * Accepts "t/3360", "3360", "T/3360" → "t/3360"; returns null if unrecognizable (→ fail-open).
 * Kept pure + exported so the key-parsing arm is unit-tested independently of git.
 */
export function normalizeTicketKey(raw) {
  const m = String(raw ?? '').trim().match(/^(?:t\/)?(\d{1,7})$/i);
  return m ? `t/${m[1]}` : null;
}

// CLI shim (the ONLY impure part). Convention (worktree-path-guard / merge-guard): BLOCK == write
// 'fire' to stdout; ALLOW == exit 0 with no stdout. The feedback rule invokes THIS module by abs
// path so the rule runs the exact logic the both-arms test proves (test == runtime, TL GV t/3270#4).
// The endsWith guard makes the shim run ONLY on direct invocation, never when imported by the test.
//   node done-evidence-predicate.mjs "<status>" "<ticket_id>"
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('done-evidence-predicate.mjs')) {
  const statusTarget = process.argv[2] || '';
  if (String(statusTarget).toLowerCase() === 'done') {
    const key = normalizeTicketKey(process.argv[3] || '');
    let hitCount = 0;
    let gitOk = true;
    if (!key) {
      gitOk = false; // unparseable id → fail-open (don't block on an id we can't turn into a key)
    } else {
      try {
        const out = execFileSync('git', ['log', 'origin/main', `--grep=${key}`, '--oneline'], {
          encoding: 'utf8',
          timeout: 8000,
        });
        hitCount = out.split(/\r?\n/).filter((l) => l.trim()).length;
      } catch {
        gitOk = false; // git error → fail-open (see header)
      }
    }
    if (doneEvidenceVerdict({ statusTarget, hitCount, gitOk }).block) process.stdout.write('fire');
  }
}
