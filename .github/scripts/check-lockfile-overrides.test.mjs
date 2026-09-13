// .github/scripts/check-lockfile-overrides.test.mjs
// Author-run: `node --test .github/scripts/check-lockfile-overrides.test.mjs`
// (matches the operations/devops/*.test.mjs predicate-test convention — these
//  node:test files are not CI-wired; they gate the author before the PR.)
//
// Covers t/3445: parseOverrides must SKIP YAML comment lines inside the
// overrides: block, so a colon-space comment (e.g. "# Transitive: sharp <- …")
// is not mis-parsed as a phantom override key (the t/3440 false-red).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseOverrides, diffOverrides } from './check-lockfile-overrides.mjs'

test('t/3445: colon-space comment inside overrides: is NOT parsed as an entry', () => {
  const yaml = [
    'overrides:',
    '  # Transitive: sharp <- @img/sharp bumped for CVE-xyz',
    '  sharp: 0.35.4',
    '  hono: 4.6.3',
    '',
    'packages:',
    '  - taxonomy-editor',
  ].join('\n')
  const parsed = parseOverrides(yaml, 'fixture')
  assert.deepEqual(parsed, { sharp: '0.35.4', hono: '4.6.3' })
  assert.ok(!('# Transitive' in parsed), 'comment must not appear as a key')
  assert.ok(!('Transitive' in parsed), 'comment content must not appear as a key')
})

test('t/3445 arm (a): a colon-comment does not create a phantom mismatch when overrides are in sync', () => {
  const ws = parseOverrides([
    'overrides:',
    '  # Transitive: sharp bump',
    '  sharp: 0.35.4',
  ].join('\n'), 'ws')
  const lf = parseOverrides([
    'overrides:',
    '  sharp: 0.35.4',   // standalone lockfile has no such comment
  ].join('\n'), 'lf')
  const { mismatches } = diffOverrides(ws, lf)
  assert.equal(mismatches.length, 0, 'comment-only difference must not red the gate')
})

test('t/3445 arm (b): a REAL override divergence still reds', () => {
  const ws = parseOverrides('overrides:\n  sharp: 0.35.4\n', 'ws')
  const lf = parseOverrides('overrides:\n  sharp: 0.35.3\n', 'lf')  // genuinely out of sync
  const { mismatches } = diffOverrides(ws, lf)
  assert.equal(mismatches.length, 1)
  assert.equal(mismatches[0].key, 'sharp')
  assert.equal(mismatches[0].workspace, '0.35.4')
  assert.equal(mismatches[0].lockfile, '0.35.3')
})

test('a missing key on one side is still reported', () => {
  const ws = parseOverrides('overrides:\n  sharp: 0.35.4\n  hono: 4.6.3\n', 'ws')
  const lf = parseOverrides('overrides:\n  sharp: 0.35.4\n', 'lf')
  const { mismatches } = diffOverrides(ws, lf)
  assert.equal(mismatches.length, 1)
  assert.equal(mismatches[0].key, 'hono')
  assert.equal(mismatches[0].lockfile, '(missing)')
})

test('quoted keys/values are stripped and match unquoted', () => {
  const ws = parseOverrides("overrides:\n  \"sharp\": '0.35.4'\n", 'ws')
  const lf = parseOverrides('overrides:\n  sharp: 0.35.4\n', 'lf')
  const { mismatches } = diffOverrides(ws, lf)
  assert.equal(mismatches.length, 0)
})
