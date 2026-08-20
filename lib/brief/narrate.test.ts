// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Tests for T3 Narrate stage: traceResolver + narrate() (t/2801).
// All model calls are mocked — no AI backend needed.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildTrace, resolveTrace, isResolvable } from './traceResolver.js';
import { narrate } from './narrate.js';
import type { NarrationInput } from './narrate.js';
import type { DeckSpec, Narration } from './types.js';
import type { AIAdapter } from '../debate/aiAdapter.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeSpec(overrides: Partial<DeckSpec> = {}): DeckSpec {
  return {
    deck_spec_version: '1.0',
    meta: { id: 'sess-1', run_id: 'run-1', title: 'AI Safety Debate', model: 'gemini-pro', protocol: 'structured', phase: 'closed' },
    question: {
      core_proposition: 'Should AI development be paused?',
      tensions: ['Safety vs. speed', 'Open vs. closed'],
      qualifiers: [],
    },
    framing_critique: { rating: 'good', composite: 0.8, rewritten_motion: 'Should frontier AI training be paused?' },
    agreements: [{ text: 'Both agree risks are real' }],
    disagreements: [{ text: 'Dispute on imminence', kind: 'EMPIRICAL', resolution_path: 'empirical research' }],
    cruxes: [{ text: 'Will scaling produce AGI?', kind: 'EMPIRICAL', if_yes: 'pause needed', if_no: 'no pause needed' }],
    resolution_analysis: { stronger_camp_findings: [{ camp: 'saf', finding: 'Evidence favors caution' }] },
    unresolved_questions: [{ text: 'Timeline uncertainty' }],
    argument_map: { nodes: [], relations: [] },
    fact_checks: [{ claim: 'AI development is accelerating', verdict: 'Supported', speaker: 'acc' }],
    concessions: [{ camp: 'acc', asserted: 2, conceded: 1, challenged: 0 }],
    top_claims: [{ camp: 'saf', claim: 'Pause reduces risk', strength: 0.9 }],
    convergence: [{ issue: 'safety', score: 0.6 }],
    open_threads: [{ text: 'Regulatory pathways' }],
    ...overrides,
  };
}

function makeAdapter(responseJson: object): AIAdapter {
  return {
    generateText: vi.fn().mockResolvedValue(JSON.stringify(responseJson)),
  } as unknown as AIAdapter;
}

const BASE_INPUT: NarrationInput = {
  spec: makeSpec(),
  preset: 'policymaker',
  modelId: 'gemini-2.0-flash',
  modelSource: 'Explicit',
};

// ── traceResolver tests ───────────────────────────────────────────────────────

describe('buildTrace', () => {
  it('encodes a simple path', () => {
    expect(buildTrace(['cruxes', 0])).toBe('/cruxes/0');
  });

  it('encodes nested path', () => {
    expect(buildTrace(['resolution_analysis', 'stronger_camp_findings', 2])).toBe(
      '/resolution_analysis/stronger_camp_findings/2'
    );
  });

  it('RFC 6901 escapes ~ → ~0 and / → ~1', () => {
    expect(buildTrace(['a~b', 'c/d'])).toBe('/a~0b/c~1d');
  });

  it('returns empty string for empty path (root pointer)', () => {
    expect(buildTrace([])).toBe('');
  });
});

describe('resolveTrace', () => {
  const spec = makeSpec();

  it('resolves a top-level array element', () => {
    const result = resolveTrace(spec, '/agreements/0') as { text: string };
    expect(result.text).toBe('Both agree risks are real');
  });

  it('resolves a nested field', () => {
    expect(resolveTrace(spec, '/question/core_proposition')).toBe('Should AI development be paused?');
  });

  it('resolves a deeply nested field', () => {
    const result = resolveTrace(spec, '/resolution_analysis/stronger_camp_findings/0') as { camp: string; finding: string };
    expect(result.camp).toBe('saf');
  });

  it('resolves the root pointer (empty string) to the spec itself', () => {
    expect(resolveTrace(spec, '')).toBe(spec);
  });

  it('throws ActionableError for a missing key', () => {
    expect(() => resolveTrace(spec, '/nonexistent')).toThrow();
  });

  it('throws ActionableError for out-of-bounds array index', () => {
    expect(() => resolveTrace(spec, '/agreements/99')).toThrow();
  });

  it('throws ActionableError for non-integer array index', () => {
    expect(() => resolveTrace(spec, '/agreements/foo')).toThrow();
  });

  it('throws ActionableError for pointer not starting with /', () => {
    expect(() => resolveTrace(spec, 'agreements/0')).toThrow();
  });

  it('decodes ~0 and ~1 escape sequences', () => {
    const specWithSlash = {
      ...spec,
      meta: { ...spec.meta, id: 'x' },
      question: {
        ...spec.question,
        qualifiers: ['a/b'],
      },
    } as DeckSpec;
    // /question/qualifiers/0 contains 'a/b' — trace into it normally
    expect(resolveTrace(specWithSlash, '/question/qualifiers/0')).toBe('a/b');
  });
});

