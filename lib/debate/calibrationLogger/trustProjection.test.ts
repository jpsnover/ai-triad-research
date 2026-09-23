// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { projectTrust, type RawMetric } from './trustProjection.js';

// ── Fixture helpers ──────────────────────────────────────────────────────────

function raw(metric: string, value = 0.5, displayValue?: string): RawMetric {
  return { metric, value, ...(displayValue !== undefined ? { displayValue } : {}) };
}

// ── Natural conclusion run ───────────────────────────────────────────────────

describe('projectTrust — natural conclusion', () => {
  it('trusts all metrics when terminationReason is undefined', () => {
    const entries = projectTrust([
      raw('convergence_score'),
      raw('claim_acceptance'),
      raw('repetition_rate'),
    ], undefined);
    expect(entries).toHaveLength(3);
    expect(entries.every(e => e.trust.verdict === 'trust')).toBe(true);
  });

  it('trusts convergence metrics on a natural run', () => {
    const entries = projectTrust([raw('convergence_score')], 'natural_conclusion');
    expect(entries[0]!.trust.verdict).toBe('trust');
  });

  it('trust reason references natural conclusion', () => {
    const entries = projectTrust([raw('claim_acceptance')], 'natural_conclusion');
    expect(entries[0]!.trust.reason.length).toBeGreaterThan(0);
  });
});

// ── Truncated run: convergence censoring ────────────────────────────────────

describe('projectTrust — truncated run (api_ceiling)', () => {
  const TRUNCATED_REASONS = ['max_iterations', 'situation_cap', 'api_ceiling'] as const;

  for (const reason of TRUNCATED_REASONS) {
    it(`censors convergence metrics on ${reason}`, () => {
      const entries = projectTrust([raw('convergence_score')], reason);
      expect(entries[0]!.trust.verdict).toBe('censored');
      expect(entries[0]!.trust.terminationReason).toBe(reason);
      expect(entries[0]!.trust.metricFamily).toBe('convergence');
    });
  }

  it('trusts non-convergence metrics on truncated run', () => {
    const entries = projectTrust([raw('debate_health_score')], 'api_ceiling');
    expect(entries[0]!.trust.verdict).toBe('trust');
  });

  it('trusts immune metric claim_acceptance on truncated run', () => {
    const entries = projectTrust([raw('claim_acceptance')], 'api_ceiling');
    expect(entries[0]!.trust.verdict).toBe('trust');
    expect(entries[0]!.trust.reason).toContain('immune');
  });

  it('trusts immune metric repetition_rate on truncated run', () => {
    const entries = projectTrust([raw('repetition_rate')], 'max_iterations');
    expect(entries[0]!.trust.verdict).toBe('trust');
  });

  it('trusts immune metric situation_crux_alignment on truncated run', () => {
    const entries = projectTrust([raw('situation_crux_alignment')], 'situation_cap');
    expect(entries[0]!.trust.verdict).toBe('trust');
  });
});

// ── TrustState.reason is mandatory ──────────────────────────────────────────

describe('projectTrust — TrustState.reason mandatory (ADR §6)', () => {
  it('every entry has a non-empty reason string', () => {
    const entries = projectTrust([
      raw('convergence_score'),
      raw('claim_acceptance'),
      raw('debate_health_score'),
    ], 'api_ceiling');
    expect(entries.every(e => e.trust.reason.length > 0)).toBe(true);
  });
});

// ── Output shape ─────────────────────────────────────────────────────────────

describe('projectTrust — output shape', () => {
  it('maps metric names and values through unchanged', () => {
    const input: RawMetric[] = [
      { metric: 'convergence_score', value: 0.72 },
      { metric: 'claim_acceptance', value: 0.88, displayValue: '72 / 84' },
    ];
    const entries = projectTrust(input, undefined);
    expect(entries[0]!.metric).toBe('convergence_score');
    expect(entries[0]!.value).toBe(0.72);
    expect(entries[1]!.displayValue).toBe('72 / 84');
  });

  it('omits displayValue when not provided', () => {
    const entries = projectTrust([raw('convergence_score', 0.5)], undefined);
    expect(entries[0]!.displayValue).toBeUndefined();
  });

  it('returns empty array for empty input', () => {
    expect(projectTrust([], undefined)).toEqual([]);
    expect(projectTrust([], 'api_ceiling')).toEqual([]);
  });

  it('preserves input order', () => {
    const metrics = ['a_metric', 'b_convergence', 'c_metric'].map(m => raw(m));
    const entries = projectTrust(metrics, 'api_ceiling');
    expect(entries.map(e => e.metric)).toEqual(['a_metric', 'b_convergence', 'c_metric']);
  });
});
