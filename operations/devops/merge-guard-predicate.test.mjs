// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Guard Testability (t/2971) for the pre-self-merge head-guard (t/3270). The predicate keys on a
// merge-time condition PR-CI cannot exercise, so both arms are proven here directly. Run:
//   node --test operations/devops/merge-guard-predicate.test.mjs
// This proves the SAME logic the type:block feedback rule inlines (INLINE_FOR_RULE in the module).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  mergeGuardVerdict,
  jointGvAutoMergeVerdict,
  isAutoMergeCommand,
  parsePrRef,
  buildMergeGuardSinkRecord,
  baseRefStaleVerdict,
  parseBaseRefRecords,
} from './merge-guard-predicate.mjs';

// ── t/3687: retarget stale-green guard — baseRefStaleVerdict (base-ref-NAME identity) ──
// Design of record: t/3687#2 (locked via the e/212 SO+TL review). Block iff the LATEST record from any
// required recorder names a base ref != the PR's current baseRefName. Selection (latest-per-recorder by
// createdAt) survives identity; "any record differs" would permanently block a correctly-retargeted PR.
// Recorder ids and base names are realistic (the 3 enumerated recorders; epic/main retargets seen in this
// repo). createdAt is ISO-8601 UTC; ordering is single-instant (no created/finished split).
const RECORDERS = ['ci.yml', 'joint-gv-guard', 'codeql.yml'];
const rec = (recorder, baseRef, createdAt) => ({ recorder, baseRef, createdAt });
// all three recorders' latest record names `base`, all at time `t`.
const allMatching = (base, t) => RECORDERS.map((r) => rec(r, base, t));

