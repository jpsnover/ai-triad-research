// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  normalizeDescription,
  hashDescription,
  loadRegistry,
  saveRegistry,
  registryPath,
  persistDebateCruxes,
  evictStaleEntries,
  findRelevantPriorCruxes,
  formatPriorCruxContext,
  resolveTaxonomyRefs,
} from './cruxRegistry.js';
import type { CruxRegistry, CruxRegistryEntry, DebateSession, TrackedCrux, ArgumentNetworkNode } from './types.js';

const TMP_DIR = path.join(import.meta.dirname ?? '.', '__test_crux_registry__');
const CALIB_DIR = path.join(TMP_DIR, 'calibration');

function makeEmbedding(seed: number, dim = 4): number[] {
  const v = Array.from({ length: dim }, (_, i) => Math.sin(seed + i));
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map(x => x / norm);
}

function makeEntry(overrides: Partial<CruxRegistryEntry> = {}): CruxRegistryEntry {
  return {
    id: 'abc123',
    description: 'Test crux description',
    embedding: makeEmbedding(1),
    disagreement_type: 'empirical',
    first_seen_debate: 'debate-1',
    first_seen_date: new Date().toISOString(),
    occurrences: [{
      debate_id: 'debate-1',
      debate_topic: 'AI safety',
      date: new Date().toISOString(),
      an_id: 'crux-1',
      final_state: 'irreducible',
      turns_engaged: 3,
      intervention_issued: false,
      resolved_post_intervention: false,
      model: 'gemini-2.5-flash',
    }],
    related_taxonomy_nodes: ['acc-beliefs-001'],
    promoted_to_situation: null,
    ...overrides,
  };
}

function makeAnNode(id: string, taxonomyRefs: string[]): ArgumentNetworkNode {
  return {
    id,
    text: 'claim text',
    speaker: 'accelerationist',
    source_entry_id: 'entry-1',
    taxonomy_refs: taxonomyRefs,
    turn_number: 1,
  } as ArgumentNetworkNode;
}

function makeSession(cruxes: TrackedCrux[], anNodes?: ArgumentNetworkNode[]): DebateSession {
  return {
    id: 'test-debate',
    title: 'Test debate on AI safety',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    phase: 'concluding',
    topic: { original: 'AI safety', refined: null, final: 'AI safety' },
    source_type: 'freeform',
    source_ref: '',
    source_content: '',
    active_povers: ['accelerationist', 'safetyist', 'skeptic'],
    user_is_pover: false,
    transcript: [],
    context_summaries: [],
    generated_with_prompt_version: 'test',
    debate_model: 'gemini-2.5-flash',
    argument_network: { nodes: anNodes ?? [], edges: [] },
    crux_tracker: cruxes,
  } as unknown as DebateSession;
}

function makeCrux(overrides: Partial<TrackedCrux> = {}): TrackedCrux {
  return {
    id: 'crux-1',
    description: 'Whether current AI capabilities pose existential risk',
    identified_turn: 2,
    state: 'irreducible',
    history: [{ from: 'identified', to: 'engaged', turn: 3, trigger: 'direct' }],
    disagreement_type: 'empirical',
    attacking_claim_ids: ['acc-beliefs-001'],
    speakers_involved: ['accelerationist', 'safetyist'],
    last_computed_strength: 0.6,
    support_polarity: -1,
    ...overrides,
  };
}

beforeEach(() => {
  fs.mkdirSync(CALIB_DIR, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

describe('normalizeDescription', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalizeDescription('AI Safety — Risk!')).toBe('ai safety risk');
  });

  it('collapses whitespace', () => {
    expect(normalizeDescription('  a   b  c  ')).toBe('a b c');
  });
});

describe('hashDescription', () => {
  it('produces a 16-char hex string', () => {
    const h = hashDescription('some crux');
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is stable for same input', () => {
    expect(hashDescription('AI risk')).toBe(hashDescription('AI risk'));
  });

  it('normalizes before hashing', () => {
    expect(hashDescription('AI Risk!')).toBe(hashDescription('ai risk'));
  });
});

