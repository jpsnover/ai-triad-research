// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Both-arms proof for the done-requires-evidence gate (t/3360). The predicate keys on a git state
// the ticket workflow can't exercise in unit tests, so both arms are proven here directly. Run:
//   node --test operations/devops/done-evidence-predicate.test.mjs
// Proves the SAME logic the feedback rule invokes (test == runtime, per t/3270#4).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { doneEvidenceVerdict, normalizeTicketKey } from './done-evidence-predicate.mjs';

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