test('t/3687 ALLOW: every required recorder\'s latest record names the current base', () => {
  const v = baseRefStaleVerdict({ currentBaseRefName: 'main', expectedRecorders: RECORDERS, records: allMatching('main', '2026-09-25T17:00:00Z') });
  assert.equal(v.block, false);
  assert.equal(v.reason, 'all-recorders-match-current-base');
});
test('t/3687 BLOCK: one recorder\'s latest record names the OLD base (retarget stale-green)', () => {
  const records = [rec('ci.yml', 'main', '2026-09-25T17:00:00Z'), rec('joint-gv-guard', 'main', '2026-09-25T17:00:00Z'), rec('codeql.yml', 'epic/x', '2026-09-25T17:00:00Z')];
  const v = baseRefStaleVerdict({ currentBaseRefName: 'main', expectedRecorders: RECORDERS, records });
  assert.equal(v.block, true);
  assert.equal(v.reason, 'base-ref-mismatch:codeql.yml');
});
test('t/3687 ALLOW: retargeted-then-fresh-run — old epic record + newer main record → latest wins (the permanent-block regression)', () => {
  // Opened against epic/x (17:00), retargeted to main, synchronize minted a fresh record naming main
  // (17:30). The OLD epic records are immutable but SUPERSEDED. "Any record differs" would block forever;
  // latest-per-recorder correctly allows.
  const records = RECORDERS.flatMap((r) => [rec(r, 'epic/x', '2026-09-25T17:00:00Z'), rec(r, 'main', '2026-09-25T17:30:00Z')]);
  const v = baseRefStaleVerdict({ currentBaseRefName: 'main', expectedRecorders: RECORDERS, records });
  assert.equal(v.block, false);
  assert.equal(v.reason, 'all-recorders-match-current-base');
});
test('t/3687 ALLOW: 3+ records for one recorder (unbounded, t/3646 triggers) — latest names current → allow', () => {
  // t/3646 added edited/auto_merge_disabled triggers → a PR with edits carries several records per
  // recorder; the count is unbounded, so selection maxes over a set. Latest (18:10) names main.
  const many = [
    rec('ci.yml', 'main', '2026-09-25T17:00:00Z'),
    rec('ci.yml', 'main', '2026-09-25T17:40:00Z'),
    rec('ci.yml', 'epic/x', '2026-09-25T16:00:00Z'),
    rec('ci.yml', 'main', '2026-09-25T18:10:00Z'),
  ];
  const records = [...many, rec('joint-gv-guard', 'main', '2026-09-25T18:00:00Z'), rec('codeql.yml', 'main', '2026-09-25T18:00:00Z')];
  const v = baseRefStaleVerdict({ currentBaseRefName: 'main', expectedRecorders: RECORDERS, records });
  assert.equal(v.block, false);
  assert.equal(v.reason, 'all-recorders-match-current-base');
});
test('t/3687 BLOCK: a required recorder has NO record → block, naming it (never allow on a partial set)', () => {
  const records = [rec('ci.yml', 'main', '2026-09-25T17:00:00Z'), rec('joint-gv-guard', 'main', '2026-09-25T17:00:00Z')]; // codeql.yml absent
  const v = baseRefStaleVerdict({ currentBaseRefName: 'main', expectedRecorders: RECORDERS, records });
  assert.equal(v.block, true);
  assert.equal(v.reason, 'missing-record:codeql.yml');
});
test('t/3687 BLOCK: no records at all → block', () => {
  const v = baseRefStaleVerdict({ currentBaseRefName: 'main', expectedRecorders: RECORDERS, records: [] });
  assert.equal(v.block, true);
  assert.equal(v.reason, 'missing-record:ci.yml');
});
test('t/3687 BLOCK: no expected recorders → block (nothing evaluated)', () => {
  const v = baseRefStaleVerdict({ currentBaseRefName: 'main', expectedRecorders: [], records: allMatching('main', '2026-09-25T17:00:00Z') });
  assert.equal(v.block, true);
  assert.equal(v.reason, 'no-expected-recorders');
});
test('t/3687 BLOCK: no current base ref → block (can\'t verify)', () => {
  const v = baseRefStaleVerdict({ currentBaseRefName: '', expectedRecorders: RECORDERS, records: allMatching('main', '2026-09-25T17:00:00Z') });
  assert.equal(v.block, true);
  assert.equal(v.reason, 'no-current-base-ref');
});
test('t/3687 BLOCK: tie at max createdAt with a mismatch → safe side (unknown ordering → block)', () => {
  // Two ci.yml records at the SAME instant, one naming main and one epic/x. Ordering is unknown at
  // second-granularity; the safe resolution is to block.
  const records = [
    rec('ci.yml', 'main', '2026-09-25T17:00:00Z'),
    rec('ci.yml', 'epic/x', '2026-09-25T17:00:00Z'),
    rec('joint-gv-guard', 'main', '2026-09-25T17:00:00Z'),
    rec('codeql.yml', 'main', '2026-09-25T17:00:00Z'),
  ];
  const v = baseRefStaleVerdict({ currentBaseRefName: 'main', expectedRecorders: RECORDERS, records });
  assert.equal(v.block, true);
  assert.equal(v.reason, 'base-ref-mismatch:ci.yml');
});

