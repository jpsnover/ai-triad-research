// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Both-arms proof for the done-requires-evidence gate (t/3360). The predicate keys on a git state
// the ticket workflow can't exercise in unit tests, so both arms are proven here directly. Run:
//   node --test operations/devops/done-evidence-predicate.test.mjs
// Proves the SAME logic the feedback rule invokes (test == runtime, per t/3270#4).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { doneEvidenceVerdict, normalizeTicketKey, countEvidenceAcrossRepos, buildSinkRecord } from './done-evidence-predicate.mjs';

// A tiny fake-git harness for the pure two-repo aggregation: map repo dir → hit count, or the
// sentinel 'ERR' to make that repo's git call throw. Absent-from-map dirs are treated as present-but-0
// unless listed in `absent`. Keeps countEvidenceAcrossRepos runtime-identical to the shim (t/3360#5).
function harness({ hits = {}, absent = [] } = {}) {
  return {
    existsDir: (d) => !absent.includes(d),
    runGit: (d) => {
      if (hits[d] === 'ERR') throw new Error('git failed');
      return hits[d] ?? 0;
    },
  };
}
const CODE = '/repo';
const DATA = '/data';

// ── doneEvidenceVerdict: BLOCK arm ──
test('BLOCK arm: Done + git OK + zero commits referencing the ticket', () => {
  const v = doneEvidenceVerdict({ statusTarget: 'Done', hitCount: 0, gitOk: true });
  assert.equal(v.block, true);
  assert.equal(v.reason, 'no-committed-evidence');
});

// ── doneEvidenceVerdict: ALLOW arms ──
test('ALLOW arm: Done + a commit references the ticket (evidence present)', () => {
  const v = doneEvidenceVerdict({ statusTarget: 'Done', hitCount: 3, gitOk: true });
  assert.equal(v.block, false);
  assert.equal(v.reason, 'evidence-present');
});

test('ALLOW arm: exactly one commit still counts as evidence', () => {
  assert.equal(doneEvidenceVerdict({ statusTarget: 'Done', hitCount: 1, gitOk: true }).block, false);
});

test('ALLOW arm: git unavailable → FAIL-OPEN (a git hiccup must not brick Done)', () => {
  const v = doneEvidenceVerdict({ statusTarget: 'Done', hitCount: 0, gitOk: false });
  assert.equal(v.block, false);
  assert.equal(v.reason, 'git-unavailable-fail-open');
});

test('ALLOW arm: non-Done transitions are out of scope (never block)', () => {
  for (const s of ['In Progress', 'Todo', 'Backlog', 'Cancelled', 'Verified', 'Blocked', '']) {
    const v = doneEvidenceVerdict({ statusTarget: s, hitCount: 0, gitOk: true });
    assert.equal(v.block, false, `status "${s}" must not block`);
    assert.equal(v.reason, 'not-done-transition');
  }
});

test('Done is matched case-insensitively (block still fires for "done")', () => {
  assert.equal(doneEvidenceVerdict({ statusTarget: 'done', hitCount: 0, gitOk: true }).block, true);
  assert.equal(doneEvidenceVerdict({ statusTarget: 'DONE', hitCount: 0, gitOk: true }).block, true);
});

test('empty/undefined args never throw and default to allow', () => {
  assert.equal(doneEvidenceVerdict().block, false);
  assert.equal(doneEvidenceVerdict({}).block, false);
});

// ── normalizeTicketKey ──
test('normalizeTicketKey: accepts t/KEY, bare number, and uppercase; rejects junk', () => {
  assert.equal(normalizeTicketKey('t/3360'), 't/3360');
  assert.equal(normalizeTicketKey('3360'), 't/3360');
  assert.equal(normalizeTicketKey('T/3360'), 't/3360');
  assert.equal(normalizeTicketKey('  t/42  '), 't/42');
  assert.equal(normalizeTicketKey('e/105'), null); // email ref, not a ticket key
  assert.equal(normalizeTicketKey('p/526'), null); // ping ref
  assert.equal(normalizeTicketKey('not-a-key'), null);
  assert.equal(normalizeTicketKey(''), null);
  assert.equal(normalizeTicketKey(null), null);
  assert.equal(normalizeTicketKey(undefined), null);
});

