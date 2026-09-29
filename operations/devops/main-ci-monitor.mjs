// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { execFileSync } from 'node:child_process';

/**
 * main-CI monitor (t/3737) — answers "is the tip of `main` broken?" and alerts an acting role when
 * it is, so a red `main` cannot sit unobserved (the incident: a recorded red that notified nobody).
 * Pure verdict here; the impure gh fetch + issue/notify live in the CLI shim below and the workflow.
 * Test == runtime: the shim feeds classifyMainCI the exact shape the tests use.
 *
 * DETECTION MODEL — OBSERVE WHAT RAN, DON'T MODEL WHAT SHOULD HAVE (TL ruling, t/3737#11,
 * p/331#1626). The earlier "all REQUIRED contexts success on the head" model was WRONG: required
 * contexts answer "may this PR merge?" (enforced on the PR head at merge time), NOT "is the tip
 * broken?". Most required contexts never re-post on main's post-merge head — `joint-gv-guard` is
 * `pull_request`-only (never on main's head), `CodeQL`/`ci-gate` are path-gated — so requiring them
 * on the head false-fires every merge. The fix is to stop modelling triggers entirely:
 *
 *   main is RED  ⟺  a `push`-event workflow RUN on the head SHA concluded failure/cancelled.
 *
 * Zero trigger-modelling → nothing to drift from the YAML. A workflow's conclusion counts WHEN it
 * runs; there is nothing to wait for when a path filter skips it (skips create no run). New push
 * workflows are covered with no list to maintain. The required-contexts list is OUT of detection —
 * kept only as the SSOT cross-check (crossCheckSsot).
 *
 * GRADED, not suppressed (TL): the designated main-health workflow is `CI` (HEALTH_WORKFLOW) — its
 * failure is a FULL alert. Any OTHER push-event workflow concluding red is a separate LOWER-severity
 * notice, never silently dropped.
 *
 * CI-ABSENT boundary (TL ruling, p/331#1629): `paths-ignore` (e.g. a docs-only push) fires NO push
 * workflow at all — verified: `5de42009`/`295d5d8a`/`ae1cdda6` each have push-runs=0, and that is the
 * CORRECT, permanent state for those heads. So:
 *   - absent entirely (no run of the health workflow) → UNKNOWN, **NO alert** (not even a low notice —
 *     deciding a run *should* have fired is exactly the trigger-modelling we declined).
 *   - created but UNCONCLUDED past the deadline → alert (guards a hung/stuck run).
 * Accepted trade, named as a blank: this cannot catch "CI never started when it should have." The
 * known remedy if we ever want it is a cron-triggered always-fires canary — NOT now (t/3737#11).
 *
 * DEADLINE: sized from the slowest push run's observed worst-case wall-clock (`ci-gate` inside `CI`,
 * measured max 13m11s over 8 same-day `main` runs, TL p/331#1600) × ~2.3 for runner contention =
 * 30 min. OBSERVED-NOT-BOUNDED (8 samples, ~1 day) — revisit if a legitimate run exceeds it.
 */
export const DEADLINE_MS = 30 * 60 * 1000;   // observed-not-bounded; see header.
export const HEALTH_WORKFLOW = 'CI';          // the designated main-health workflow `name:` (not a filename).

const FAILED = new Set(['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure', 'stale']);

/** PURE. One run's coarse state: 'failed' | 'passed' | 'pending'. `skipped`/`neutral` are NOT failures. */
export function runState(run) {
  if (!run || String(run.status) !== 'completed') return 'pending'; // queued / in_progress / waiting / requested
  if (FAILED.has(String(run.conclusion))) return 'failed';
  return 'passed'; // success / skipped / neutral
}

/**
 * PURE. GitHub returns every run (including re-runs) for a head SHA. A re-run should reflect the
 * CURRENT state, so collapse to the latest run per workflow `name` by `createdAt` (ISO string; lexical
 * compare is correct for ISO-8601). Runs without createdAt keep first-seen order as a tiebreak.
 */
