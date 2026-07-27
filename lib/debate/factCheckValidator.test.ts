// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import {
  validateFactCheckResult,
  resolveFactVerdict,
  isDiscrepancyComplete,
  PARTIALLY_ACCURATE_FALLBACK,
} from './factCheckValidator.js';
import { FACT_VERDICTS, normalizeVerdict, type FactVerdict } from './types/factVerdict.js';
import type { FactDiscrepancy } from './types/synthesis.js';
import { factCheckPrompt } from './prompts/synthesis.js';

const fullDiscrepancy = (over: Partial<FactDiscrepancy> = {}): FactDiscrepancy => ({
  dimension: 'magnitude',
  claimed: '12 states',
  actual: '10 states',
  source: 'conflict-states-count',
  severity: 'minor',
  ...over,
});

describe('FactVerdict vocabulary (t/1715)', () => {
  it('has exactly the five approved values', () => {
    expect([...FACT_VERDICTS]).toEqual([
      'supported', 'partially_accurate', 'disputed', 'false', 'unverifiable',
    ]);
  });

  it('factCheckPrompt names all five verdict values and the discrepancy fields (end-to-end)', () => {
    const prompt = factCheckPrompt('AI cut costs in 12 states', 'context', 'taxonomy nodes', '');
    for (const v of FACT_VERDICTS) expect(prompt).toContain(v);
    // discrepancy emission instructions
    for (const field of ['discrepancy', 'dimension', 'claimed', 'actual', 'source', 'severity']) {
      expect(prompt).toContain(field);
    }
    for (const dim of ['magnitude', 'temporal', 'attribution', 'scope', 'existence']) {
      expect(prompt).toContain(dim);
    }
  });

  it('validator accepts each verdict end-to-end (partially_accurate with a complete discrepancy)', () => {
    for (const v of FACT_VERDICTS) {
      const raw = v === 'partially_accurate'
        ? { verdict: v, explanation: 'x', discrepancy: fullDiscrepancy() }
        : { verdict: v, explanation: 'x' };
      expect(validateFactCheckResult(raw).verdict).toBe(v);
    }
  });
});

describe('anti-escape-hatch gate — partially_accurate requires a sourced discrepancy (t/1701 AC#3)', () => {
  it('REJECTS partially_accurate with NO discrepancy → falls back to unverifiable', () => {
    const r = validateFactCheckResult({ verdict: 'partially_accurate', explanation: 'mostly right' });
    expect(r.verdict).toBe(PARTIALLY_ACCURATE_FALLBACK);
    expect(r.verdict).toBe('unverifiable');
    expect(r.discrepancy).toBeUndefined();
  });

  it.each(['claimed', 'actual', 'source'] as const)(
    'REJECTS partially_accurate when discrepancy is missing %s',
    (missing) => {
      const disc = fullDiscrepancy({ [missing]: '' });
      const r = validateFactCheckResult({ verdict: 'partially_accurate', explanation: 'x', discrepancy: disc });
      expect(r.verdict).toBe('unverifiable');
      expect(r.discrepancy).toBeUndefined();
    },
  );

  it('resolveFactVerdict keeps partially_accurate only with a complete discrepancy', () => {
    expect(resolveFactVerdict('partially_accurate', fullDiscrepancy())).toBe('partially_accurate');
    expect(resolveFactVerdict('partially_accurate', undefined)).toBe('unverifiable');
    expect(resolveFactVerdict('partially_accurate', fullDiscrepancy({ source: '   ' }))).toBe('unverifiable');
    // other verdicts pass through untouched
    expect(resolveFactVerdict('supported', undefined)).toBe('supported');
    expect(resolveFactVerdict('false', undefined)).toBe('false');
  });

  it('isDiscrepancyComplete requires all three of claimed/actual/source non-empty', () => {
    expect(isDiscrepancyComplete(fullDiscrepancy())).toBe(true);
    expect(isDiscrepancyComplete(fullDiscrepancy({ claimed: '' }))).toBe(false);
    expect(isDiscrepancyComplete(fullDiscrepancy({ actual: '  ' }))).toBe(false);
    expect(isDiscrepancyComplete(undefined)).toBe(false);
  });
});

describe('verified→supported read-time alias shim (t/1715 AC#3)', () => {
  it('normalizeVerdict maps legacy verified to supported', () => {
    expect(normalizeVerdict('verified')).toBe('supported');
  });

  it('passes through the canonical verdicts and the pending lifecycle state unchanged', () => {
    for (const v of [...FACT_VERDICTS, 'pending'] as (FactVerdict | 'pending')[]) {
      expect(normalizeVerdict(v)).toBe(v);
    }
  });

  it('validateFactCheckResult normalizes a legacy verified verdict to supported', () => {
    expect(validateFactCheckResult({ verdict: 'verified', explanation: 'x' }).verdict).toBe('supported');
  });

  it('unrecognized verdict falls back to unverifiable (existing parse-failure default)', () => {
    expect(validateFactCheckResult({ verdict: 'totally-made-up' }).verdict).toBe('unverifiable');
    expect(validateFactCheckResult({}).verdict).toBe('unverifiable');
  });
});

describe('12-vs-10 worked example (t/1715 AC#4)', () => {
  it('classifies as partially_accurate with a magnitude discrepancy', () => {
    const raw = {
      verdict: 'partially_accurate',
      explanation: 'The states did do X (core supported); the count is off by two.',
      discrepancy: {
        dimension: 'magnitude',
        claimed: '12 states',
        actual: '10 states',
        source: 'conflict-states-count',
        severity: 'minor',
      },
      sources: [{ conflict_id: 'conflict-states-count' }],
    };
    const r = validateFactCheckResult(raw);
    expect(r.verdict).toBe('partially_accurate');
    expect(r.discrepancy).toEqual({
      dimension: 'magnitude',
      claimed: '12 states',
      actual: '10 states',
      source: 'conflict-states-count',
      severity: 'minor',
    });
  });
});
