#!/usr/bin/env node
// scripts/sync-standalone-lockfile.mjs
// Regenerates taxonomy-editor/pnpm-lock.yaml to match root pnpm-workspace.yaml overrides.
// Run after any change to the overrides: block in pnpm-workspace.yaml.
//
// Background: the Dockerfile prod-deps stage copies taxonomy-editor/pnpm-lock.yaml +
// root pnpm-workspace.yaml and runs pnpm install --prod --frozen-lockfile. If the
// standalone lockfile's overrides: block diverges from pnpm-workspace.yaml, pnpm
// aborts with ERR_PNPM_LOCKFILE_CONFIG_MISMATCH. A plain root `pnpm install` only
// regenerates the root pnpm-lock.yaml — this script handles the standalone one.
// (Three PRs rediscovered this the hard way: #478, #480, #485 — t/2185, t/2184.)

import { readFileSync, writeFileSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspaceContent = readFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8')

function extractOverridesBlock(yaml) {
  const lines = yaml.split('\n')
  const result = []
  let inOverrides = false
  for (const line of lines) {
    if (/^overrides:\s*$/.test(line)) {
      inOverrides = true
      result.push(line)
      continue
    }
    if (inOverrides) {
      if (line.length > 0 && !/^\s/.test(line)) break
      result.push(line)
    }
  }
  if (!inOverrides) throw new Error('No overrides: block found in pnpm-workspace.yaml')
  return result.join('\n').trimEnd() + '\n'
}

const overridesBlock = extractOverridesBlock(workspaceContent)
const tmpDir = mkdtempSync(join(tmpdir(), 'lockfile-sync-'))

try {
  writeFileSync(join(tmpDir, 'pnpm-workspace.yaml'), overridesBlock)
  copyFileSync(join(repoRoot, 'taxonomy-editor', 'package.json'), join(tmpDir, 'package.json'))
  copyFileSync(join(repoRoot, 'taxonomy-editor', 'pnpm-lock.yaml'), join(tmpDir, 'pnpm-lock.yaml'))
  execSync('pnpm install --lockfile-only', { cwd: tmpDir, stdio: 'inherit' })
  copyFileSync(join(tmpDir, 'pnpm-lock.yaml'), join(repoRoot, 'taxonomy-editor', 'pnpm-lock.yaml'))
  console.log('taxonomy-editor/pnpm-lock.yaml updated')
} finally {
  rmSync(tmpDir, { recursive: true, force: true })
}
