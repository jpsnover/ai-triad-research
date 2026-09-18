// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import {
  NARRATIVE_VOICING_KIND,
  parseNarrativeVoicing,
  formatNarrativeVoicingEntry,
  narrativeBlockForDebater,
  extractNarrativeCheck,
  narrativeReferenceText,
  meanParagraphSimilarity,
  embedNarrativeReferences,
  scoreTurnAgainstNarrative,
  truncateNarrativeMaterial,
  MAX_NARRATIVE_MATERIAL_CHARS,
} from './narrativeVoicing.js';
import { narrativeVoicingPrompt, briefOpeningStagePrompt, draftOpeningStagePrompt, NARRATIVE_CHECK_INSTRUCTION } from './prompts.js';
import type { OpeningStagePromptInput } from './prompts.js';
import { formatStrippedTranscript, buildSpeakerMapping } from './neutralEvaluator.js';
import { formatRecentTranscript } from './helpers.js';
import type { CampNarrative, TranscriptEntry } from './types.js';

const ALL = ['accelerationist', 'safetyist', 'skeptic'] as const;

function voicingJson(povs: readonly string[] = ALL): string {
  return JSON.stringify({
    narratives: povs.map(p => ({
      pov: p,
      fears_losing: `${p} fears`,
      history_carried: `${p} history`,
      narrative: `If I were a ${p}, I would remember ${p} things.`,
    })),
  });
}

function narratives(): CampNarrative[] {
  return parseNarrativeVoicing(voicingJson(), ALL)!;
}

describe('parseNarrativeVoicing', () => {
  it('returns one narrative per active debater, in active order', () => {
    const out = parseNarrativeVoicing(voicingJson(['skeptic', 'accelerationist', 'safetyist']), ALL);
    expect(out?.map(n => n.speaker)).toEqual([...ALL]);
    expect(out?.[1]).toMatchObject({ fears_losing: 'safetyist fears', history_carried: 'safetyist history' });
  });

  it('accepts fenced JSON and mixed-case pov keys', () => {
    const text = '```json\n' + voicingJson().replace('"safetyist"', '"Safetyist"') + '\n```';
    expect(parseNarrativeVoicing(text, ALL)).toHaveLength(3);
  });

  it('returns null when any active camp is missing — a partial voicing is worse than none', () => {
    expect(parseNarrativeVoicing(voicingJson(['accelerationist', 'safetyist']), ALL)).toBeNull();
  });

  it('ignores camps that are not debating', () => {
    const out = parseNarrativeVoicing(voicingJson(), ['safetyist', 'skeptic']);
    expect(out?.map(n => n.speaker)).toEqual(['safetyist', 'skeptic']);
  });

  it('returns null for unparseable output and for entries with an empty narrative', () => {
    expect(parseNarrativeVoicing('not json at all', ALL)).toBeNull();
    const blank = JSON.stringify({ narratives: ALL.map(p => ({ pov: p, narrative: '  ' })) });
    expect(parseNarrativeVoicing(blank, ALL)).toBeNull();
  });
});

describe('formatting', () => {
  it('transcript entry text opens with the moderator framing and contains every narrative', () => {
    const text = formatNarrativeVoicingEntry(narratives());
    expect(text).toMatch(/^Before any argument/);
    for (const p of ALL) expect(text).toContain(`If I were a ${p}`);
  });

  it('debater block labels its own camp separately from the others', () => {
    const block = narrativeBlockForDebater(narratives(), 'safetyist');
    expect(block).toContain('YOUR camp (Safetyist)');
    expect(block).toContain('the Accelerationist camp');
    expect(block).toContain('the Skeptic camp');
    expect(block).not.toContain('the Safetyist camp');
    expect(block).toContain('Do not attribute claims to a speaker');
  });

  it('truncates oversize material', () => {
    const long = 'x'.repeat(MAX_NARRATIVE_MATERIAL_CHARS + 50);
    expect(truncateNarrativeMaterial(long).length).toBeLessThan(long.length);
    expect(truncateNarrativeMaterial('short')).toBe('short');
  });

  it('voicing prompt carries topic, every camp label and the no-judgment rule', () => {
    const prompt = narrativeVoicingPrompt('Should frontier training runs be licensed?', [
      { pov: 'safetyist', label: 'Safetyist', context: 'SAF CONTEXT' },
      { pov: 'skeptic', label: 'Skeptic', context: 'SKP CONTEXT' },
    ]);
    expect(prompt).toContain('Should frontier training runs be licensed?');
    expect(prompt).toContain('=== MATERIAL: Safetyist (safetyist) ===\nSAF CONTEXT');
    expect(prompt).toContain('"pov": "safetyist" | "skeptic"');
    expect(prompt).toMatch(/Do not evaluate, rank, rebut/);
  });
});

