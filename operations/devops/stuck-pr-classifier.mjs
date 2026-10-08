// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * t/4115 (t/4096 item 2): pure classifier for the stuck-PR SLA alert. Alert-only — never
 * blocks a merge. The impure `pr-triage.yml` step fetches facts (actions/runs?head_sha,
 * mergeability, labels, issue-events) and calls these functions; this file does no I/O.
 *
 * REQUIRED_CONTEXTS mirrors branch protection's required status checks (docs/...; t/3736).
 * Read from actions/runs?head_sha or check-suites, NEVER from `gh pr checks` or the
 * check-runs rollup — both collapse to the newest-by-name view and hide a run that is
 * QUEUED behind an older, already-green run of the same workflow (#3062, t/4096#1): GitHub
 * evaluates a required context against the NEWEST check suite, so a stuck queued suite
 * reads as "expected" even though an older green suite for the same workflow exists and is
 * visible everywhere else. That blind spot is exactly what stuck-required-run exists to catch.
 */
export const REQUIRED_CONTEXTS = ['ci-gate', 'CodeQL', 'joint-gv-guard', 'consult-hold-guard'];

// Gate Co-Location: thresholds at their point of use, with rationale.
export const STUCK_RUN_MINUTES = 30;   // t/4096#2: a required-context run queued/in-progress this long is a named blocker.
export const IDLE_DETECT_HOURS = 1;    // no PR activity for this long, with no other named blocker, names "idle".
export const OWNER_SLA_HOURS = 2;      // blocker episode age at which the owning role is pinged.
export const TL_SLA_HOURS = 6;         // blocker episode age at which the TL is pinged (never the PI).
export const SWEEP_WINDOW_SECONDS = 15;  // ready_for_review -> auto_*_enabled within this = the sweep signature.
export const SWEEP_BURST_SECONDS = 120;  // 2+ PRs showing the signature within this window = the sweep shape.

/**
 * PURE. Classifies one open, non-draft PR's blocker, or null if it has none.
 *
 * @param {object} pr
 * @param {string} pr.mergeableState - GitHub's mergeable_state, e.g. 'behind'|'clean'|'dirty'|'blocked'|'unknown'.
 * @param {boolean} pr.isConflicting - true iff mergeable === false / mergeable_state === 'dirty' (GitHub's CONFLICTING).
 * @param {boolean} pr.autoMergeEnabled
 * @param {string[]} pr.labels
 * @param {Array<{name:string, status:string, conclusion:string|null, createdAt:string}>} pr.runs
 *   The NEWEST run per workflow name touching this head SHA (actions/runs?head_sha), for
 *   every name in REQUIRED_CONTEXTS that has at least one run. Absent names mean no run yet.
 * @param {string|null} pr.mergeRefusalText - the REST merge attempt's refusal message, if tried.
 * @param {string|null} pr.lastActivityAt - ISO timestamp of the PR's last commit/comment/review.
 * @param {number} nowMs
 * @returns {{class:string, detail:object}|null}
 */
export function classifyBlocker(pr, nowMs) {
  const labels = pr.labels ?? [];
  const runs = pr.runs ?? [];
  const byName = new Map(runs.map((r) => [r.name, r]));

  // 1. held — checked FIRST and reported alone: a hold is deliberate, so a PR carrying one
  //    is never escalated even if it also matches another class underneath.
  if (labels.includes('consult-hold') || labels.includes('joint-gv')) {
    const ageHours = pr.lastActivityAt ? (nowMs - Date.parse(pr.lastActivityAt)) / 3600000 : null;
    return { class: 'held', detail: { labels: labels.filter((l) => l === 'consult-hold' || l === 'joint-gv'), ageHours } };
  }

  // 2. merge-conflict
  if (pr.isConflicting) {
    return { class: 'merge-conflict', detail: {} };
  }

  // 3. stuck-required-run — the #3062 blind spot. Checked before required-check-failed:
  //    a run that is still queued/in_progress has no conclusion yet, so it can't be "failed".
  for (const name of REQUIRED_CONTEXTS) {
    const run = byName.get(name);
    if (!run) continue;
    if (run.status === 'queued' || run.status === 'in_progress') {
      const stuckMinutes = (nowMs - Date.parse(run.createdAt)) / 60000;
      if (stuckMinutes > STUCK_RUN_MINUTES) {
        return {
          class: 'stuck-required-run',
          detail: {
            context: name,
            runId: run.id,
            stuckMinutes: Math.round(stuckMinutes),
            remedy: `Re-trigger first (toggle auto-merge or a label); if that doesn't clear it, cancel and re-run run ${run.id}.`,
          },
        };
      }
    }
  }

  // 4. required-check-failed
  for (const name of REQUIRED_CONTEXTS) {
    const run = byName.get(name);
    if (run && run.status === 'completed' && run.conclusion !== 'success') {
      return { class: 'required-check-failed', detail: { context: name, conclusion: run.conclusion, runId: run.id } };
    }
  }

  // 5. armed-but-blocked
  if (pr.autoMergeEnabled) {
    const allGreen = REQUIRED_CONTEXTS.every((name) => {
      const run = byName.get(name);
      return run && run.status === 'completed' && run.conclusion === 'success';
    });
    if (allGreen && pr.mergeableState === 'blocked') {
      return { class: 'armed-but-blocked', detail: { mergeRefusalText: pr.mergeRefusalText ?? '(not captured)' } };
    }
  }

  // 6. idle
  if (pr.lastActivityAt) {
    const idleHours = (nowMs - Date.parse(pr.lastActivityAt)) / 3600000;
    if (idleHours > IDLE_DETECT_HOURS) {
      return { class: 'idle', detail: { idleHours: Math.round(idleHours * 10) / 10 } };
    }
  }

  return null;
}

/**
 * PURE. Given a named blocker and how long its episode has been open, decides who to ping.
 * 'held' never escalates, regardless of age — holds are deliberate (t/4115 design).
 * @returns {'none'|'owner'|'tl'}
 */
export function escalationLevel(blockerClass, episodeAgeHours) {
  if (blockerClass === 'held') return 'none';
  if (episodeAgeHours >= TL_SLA_HOURS) return 'tl';
  if (episodeAgeHours >= OWNER_SLA_HOURS) return 'owner';
  return 'none';
}

/**
 * PURE. Finds ready_for_review -> auto_*_enabled pairs within SWEEP_WINDOW_SECONDS on the
 * same PR (t/4096#4 / t/3716). `events` is the repo-wide issue-events feed, already filtered
 * to these two event types (GraphQL omits AutoMergeEnabledEvent from PR timelines, t/3716#18,
 * so the caller must use the REST issue-events endpoint, not GraphQL).
 * @param {Array<{prNumber:number, event:'ready_for_review'|'auto_merge_enabled'|'auto_update_enabled', actor:string, createdAt:string}>} events
 * @returns {Array<{prNumber:number, readyAt:string, armedAt:string, deltaSeconds:number, actor:string}>}
 */
export function detectSweepSignature(events) {
  const byPr = new Map();
  for (const e of events ?? []) {
    if (!byPr.has(e.prNumber)) byPr.set(e.prNumber, []);
    byPr.get(e.prNumber).push(e);
  }
  const hits = [];
  for (const [prNumber, prEvents] of byPr) {
    const sorted = [...prEvents].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].event !== 'ready_for_review') continue;
      const readyAt = Date.parse(sorted[i].createdAt);
      for (let j = i + 1; j < sorted.length; j++) {
        const ev = sorted[j].event;
        if (ev !== 'auto_merge_enabled' && ev !== 'auto_update_enabled') continue;
        const armedAt = Date.parse(sorted[j].createdAt);
        const deltaSeconds = (armedAt - readyAt) / 1000;
        if (deltaSeconds >= 0 && deltaSeconds <= SWEEP_WINDOW_SECONDS) {
          hits.push({ prNumber, readyAt: sorted[i].createdAt, armedAt: sorted[j].createdAt, deltaSeconds, actor: sorted[j].actor });
        }
        break; // only the first auto_*_enabled after this ready_for_review counts
      }
    }
  }
  return hits;
}