export function dedupeLatestByWorkflow(runs) {
  const latest = new Map();
  for (const r of runs ?? []) {
    const prev = latest.get(r.name);
    if (!prev || String(r.createdAt ?? '') > String(prev.createdAt ?? '')) latest.set(r.name, r);
  }
  return [...latest.values()];
}

const names = (rs) => rs.map((r) => r.name);

/**
 * PURE core. Given the push-event runs on main's head SHA (already deduped to latest-per-workflow),
 * classify main and decide whether/how to alert.
 *   runs           : [{ name, status, conclusion }]  — push-event runs on the head SHA
 *   healthWorkflow : string  — the designated main-health workflow name (default 'CI')
 *   headAgeMs      : number  — now - head commit time (ms)
 *   deadlineMs     : number
 * Returns { severity:'red'|'notice'|'none', state, alert, pastDeadline, failedHealth:[], failedOther:[], reason }.
 *   severity 'red'    → FULL alert (CI failed).
 *   severity 'notice' → LOW-severity notice (non-CI red; hung CI; CI-absent past deadline).
 *   severity 'none'   → no action (green, or within deadline).
 */
export function classifyMainCI({ runs, healthWorkflow = HEALTH_WORKFLOW, headAgeMs, deadlineMs = DEADLINE_MS } = {}) {
  const list = Array.isArray(runs) ? runs : [];
  const pastDeadline = Number(headAgeMs) > Number(deadlineMs);
  const health = list.filter((r) => r.name === healthWorkflow);
  const others = list.filter((r) => r.name !== healthWorkflow);
  const healthFailed = health.filter((r) => runState(r) === 'failed');
  const otherFailed = others.filter((r) => runState(r) === 'failed');
  const healthPassed = health.some((r) => runState(r) === 'passed');
  const healthPending = health.some((r) => runState(r) === 'pending');

  // 1. CI failed → FULL alert, regardless of age (a concluded failure is definitive).
  if (healthFailed.length) {
    return { severity: 'red', state: 'red', alert: true, pastDeadline,
      failedHealth: names(healthFailed), failedOther: names(otherFailed),
      reason: `RED — main-health workflow '${healthWorkflow}' concluded failure on the head SHA: ${names(healthFailed).join(', ')}` +
        (otherFailed.length ? ` (also failed: ${names(otherFailed).join(', ')})` : '') };
  }
  // 2. A non-CI push workflow failed → LOW-severity notice (never silently dropped), whatever CI's state.
  if (otherFailed.length) {
    const ciState = healthPassed ? `'${healthWorkflow}' itself passed` : healthPending ? `'${healthWorkflow}' still in flight` : `'${healthWorkflow}' absent`;
    return { severity: 'notice', state: 'other-red', alert: true, pastDeadline,
      failedHealth: [], failedOther: names(otherFailed),
      reason: `LOW NOTICE — non-health push workflow(s) concluded failure: ${names(otherFailed).join(', ')} (${ciState})` };
  }
  // 3. CI passed, nothing failed → GREEN.
  if (healthPassed) {
    return { severity: 'none', state: 'green', alert: false, pastDeadline, failedHealth: [], failedOther: [],
      reason: `green — '${healthWorkflow}' concluded success on the head SHA; no push workflow failed` };
  }
  // 4. CI CREATED but not concluded → UNRESOLVED; alert past the deadline (guards a hung/stuck run).
  //    This is the one "waiting" state that alerts — a run EXISTS, so we are genuinely waiting on it.
  if (healthPending) {
    return { severity: pastDeadline ? 'red' : 'none', state: pastDeadline ? 'stuck' : 'unresolved', alert: pastDeadline, pastDeadline,
      failedHealth: [], failedOther: [],
      reason: pastDeadline
        ? `ALERT — '${healthWorkflow}' run was CREATED but has not concluded ${Math.round(headAgeMs / 60000)}m after the head commit (hung/stuck run — main health unknown, not confirmed-failed)`
        : `'${healthWorkflow}' in flight, within deadline — not actionable` };
  }
  // 5. CI ABSENT entirely, nothing failed → UNKNOWN, NO alert, ever (TL p/331#1629). No run of the
  //    health workflow was created — the CORRECT permanent state for a paths-filtered (e.g. docs-only)
  //    push. Judging that a run "should" have fired is the trigger-modelling we declined; that blank
  //    (CI-never-started) is an accepted trade, remediable later by a cron always-fires canary.
  //
  //    ⚠️ COUPLING — DO NOT DELETE without reading (TL p/331#1631, Gate Co-Location across decisions):
  //    "absent → no emission" means a healthy week of `main` produces SILENCE, which by inspection is
  //    indistinguishable from a DEAD monitor. The ONLY thing that tells them apart is the monitor's
  //    self-health check (liveness / detection / wiring — see the workflow's self-health job, t/3737#4).
  //    This no-emission branch and that health job are LOAD-BEARING FOR EACH OTHER. If you are trimming
  //    "the redundant health check", stop: without it, this silence becomes a monitor nobody can tell is
  //    alive. The reciprocal pointer lives at the health job.
  return { severity: 'none', state: 'unknown', alert: false, pastDeadline,
    failedHealth: [], failedOther: [],
    reason: `UNKNOWN — no '${healthWorkflow}' run exists on the head SHA (no push run created). Correct for a paths-filtered push; not alerted (observe-what-ran accepts the CI-never-started blank).` };
}