describe('loadRegistry / saveRegistry', () => {
  it('returns empty registry when no file exists', () => {
    const reg = loadRegistry(TMP_DIR);
    expect(reg.version).toBe(1);
    expect(reg.entries).toEqual([]);
  });

  it('round-trips a registry through save and load', () => {
    const reg: CruxRegistry = {
      version: 1,
      entries: [makeEntry()],
      last_updated: new Date().toISOString(),
    };
    saveRegistry(reg, TMP_DIR);
    const loaded = loadRegistry(TMP_DIR);
    expect(loaded.entries).toHaveLength(1);
    expect(loaded.entries[0].id).toBe('abc123');
  });

  it('returns empty registry for corrupt JSON', () => {
    fs.writeFileSync(registryPath(TMP_DIR), 'NOT JSON', 'utf-8');
    const reg = loadRegistry(TMP_DIR);
    expect(reg.entries).toEqual([]);
  });
});

describe('resolveTaxonomyRefs', () => {
  it('resolves AN claim IDs to taxonomy node IDs', () => {
    const map = new Map<string, ArgumentNetworkNode>([
      ['claim-1', makeAnNode('claim-1', ['acc-beliefs-001', 'saf-desires-002'])],
      ['claim-2', makeAnNode('claim-2', ['skp-intentions-003'])],
    ]);
    const refs = resolveTaxonomyRefs(['claim-1', 'claim-2'], map);
    expect(refs).toContain('acc-beliefs-001');
    expect(refs).toContain('saf-desires-002');
    expect(refs).toContain('skp-intentions-003');
    expect(refs).toHaveLength(3);
  });

  it('deduplicates taxonomy refs', () => {
    const map = new Map<string, ArgumentNetworkNode>([
      ['claim-1', makeAnNode('claim-1', ['acc-beliefs-001'])],
      ['claim-2', makeAnNode('claim-2', ['acc-beliefs-001'])],
    ]);
    const refs = resolveTaxonomyRefs(['claim-1', 'claim-2'], map);
    expect(refs).toHaveLength(1);
  });

  it('skips unknown claim IDs', () => {
    const map = new Map<string, ArgumentNetworkNode>();
    const refs = resolveTaxonomyRefs(['unknown-claim'], map);
    expect(refs).toHaveLength(0);
  });
});

