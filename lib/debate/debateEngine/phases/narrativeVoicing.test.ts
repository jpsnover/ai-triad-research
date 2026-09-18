// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../taxonomyContext.js', () => ({
  getRelevantTaxonomyContext: vi.fn(async (_engine: unknown, pov: string) => `CONTEXT FOR ${pov}`),
}));
vi.mock('../modelResolution.js', () => ({
  resolveStageModel: vi.fn(() => 'moderator-model'),
}));
vi.mock('../../../embeddings/onnxEmbedding.js', () => ({
  computeEmbeddings: vi.fn(async (texts: string[]) => texts.map(t => (t.includes('safetyist') ? [0, 1] : [1, 0]))),
}));

import { runNarrativeVoicing, finalizeNarrativeReference, updateNarrativeSimilarity } from './narrativeVoicing.js';
import { NARRATIVE_VOICING_KIND } from '../../narrativeVoicing.js';
import type { DebateEngineInternals } from '../internals.js';
import type { TranscriptEntry } from '../../types.js';

const GOOD = JSON.stringify({
  narratives: ['accelerationist', 'safetyist'].map(p => ({
    pov: p, fears_losing: 'f', history_carried: 'h', narrative: `If I were a ${p}, I would remember.`,
  })),
});

function fakeEngine(opts: { enabled: boolean; response?: string; throws?: boolean }) {
  const transcript: TranscriptEntry[] = [];
  const engine = {
    config: { narrativeVoicing: opts.enabled, activePovers: ['accelerationist', 'safetyist'] },
    session: { id: 'd1', topic: { final: 'Topic?', background: '' }, transcript } as Record<string, unknown>,
    progress: vi.fn(),
    warn: vi.fn(),
    recordDiagnostic: vi.fn(),
    generateWithModel: vi.fn(async () => {
      if (opts.throws) throw new Error('backend down');
      return opts.response ?? GOOD;
    }),
    addEntry: vi.fn((e: Omit<TranscriptEntry, 'id' | 'timestamp'>) => {
      const full = { id: `e${transcript.length}`, timestamp: 't', ...e } as TranscriptEntry;
      transcript.push(full);
      return full;
    }),
  };
  return engine as unknown as DebateEngineInternals & typeof engine;
}

describe('runNarrativeVoicing (engine)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is a no-op when the flag is off', async () => {
    const engine = fakeEngine({ enabled: false });
    await runNarrativeVoicing(engine);
    expect(engine.generateWithModel).not.toHaveBeenCalled();
    expect(engine.session.transcript).toHaveLength(0);
    expect(engine.session.narrative_voicing).toBeUndefined();
  });

  it('adds a moderator system entry and records the voicing on the session', async () => {
    const engine = fakeEngine({ enabled: true });
    await runNarrativeVoicing(engine);

    expect(engine.generateWithModel).toHaveBeenCalledWith(expect.stringContaining('CONTEXT FOR safetyist'), 'Narrative voicing', 'moderator-model');
    const [entry] = engine.session.transcript;
    expect(entry).toMatchObject({ type: 'system', speaker: 'moderator', metadata: { kind: NARRATIVE_VOICING_KIND } });
    expect(entry.content).toContain('If I were a safetyist');
    expect(engine.session.narrative_voicing).toMatchObject({ entry_id: entry.id, model: 'moderator-model' });
    expect(engine.session.narrative_voicing_enabled).toBe(true);
    expect(engine.session.narrative_voicing!.narratives.map(n => n.speaker)).toEqual(['accelerationist', 'safetyist']);
  });

  it('is idempotent on resume', async () => {
    const engine = fakeEngine({ enabled: true });
    await runNarrativeVoicing(engine);
    await runNarrativeVoicing(engine);
    expect(engine.generateWithModel).toHaveBeenCalledTimes(1);
    expect(engine.session.transcript).toHaveLength(1);
  });

  it('degrades to no voicing (with a warning) when a camp is missing or the call fails', async () => {
    const partial = fakeEngine({ enabled: true, response: JSON.stringify({ narratives: [{ pov: 'safetyist', narrative: 'x' }] }) });
    await runNarrativeVoicing(partial);
    expect(partial.session.narrative_voicing).toBeUndefined();
    expect(partial.session.transcript).toHaveLength(0);
    expect(partial.warn).toHaveBeenCalled();

    const failing = fakeEngine({ enabled: true, throws: true });
    await expect(runNarrativeVoicing(failing)).resolves.toBeUndefined();
    expect(failing.session.narrative_voicing).toBeUndefined();
    expect(failing.warn).toHaveBeenCalled();
  });
});

describe('narrative drift reference (engine)', () => {
  it('embeds narratives after openings and scores openings and later turns against their own camp', async () => {
    const engine = fakeEngine({ enabled: true });
    await runNarrativeVoicing(engine);
    engine.session.transcript.push(
      { id: 'o-acc', timestamp: 't', type: 'opening', speaker: 'accelerationist', content: 'acc para', taxonomy_refs: [] },
      { id: 'o-saf', timestamp: 't', type: 'opening', speaker: 'safetyist', content: 'safetyist para', taxonomy_refs: [] },
    );

    await finalizeNarrativeReference(engine);
    const v = engine.session.narrative_voicing!;
    expect(v.narratives.every(n => Array.isArray(n.embedding))).toBe(true);
    expect(v.similarity_series).toEqual({ 'o-acc': 1, 'o-saf': 1 });

    // A safetyist turn that now sounds like the accelerationist story has drifted to 0.
    await updateNarrativeSimilarity(engine, { id: 's1', timestamp: 't', type: 'statement', speaker: 'safetyist', content: 'acc para', taxonomy_refs: [] });
    expect(v.similarity_series!.s1).toBeCloseTo(0);
  });

  it('does nothing without a voicing', async () => {
    const engine = fakeEngine({ enabled: false });
    await finalizeNarrativeReference(engine);
    await updateNarrativeSimilarity(engine, { id: 's1', timestamp: 't', type: 'statement', speaker: 'safetyist', content: 'x', taxonomy_refs: [] });
    expect(engine.session.narrative_voicing).toBeUndefined();
  });
});
