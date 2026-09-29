// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { execFileSync } from 'node:child_process';

/**
 * Ticketed branch-ancestry-inheritance detector (t/3738). Prevention for the PR #2521 /
 * `007a5136` incident: a PR described as a one-file catalog fix carried three other agents'
 * commits (t/3725, t/3732, t/3733) because the worktree that produced it branched from a stale
 * shared HEAD instead of `origin/main`, and merged clean with no conflict.
 *
 * RESIDUAL (state exactly this, never "ancestry inheritance detected" — that overclaims):
 * catches TICKETED foreign commits (subject carries a `t/NNNN`-shaped ref disjoint from the PR's
 * own ticket) and MERGE commits in range (100% of sampled merge commits carry no ticket ref, and
 * a merge commit is the reconciliation artifact this check exists to catch — Option B, t/3738#6).
 * It is BLIND to a ref-less, non-merge foreign commit — that commit shape evades detection
 * entirely; `5de42009` and `e348e467` are live, observed instances of that residual on this repo.
 *
 * Pure-core/impure-shim split (t/3699 pattern): this module's exported functions take only
 * plain data (subjects, ticket sets, a pre-computed commit list) — no git calls, no env reads.
 * The CLI shim at the bottom does the impure part (git, PR-title env var) and is the only piece
 * the workflow actually invokes, so test == runtime (t/3270#4 discipline).
 */

// Catches BOTH `t/NNNN` and the live `scope(tNNNN):` convention form (`analysis(t3596)`, etc.).
// `t/[0-9]+` alone misses the second form — a confirmed false-negative (t/3738#6).
const TICKET_REF_RE = /\bt\/?([0-9]{3,4})\b/gi;

