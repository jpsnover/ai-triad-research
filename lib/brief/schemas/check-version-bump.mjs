#!/usr/bin/env node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Brief Export schema version-bump gate (t/2808).
//
// Under the forward-compatible IR (T1, Second Opinion e/109#2), the version-bump
// discipline is a SOCIAL rule the schema can't self-enforce: a `properties` change
// to any lib/brief/schemas/*.write.json with no version bump silently erodes the
// provenance guarantee (on-disk manifests would misreport which contract they were
// written under). This gate diffs the three write schemas against the PR base and
// fails when a contract change lands without bumping the schema's `$id` version.
//
// The version marker is the trailing `/<major>.<minor>` of each schema's `$id`
// (e.g. .../deck_spec/1.0). Additive-optional → bump minor; breaking → bump major.
//
// Config is co-located with the schemas (this file lives beside them). Pure logic
// is exported for unit tests; the CLI runner drives it against `git`.
//
// Usage: node lib/brief/schemas/check-version-bump.mjs [--mode=warn|block]
//   --mode=warn  (default) prints violations as GitHub warnings, exits 0.
//   --mode=block prints errors, exits 1 on any violation (promote here after a
//                green warn cycle — Gate Promotion, t/2808 AC).
// Base ref: $BASE_REF, else origin/$GITHUB_BASE_REF, else origin/main.

import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Pure logic (unit-tested) ────────────────────────────────────────────────

/** Non-contract keys stripped before comparing — editing these never needs a bump. */
const NON_CONTRACT_KEYS = new Set(['description', 'title', '$id', '$schema', '$comment']);

/** Extract `<major>.<minor>` from a schema's `$id`, or null if absent/malformed. */
export function schemaVersion(schema) {
  const id = schema && typeof schema['$id'] === 'string' ? schema['$id'] : '';
  const m = /\/(\d+)\.(\d+)(?:\.\d+)?$/.exec(id);
  return m ? `${m[1]}.${m[2]}` : null;
}

/** A stable, description-independent signature of the contract surface. */
export function contractSignature(schema) {
  return stableStringify(stripNonContract(schema));
}

/**
 * Classify a `git show <ref>:<path>` failure from its stderr.
 * @returns true iff the failure means the PATH is legitimately ABSENT at that ref
 *   (a new file at head → no prior contract, safe to treat as null). Returns false
 *   for every OTHER git failure — bad/missing ref, shallow-clone gap, git
 *   unavailable — which must NOT be swallowed as "new file" (that silently
 *   disables the gate; t/2808#2/#3).
 *
 * git's messages for an absent path (stable across versions):
 *   fatal: path 'X' does not exist in 'REF'
 *   fatal: path 'X' exists on disk, but not in 'REF'
 */
export function isPathAbsentError(stderr) {
  return /does not exist in|exists on disk, but not in/i.test(String(stderr ?? ''));
}

function stripNonContract(value) {
  if (Array.isArray(value)) return value.map(stripNonContract);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (NON_CONTRACT_KEYS.has(k)) continue;
      out[k] = stripNonContract(v);
    }
    return out;
  }
  return value;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Decide whether a single schema's change is a violation.
 * @returns {null | {file, baseVersion, headVersion, reason}} null = OK.
 */
export function detectViolation(file, baseSchema, headSchema) {
  if (baseSchema == null) return null;          // new schema file — no prior contract
  if (headSchema == null) return null;          // deleted schema — not this gate's concern
  if (contractSignature(baseSchema) === contractSignature(headSchema)) return null; // no contract change
  const baseVersion = schemaVersion(baseSchema);
  const headVersion = schemaVersion(headSchema);
  if (baseVersion !== null && baseVersion === headVersion) {
    return {
      file,
      baseVersion,
      headVersion,
      reason: 'contract surface (properties/required/enum/pattern/type) changed without bumping the schema $id version',
    };
  }
  return null; // contract changed AND version bumped (or version marker is new) → OK
}

// ── CLI runner ──────────────────────────────────────────────────────────────

function parseSchema(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function baseRef() {
  if (process.env.BASE_REF) return process.env.BASE_REF;
  if (process.env.GITHUB_BASE_REF) return `origin/${process.env.GITHUB_BASE_REF}`;
  return 'origin/main';
}

/**
 * `git show <ref>:<path>` → text, or null iff the path is legitimately absent at
 * that ref (new file at head). ANY other git failure (bad ref, shallow-clone gap,
 * git unavailable) THROWS rather than returning null — swallowing it would treat a
 * broken diff as "new file → no prior contract" and silently pass the gate on
 * every schema (t/2808#2/#3). Loud failure is correct: in warn mode CI it surfaces
 * as a non-blocking red step; in block mode it fails the build instead of a
 * false-pass.
 */
function gitShow(ref, repoRelPath) {
  try {
    return execFileSync('git', ['show', `${ref}:${repoRelPath}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const stderr = String(err?.stderr ?? '');
    if (isPathAbsentError(stderr)) return null; // legit: absent at base → new file
    throw new Error(
      'schema version-bump gate: unable to read the base schema — refusing to treat ' +
      'this as a new file (that would silently disable the gate).\n' +
      `  Goal:       diff ${repoRelPath} against the PR base to require a version bump.\n` +
      `  Problem:    git show ${ref}:${repoRelPath} failed, and stderr is not "path absent at ref":\n` +
      `              ${stderr.trim() || (err && err.message) || 'unknown git error'}\n` +
      '  Location:   lib/brief/schemas/check-version-bump.mjs gitShow()\n' +
      `  Next steps: ensure the base is fetched (actions/checkout fetch-depth: 0) and ` +
      `BASE_REF/GITHUB_BASE_REF resolves to a real commit (currently "${ref}").`,
    );
  }
}

function repoRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
}

function main() {
  const mode = (process.argv.find(a => a.startsWith('--mode=')) ?? '--mode=warn').split('=')[1];
  const here = dirname(fileURLToPath(import.meta.url));
  const root = repoRoot();
  const ref = baseRef();

  const schemaFiles = readdirSync(here).filter(f => f.endsWith('.write.json')).sort();
  const violations = [];

  for (const name of schemaFiles) {
    const abs = join(here, name);
    const repoRel = relative(root, abs).split('\\').join('/');
    const head = parseSchema(readFileSync(abs, 'utf8'));
    const baseText = gitShow(ref, repoRel);
    const base = baseText === null ? null : parseSchema(baseText);
    const v = detectViolation(repoRel, base, head);
    if (v) violations.push(v);
  }

  if (violations.length === 0) {
    console.log(`schema version-bump gate: clean (${schemaFiles.length} schema(s) checked against ${ref}).`);
    process.exit(0);
  }

  const level = mode === 'block' ? 'error' : 'warning';
  for (const v of violations) {
    console.log(
      `::${level} file=${v.file}::${v.file} — ${v.reason}. ` +
      `Version is still ${v.headVersion}; bump the $id (minor for additive-optional, major for breaking).`,
    );
  }
  console.log(
    `\nschema version-bump gate: ${violations.length} violation(s) [mode=${mode}]. ` +
    (mode === 'block'
      ? 'Failing the build.'
      : 'Warn-only for now — promote to --mode=block after a green cycle (t/2808).'),
  );
  process.exit(mode === 'block' ? 1 : 0);
}

// Run only when invoked directly (not when imported by tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