// SSOT CROSS-CHECK is deliberately NOT part of this monitor — it answers a DIFFERENT question
// ("is the required-contexts.json mirror stale vs live branch protection?" vs this monitor's "is the
// tip broken?"). This monitor never reads the required-contexts list at all.
//
// ⚠️ DO NOT cite that cross-check as "covered" — as of 2026-09-29 it is performed NOWHERE (TL
// p/331#1633). `RequiredContextsDriftVerdict.ps1`'s predicate is Pester-tested, but its live-API
// runner `Test-RequiredContextsListDrift.ps1` is invoked by no workflow or script (only a descriptive
// comment in required-contexts.json names it) — a t/3695-shape dead execution layer (pure half tested,
// impure half never runs). Wiring that orphaned runner as its OWN scheduled job (separate routing +
// liveness, advisory) is tracked at t/3740. It must NOT be bolted onto this monitor's self-health —
// coupling would make the main-CI health check assert less than it appears (the t/3737#3/#4 defect).

// ── CLI shim (impure — the ONLY part that touches gh). Prints a JSON verdict to stdout.
//    node main-ci-monitor.mjs <owner/repo>
//    The workflow reads the JSON and does the issue open/update/close + graded role notification.
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('operations/devops/main-ci-monitor.mjs')) {
  const repo = process.argv[2] || process.env.GITHUB_REPOSITORY;
  const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', timeout: 30000 });
  const ghJson = (path) => JSON.parse(gh(['api', path]));
  let out;
  try {
    const commit = ghJson(`repos/${repo}/commits/main`);
    const sha = commit.sha;
    const headAgeMs = Date.now() - new Date(commit.commit.committer.date).getTime();
    // OBSERVE WHAT RAN: push-event workflow runs on this exact head SHA.
    const rawRuns = (ghJson(`repos/${repo}/actions/runs?event=push&head_sha=${sha}&per_page=100`).workflow_runs ?? [])
      .map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion, createdAt: r.created_at }));
    const runs = dedupeLatestByWorkflow(rawRuns);
    const verdict = classifyMainCI({ runs, headAgeMs });
    out = { ok: true, sha, headAgeMin: Math.round(headAgeMs / 60000), runObserved: runs.map((r) => `${r.name}:${runState(r)}`), verdict };
  } catch (e) {
    // CANNOT-EVALUATE → fail LOUD (never silently green). The workflow treats ok:false as an infra
    // alert distinct from a main-red alert (opposite remedies).
    out = { ok: false, error: String((e && e.message) || e) };
  }
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.exitCode = out.ok ? 0 : 3; // 3 = cannot-evaluate (infra), distinct from a clean run
}