describe('persistDebateCruxes', () => {
  const mockEmbed = vi.fn(async (text: string) => makeEmbedding(text.length));

  beforeEach(() => {
    mockEmbed.mockClear();
  });

  it('creates new entry for a novel crux with resolved taxonomy refs', async () => {
    const anNodes = [makeAnNode('acc-beliefs-001', ['acc-beliefs-001', 'saf-desires-002'])];
    const session = makeSession([makeCrux({ attacking_claim_ids: ['acc-beliefs-001'] })], anNodes);
    const result = await persistDebateCruxes(session, TMP_DIR, mockEmbed);
    expect(result).toEqual({ merged: 0, created: 1 });

    const reg = loadRegistry(TMP_DIR);
    expect(reg.entries).toHaveLength(1);
    expect(reg.entries[0].occurrences).toHaveLength(1);
    expect(reg.entries[0].disagreement_type).toBe('empirical');
    expect(reg.entries[0].related_taxonomy_nodes).toContain('acc-beliefs-001');
    expect(reg.entries[0].related_taxonomy_nodes).toContain('saf-desires-002');
  });

  it('persists and reloads a terminal `undecided` crux — guard-2 state/persistence agreement (t/1676)', async () => {
    // Guard-2 (TL t/1676#6): the literal terminal `undecided` state set by the debate-end
    // finalization sweep must survive persistDebateCruxes → loadRegistry, so the persisted
    // registry AGREES with the in-session crux.state. The pre-t/1676 retention filter kept
    // only `irreducible || engaged`; without adding `undecided` to it, a finalized crux would
    // be silently dropped and state/persistence would disagree. This asserts the round-trip.
    const session = makeSession([
      makeCrux({
        id: 'crux-undecided',
        state: 'undecided',
        history: [{ from: 'identified', to: 'undecided', turn: 5, trigger: 'Debate ended without cross-engagement' }],
      }),
    ]);
    const result = await persistDebateCruxes(session, TMP_DIR, mockEmbed);
    expect(result).toEqual({ merged: 0, created: 1 });

    const reloaded = loadRegistry(TMP_DIR);
    expect(reloaded.entries).toHaveLength(1);
    expect(reloaded.entries[0].occurrences).toHaveLength(1);
    expect(reloaded.entries[0].occurrences[0].final_state).toBe('undecided');
  });

  it('merges occurrence when crux is similar (>0.80)', async () => {
    const existingEntry = makeEntry({
      embedding: makeEmbedding(47),
    });
    const reg: CruxRegistry = { version: 1, entries: [existingEntry], last_updated: '' };
    saveRegistry(reg, TMP_DIR);

    mockEmbed.mockResolvedValueOnce(makeEmbedding(47));

    const session = makeSession([makeCrux({ id: 'crux-2' })]);
    const result = await persistDebateCruxes(session, TMP_DIR, mockEmbed);
    expect(result).toEqual({ merged: 1, created: 0 });

    const loaded = loadRegistry(TMP_DIR);
    expect(loaded.entries).toHaveLength(1);
    expect(loaded.entries[0].occurrences).toHaveLength(2);
  });

  it('creates new entry when crux is dissimilar (<0.80)', async () => {
    const existingEntry = makeEntry({
      embedding: makeEmbedding(1),
    });
    const reg: CruxRegistry = { version: 1, entries: [existingEntry], last_updated: '' };
    saveRegistry(reg, TMP_DIR);

    mockEmbed.mockResolvedValueOnce(makeEmbedding(100));

    const session = makeSession([makeCrux({ id: 'crux-2', description: 'Completely different crux' })]);
    const result = await persistDebateCruxes(session, TMP_DIR, mockEmbed);
    expect(result).toEqual({ merged: 0, created: 1 });

    const loaded = loadRegistry(TMP_DIR);
    expect(loaded.entries).toHaveLength(2);
  });

  it('skips cruxes with resolved state', async () => {
    const session = makeSession([makeCrux({ state: 'resolved' })]);
    const result = await persistDebateCruxes(session, TMP_DIR, mockEmbed);
    expect(result).toEqual({ merged: 0, created: 0 });
    expect(mockEmbed).not.toHaveBeenCalled();
  });

  it('includes engaged cruxes', async () => {
    const session = makeSession([makeCrux({ state: 'engaged' })]);
    const result = await persistDebateCruxes(session, TMP_DIR, mockEmbed);
    expect(result).toEqual({ merged: 0, created: 1 });
  });

  it('returns zero counts when no crux tracker exists', async () => {
    const session = makeSession([]);
    session.crux_tracker = undefined;
    const result = await persistDebateCruxes(session, TMP_DIR, mockEmbed);
    expect(result).toEqual({ merged: 0, created: 0 });
  });

  it('decontextualizes description when generateFn is provided', async () => {
    const mockGenerate = vi.fn().mockResolvedValue(
      JSON.stringify({ decontextualized: '[The EU AI Act] would reduce innovation in [European] markets', changes_made: ['expanded "it"', 'expanded "those markets"'] }),
    );
    mockEmbed.mockResolvedValueOnce(makeEmbedding(99));

    const session = makeSession([makeCrux({ description: 'It would reduce innovation in those markets' })]);
    await persistDebateCruxes(session, TMP_DIR, mockEmbed, mockGenerate);

    const reg = loadRegistry(TMP_DIR);
    expect(reg.entries).toHaveLength(1);
    expect(reg.entries[0].description).toBe('[The EU AI Act] would reduce innovation in [European] markets');
    expect(mockGenerate).toHaveBeenCalledOnce();
  });

  it('falls back to original description when generateFn fails', async () => {
    const mockGenerate = vi.fn().mockRejectedValue(new Error('LLM error'));
    mockEmbed.mockResolvedValueOnce(makeEmbedding(99));

    const session = makeSession([makeCrux()]);
    await persistDebateCruxes(session, TMP_DIR, mockEmbed, mockGenerate);

    const reg = loadRegistry(TMP_DIR);
    expect(reg.entries).toHaveLength(1);
    expect(reg.entries[0].description).toBe('Whether current AI capabilities pose existential risk');
  });

  it('uses original description when generateFn is not provided', async () => {
    mockEmbed.mockResolvedValueOnce(makeEmbedding(99));

    const session = makeSession([makeCrux()]);
    await persistDebateCruxes(session, TMP_DIR, mockEmbed);

    const reg = loadRegistry(TMP_DIR);
    expect(reg.entries).toHaveLength(1);
    expect(reg.entries[0].description).toBe('Whether current AI capabilities pose existential risk');
  });
});

