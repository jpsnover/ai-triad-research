#!/usr/bin/env node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Write-only-downward complexity baseline generator (t/3821).
// Usage: node generate-complexity-baseline.mjs --root <dir> --baseline <file> [--threshold <N>]
//
// Write-only-downward semantics (corrected per TL t/3821#2):
//   WRITE if observed.max <= existing.max && observed.countOver <= existing.countOver (Pareto)
//   WRITE if observed.max <  existing.max  (decomposition — max strictly down, countOver may rise)
//   KEEP  otherwise (regression — existing entry unchanged)
// This ensures the baseline always describes a state the tree actually passed through.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, relative, extname } from 'path';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { parseArgs } from 'node:util';
import { isAcceptable } from './complexity-budget-predicate.js';

const { values: args } = parseArgs({
  options: {
    root:      { type: 'string' },
    baseline:  { type: 'string' },
    threshold: { type: 'string', default: '15' },
  },
  strict: true,
});

if (!args.root || !args.baseline) {
  console.error('Usage: node generate-complexity-baseline.mjs --root <dir> --baseline <file> [--threshold <N>]');
  process.exit(1);
}

const ROOT      = args.root;
const BASELINE  = args.baseline;
const THRESHOLD = parseInt(args.threshold, 10);
const TS_EXTS   = new Set(['.ts', '.tsx']);
const JS_EXTS   = new Set(['.js', '.jsx', '.mjs', '.cjs']);

/** Recursively enumerate TS/JS source files, skipping node_modules and hidden dirs. */
function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      const ext = extname(entry.name);
      if (TS_EXTS.has(ext) || JS_EXTS.has(ext)) yield full;
    }
  }
}

/**
 * Measure per-function cyclomatic complexities using ESLint's built-in `complexity` rule.
 * The built-in is authoritative; our rule mirrors its node set — the drift test verifies parity.
 *
 * @param {string} code
 * @param {string} filename
 * @returns {number[]}
 */
function measureComplexities(code, filename) {
  const linter = new Linter({ configType: 'flat' });
  const isTs = TS_EXTS.has(extname(filename));
  /** @type {import('eslint').Linter.Config} */
  const config = {
    rules: { complexity: ['error', { max: 0 }] },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      ...(isTs ? { parser: tseslint.parser } : {}),
    },
  };
  const messages = linter.verify(code, config, { filename });
  return messages
    .filter((m) => m.ruleId === 'complexity')
    .map((m) => {
      const match = m.message.match(/complexity of (\d+)/);
      return match ? parseInt(match[1], 10) : 1;
    });
}

/**
 * Compute file-level baseline entry from per-function complexities.
 * @param {number[]} complexities
 * @param {number} threshold
 * @returns {{ max: number; countOver: number } | null}
 */
function toEntry(complexities, threshold) {
  if (complexities.length === 0) return null;
  return {
    max: Math.max(...complexities),
    countOver: complexities.filter((c) => c > threshold).length,
  };
}

/**
 * Write-only-downward decision (t/3821#2 corrected semantics).
 * Returns true if the observed entry should replace the existing one.
 * Delegates to the shared isAcceptable predicate so rule and generator always agree.
 *
 * @param {{ max: number; countOver: number }} observed
 * @param {{ max: number; countOver: number } | undefined} existing
 */
function shouldWrite(observed, existing) {
  if (!existing) return true; // new file — always write
  return isAcceptable(observed, existing);
}

// ── Main ──────────────────────────────────────────────────────────────────────

/** @type {Record<string, { max: number; countOver: number }>} */
const existing = existsSync(BASELINE)
  ? JSON.parse(readFileSync(BASELINE, 'utf-8'))
  : {};

const updated = { ...existing };
let written = 0;
let kept    = 0;
let skipped = 0;

for (const absPath of walk(ROOT)) {
  const relKey = relative(ROOT, absPath).replace(/\\/g, '/');
  let code;
  try {
    code = readFileSync(absPath, 'utf-8');
  } catch {
    continue;
  }

  let complexities;
  try {
    complexities = measureComplexities(code, absPath);
  } catch {
    // Parse errors (e.g. syntax errors in source) — skip file
    skipped++;
    continue;
  }

  const observed = toEntry(complexities, THRESHOLD);
  if (!observed) {
    skipped++;
    continue; // no functions in file
  }

  if (shouldWrite(observed, existing[relKey])) {
    updated[relKey] = observed;
    written++;
  } else {
    kept++;
  }
}

writeFileSync(BASELINE, JSON.stringify(updated, null, 2) + '\n', 'utf-8');
console.log(`Baseline written: ${BASELINE}`);
console.log(`  updated: ${written}, kept (regression): ${kept}, skipped (no functions / parse error): ${skipped}`);
