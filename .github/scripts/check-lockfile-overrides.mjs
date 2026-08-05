#!/usr/bin/env node
// .github/scripts/check-lockfile-overrides.mjs
// Fails CI if pnpm-workspace.yaml overrides: diverges from taxonomy-editor/pnpm-lock.yaml.
// Prevents ERR_PNPM_LOCKFILE_CONFIG_MISMATCH in the Dockerfile prod-deps stage (t/2188).
//
// Fix: node scripts/sync-standalone-lockfile.mjs

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function stripQuotes(s) { return s.replace(/^['"]|['"]$/g, '') }

function parseOverrides(content, label) {
  const lines = content.split('\n')
  const overrides = {}
  let inOverrides = false
  for (const line of lines) {
    if (/^overrides:\s*$/.test(line)) { inOverrides = true; continue }
    if (inOverrides) {
      if (line.length > 0 && !/^\s/.test(line)) break
      if (!line.trim()) continue
      const m = line.match(/^\s+(.+?)\s*:\s+(.+?)\s*$/)
      if (m) overrides[stripQuotes(m[1].trim())] = stripQuotes(m[2].trim())
    }
  }
  if (!inOverrides) { console.error(`no overrides: block in ${label}`); process.exit(1) }
  return overrides
}

const wsOverrides = parseOverrides(
  readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8'),
  'pnpm-workspace.yaml',
)
const lfOverrides = parseOverrides(
  readFileSync(join(root, 'taxonomy-editor', 'pnpm-lock.yaml'), 'utf8'),
  'taxonomy-editor/pnpm-lock.yaml',
)

const allKeys = new Set([...Object.keys(wsOverrides), ...Object.keys(lfOverrides)])
const mismatches = []
for (const key of allKeys) {
  const ws = wsOverrides[key]
  const lf = lfOverrides[key]
  if (ws !== lf) mismatches.push({ key, workspace: ws ?? '(missing)', lockfile: lf ?? '(missing)' })
}

if (mismatches.length > 0) {
  console.error('FAIL: pnpm-workspace.yaml overrides != taxonomy-editor/pnpm-lock.yaml overrides')
  console.error('Fix:  node scripts/sync-standalone-lockfile.mjs')
  console.error('')
  for (const { key, workspace, lockfile } of mismatches)
    console.error(`  ${key}:  workspace=${workspace}  lockfile=${lockfile}`)
  process.exit(1)
}

console.log(`OK: overrides in sync (${allKeys.size} entries)`)