/**
 * PURE. Decides escalation for each sweep-signature hit.
 * - A hit on a PR carrying consult-hold or joint-gv escalates straight to DevOps+TL.
 * - A BURST (2+ distinct PRs hit within SWEEP_BURST_SECONDS of each other) escalates every
 *   PR in that burst straight to DevOps+TL — no single legitimate owner flow produces this shape.
 * - Otherwise, one confirmation-request comment on the PR (never escalated).
 * @param {Array<{prNumber:number, readyAt:string, armedAt:string, actor:string}>} hits
 * @param {Map<number,string[]>} labelsByPr
 * @returns {Array<{prNumber:number, escalate:boolean, reason:string}>}
 */
export function classifySweepHits(hits, labelsByPr) {
  const sortedHits = [...hits].sort((a, b) => Date.parse(a.armedAt) - Date.parse(b.armedAt));
  const burstPrNumbers = new Set();
  for (let i = 0; i < sortedHits.length; i++) {
    for (let j = i + 1; j < sortedHits.length; j++) {
      const deltaSeconds = (Date.parse(sortedHits[j].armedAt) - Date.parse(sortedHits[i].armedAt)) / 1000;
      if (deltaSeconds > SWEEP_BURST_SECONDS) break;
      if (sortedHits[i].prNumber !== sortedHits[j].prNumber) {
        burstPrNumbers.add(sortedHits[i].prNumber);
        burstPrNumbers.add(sortedHits[j].prNumber);
      }
    }
  }

  return hits.map((h) => {
    const labels = labelsByPr?.get(h.prNumber) ?? [];
    const held = labels.includes('consult-hold') || labels.includes('joint-gv');
    if (held) {
      return { prNumber: h.prNumber, escalate: true, reason: `held PR (${labels.filter((l) => l === 'consult-hold' || l === 'joint-gv').join(', ')}) shows the sweep signature — escalating to DevOps+TL` };
    }
    if (burstPrNumbers.has(h.prNumber)) {
      return { prNumber: h.prNumber, escalate: true, reason: `sweep burst — ${burstPrNumbers.size} PRs showed the signature within ${SWEEP_BURST_SECONDS}s of each other` };
    }
    return { prNumber: h.prNumber, escalate: false, reason: 'single-PR signature, no hold — asking the owner to confirm' };
  });
}
