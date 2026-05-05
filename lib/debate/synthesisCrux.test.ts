// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { extractArraysFromPartialJson } from './helpers.js';
import type {
  SynthesisCrux,
  AggregatedCrux,
  CruxSource,
  SynthesisResult,
} from './types.js';

// ── SynthesisCrux parsing ────────────────────────────────

describe('SynthesisCrux extraction from synthesis response', () => {
  it('extracts cruxes with full fields from valid JSON', () => {
    const synthesisJson = JSON.stringify({
      areas_of_agreement: [],
      areas_of_disagreement: [],
      cruxes: [
        {
          question: 'Does scaling AI models inherently increase existential risk?',
          if_yes: 'Sentinel\'s position strengthens — pause/regulate scaling',
          if_no: 'Prometheus\'s position strengthens — scaling is safe to continue',
          type: 'EMPIRICAL',
          resolution_status: 'active',
          resolution_evidence: null,
          speakers: ['prometheus', 'sentinel'],
        },
        {
          question: 'Can AI alignment be solved before AGI arrives?',
          if_yes: 'Prometheus\'s confidence in safe scaling is justified',
          if_no: 'Sentinel\'s call for pause gains urgency',
          type: 'EMPIRICAL',
          resolution_status: 'irreducible',
          speakers: ['prometheus', 'sentinel', 'cassandra'],
        },
      ],
      unresolved_questions: [],
    });

    const result = extractArraysFromPartialJson(synthesisJson);
    const cruxes = result.cruxes as SynthesisCrux[];

    expect(cruxes).toHaveLength(2);
    expect(cruxes[0].question).toBe('Does scaling AI models inherently increase existential risk?');
    expect(cruxes[0].type).toBe('EMPIRICAL');
    expect(cruxes[0].resolution_status).toBe('active');
    expect(cruxes[0].speakers).toEqual(['prometheus', 'sentinel']);
    expect(cruxes[1].resolution_status).toBe('irreducible');
    expect(cruxes[1].speakers).toHaveLength(3);
  });

  it('extracts cruxes from truncated JSON response', () => {
    const truncated = `{
      "areas_of_agreement": [{"point": "Both agree on X", "povers": ["prometheus"]}],
      "cruxes": [
        {"question": "Is open-source AI safer?", "type": "EMPIRICAL", "resolution_status": "active"}
      ],
      "unresolved_questions": ["What ab`;

    const result = extractArraysFromPartialJson(truncated);
    const cruxes = result.cruxes as SynthesisCrux[];

    expect(cruxes).toHaveLength(1);
    expect(cruxes[0].question).toBe('Is open-source AI safer?');
    expect(cruxes[0].type).toBe('EMPIRICAL');
  });

  it('handles cruxes with minimal fields', () => {
    const json = JSON.stringify({
      cruxes: [{ question: 'Is X true?' }],
    });

    const result = extractArraysFromPartialJson(json);
    const cruxes = result.cruxes as SynthesisCrux[];

    expect(cruxes).toHaveLength(1);
    expect(cruxes[0].question).toBe('Is X true?');
    expect(cruxes[0].type).toBeUndefined();
    expect(cruxes[0].resolution_status).toBeUndefined();
    expect(cruxes[0].speakers).toBeUndefined();
  });
});

// ── Type shape validation ────────────────────────────────

describe('SynthesisResult type includes cruxes', () => {
  it('cruxes field is optional on SynthesisResult', () => {
    const withCruxes: SynthesisResult = {
      areas_of_agreement: [],
      areas_of_disagreement: [],
      unresolved_questions: [],
      taxonomy_coverage: [],
      cruxes: [
        {
          question: 'Test crux',
          type: 'VALUES',
          resolution_status: 'active',
          speakers: ['prometheus', 'sentinel'],
        },
      ],
    };
    expect(withCruxes.cruxes).toHaveLength(1);

    const withoutCruxes: SynthesisResult = {
      areas_of_agreement: [],
      areas_of_disagreement: [],
      unresolved_questions: [],
      taxonomy_coverage: [],
    };
    expect(withoutCruxes.cruxes).toBeUndefined();
  });
});

// ── AggregatedCrux and CruxSource type shape ─────────────

describe('AggregatedCrux type', () => {
  it('can be constructed with required fields', () => {
    const source: CruxSource = {
      debate_id: 'debate-001',
      debate_topic: 'AI Governance Frameworks',
      crux_tracker_id: 'crux-node-42',
      identified_turn: 3,
      final_state: 'resolved',
    };

    const crux: AggregatedCrux = {
      id: 'crux-001',
      statement: 'Whether scaling AI models inherently increases risk',
      type: 'empirical',
      sources: [source],
      linked_node_ids: ['acc-beliefs-012', 'saf-beliefs-003'],
      frequency: 1,
      resolution_summary: { resolved: 1, active: 0, irreducible: 0 },
    };

    expect(crux.id).toBe('crux-001');
    expect(crux.sources).toHaveLength(1);
    expect(crux.sources[0].final_state).toBe('resolved');
    expect(crux.linked_node_ids).toHaveLength(2);
    expect(crux.linked_conflict_ids).toBeUndefined();
  });

  it('supports optional linked_conflict_ids', () => {
    const crux: AggregatedCrux = {
      id: 'crux-002',
      statement: 'Whether open-source AI is safer than closed-source',
      type: 'values',
      sources: [],
      linked_node_ids: [],
      linked_conflict_ids: ['conflict-pair-007'],
      frequency: 3,
      resolution_summary: { resolved: 0, active: 2, irreducible: 1 },
    };

    expect(crux.linked_conflict_ids).toEqual(['conflict-pair-007']);
    expect(crux.resolution_summary.active).toBe(2);
    expect(crux.resolution_summary.irreducible).toBe(1);
  });

  it('aggregates multiple sources from different debates', () => {
    const sources: CruxSource[] = [
      {
        debate_id: 'debate-001',
        debate_topic: 'AI Safety Frameworks',
        crux_tracker_id: 'node-a',
        identified_turn: 2,
        final_state: 'resolved',
      },
      {
        debate_id: 'debate-002',
        debate_topic: 'AI Governance Models',
        crux_tracker_id: 'node-b',
        identified_turn: 4,
        final_state: 'irreducible',
      },
      {
        debate_id: 'debate-003',
        debate_topic: 'Open Source AI Policy',
        crux_tracker_id: 'node-c',
        identified_turn: 1,
        final_state: 'engaged',
      },
    ];

    const crux: AggregatedCrux = {
      id: 'crux-003',
      statement: 'Can alignment research keep pace with capabilities research?',
      type: 'empirical',
      sources,
      linked_node_ids: ['acc-beliefs-001'],
      frequency: 3,
      resolution_summary: { resolved: 1, active: 1, irreducible: 1 },
    };

    expect(crux.frequency).toBe(3);
    expect(crux.sources).toHaveLength(3);
    expect(crux.sources.map(s => s.final_state)).toEqual(['resolved', 'irreducible', 'engaged']);
  });
});