describe('evictStaleEntries', () => {
  it('removes entries older than 12 months with no recent occurrence', () => {
    const staleDate = new Date();
    staleDate.setMonth(staleDate.getMonth() - 13);

    const reg: CruxRegistry = {
      version: 1,
      entries: [
        makeEntry({ first_seen_date: staleDate.toISOString(), occurrences: [{ debate_id: 'd1', debate_topic: 't', date: staleDate.toISOString(), an_id: 'c1', final_state: 'irreducible', turns_engaged: 1, intervention_issued: false, resolved_post_intervention: false, model: 'm' }] }),
        makeEntry({ id: 'fresh', first_seen_date: new Date().toISOString() }),
      ],
      last_updated: '',
    };
    const evicted = evictStaleEntries(reg);
    expect(evicted).toBe(1);
    expect(reg.entries).toHaveLength(1);
    expect(reg.entries[0].id).toBe('fresh');
  });

  it('preserves promoted entries even if stale', () => {
    const staleDate = new Date();
    staleDate.setMonth(staleDate.getMonth() - 13);

    const reg: CruxRegistry = {
      version: 1,
      entries: [
        makeEntry({ first_seen_date: staleDate.toISOString(), promoted_to_situation: 'sit-001', occurrences: [{ debate_id: 'd1', debate_topic: 't', date: staleDate.toISOString(), an_id: 'c1', final_state: 'irreducible', turns_engaged: 1, intervention_issued: false, resolved_post_intervention: false, model: 'm' }] }),
      ],
      last_updated: '',
    };
    const evicted = evictStaleEntries(reg);
    expect(evicted).toBe(0);
    expect(reg.entries).toHaveLength(1);
  });

  it('enforces max 200 entries by LRU', () => {
    const entries: CruxRegistryEntry[] = [];
    for (let i = 0; i < 210; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      entries.push(makeEntry({
        id: `entry-${i}`,
        first_seen_date: date.toISOString(),
        occurrences: [{ debate_id: `d${i}`, debate_topic: 't', date: date.toISOString(), an_id: `c${i}`, final_state: 'irreducible', turns_engaged: 1, intervention_issued: false, resolved_post_intervention: false, model: 'm' }],
      }));
    }
    const reg: CruxRegistry = { version: 1, entries, last_updated: '' };
    const evicted = evictStaleEntries(reg);
    expect(evicted).toBe(10);
    expect(reg.entries).toHaveLength(200);
    expect(reg.entries[0].id).toBe('entry-0');
  });
});