describe('opening prompt injection', () => {
  const base: OpeningStagePromptInput = {
    label: 'Safetyist', pov: 'safetyist', personality: '', topic: 'T',
    taxonomyContext: 'CTX', priorStatements: '', isFirst: true,
  };
  const block = '\n=== MODERATOR\'S OPENING: EACH CAMP\'S STORY ===\nBLOCK';

  it('is absent when narrative voicing is off (prompts unchanged)', () => {
    expect(briefOpeningStagePrompt(base)).not.toContain('MODERATOR\'S OPENING');
    const draft = draftOpeningStagePrompt(base, '{}', '{}');
    expect(draft).not.toContain('MODERATOR\'S OPENING');
    expect(draft).not.toContain('narrative_check');
  });

  it('reaches BRIEF and DRAFT, and DRAFT asks for the narrative check', () => {
    const input = { ...base, narrativeVoicing: block };
    expect(briefOpeningStagePrompt(input)).toContain(block);
    const draft = draftOpeningStagePrompt(input, '{}', '{}');
    expect(draft).toContain(block);
    expect(draft).toContain(NARRATIVE_CHECK_INSTRUCTION.trim());
  });
});

describe('extractNarrativeCheck', () => {
  it('reads affirm and amend', () => {
    expect(extractNarrativeCheck({ narrative_check: { verdict: 'affirm', amendment: '' } })).toEqual({ verdict: 'affirm' });
    expect(extractNarrativeCheck({ narrative_check: { verdict: 'Amend', amendment: ' We also carry X. ' } }))
      .toEqual({ verdict: 'amend', amendment: 'We also carry X.' });
  });

  it('returns undefined for missing, malformed, or amend-without-text', () => {
    expect(extractNarrativeCheck(undefined)).toBeUndefined();
    expect(extractNarrativeCheck({})).toBeUndefined();
    expect(extractNarrativeCheck({ narrative_check: 'affirm' })).toBeUndefined();
    expect(extractNarrativeCheck({ narrative_check: { verdict: 'amend', amendment: '' } })).toBeUndefined();
    expect(extractNarrativeCheck({ narrative_check: { verdict: 'maybe' } })).toBeUndefined();
  });

  it('the drift reference includes an amendment when the camp corrected its story', () => {
    const [n] = narratives();
    expect(narrativeReferenceText(n)).toBe(n.narrative);
    expect(narrativeReferenceText({ ...n, acknowledgment: { verdict: 'amend', amendment: 'Also Y.' } })).toBe(`${n.narrative} Also Y.`);
    expect(narrativeReferenceText({ ...n, acknowledgment: { verdict: 'affirm' } })).toBe(n.narrative);
  });
});

describe('drift similarity', () => {
  it('meanParagraphSimilarity averages cosine over comparable paragraphs', () => {
    expect(meanParagraphSimilarity([1, 0], [[1, 0], [0, 1]])).toBeCloseTo(0.5);
    expect(meanParagraphSimilarity([1, 0], [[2, 0], [1, 2, 3]])).toBeCloseTo(1);
    expect(meanParagraphSimilarity([1, 0], [])).toBeNull();
    expect(meanParagraphSimilarity([1, 0], [[1, 2, 3]])).toBeNull();
  });

  it('embeds references then scores a turn against the speaker\'s own camp only', async () => {
    const ns = narratives();
    // Deterministic fake embedder: accelerationist → x-axis, safetyist → y-axis, everything else → z-axis.
    const embed = async (texts: string[]) => texts.map(t =>
      t.includes('accelerationist') ? [1, 0, 0] : t.includes('safetyist') ? [0, 1, 0] : [0, 0, 1]);
    await embedNarrativeReferences(ns, embed);
    expect(ns.every(n => n.embedding?.length === 3)).toBe(true);

    const turn = 'accelerationist paragraph one\n\nsafetyist paragraph two';
    expect(await scoreTurnAgainstNarrative(ns, 'accelerationist', turn, embed)).toBeCloseTo(0.5);
    expect(await scoreTurnAgainstNarrative(ns, 'skeptic', turn, embed)).toBeCloseTo(0);
    expect(await scoreTurnAgainstNarrative(ns, 'user', turn, embed)).toBeNull();
    expect(await scoreTurnAgainstNarrative(ns, 'accelerationist', '   ', embed)).toBeNull();
  });
});

describe('isolation of the voicing entry', () => {
  const voicingEntry: TranscriptEntry = {
    id: 'nv', timestamp: '2026-01-01T00:00:00Z', type: 'system', speaker: 'moderator',
    content: formatNarrativeVoicingEntry(narratives()), taxonomy_refs: [], metadata: { kind: NARRATIVE_VOICING_KIND },
  };
  const opening: TranscriptEntry = {
    id: 'o1', timestamp: '2026-01-01T00:00:01Z', type: 'opening', speaker: 'safetyist',
    content: 'OPENING TEXT', taxonomy_refs: [],
  };

  it('is invisible to the neutral evaluator (it names every camp and would break anonymization)', () => {
    const text = formatStrippedTranscript([voicingEntry, opening], buildSpeakerMapping([...ALL]));
    expect(text).not.toContain('If I were');
    expect(text).toContain('OPENING TEXT');
  });

  it('is not replayed to debaters through the recent-transcript window', () => {
    const text = formatRecentTranscript([voicingEntry, opening]);
    expect(text).not.toContain('If I were');
    expect(text).toContain('OPENING TEXT');
  });
});