// ── countEvidenceAcrossRepos: two-repo evidence aggregation (t/3360#5) ──
// The warn-phase corpus showed the dominant real FP class was a commit that landed in the DATA repo,
// invisible to an origin/main grep of the code repo alone. These prove a hit in EITHER repo is evidence
// and that the fail-open seams behave, feeding straight into doneEvidenceVerdict (test == runtime).

test('data-repo hit only → evidence present (the t/3050 class: was a false-block before)', () => {
  const { hitCount, gitOk } = countEvidenceAcrossRepos({
    key: 't/3050', repoDirs: [CODE, DATA], ...harness({ hits: { [CODE]: 0, [DATA]: 2 } }),
  });
  assert.equal(gitOk, true);
  assert.equal(hitCount, 2);
  assert.equal(doneEvidenceVerdict({ statusTarget: 'Done', hitCount, gitOk }).reason, 'evidence-present');
});

test('code-repo hit only → evidence present', () => {
  const { hitCount, gitOk } = countEvidenceAcrossRepos({
    key: 't/3372', repoDirs: [CODE, DATA], ...harness({ hits: { [CODE]: 3, [DATA]: 0 } }),
  });
  assert.equal(hitCount, 3);
  assert.equal(doneEvidenceVerdict({ statusTarget: 'Done', hitCount, gitOk }).block, false);
});

test('hits SUM across both repos', () => {
  const { hitCount } = countEvidenceAcrossRepos({
    key: 't/1', repoDirs: [CODE, DATA], ...harness({ hits: { [CODE]: 1, [DATA]: 1 } }),
  });
  assert.equal(hitCount, 2);
});

test('BLOCK arm survives: neither repo has a referencing commit → no evidence, git OK', () => {
  const { hitCount, gitOk } = countEvidenceAcrossRepos({
    key: 't/9999999', repoDirs: [CODE, DATA], ...harness({ hits: { [CODE]: 0, [DATA]: 0 } }),
  });
  assert.equal(gitOk, true);
  assert.equal(hitCount, 0);
  assert.equal(doneEvidenceVerdict({ statusTarget: 'Done', hitCount, gitOk }).reason, 'no-committed-evidence');
});

test('absent data repo is NOT an error → counts code repo only, still blocks with no evidence', () => {
  const { hitCount, gitOk } = countEvidenceAcrossRepos({
    key: 't/42', repoDirs: [CODE, DATA], ...harness({ hits: { [CODE]: 0 }, absent: [DATA] }),
  });
  assert.equal(gitOk, true); // absent sibling repo must not fail-open the gate
  assert.equal(hitCount, 0);
  assert.equal(doneEvidenceVerdict({ statusTarget: 'Done', hitCount, gitOk }).block, true);
});

test('real git error on a PRESENT repo → gitOk false → fail-open', () => {
  const { gitOk } = countEvidenceAcrossRepos({
    key: 't/42', repoDirs: [CODE, DATA], ...harness({ hits: { [CODE]: 'ERR', [DATA]: 0 } }),
  });
  assert.equal(gitOk, false);
  assert.equal(doneEvidenceVerdict({ statusTarget: 'Done', hitCount: 0, gitOk }).reason, 'git-unavailable-fail-open');
});

test('unparseable/empty key → fail-open (gitOk false), never blocks', () => {
  const r = countEvidenceAcrossRepos({ key: null, repoDirs: [CODE, DATA], ...harness({}) });
  assert.equal(r.gitOk, false);
  assert.equal(r.hitCount, 0);
});

// ── fail-open OBSERVABILITY (SO cond 3, e/146#2): every fail-open pass must be visible ──
// The warn seam is what makes a silently-dead gate detectable (t/3085 class). These prove it fires on
// BOTH fail-open reasons and stays SILENT on the happy path (no spurious warn noise).

