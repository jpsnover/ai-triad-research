// .github/scripts/complexity-tickets.test.mjs
// Author-run: `node --test .github/scripts/complexity-tickets.test.mjs`
// (matches the check-lockfile-overrides.test.mjs convention: node:test, not CI-wired.)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  issueTitle, pathFromTitle, offendersFromBaseline, rankOffenders, violationsFromEslint,
  violationsFromPs, groupByPath, readReports, reportBody, newIssueBody, BASELINES, loadOffenders,
  alreadyRecorded,
} from './complexity-tickets.mjs'

const ROOT = '/repo'

test('issue title round-trips to the file path', () => {
  const p = 'taxonomy-editor/src/server/routes/ai.ts'
  assert.equal(pathFromTitle(issueTitle(p)), p)
  assert.equal(pathFromTitle('Some other issue'), null)
})

test('baseline rows are prefixed with their root and skip __meta__', () => {
  const rows = offendersFromBaseline(
    { __meta__: { threshold: 15 }, 'src/a.ts': { max: 20, countOver: 2 } },
    { root: 'taxonomy-editor', lang: 'TypeScript' })
  assert.deepEqual(rows, [{ path: 'taxonomy-editor/src/a.ts', lang: 'TypeScript', max: 20, countOver: 2 }])
})

test('ranking: max desc, then countOver desc', () => {
  const ranked = rankOffenders([
    { path: 'a', max: 20, countOver: 1 }, { path: 'b', max: 30, countOver: 1 }, { path: 'c', max: 20, countOver: 3 },
  ])
  assert.deepEqual(ranked.map(r => r.path), ['b', 'c', 'a'])
})

test('ESLint: only budget BREACHES become violations, never config errors or other rules', () => {
  const results = [{
    filePath: '/repo/taxonomy-editor/src/server/routes/diagnostics.ts',
    messages: [
      { ruleId: 'local/complexity-budget', messageId: 'maxExceeded', message: 'File complexity max 20 exceeds baseline max 16.' },
      { ruleId: 'local/complexity-budget', messageId: 'baselineLoadError', message: 'Could not load baseline' },
      { ruleId: 'complexity', messageId: 'complex', message: 'Arrow function has a complexity of 20.' },
    ],
  }]
  assert.deepEqual(violationsFromEslint(results, ROOT), [
    { path: 'taxonomy-editor/src/server/routes/diagnostics.ts', detail: 'File complexity max 20 exceeds baseline max 16.' },
  ])
})

test('PS: regression and new-offender rows map to repo-relative paths', () => {
  const v = violationsFromPs({ root: 'scripts', violations: [
    { File: 'AITriad\\Public\\X.ps1', Reason: 'regression', Observed: { max: 30, countOver: 2 }, Baseline: { max: 25, countOver: 2 } },
    { File: 'New.ps1', Reason: 'new-offender', Observed: { max: 18, countOver: 1 }, Baseline: null },
  ] })
  assert.equal(v[0].path, 'scripts/AITriad/Public/X.ps1')
  assert.match(v[0].detail, /max 30 .* exceeds baseline max 25/)
  assert.match(v[1].detail, /not in baseline/)
})

test('two messages for one file collapse into one issue with both details', () => {
  const grouped = groupByPath([
    { path: 'f.ts', detail: 'max' }, { path: 'f.ts', detail: 'countOver' }, { path: 'f.ts', detail: 'max' },
  ])
  assert.deepEqual(grouped, [{ path: 'f.ts', details: ['max', 'countOver'] }])
})

test('readReports reads both report shapes and skips junk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cxt-'))
  try {
    writeFileSync(join(dir, 'eslint-poviewer.json'), JSON.stringify([{ filePath: '/repo/poviewer/src/a.ts', messages: [
      { ruleId: 'local/complexity-budget', messageId: 'overThreshold', message: 'over' }] }]))
    writeFileSync(join(dir, 'ps-scripts.json'), JSON.stringify({ root: 'scripts', violations: [
      { File: 'b.ps1', Reason: 'new-offender', Observed: { max: 16, countOver: 1 } }] }))
    writeFileSync(join(dir, 'broken.json'), '{not json')
    const paths = readReports(dir, ROOT).map(v => v.path).sort()
    assert.deepEqual(paths, ['poviewer/src/a.ts', 'scripts/b.ps1'])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('report: per-language tables capped at top N, linking open refactor issues', () => {
  const rows = [
    { path: 'taxonomy-editor/src/a.ts', lang: 'TypeScript', max: 18, countOver: 2 },
    { path: 'scripts/b.ps1', lang: 'PowerShell', max: 90, countOver: 1 },
    { path: 'scripts/c.ps1', lang: 'PowerShell', max: 80, countOver: 1 },
  ]
  const body = reportBody(rows, { top: 1, date: '2026-10-06',
    refactorIssues: [{ number: 7, title: issueTitle('scripts/b.ps1') }] })
  assert.match(body, /\*\*3\*\* files over threshold: taxonomy-editor 1, scripts 2/)
  assert.match(body, /### PowerShell: top 1 of 2/)
  assert.match(body, /`scripts\/b\.ps1` \| 90 \| 1 \| #7 \|/)
  assert.doesNotMatch(body, /c\.ps1/)
  // A low-max TypeScript file still surfaces despite much larger PowerShell maxima.
  assert.match(body, /### TypeScript: top 1 of 1[\s\S]*`taxonomy-editor\/src\/a\.ts`/)
})

test('new issue body says whether the file is already baselined', () => {
  const ctx = { pr: '2847', runUrl: 'https://x/run', sha: 'abc' }
  assert.match(newIssueBody({ path: 'f.ts', details: ['d'] }, { max: 16, countOver: 1 }, ctx), /Recorded on main: max \*\*16\*\*/)
  assert.match(newIssueBody({ path: 'f.ts', details: ['d'] }, undefined, ctx), /new over-threshold file/)
  assert.match(newIssueBody({ path: 'f.ts', details: ['d'] }, undefined, ctx), /PR #2847 \(\[run\]\(https:\/\/x\/run\)\)/)
})

test('a PR already named on the issue is not recorded twice; other PRs and pushes are', () => {
  const texts = ['`f.ts` hit the complexity budget in PR #2847 ([run](u)):', 'Hit the budget again in PR #2900:']
  assert.equal(alreadyRecorded(texts, { pr: '2847' }), true)
  assert.equal(alreadyRecorded(texts, { pr: '2900' }), true)
  assert.equal(alreadyRecorded(texts, { pr: '284' }), false, 'PR #284 must not match PR #2847')
  assert.equal(alreadyRecorded(texts, { pr: '' }), false, 'pushes to main are always recorded')
})

test('every configured baseline exists in this checkout (catches a moved baseline)', () => {
  const repoRoot = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
  const rows = loadOffenders(repoRoot, BASELINES)
  assert.ok(rows.length > 0)
  for (const b of BASELINES) assert.ok(rows.some(r => r.path.startsWith(`${b.root}/`)) || b.root === 'operations',
    `${b.baseline} produced no rows`)
})
