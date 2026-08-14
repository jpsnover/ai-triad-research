// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { parseOpEdSet } from './schemas.js';

// ── Fixture helpers ────────────────────────────────────────────────────────────

function makeGrounding(overrides: Record<string, unknown> = {}) {
  return {
    node_id: 'saf-bel-001',
    label: 'AI is dangerous',
    category: 'Belief',
    pov: 'safetyist',
    relevance: '0.9100',
    how_reflected: 'cited in opening paragraph',
    ...overrides,
  };
}

function makeMember(overrides: Record<string, unknown> = {}) {
  return {
    pov: 'safetyist',
    status: 'complete',
    headline: 'Audits Are Overdue',
    subtitle: 'The safety case',
    body: 'Essay body text.',
    wordCount: 3,
    grounding: [makeGrounding()],
    ...overrides,
  };
}

function makeSet(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    set_id: 'set-abc-123',
    topic: 'Mandatory AI audits',
    params: { wordCount: 800, model: 'gemini-3.7-flash' },
    created_at: '2026-08-13T00:00:00.000Z',
    opeds: [makeMember()],
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('parseOpEdSet', () => {
  it('accepts a valid canonical OpEdSet', () => {
    const set = makeSet();
    expect(() => parseOpEdSet(set)).not.toThrow();
    const result = parseOpEdSet(set);
    expect(result.set_id).toBe('set-abc-123');
  });

  it('rejects short-code pov (acc/saf/skp) — names the offending field', () => {
    const bad = makeSet({ opeds: [makeMember({ pov: 'acc' })] });
    expect(() => parseOpEdSet(bad)).toThrow(/opeds\.0\.pov/);
  });

  it('rejects PascalCase grounding field (Id instead of node_id)', () => {
    const badGrounding = { Id: 'saf-bel-001', label: 'test', category: 'Belief', pov: 'safetyist', relevance: '0.9', how_reflected: 'used' };
    const bad = makeSet({ opeds: [makeMember({ grounding: [badGrounding] })] });
    expect(() => parseOpEdSet(bad)).toThrow();
  });

  it('accepts a partial set with complete + failed members (partial-set contract)', () => {
    const failedMember = makeMember({
      status: 'failed',
      headline: undefined,
      subtitle: undefined,
      body: undefined,
      wordCount: undefined,
      grounding: [],
    });
    const mixed = makeSet({ opeds: [makeMember(), failedMember] });
    expect(() => parseOpEdSet(mixed)).not.toThrow();
    const result = parseOpEdSet(mixed);
    expect(result.opeds).toHaveLength(2);
    expect(result.opeds[1].status).toBe('failed');
    expect(result.opeds[1].headline).toBe('');
  });

  it('rejects schema_version other than 1', () => {
    const bad = makeSet({ schema_version: 2 });
    expect(() => parseOpEdSet(bad)).toThrow();
  });
});