test('git-error fail-open emits a warn with reason + repo + error (not silent)', () => {
  const warns = [];
  countEvidenceAcrossRepos({
    key: 't/42', repoDirs: [CODE, DATA],
    ...harness({ hits: { [CODE]: 'ERR', [DATA]: 0 } }),
    warn: (i) => warns.push(i),
  });
  assert.equal(warns.length, 1);
  assert.equal(warns[0].reason, 'git-error');
  assert.equal(warns[0].dir, CODE);
  assert.match(warns[0].error, /git failed/);
});

test('unparseable-key fail-open emits a warn (reason=unparseable-key)', () => {
  const warns = [];
  countEvidenceAcrossRepos({ key: null, repoDirs: [CODE, DATA], ...harness({}), warn: (i) => warns.push(i) });
  assert.equal(warns.length, 1);
  assert.equal(warns[0].reason, 'unparseable-key');
});

test('happy path (evidence present, git OK) emits NO warn', () => {
  const warns = [];
  const { gitOk } = countEvidenceAcrossRepos({
    key: 't/3372', repoDirs: [CODE, DATA],
    ...harness({ hits: { [CODE]: 2, [DATA]: 0 } }),
    warn: (i) => warns.push(i),
  });
  assert.equal(gitOk, true);
  assert.equal(warns.length, 0);
});

test('both repos error → gitOk false, one warn PER failing repo', () => {
  const warns = [];
  const { gitOk } = countEvidenceAcrossRepos({
    key: 't/42', repoDirs: [CODE, DATA],
    ...harness({ hits: { [CODE]: 'ERR', [DATA]: 'ERR' } }),
    warn: (i) => warns.push(i),
  });
  assert.equal(gitOk, false);
  assert.equal(warns.length, 2);
});

// ── buildSinkRecord: durable telemetry record shape (t/3394) ──
// The platform execution-telemetry writer is dead (Orca Support t/3394#2); the shim appends these
// records so the re-audit has a queryable source. Prove the record maps the verdict + carries the
// fail-open reasons (the otherwise-invisible signal).

test('sink record: BLOCK verdict → decision=block, carries reason + counts', () => {
  const r = buildSinkRecord({
    nowIso: '2026-09-07T20:00:00.000Z', rawTicketId: 't/8888888', key: 't/8888888',
    verdict: { block: true, reason: 'no-committed-evidence' }, hitCount: 0, gitOk: true, warns: [],
  });
  assert.equal(r.decision, 'block');
  assert.equal(r.reason, 'no-committed-evidence');
  assert.equal(r.ts, '2026-09-07T20:00:00.000Z');
  assert.equal(r.key, 't/8888888');
  assert.equal(r.hitCount, 0);
  assert.equal(r.gitOk, true);
  assert.deepEqual(r.failOpen, []);
});

test('sink record: ALLOW verdict → decision=allow', () => {
  const r = buildSinkRecord({
    nowIso: 'x', rawTicketId: 't/3372', key: 't/3372',
    verdict: { block: false, reason: 'evidence-present' }, hitCount: 3, gitOk: true, warns: [],
  });
  assert.equal(r.decision, 'allow');
  assert.equal(r.reason, 'evidence-present');
});

test('sink record: fail-open reasons are carried into failOpen (the re-audit signal)', () => {
  const warns = [{ reason: 'git-error', dir: '/repo', error: 'boom' }];
  const r = buildSinkRecord({
    nowIso: 'x', rawTicketId: 't/42', key: 't/42',
    verdict: { block: false, reason: 'git-unavailable-fail-open' }, hitCount: 0, gitOk: false, warns,
  });
  assert.equal(r.decision, 'allow'); // fail-open is an allow
  assert.equal(r.reason, 'git-unavailable-fail-open');
  assert.equal(r.gitOk, false);
  assert.deepEqual(r.failOpen, warns);
});

test('sink record: empty/undefined args never throw and default cleanly', () => {
  const r = buildSinkRecord();
  assert.equal(r.decision, 'allow'); // no verdict → not a block
  assert.equal(r.reason, null);
  assert.deepEqual(r.failOpen, []);
});
