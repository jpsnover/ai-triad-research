// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Shared conformance corpus consumer — TS side (t/3656, SO condition 4 of t/3557).
// Reads lib/ai-config/modelLiteralLint.conformance.json and asserts the TS resolution predicate against
// it. tests/ModelLiteralLint.Tests.ps1 reads the SAME file and asserts the PS predicate. One corpus, two
// gates — the forcing function that turns "same predicate" from a claim into a test. See the corpus
// `_doc` for the layer contract; only the `resolution` layer is wired today (marker = t/3557 cond-1
// future contract; registry = loader/guard level, not this pure predicate).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { findModelLiterals, lintModelLiterals } from './modelLiteralLint.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_PATH = path.join(__dirname, 'modelLiteralLint.conformance.json');

type Layer = 'resolution' | 'marker' | 'registry';
type Verdict = 'pass' | 'fail' | 'error';
interface ConformanceCase {
  name: string;
  layer: Layer;
  id: string;
  marker: string | null;
  registeredIds: string[];
  registryState: 'ok' | 'empty' | 'unreadable';
  expect: Verdict;
  reason: string;
}
interface Corpus {
  schemaVersion: number;
  cases: ConformanceCase[];
}

const corpus: Corpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf-8'));
const resolutionCases = corpus.cases.filter((c) => c.layer === 'resolution');
const deferredCases = corpus.cases.filter((c) => c.layer !== 'resolution');

describe('model-literal lint — shared conformance corpus (t/3656)', () => {
  it('CORPUS guard: schemaVersion is 1 and the case set is non-empty', () => {
    expect(corpus.schemaVersion).toBe(1);
    expect(corpus.cases.length).toBeGreaterThan(0);
  });

  it('CORPUS guard: every resolution case id extracts exactly once (no vacuous pass on a fail case)', () => {
    // A resolution "fail" case reads its verdict from offender COUNT; if the extractor silently found
    // nothing, a fail case would report zero offenders and read as a false pass. Pin extraction first.
    for (const c of resolutionCases) {
      const hits = findModelLiterals({ path: `${c.name}.ts`, content: `const m = '${c.id}';` });
      expect(hits.map((h) => h.id), `case ${c.name}: id '${c.id}' must extract exactly once`).toEqual([c.id]);
    }
  });

  it.each(resolutionCases)('resolution/$name -> $expect ($reason)', (c) => {
    const validIds = new Set(c.registeredIds);
    const offenders = lintModelLiterals([{ path: `${c.name}.ts`, content: `const m = '${c.id}';` }], validIds);
    if (c.expect === 'pass') {
      expect(offenders, offenders.map((o) => o.message).join('\n')).toEqual([]);
    } else {
      // resolution layer only ever declares pass|fail; a stray 'error' here is a corpus authoring bug.
      expect(c.expect, `resolution case ${c.name} must declare pass|fail, not '${c.expect}'`).toBe('fail');
      expect(offenders).toHaveLength(1);
      expect(offenders[0].id).toBe(c.id);
    }
  });

  // VISIBLE staging (PowerShell note 1, t/3656#2): marker + registry rows are SKIPPED, not silently
  // passed, so the corpus's own report shows what is not yet enforced. Do NOT delete these — flip
  // skip->assert as the layers land:
  //   - marker (5-8): the t/3557 cond-1 future contract. The current lintModelLiterals treats ANY line
  //     containing 'model-lint:allow' as suppressed (line-contains), so it CANNOT yet distinguish
  //     allow-pin / allow-external / bare-allow or catch the pin-on-registered contradiction — bare-allow
  //     and pin-on-registered would both wrongly pass. Wire these when cond-1 lands the structured parser.
  //   - registry (9): loader/guard level (the caller's empty/unreadable guard), not this pure predicate.
  it.skip.each(deferredCases)('PENDING t/3557 cond-1 — $layer/$name -> $expect', () => {
    /* intentionally skipped — see the block comment above */
  });
});
