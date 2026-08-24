// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const records: Array<Record<string, unknown>> = [];
vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: (e: Record<string, unknown>) => records.push(e) }),
}));

import { coerceSituationDivergence } from './coerceSituationDivergence';

beforeEach(() => { records.length = 0; });

describe('coerceSituationDivergence (t/3002)', () => {
  it('coerces a numeric string to a number and records a warning', () => {
    const f = { nodes: [{ id: 'sit-1', interpretation_divergence: '0.52' }] };
    coerceSituationDivergence(f);
    expect(f.nodes[0].interpretation_divergence).toBe(0.52);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ type: 'system.error', level: 'warn', component: 'situations-load' });
    expect(records[0].data).toMatchObject({ nodeId: 'sit-1', value: '0.52', action: 'coerced' });
  });

  it('strips a non-numeric string to undefined and records a warning naming the node + value', () => {
    const f = { nodes: [{ id: 'sit-2', interpretation_divergence: 'moderate' }] };
    coerceSituationDivergence(f);
    expect(f.nodes[0].interpretation_divergence).toBeUndefined();
    expect(records[0].data).toMatchObject({ nodeId: 'sit-2', value: 'moderate', action: 'stripped' });
  });

  it('treats an empty string as non-numeric (stripped, not coerced to 0)', () => {
    const f = { nodes: [{ id: 'sit-6', interpretation_divergence: '' }] };
    coerceSituationDivergence(f);
    expect(f.nodes[0].interpretation_divergence).toBeUndefined();
    expect(records[0].data).toMatchObject({ action: 'stripped' });
  });

  it('leaves a real number and absent/undefined values untouched, recording nothing', () => {
    const f = { nodes: [{ id: 'a', interpretation_divergence: 0.8 }, { id: 'b' }, { id: 'c', interpretation_divergence: undefined }] };
    coerceSituationDivergence(f);
    expect(f.nodes[0].interpretation_divergence).toBe(0.8);
    expect(records).toHaveLength(0);
  });

  it('passes non-situation input (null / no nodes array) through without throwing', () => {
    expect(() => coerceSituationDivergence(null)).not.toThrow();
    expect(coerceSituationDivergence({ foo: 1 })).toEqual({ foo: 1 });
    expect(records).toHaveLength(0);
  });
});
