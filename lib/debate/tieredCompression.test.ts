import { describe, it, expect } from 'vitest';
import {
  buildMediumTierSummary,
  buildDistantTierSummary,
  buildTieredContext,
  formatTieredTranscript,
} from './tieredCompression';
import type {
  TranscriptEntry,
  ArgumentNetworkNode,
  ArgumentNetworkEdge,
  CommitmentStore,
} from './types';

function makeEntry(id: string, speaker: string, content: string, type: string = 'statement'): TranscriptEntry {
  return {
    id, timestamp: new Date().toISOString(),
    type: type as TranscriptEntry['type'],
    speaker: speaker as TranscriptEntry['speaker'],
    content, taxonomy_refs: [],
  };
}

function makeNode(overrides: Partial<ArgumentNetworkNode> & { id: string }): ArgumentNetworkNode {
  return {
    text: `Claim ${overrides.id}`,
    speaker: 'prometheus',
    source_entry_id: 'e1',
    taxonomy_refs: [],
    turn_number: 1,
    base_strength: 0.6,
    computed_strength: 0.6,
    ...overrides,
  };
}

function makeEdge(overrides: Partial<ArgumentNetworkEdge> & { source: string; target: string }): ArgumentNetworkEdge {
  return {
    id: `${overrides.source}->${overrides.target}`,
    type: 'attacks',
    ...overrides,
  };
}

describe('buildMediumTierSummary', () => {
  it('returns empty string when no claims found in entries', () => {
    const entries = [makeEntry('e1', 'prometheus', 'hello')];
    const result = buildMediumTierSummary(entries, [], [], {});
    expect(result).toBe('');
  });

  it('groups claims by speaker and sorts by strength', () => {
    const entries = [makeEntry('e1', 'prometheus', 'test')];
    const nodes = [
      makeNode({ id: 'AN-1', speaker: 'prometheus', source_entry_id: 'e1', computed_strength: 0.8, text: 'Strong claim' }),
      makeNode({ id: 'AN-2', speaker: 'prometheus', source_entry_id: 'e1', computed_strength: 0.4, text: 'Weak claim' }),
    ];
    const result = buildMediumTierSummary(entries, nodes, [], {});
    expect(result).toContain("Prometheus's key claims:");
    expect(result).toContain('Strong claim');
    expect(result).toContain('Weak claim');
    expect(result.indexOf('Strong claim')).toBeLessThan(result.indexOf('Weak claim'));
  });

  it('includes concessions from commitment store', () => {
    const entries = [makeEntry('e1', 'sentinel', 'test')];
    const commitments: Record<string, CommitmentStore> = {
      sentinel: { asserted: [], conceded: ['AI risk is real'], challenged: [] },
    };
    const result = buildMediumTierSummary(entries, [], [], commitments);
    expect(result).toContain('Sentinel conceded: AI risk is real');
  });

  it('includes cross-POV edge counts', () => {
    const entries = [makeEntry('e1', 'prometheus', 'test')];
    const nodes = [
      makeNode({ id: 'AN-1', speaker: 'prometheus', source_entry_id: 'e1' }),
      makeNode({ id: 'AN-2', speaker: 'sentinel', source_entry_id: 'e2' }),
    ];
    const edges = [makeEdge({ source: 'AN-1', target: 'AN-2', type: 'attacks' })];
    const result = buildMediumTierSummary(entries, nodes, edges, {});
    expect(result).toContain('Cross-POV interactions: 1 attacks, 0 supports');
  });
});

