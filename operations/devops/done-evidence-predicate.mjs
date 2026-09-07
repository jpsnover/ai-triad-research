// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { execFileSync } from 'node:child_process'; // used only by the CLI shim's git query
import { fileURLToPath } from 'node:url'; // resolve repo dirs from the module path, not cwd
import fs from 'node:fs'; // existsSync guard for the (optionally absent) data repo

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
 * TWO-REPO EVIDENCE (t/3360#5, warn-phase measurement): the fleet is a two-repo split — code here,
 * structured data in the sibling `ai-triad-data` repo. The warn-phase corpus showed the dominant
 * real false-positive class was NOT no-code tickets (those are near-absent) but real work whose
 * commit landed in the DATA repo — invisible to an `origin/main` grep of THIS repo alone. So evidence
 * is now searched across BOTH repos (see countEvidenceAcrossRepos); a hit in either counts.
 *
 * Split (merge-guard pattern, t/3270/t/3318, Guard Testability t/2971): the impure `git log` query
 * lives in the CLI shim; `doneEvidenceVerdict` is a PURE function of { statusTarget, hitCount, gitOk }
 * and `countEvidenceAcrossRepos` is a PURE aggregation over injectable runGit/existsDir — so both
 * arms (including the data-repo leg) stay unit-testable (test == runtime). Returns { block, reason }.
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
  // A landed commit (in EITHER repo) references the ticket key → committed evidence exists.
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

/**
 * PURE aggregation of committed evidence across the fleet's two git repos (t/3360#5).
 * Injectable seams keep it unit-testable without real git (test == runtime):
 *   - runGit(dir)   → number of origin/main commits in `dir` whose message references the key;
 *                     throws on a real git error.
 *   - existsDir(dir)→ whether the repo path is present.
 * Semantics:
 *   - a null/empty key → { hitCount: 0, gitOk: false } (fail-open: never block on a key we can't form);
 *   - an ABSENT repo (existsDir false) contributes 0 hits and is NOT an error — e.g. a checkout with no
 *     sibling data repo; only a real git failure on a PRESENT repo flips gitOk=false (→ fail-open);
 *   - hits SUM across repos; a hit in EITHER repo is evidence.
 */
export function countEvidenceAcrossRepos({ key, repoDirs, runGit, existsDir } = {}) {
  if (!key) return { hitCount: 0, gitOk: false };
  let hitCount = 0;
  let gitOk = true;
  for (const dir of repoDirs ?? []) {
    if (!existsDir(dir)) continue; // genuinely-absent repo is not a git error
    try {
      hitCount += runGit(dir);
    } catch {
      gitOk = false; // real git failure on a present repo → fail-open
    }
  }
  return { hitCount, gitOk };
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
    // Resolve both repo roots from THIS module's path (not cwd, which the hook runtime doesn't fix):
    //   repo root  = <root>/  (this file is <root>/operations/devops/done-evidence-predicate.mjs)
    //   data repo  = $AI_TRIAD_DATA_ROOT, else the sibling <root>/../ai-triad-data (monorepo fallback,
    //                mirrors the .aitriad.json resolution priority in root AGENTS.md).
    const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
    const dataRoot = process.env.AI_TRIAD_DATA_ROOT || fileURLToPath(new URL('../../../ai-triad-data', import.meta.url));
    const { hitCount, gitOk } = countEvidenceAcrossRepos({
      key,
      repoDirs: [repoRoot, dataRoot],
      existsDir: (d) => {
        try {
          return fs.existsSync(d);
        } catch {
          return false;
        }
      },
      runGit: (d) => {
        const out = execFileSync('git', ['-C', d, 'log', 'origin/main', `--grep=${key}`, '--oneline'], {
          encoding: 'utf8',
          timeout: 8000,
        });
        return out.split(/\r?\n/).filter((l) => l.trim()).length;
      },
    });
    if (doneEvidenceVerdict({ statusTarget, hitCount, gitOk }).block) process.stdout.write('fire');
  }
}