// ── t/3687: parseBaseRefRecords — commit-statuses payload → records (storage layer, pending TL GV) ──
// Fixture mirrors the shape of `gh api repos/{o}/{r}/commits/{sha}/statuses`: newest-first list of
// { context, description, created_at, state }. Only `base-ref-record/<recorder>` contexts are records.
const STATUSES = [
  { context: 'base-ref-record/ci.yml', description: 'main', created_at: '2026-09-25T17:40:00Z', state: 'success' },
  { context: 'ci-gate', description: 'All checks passed', created_at: '2026-09-25T17:41:00Z', state: 'success' }, // foreign — ignored
  { context: 'base-ref-record/codeql.yml', description: 'epic/x', created_at: '2026-09-25T17:00:00Z', state: 'success' },
  { context: 'base-ref-record/ci.yml', description: 'epic/x', created_at: '2026-09-25T16:00:00Z', state: 'success' }, // older dup — kept (history)
];
test('t/3687 parse: extracts base-ref-record/* statuses to {recorder,baseRef,createdAt}, ignoring foreign contexts', () => {
  const recs = parseBaseRefRecords(STATUSES);
  assert.equal(recs.length, 3); // the ci-gate status is not a record
  assert.deepEqual(recs.find((r) => r.recorder === 'codeql.yml'), { recorder: 'codeql.yml', baseRef: 'epic/x', createdAt: '2026-09-25T17:00:00Z' });
  assert.equal(recs.filter((r) => r.recorder === 'ci.yml').length, 2); // full history preserved for latest-selection
});
test('t/3687 parse: feeds baseRefStaleVerdict end-to-end — latest ci.yml record (main) wins over older (epic/x)', () => {
  const records = parseBaseRefRecords(STATUSES);
  // codeql.yml's only record names epic/x → mismatch → block on that recorder
  const v = baseRefStaleVerdict({ currentBaseRefName: 'main', expectedRecorders: ['ci.yml', 'codeql.yml'], records });
  assert.equal(v.block, true);
  assert.equal(v.reason, 'base-ref-mismatch:codeql.yml');
  // ci.yml alone: latest is main (17:40) over epic/x (16:00) → that recorder matches
  const vCi = baseRefStaleVerdict({ currentBaseRefName: 'main', expectedRecorders: ['ci.yml'], records });
  assert.equal(vCi.block, false);
});
test('t/3687 parse: skips a record missing description or created_at (→ missing-record, never silent allow)', () => {
  const recs = parseBaseRefRecords([
    { context: 'base-ref-record/ci.yml', description: '', created_at: '2026-09-25T17:00:00Z', state: 'success' },
    { context: 'base-ref-record/codeql.yml', description: 'main', created_at: null, state: 'success' },
  ]);
  assert.equal(recs.length, 0);
});
test('t/3687 parse: non-array / empty input → []', () => {
  assert.deepEqual(parseBaseRefRecords(undefined), []);
  assert.deepEqual(parseBaseRefRecords([]), []);
});

const MODULE = fileURLToPath(new URL('./merge-guard-predicate.mjs', import.meta.url));
// Invoke the module the SAME way the feedback rule does — proves runtime (CLI shim) == the tested
// function (test==runtime, TL GV t/3270#4). Returns the shim's stdout: 'fire' to block, '' to allow.
function runShim(command) {
  return execFileSync(process.execPath, [MODULE, command], { encoding: 'utf8' });
}

test('BLOCK arm: manual merge without --match-head-commit', () => {
  const v = mergeGuardVerdict('gh pr merge 1901 --squash');
  assert.equal(v.block, true);
  assert.equal(v.reason, 'missing-match-head-commit');
});

test('ALLOW arm: manual merge WITH --match-head-commit <SHA> (space form)', () => {
  const v = mergeGuardVerdict('gh pr merge 1901 --squash --match-head-commit 1578b0a0');
  assert.equal(v.block, false);
  assert.equal(v.reason, 'guarded');
});

test('ALLOW arm: --match-head-commit=<SHA> (equals form — must not false-block)', () => {
  // TL robustness condition: the = form is a correct merge; missing it would false-block.
  const v = mergeGuardVerdict('gh pr merge 1901 --squash --match-head-commit=1578b0a0');
  assert.equal(v.block, false);
  assert.equal(v.reason, 'guarded');
});

test('ALLOW arm: --auto is EXEMPT (TL ruling t/3270#2)', () => {
  const v = mergeGuardVerdict('gh pr merge 1901 --auto --squash');
  assert.equal(v.block, false);
  assert.equal(v.reason, 'auto-exempt');
});

test('NO-OP: a non-merge command is never blocked', () => {
  for (const c of ['gh pr view 1901 --json headRefOid', 'git status', 'gh pr checks 1901', 'ls -la']) {
    const v = mergeGuardVerdict(c);
    assert.equal(v.block, false, `should not fire on: ${c}`);
    assert.equal(v.reason, 'not-a-merge');
  }
});

test('robustness: gh.exe (win32 fleet) is matched', () => {
  assert.equal(mergeGuardVerdict('gh.exe pr merge 1901 --squash').block, true);
  assert.equal(mergeGuardVerdict('gh.exe pr merge 1901 --squash --match-head-commit=abc').block, false);
});

test('robustness: flag ordering — head flag before the PR number', () => {
  const v = mergeGuardVerdict('gh pr merge --match-head-commit abcdef0 --squash 1901');
  assert.equal(v.block, false);
});