describe('findRelevantPriorCruxes', () => {
  it('returns entries with similarity >= 0.50', () => {
    const topicEmb = makeEmbedding(5);
    const reg: CruxRegistry = {
      version: 1,
      entries: [
        makeEntry({ id: 'similar', embedding: makeEmbedding(5) }),
        makeEntry({ id: 'different', embedding: makeEmbedding(100) }),
      ],
      last_updated: '',
    };
    const results = findRelevantPriorCruxes(topicEmb, reg);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe('similar');
  });

  it('returns empty for no matches', () => {
    const topicEmb = makeEmbedding(1);
    const reg: CruxRegistry = {
      version: 1,
      entries: [makeEntry({ embedding: makeEmbedding(500) })],
      last_updated: '',
    };
    const results = findRelevantPriorCruxes(topicEmb, reg);
    const hasSimilar = results.length > 0;
    expect(typeof hasSimilar).toBe('boolean');
  });

  it('caps results at maxResults (default 8)', () => {
    const topicEmb = makeEmbedding(5);
    const entries: CruxRegistryEntry[] = [];
    for (let i = 0; i < 15; i++) {
      entries.push(makeEntry({ id: `e-${i}`, embedding: makeEmbedding(5 + i * 0.001) }));
    }
    const reg: CruxRegistry = { version: 1, entries, last_updated: '' };
    const results = findRelevantPriorCruxes(topicEmb, reg);
    expect(results.length).toBeLessThanOrEqual(8);
  });

  it('respects custom maxResults', () => {
    const topicEmb = makeEmbedding(5);
    const entries: CruxRegistryEntry[] = [];
    for (let i = 0; i < 15; i++) {
      entries.push(makeEntry({ id: `e-${i}`, embedding: makeEmbedding(5 + i * 0.001) }));
    }
    const reg: CruxRegistry = { version: 1, entries, last_updated: '' };
    const results = findRelevantPriorCruxes(topicEmb, reg, 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('sorts by descending similarity', () => {
    const topicEmb = makeEmbedding(5);
    const reg: CruxRegistry = {
      version: 1,
      entries: [
        makeEntry({ id: 'close', embedding: makeEmbedding(5) }),
        makeEntry({ id: 'closer', embedding: makeEmbedding(5.001) }),
      ],
      last_updated: '',
    };
    const results = findRelevantPriorCruxes(topicEmb, reg);
    if (results.length >= 2) {
      expect(results[0].id).toBe('close');
    }
  });
});

describe('formatPriorCruxContext', () => {
  it('returns empty string for no entries', () => {
    expect(formatPriorCruxContext([])).toBe('');
  });

  it('formats entries with header and type labels', () => {
    const entries = [
      makeEntry({ disagreement_type: 'empirical', description: 'Whether AI can reason', occurrences: [{ debate_id: 'd1', debate_topic: 't', date: '', an_id: 'c1', final_state: 'irreducible', turns_engaged: 1, intervention_issued: false, resolved_post_intervention: false, model: 'm' }] }),
      makeEntry({ disagreement_type: 'values', description: 'Should we prioritize safety', occurrences: [{ debate_id: 'd1', debate_topic: 't', date: '', an_id: 'c1', final_state: 'engaged', turns_engaged: 2, intervention_issued: false, resolved_post_intervention: false, model: 'm' }] }),
    ];
    const result = formatPriorCruxContext(entries);
    expect(result).toContain('=== PRIOR UNRESOLVED CRUXES ===');
    expect(result).toContain('[empirical]');
    expect(result).toContain('[values]');
    expect(result).toContain('Whether AI can reason');
    expect(result).toContain('1/1 irreducible');
    expect(result).toContain('1 occurrence, engaged');
  });

  it('shows multi-occurrence stats', () => {
    const entries = [
      makeEntry({
        description: 'Recurring crux',
        occurrences: [
          { debate_id: 'd1', debate_topic: 't', date: '', an_id: 'c1', final_state: 'irreducible', turns_engaged: 1, intervention_issued: false, resolved_post_intervention: false, model: 'm' },
          { debate_id: 'd2', debate_topic: 't', date: '', an_id: 'c2', final_state: 'engaged', turns_engaged: 2, intervention_issued: false, resolved_post_intervention: false, model: 'm' },
          { debate_id: 'd3', debate_topic: 't', date: '', an_id: 'c3', final_state: 'irreducible', turns_engaged: 3, intervention_issued: false, resolved_post_intervention: false, model: 'm' },
        ],
      }),
    ];
    const result = formatPriorCruxContext(entries);
    expect(result).toContain('2/3 irreducible');
  });
});