describe('buildDistantTierSummary', () => {
  it('includes network size', () => {
    const nodes = [makeNode({ id: 'AN-1' })];
    const edges = [makeEdge({ source: 'AN-1', target: 'AN-2', type: 'attacks' })];
    const result = buildDistantTierSummary(nodes, edges, {});
    expect(result).toContain('Argument network: 1 claims, 1 attacks, 0 supports');
  });

  it('includes crux tracker summary', () => {
    const result = buildDistantTierSummary([], [], {}, [
      { id: 'AN-1', description: 'AI sentience', state: 'resolved', identified_turn: 1, history: [], attacking_claim_ids: [], speakers_involved: [], last_computed_strength: 0.5, support_polarity: 0.9 },
      { id: 'AN-2', description: 'Open source risk', state: 'engaged', identified_turn: 2, history: [], attacking_claim_ids: [], speakers_involved: [], last_computed_strength: 0.5, support_polarity: 0.5 },
    ]);
    expect(result).toContain('Resolved cruxes: AI sentience');
    expect(result).toContain('Active cruxes: Open source risk');
  });

  it('includes concession summaries', () => {
    const commitments: Record<string, CommitmentStore> = {
      prometheus: { asserted: [], conceded: ['point A', 'point B'], challenged: ['point C'] },
    };
    const result = buildDistantTierSummary([], [], commitments);
    expect(result).toContain('Prometheus has conceded 2 point(s)');
    expect(result).toContain('Prometheus has challenged 1 point(s)');
  });

  it('includes top-strength claims', () => {
    const nodes = [
      makeNode({ id: 'AN-1', speaker: 'prometheus', computed_strength: 0.9, text: 'Very strong claim' }),
      makeNode({ id: 'AN-2', speaker: 'sentinel', computed_strength: 0.3, text: 'Weak claim' }),
    ];
    const result = buildDistantTierSummary(nodes, [], {});
    expect(result).toContain('Strongest surviving claims');
    expect(result).toContain('Very strong claim');
    expect(result).not.toContain('Weak claim');
  });
});

describe('buildTieredContext', () => {
  it('returns null tiers for short transcripts', () => {
    const transcript = Array.from({ length: 5 }, (_, i) =>
      makeEntry(`e${i}`, 'prometheus', `Turn ${i}`),
    );
    const result = buildTieredContext({
      transcript, nodes: [], edges: [], commitments: {},
      existingSummaries: [],
    });
    expect(result.distantSummary).toBeNull();
    expect(result.mediumSummary).toBeNull();
  });

  it('produces medium tier for 9-16 entries', () => {
    const transcript = Array.from({ length: 12 }, (_, i) =>
      makeEntry(`e${i}`, i % 2 === 0 ? 'prometheus' : 'sentinel', `Turn ${i}`),
    );
    const nodes = [makeNode({ id: 'AN-1', source_entry_id: 'e0' })];
    const result = buildTieredContext({
      transcript, nodes, edges: [], commitments: {},
      existingSummaries: [],
    });
    expect(result.mediumSummary).toBeTruthy();
    expect(result.mediumEntryIds.length).toBeGreaterThan(0);
  });

  it('produces distant tier for 17+ entries', () => {
    const transcript = Array.from({ length: 20 }, (_, i) =>
      makeEntry(`e${i}`, i % 2 === 0 ? 'prometheus' : 'sentinel', `Turn ${i}`),
    );
    const nodes = [
      makeNode({ id: 'AN-1', source_entry_id: 'e0', computed_strength: 0.8 }),
      makeNode({ id: 'AN-2', source_entry_id: 'e5', speaker: 'sentinel', computed_strength: 0.7 }),
    ];
    const commitments: Record<string, CommitmentStore> = {
      prometheus: { asserted: ['claim A'], conceded: ['point X'], challenged: [] },
    };
    const result = buildTieredContext({
      transcript, nodes, edges: [], commitments,
      existingSummaries: [],
    });
    expect(result.distantSummary).toBeTruthy();
    expect(result.distantEntryIds.length).toBeGreaterThan(0);
    expect(result.mediumSummary).toBeTruthy();
  });
});

describe('formatTieredTranscript', () => {
  it('includes all three tiers for long debates', () => {
    const transcript = Array.from({ length: 20 }, (_, i) =>
      makeEntry(`e${i}`, i % 2 === 0 ? 'prometheus' : 'sentinel', `Turn ${i}`),
    );
    const nodes = [
      makeNode({ id: 'AN-1', source_entry_id: 'e0', computed_strength: 0.8 }),
    ];
    const commitments: Record<string, CommitmentStore> = {
      accelerationist: { asserted: ['claim A'], conceded: ['point X'], challenged: [] },
    };
    const result = formatTieredTranscript(transcript, [], nodes, [], commitments);
    expect(result).toContain('[Distant context');
    expect(result).toContain('[Medium context');
    expect(result).toContain('Turn 19');
  });

  it('falls back to legacy summary when no tiered summaries', () => {
    const transcript = [makeEntry('e1', 'prometheus', 'Turn 1')];
    const summaries = [{ up_to_entry_id: 'e0', summary: 'Legacy summary text' }];
    const result = formatTieredTranscript(transcript, summaries, [], [], {});
    expect(result).toContain('[Earlier debate summary]: Legacy summary text');
  });
});