test('robustness: --auto exempt regardless of flag order / trailing position', () => {
  assert.equal(mergeGuardVerdict('gh pr merge 1901 --squash --auto').block, false);
});

test('edge: a bare --match-head-commit with NO value does NOT count as guarded (still blocks)', () => {
  // A value-less flag would be a malformed merge; must not pass the guard.
  const v = mergeGuardVerdict('gh pr merge 1901 --squash --match-head-commit');
  assert.equal(v.block, true);
  assert.equal(v.reason, 'missing-match-head-commit');
});

test('edge: empty / undefined command is a no-op', () => {
  assert.equal(mergeGuardVerdict('').block, false);
  assert.equal(mergeGuardVerdict(undefined).block, false);
});

// --- CLI shim: prove the RUNTIME the feedback rule invokes (test==runtime, TL GV t/3270#4) ---

test('CLI shim: BLOCKs (emits "fire") on a manual merge missing the flag', () => {
  assert.equal(runShim('gh pr merge 1901 --squash'), 'fire');
});

test('CLI shim: ALLOWs (no output) on a guarded merge — both flag forms', () => {
  assert.equal(runShim('gh pr merge 1901 --squash --match-head-commit 1578b0a0'), '');
  assert.equal(runShim('gh pr merge 1901 --squash --match-head-commit=1578b0a0'), '');
});

test('CLI shim: ALLOWs --auto (exempt) and non-merge commands', () => {
  assert.equal(runShim('gh pr merge 1901 --auto'), '');
  assert.equal(runShim('gh pr view 1901 --json headRefOid'), '');
});

// ── t/3318: auto-merge-on-joint-GV guard (TL gate design t/3318#1) ──
// The pure predicate is the both-arms unit under test; the label lookup (fetch shim) is impure and
// proven by the real fire-drill (labeled test PR + --auto → blocks). Here we prove the 4-combo truth
// table + the command parsers, and the CLI --jointgv mode's gh-free early-exits.

test('jointGv BLOCK arm: --auto + joint-gv label → block', () => {
  const v = jointGvAutoMergeVerdict({ isAutoMerge: true, isJointGvLabeled: true });
  assert.equal(v.block, true);
  assert.equal(v.reason, 'auto-merge-on-joint-gv');
});

test('jointGv ALLOW arm: --auto + NOT labeled → allow (solo draft may auto-merge)', () => {
  const v = jointGvAutoMergeVerdict({ isAutoMerge: true, isJointGvLabeled: false });
  assert.equal(v.block, false);
  assert.equal(v.reason, 'auto-merge-unlabeled-ok');
});

test('jointGv ALLOW arm: manual (no --auto) + joint-gv label → allow (manual co-merge is the intent)', () => {
  const v = jointGvAutoMergeVerdict({ isAutoMerge: false, isJointGvLabeled: true });
  assert.equal(v.block, false);
  assert.equal(v.reason, 'not-auto-merge');
});

test('jointGv ALLOW arm: manual + not labeled → allow', () => {
  const v = jointGvAutoMergeVerdict({ isAutoMerge: false, isJointGvLabeled: false });
  assert.equal(v.block, false);
  assert.equal(v.reason, 'not-auto-merge');
});

test('isAutoMergeCommand: true only for a `gh pr merge` carrying --auto', () => {
  assert.equal(isAutoMergeCommand('gh pr merge 1947 --auto --squash'), true);
  assert.equal(isAutoMergeCommand('gh pr merge 1947 --squash --auto'), true);
  assert.equal(isAutoMergeCommand('gh.exe pr merge --auto'), true);
  assert.equal(isAutoMergeCommand('gh pr merge 1947 --squash'), false); // manual
  assert.equal(isAutoMergeCommand('gh pr view 1947 --json labels'), false); // not a merge
  assert.equal(isAutoMergeCommand('gh pr merge 1947 --squash --auto-delete'), false); // not the --auto flag
});