/** Pure: subject line -> normalized ticket ids (e.g. "t3729"), deduped, order-preserving. */
export function extractTicketRefs(subject) {
  const s = typeof subject === 'string' ? subject : '';
  const seen = new Set();
  const out = [];
  for (const m of s.matchAll(TICKET_REF_RE)) {
    const id = `t${m[1]}`;
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Pure: is a single commit foreign to the PR's own ticket?
 * FOREIGN ⟺ subjectRefs is non-empty AND disjoint from prTicket (intersection, not equality —
 * a commit naming its own ticket PLUS a related one, e.g. `cb35c91e` = t3350+t3633 in a t3350
 * PR, is NOT foreign; t/3738#4).
 */
export function isForeignCommit({ subjectRefs, prTicket } = {}) {
  const refs = Array.isArray(subjectRefs) ? subjectRefs : [];
  if (refs.length === 0) return false; // no ref -> contributes nothing (the stated residual)
  if (!prTicket) return false; // no-ticket-PR case is handled at the PR level (fires via empty expected set), not here
  return !refs.includes(prTicket);
}

/**
 * Pure: evaluate a full commit range against the PR's own ticket.
 *
 * @param prTicket   normalized ticket id for the PR (e.g. "t3729"), or null/empty if the PR
 *                   title carries no ticket ref (the no-ticket-PR case — fires, clearable via
 *                   the same opt-out as a genuine multi-ticket PR).
 * @param commits    [{ sha, subject, isMerge }] — the full merge-base..HEAD range, already
 *                   resolved by the impure shim. isMerge = parent count > 1.
 * @param rangeValid whether the shim successfully resolved merge-base AND got a non-empty
 *                   range. false -> 'cannot-evaluate' UNCONDITIONALLY, never 'clean' (t/3738#2 —
 *                   the fail-open trap: an unresolved range must never read as "nothing found").
 * @param optedOut   true when the PR carries the documented multi-ticket opt-out marker.
 */
export function evaluateForeignInheritance({ prTicket, commits, rangeValid, optedOut } = {}) {
  if (!rangeValid) {
    return { verdict: 'cannot-evaluate', foreignCommits: [], mergeCommits: [], noTicketPr: false };
  }
  if (optedOut) {
    return { verdict: 'clean', foreignCommits: [], mergeCommits: [], noTicketPr: false };
  }

  const list = Array.isArray(commits) ? commits : [];
  const normalizedTicket = prTicket || null;
  const noTicketPr = !normalizedTicket;

  const foreignCommits = list.filter((c) =>
    isForeignCommit({ subjectRefs: extractTicketRefs(c.subject), prTicket: normalizedTicket }),
  );
  const mergeCommits = list.filter((c) => c.isMerge);

  const fires = noTicketPr || foreignCommits.length > 0 || mergeCommits.length > 0;
  return { verdict: fires ? 'fire' : 'clean', foreignCommits, mergeCommits, noTicketPr };
}

/** Pure: format the human-readable result the CLI shim prints. */
export function formatResult(result) {
  if (result.verdict === 'cannot-evaluate') {
    return 'CANNOT EVALUATE — merge-base against origin/main did not resolve, or the commit range ' +
      'could not be determined. This is never treated as clean (t/3738 fail-closed rule). Check ' +
      'that the workflow uses fetch-depth: 0 and that origin/main is fetchable.';
  }
  if (result.verdict === 'clean') return 'clean — no foreign or merge commits in range';

  const lines = ['FOREIGN-COMMIT / TICKETED-ANCESTRY-INHERITANCE CHECK FIRED:'];
  if (result.noTicketPr) {
    lines.push('- PR title carries no t/NNNN ticket ref (empty expected set) — clear via the multi-ticket opt-out if intentional.');
  }
  for (const c of result.foreignCommits) {
    lines.push(`- ${c.sha.slice(0, 8)} carries a ticket ref foreign to this PR: ${c.subject}`);
  }
  for (const c of result.mergeCommits) {
    lines.push(`- ${c.sha.slice(0, 8)} is a merge commit in range (reconciliation artifact): ${c.subject}`);
  }
  lines.push(
    '',
    'Residual: catches TICKETED foreign commits and MERGE commits only. Blind to a ref-less, ' +
      'non-merge foreign commit — that shape evades this check entirely.',
  );
  return lines.join('\n');
}

// ── Impure shim ──────────────────────────────────────────────────────────────────────────────
// Invoked as: node foreign-commit-predicate.mjs "<PR title>" ["<opt-out marker present: 0|1>"]
// Exit 0 ONLY on 'clean'. Any other verdict exits 1 (warn-only workflow step should set
// continue-on-error: true so this can never block — the gate is advisory until a separate,
// SO-consulted promotion to blocking).
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('foreign-commit-predicate.mjs')) {
  const prTitle = process.argv[2] || '';
  const optedOut = process.argv[3] === '1';
  const prTicketRefs = extractTicketRefs(prTitle);
  const prTicket = prTicketRefs[0] || null;

  let mergeBase = null;
  let rangeValid = false;
  let commits = [];
  try {
    mergeBase = execFileSync('git', ['merge-base', 'origin/main', 'HEAD'], { encoding: 'utf8' }).trim();
    const raw = execFileSync(
      'git',
      ['log', '--format=%H%x1f%s%x1f%P', `${mergeBase}..HEAD`],
      { encoding: 'utf8' },
    ).trim();
    if (raw.length > 0) {
      commits = raw.split('\n').map((line) => {
        const [sha, subject, parents] = line.split('\x1f');
        const parentCount = (parents || '').trim().length === 0 ? 0 : parents.trim().split(/\s+/).length;
        return { sha, subject, isMerge: parentCount > 1 };
      });
    }
    // A resolved merge-base with an empty range is a VALID clean result (PR head == origin/main,
    // or a fast-forward with no new commits) — not the same as merge-base failing to resolve.
    rangeValid = true;
  } catch {
    rangeValid = false; // merge-base couldn't resolve (e.g. shallow checkout) -> cannot-evaluate
  }

  const result = evaluateForeignInheritance({ prTicket, commits, rangeValid, optedOut });
  process.stdout.write(formatResult(result) + '\n');
  process.exitCode = result.verdict === 'clean' ? 0 : 1;
}
