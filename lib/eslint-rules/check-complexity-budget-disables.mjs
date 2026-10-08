// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Bypass guard for lib's complexity ratchet (t/3823 Phase 2, SO e/286#2 condition 2).
//
// ESLint honours inline directives silently: `/* eslint-disable local/complexity-budget */` (or a blanket
// `/* eslint-disable */`, or `/* eslint local/complexity-budget: off */`) drops a file out of the gate with
// no CI signal. This check refuses those directives in the gated population.
//
// It is a SEPARATE PROCESS on purpose, not an ESLint rule: a blanket `eslint-disable` would switch off a
// guard rule along with the gate, and no source comment can reach this script. It runs from lib's `lint`
// npm script (`eslint . && node eslint-rules/check-complexity-budget-disables.mjs`), so CI's lib-lint
// "Lint" step runs it with no workflow change.
//
// Refused, in non-test .ts/.tsx under lib/ (the population the gate covers):
//   - eslint-disable / -line / -next-line naming any rule ending in `complexity-budget`
//   - eslint-disable / -line / -next-line with NO rule list (blanket: it disables the gate too)
//   - an inline config comment `/* eslint <rule>: <severity> */` naming a rule ending in `complexity-budget`
//
// To RAISE a file's budget instead, see the raise path in lib/eslint.config.mjs (a reviewed hand edit of
// the baseline). The generator never raises a number.

import { readFileSync, readdirSync } from 'fs';
import { join, relative, extname, sep } from 'path';
import { pathToFileURL } from 'url';

const GATED_EXTS = new Set(['.ts', '.tsx']);
const SKIP_DIRS = new Set(['node_modules', 'dist', '__tests__', '.turbo']);
const isTestFile = (p) => /\.(test|spec)\.tsx?$/.test(p);

const COMMENT_RE = /\/\*([\s\S]*?)\*\/|\/\/([^\n]*)/g;
const DISABLE_RE = /^\s*eslint-disable(?:-next-line|-line)?(?=\s|$)([\s\S]*)$/;
const INLINE_CONFIG_RE = /^\s*eslint\s+([\s\S]+)$/;
const isBudgetRule = (name) => /(^|\/)complexity-budget$/.test(name.trim());

/**
 * The bypass directives in one file's source. Pure, for tests.
 * @param {string} source
 * @returns {{ line: number, directive: string, reason: string }[]}
 */
export function findBypasses(source) {
  const found = [];
  for (const m of source.matchAll(COMMENT_RE)) {
    const body = m[1] ?? m[2] ?? '';
    const line = source.slice(0, m.index).split('\n').length;
    const directive = (m[0].length > 120 ? `${m[0].slice(0, 117)}...` : m[0]).replace(/\s+/g, ' ');
    const disable = DISABLE_RE.exec(body);
    if (disable) {
      const rules = disable[1].split(/\s--\s|\s--$/)[0].split(',').map((r) => r.trim()).filter(Boolean);
      if (rules.length === 0) found.push({ line, directive, reason: 'blanket eslint-disable (switches off the complexity gate too)' });
      else if (rules.some(isBudgetRule)) found.push({ line, directive, reason: 'disables local/complexity-budget' });
      continue;
    }
    const inline = INLINE_CONFIG_RE.exec(body);
    if (inline && !/^\s*(env|globals?)\b/.test(inline[1])) {
      const names = inline[1].split(',').map((kv) => kv.split(':')[0]);
      if (names.some(isBudgetRule)) found.push({ line, directive, reason: 'reconfigures local/complexity-budget inline' });
    }
  }
  return found;
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) yield* walk(full); continue; }
    if (GATED_EXTS.has(extname(entry.name)) && !isTestFile(entry.name)) yield full;
  }
}

/** Scan `root` (lib/). Returns the violations, keyed by root-relative path. */
export function scan(root) {
  let files = 0;
  const violations = [];
  for (const file of walk(root)) {
    files++;
    for (const v of findBypasses(readFileSync(file, 'utf8'))) {
      violations.push({ file: relative(root, file).split(sep).join('/'), ...v });
    }
  }
  return { files, violations };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.argv[2] ?? process.cwd();
  const { files, violations } = scan(root);
  if (violations.length > 0) {
    for (const v of violations) console.error(`${v.file}:${v.line}  ${v.reason}: ${v.directive}`);
    console.error(`\ncomplexity-budget bypass check FAILED: ${violations.length} directive(s) in ${files} gated files.`);
    console.error('An inline disable silently removes a file from the complexity ratchet (SO e/286#2 C2).');
    console.error('To raise a budget, use the reviewed raise path in lib/eslint.config.mjs instead.');
    process.exit(1);
  }
  console.log(`complexity-budget bypass check passed: ${files} gated files, 0 bypass directives.`);
}