test('parsePrRef: numeric id, pull URL, else null (→ current branch)', () => {
  assert.equal(parsePrRef('gh pr merge 1947 --auto'), '1947');
  assert.equal(parsePrRef('gh pr merge https://github.com/jpsnover/ai-triad-research/pull/1947 --auto'),
    'https://github.com/jpsnover/ai-triad-research/pull/1947');
  assert.equal(parsePrRef('gh pr merge --auto --squash'), null); // no ref → gh uses current branch
  // a --match-head-commit value is never mistaken for the ref (leading-position only)
  assert.equal(parsePrRef('gh pr merge --match-head-commit deadbeef --squash 1947'), null);
});

// CLI --jointgv mode: the gh-free early-exits are deterministic (no PR lookup performed).
function runShimJointGv(command) {
  return execFileSync(process.execPath, [MODULE, '--jointgv', command], { encoding: 'utf8' });
}

test('CLI --jointgv: no gh call + no fire on a MANUAL merge (not --auto)', () => {
  assert.equal(runShimJointGv('gh pr merge 1947 --squash --match-head-commit abc'), '');
});

test('CLI --jointgv: no gh call + no fire on a non-merge command', () => {
  assert.equal(runShimJointGv('gh pr view 1947 --json labels'), '');
});

// ── buildMergeGuardSinkRecord: durable telemetry record shape (t/3395) ──
// The platform telemetry writer is dead (t/3394#2); the shim appends these records so merge-guard
// fires/allows — especially the jointgv fail-CLOSED block — stay observable.

test('sink record: head-guard BLOCK (missing --match-head-commit) → decision=block + command captured', () => {
  const cmd = 'gh pr merge 2059 --squash';
  const r = buildMergeGuardSinkRecord({
    nowIso: '2026-09-07T20:00:00.000Z', mode: 'head-guard', command: cmd,
    verdict: mergeGuardVerdict(cmd), failClosed: false,
  });
  assert.equal(r.gate, 'merge-guard');
  assert.equal(r.mode, 'head-guard');
  assert.equal(r.decision, 'block');
  assert.equal(r.reason, 'missing-match-head-commit');
  assert.equal(r.failClosed, false);
  assert.equal(r.command, cmd);
});

test('sink record: head-guard ALLOW (guarded merge) → decision=allow', () => {
  const cmd = 'gh pr merge 2059 --squash --match-head-commit abc123';
  const r = buildMergeGuardSinkRecord({ nowIso: 'x', mode: 'head-guard', command: cmd, verdict: mergeGuardVerdict(cmd) });
  assert.equal(r.decision, 'allow');
  assert.equal(r.reason, 'guarded');
});

test('sink record: jointgv fail-CLOSED block → decision=block, failClosed=true (the high-value event)', () => {
  const r = buildMergeGuardSinkRecord({
    nowIso: 'x', mode: 'jointgv', command: 'gh pr merge 1947 --auto',
    verdict: { block: true, reason: 'failclosed-unverifiable' }, failClosed: true,
  });
  assert.equal(r.mode, 'jointgv');
  assert.equal(r.decision, 'block');
  assert.equal(r.reason, 'failclosed-unverifiable');
  assert.equal(r.failClosed, true);
});

test('sink record: jointgv verified block (labeled joint-gv) → decision=block, failClosed=false', () => {
  const r = buildMergeGuardSinkRecord({
    nowIso: 'x', mode: 'jointgv', command: 'gh pr merge 1947 --auto',
    verdict: jointGvAutoMergeVerdict({ isAutoMerge: true, isJointGvLabeled: true }), failClosed: false,
  });
  assert.equal(r.decision, 'block');
  assert.equal(r.reason, 'auto-merge-on-joint-gv');
  assert.equal(r.failClosed, false);
});

test('sink record: command is truncated to 300 chars; empty args never throw', () => {
  const long = `gh pr merge 1 ${'x'.repeat(500)}`;
  const r = buildMergeGuardSinkRecord({ nowIso: 'x', mode: 'head-guard', command: long, verdict: { block: false, reason: 'guarded' } });
  assert.equal(r.command.length, 300);
  const empty = buildMergeGuardSinkRecord();
  assert.equal(empty.decision, 'allow');
  assert.equal(empty.command, null);
  assert.equal(empty.gate, 'merge-guard');
});