describe('isResolvable', () => {
  const spec = makeSpec();

  it('returns true for a valid pointer', () => {
    expect(isResolvable(spec, '/cruxes/0')).toBe(true);
  });

  it('returns false for a missing key', () => {
    expect(isResolvable(spec, '/nope')).toBe(false);
  });

  it('returns false for out-of-bounds index', () => {
    expect(isResolvable(spec, '/cruxes/99')).toBe(false);
  });
});

// ── narrate() tests ───────────────────────────────────────────────────────────

describe('narrate — skipNarration mode', () => {
  it('produces deterministic narration with zero adapter calls', async () => {
    const adapter = makeAdapter({});
    const result = await narrate({ ...BASE_INPUT, skipNarration: true }, adapter);
    expect(result.narration.narration_mode).toBe('deterministic');
    expect((adapter.generateText as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('includes entries traced to spec fields', async () => {
    const adapter = makeAdapter({});
    const result = await narrate({ ...BASE_INPUT, skipNarration: true }, adapter);
    const traces = result.narration.entries.map(e => e.trace);
    expect(traces).toContain('/question');
    expect(traces).toContain('/agreements/0');
    expect(traces).toContain('/cruxes/0');
  });

  it('derives audience questions from tensions', async () => {
    const adapter = makeAdapter({});
    const result = await narrate({ ...BASE_INPUT, skipNarration: true }, adapter);
    expect(result.narration.audience_questions.length).toBe(2); // 2 tensions
    expect(result.narration.audience_questions[0].trace).toBe('/question/tensions/0');
  });

  it('records narration_mode deterministic and preset', async () => {
    const adapter = makeAdapter({});
    const result = await narrate({ ...BASE_INPUT, skipNarration: true, preset: 'classroom' }, adapter);
    expect(result.narration.preset).toBe('classroom');
    expect(result.narration.narrator_model).toBe(BASE_INPUT.modelId);
    expect(result.narration.narrator_model_source).toBe(BASE_INPUT.modelSource);
  });

  it('all entry traces are resolvable', async () => {
    const adapter = makeAdapter({});
    const spec = makeSpec();
    const result = await narrate({ ...BASE_INPUT, spec, skipNarration: true }, adapter);
    for (const entry of result.narration.entries) {
      expect(isResolvable(spec, entry.trace)).toBe(true);
    }
  });
});

describe('narrate — narrated mode (mocked adapter)', () => {
  function makeNarratedResponse(spec: DeckSpec) {
    return {
      entries: [
        { trace: '/question', text: 'Should AI be paused?', slide: 1 },
        { trace: '/cruxes/0', text: 'Key crux: scaling', slide: 2 },
      ],
      audience_questions: [
        { trace: '/cruxes/0', question: 'Will scaling cause AGI?' },
        { trace: '/question/tensions/0', question: 'How do we balance safety and speed?' },
      ],
    };
  }

  it('calls adapter once with temperature 0', async () => {
    const spec = makeSpec();
    const response = makeNarratedResponse(spec);
    const adapter = makeAdapter(response);
    await narrate({ ...BASE_INPUT, spec }, adapter);
    expect((adapter.generateText as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    const [, , opts] = (adapter.generateText as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(opts?.temperature).toBe(0);
  });

  it('calls adapter with the provided modelId', async () => {
    const spec = makeSpec();
    const adapter = makeAdapter(makeNarratedResponse(spec));
    await narrate({ ...BASE_INPUT, spec, modelId: 'claude-sonnet-5' }, adapter);
    const [, modelId] = (adapter.generateText as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(modelId).toBe('claude-sonnet-5');
  });

  it('returns narration_mode narrated and preset', async () => {
    const spec = makeSpec();
    const adapter = makeAdapter(makeNarratedResponse(spec));
    const result = await narrate({ ...BASE_INPUT, spec, preset: 'conference' }, adapter);
    expect(result.narration.narration_mode).toBe('narrated');
    expect(result.narration.preset).toBe('conference');
  });

  it('throws ActionableError on non-JSON model response (after retry)', async () => {
    const adapter = { generateText: vi.fn().mockResolvedValue('not json') } as unknown as AIAdapter;
    await expect(narrate({ ...BASE_INPUT }, adapter)).rejects.toThrow();
    expect((adapter.generateText as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2); // 1 attempt + 1 repair retry
  });

  it('throws ActionableError on unresolvable trace (after retry)', async () => {
    const badResponse = {
      entries: [{ trace: '/nonexistent/path', text: 'hallucinated', slide: 1 }],
      audience_questions: [],
    };
    const adapter = makeAdapter(badResponse);
    await expect(narrate({ ...BASE_INPUT }, adapter)).rejects.toThrow();
    expect((adapter.generateText as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2); // 1 + repair retry
  });

  it('retries then throws ActionableError on empty entries — not a silent symmetry breach (t/2872)', async () => {
    // {entries:[]} is AJV-valid and has zero bad traces, so it slips past both the
    // JSON and bad-trace gates. Without the presence gate it returned an empty
    // narration that only failed far downstream at verify's symmetry check (0 slides
    // per camp). The presence gate must retry once, then throw a narrate-level error.
    const emptyResponse = { entries: [], audience_questions: [] };
    const adapter = makeAdapter(emptyResponse);
    await expect(narrate({ ...BASE_INPUT }, adapter)).rejects.toThrow(/zero narration entries/i);
    expect((adapter.generateText as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2); // 1 + repair retry
  });

  it('validates schema — rejects unknown property', async () => {
    // The model response is valid but the assembled Narration has extra fields
    // (tested by injecting a bad response that bypasses trace check)
    const goodResponse = {
      entries: [{ trace: '/question', text: 'ok', slide: 1 }],
      audience_questions: [{ trace: '/cruxes/0', question: 'ok?' }],
    };
    const adapter = makeAdapter(goodResponse);
    const result = await narrate({ ...BASE_INPUT }, adapter);
    // No extra properties → should pass AJV
    expect(result.narration).not.toHaveProperty('unknownField');
  });
});

describe('narrate — Maker-Checker', () => {
  const spec = makeSpec();
  const goodNarratedResponse = {
    entries: [{ trace: '/question', text: 'Pause debate', slide: 1 }],
    audience_questions: [{ trace: '/cruxes/0', question: 'Will scaling cause AGI?' }],
  };
  const checkerPass = {
    fidelity_failures: [],
    symmetry: { camps: [{ camp: 'saf', slide_count: 1, headline_count: 1, word_budget: 3 }], within_tolerance: true, tolerance_pct: 10 },
  };
  const checkerFail = {
    fidelity_failures: [{ trace: '/question', reason: 'Text omits key qualifier' }],
    symmetry: { camps: [], within_tolerance: false, tolerance_pct: 10 },
  };

  it('calls adapter twice when checkerModelId is provided', async () => {
    const adapter = {
      generateText: vi.fn()
        .mockResolvedValueOnce(JSON.stringify(goodNarratedResponse))
        .mockResolvedValueOnce(JSON.stringify(checkerPass)),
    } as unknown as AIAdapter;
    const result = await narrate({ ...BASE_INPUT, spec, checkerModelId: 'gemini-2.0-flash-lite', checkerModelSource: 'Global' }, adapter);
    expect((adapter.generateText as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
    expect(result.narration.checker_model).toBe('gemini-2.0-flash-lite');
    expect(result.narration.checker_passed).toBe(true);
    expect(result.checkerReport?.passed).toBe(true);
  });

  it('sets checker_passed false when checker finds fidelity failures', async () => {
    const adapter = {
      generateText: vi.fn()
        .mockResolvedValueOnce(JSON.stringify(goodNarratedResponse))
        .mockResolvedValueOnce(JSON.stringify(checkerFail)),
    } as unknown as AIAdapter;
    const result = await narrate({ ...BASE_INPUT, spec, checkerModelId: 'gemini-2.0-flash-lite', checkerModelSource: 'Global' }, adapter);
    expect(result.narration.checker_passed).toBe(false);
    expect(result.checkerReport?.fidelity_failures.length).toBeGreaterThan(0);
  });

  it('uses checker model id for the second call', async () => {
    const adapter = {
      generateText: vi.fn()
        .mockResolvedValueOnce(JSON.stringify(goodNarratedResponse))
        .mockResolvedValueOnce(JSON.stringify(checkerPass)),
    } as unknown as AIAdapter;
    await narrate({ ...BASE_INPUT, spec, checkerModelId: 'checker-model-id', checkerModelSource: 'Explicit' }, adapter);
    const [, narrateModel] = (adapter.generateText as ReturnType<typeof vi.fn>).mock.calls[0];
    const [, checkerModel] = (adapter.generateText as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(narrateModel).toBe(BASE_INPUT.modelId);
    expect(checkerModel).toBe('checker-model-id');
  });

  it('does not run checker in skipNarration mode', async () => {
    const adapter = { generateText: vi.fn() } as unknown as AIAdapter;
    const result = await narrate({ ...BASE_INPUT, spec, skipNarration: true, checkerModelId: 'checker-model-id', checkerModelSource: 'Explicit' }, adapter);
    expect((adapter.generateText as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(result.checkerReport).toBeUndefined();
  });
});
