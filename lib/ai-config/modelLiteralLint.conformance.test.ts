// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Shared conformance corpus consumer — TS side (t/3656 corpus, t/3657 conditions 1+3 wired).
// Reads lib/ai-config/modelLiteralLint.conformance.json and asserts the TS predicate against it;
// tests/ModelLiteralLint.Tests.ps1 reads the SAME file and asserts the PS predicate. One corpus, two
// gates — the forcing function that turns "same predicate" from a claim into a test.
//   - resolution: end-to-end via lintModelLiterals (extract + resolve).
//   - marker:     via classifyLiteral(parseMarker(...)) — the marker+resolution verdict, decoupled from
//                 extraction on purpose (the two gates' extraction regexes differ by design, t/3560).
//   - registry:   via assertModelRegistryUsable — the loader/guard-level discrimination (condition 3).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import {
  findModelLiterals,
  lintModelLiterals,
  classifyLiteral,
  parseMarker,
  assertModelRegistryUsable,
} from './modelLiteralLint.js';

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
const markerCases = corpus.cases.filter((c) => c.layer === 'marker');
const registryCases = corpus.cases.filter((c) => c.layer === 'registry');

describe('model-literal lint — shared conformance corpus (t/3656 + t/3657)', () => {
  it('CORPUS guard: schemaVersion is 1, non-empty, and every layer has cases (no silent under-coverage)', () => {
    expect(corpus.schemaVersion).toBe(1);
    expect(corpus.cases.length).toBeGreaterThan(0);
    // Each layer must be populated — a zeroed layer would make its it.each vacuous (0 tests, still green).
    expect(resolutionCases.length, 'resolution cases').toBeGreaterThan(0);
    expect(markerCases.length, 'marker cases').toBeGreaterThan(0);
    expect(registryCases.length, 'registry cases').toBeGreaterThan(0);
  });

  it('CORPUS guard: every resolution case id extracts exactly once (no vacuous pass on a fail case)', () => {
    for (const c of resolutionCases) {
      const hits = findModelLiterals({ path: `${c.name}.ts`, content: `const m = '${c.id}';` });
      expect(hits.map((h) => h.id), `case ${c.name}: id '${c.id}' must extract exactly once`).toEqual([c.id]);
    }
  });

  // ── resolution: end-to-end (extract + resolve) ─────────────────────────────────────────────────
  it.each(resolutionCases)('resolution/$name -> $expect ($reason)', (c) => {
    const validIds = new Set(c.registeredIds);
    const offenders = lintModelLiterals([{ path: `${c.name}.ts`, content: `const m = '${c.id}';` }], validIds);
    if (c.expect === 'pass') {
      expect(offenders, offenders.map((o) => o.message).join('\n')).toEqual([]);
    } else {
      expect(c.expect, `resolution case ${c.name} must declare pass|fail, not '${c.expect}'`).toBe('fail');
      expect(offenders).toHaveLength(1);
      expect(offenders[0].id).toBe(c.id);
    }
  });

  // ── marker: the typed-marker + resolution verdict, decoupled from extraction (t/3657 condition 1) ──
  it.each(markerCases)('marker/$name -> $expect ($reason)', (c) => {
    const validIds = new Set(c.registeredIds);
    const marker = c.marker === null ? null : parseMarker(c.marker);
    const verdict = classifyLiteral(c.id, marker, validIds);
    const clean = verdict === 'ok' || verdict === 'exempt';
    if (c.expect === 'pass') {
      expect(clean, `expected clean (ok|exempt) for ${c.name}, got '${verdict}'`).toBe(true);
    } else {
      expect(c.expect, `marker case ${c.name} must declare pass|fail, not '${c.expect}'`).toBe('fail');
      expect(clean, `expected an offender verdict for ${c.name}, got '${verdict}'`).toBe(false);
    }
  });

  // ── registry: loader/guard-level discrimination — empty/unreadable is NOT "unregistered" (condition 3) ──
  it.each(registryCases)('registry/$name -> $expect ($reason)', (c) => {
    expect(c.expect, `registry case ${c.name} must declare 'error'`).toBe('error');
    // empty/unreadable registry → the guard fires with a message that names the INFRA cause, so the
    // next person does not hunt a literal that was never the problem.
    let thrown: unknown;
    try {
      assertModelRegistryUsable(new Set(c.registeredIds));
    } catch (e) {
      thrown = e;
    }
    expect(thrown, `assertModelRegistryUsable must throw for registryState='${c.registryState}'`).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/infrastructure condition/i);
  });
});
