// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3512 — the reflector sees only the nodes THIS debate engaged (ranked, with their debate
// record), the full taxonomy is an opt-in sweep, and an edit whose cited claims do not reference
// the node it edits is flagged and refused by apply.
//
// Regression source: debate 55447f02 proposed 4 edits, 3 of them to nodes that were never injected
// and never cited, citing claim ids that reference other nodes (or prose).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mockApi, mockTaxonomyState, makeSession } from './storeTestHarness';
import { useDebateStore } from '../../useDebateStore';
import { reflectionPrompt } from '../../../prompts/debate';

const povNode = (id: string, label = `L ${id}`) => ({ id, category: 'Beliefs', label, description: `D ${id}` });

/** The camp file holds 4 nodes; the debate engages only two of them. */
function seedTaxonomy() {
  mockTaxonomyState.accelerationist = {
    nodes: [povNode('acc-beliefs-003'), povNode('acc-beliefs-010'), povNode('acc-beliefs-020'), povNode('acc-intentions-027')],
  } as never;
}

function seedDebate(overrides: Record<string, unknown> = {}) {
  useDebateStore.setState({
    activeDebate: makeSession({
      phase: 'debate',
      active_povers: ['accelerationist'],
      transcript: [
        {
          id: 'e1', timestamp: 't', type: 'statement', speaker: 'accelerationist', content: 'X',
          taxonomy_refs: [{ node_id: 'acc-beliefs-010' }],
          metadata: { injection_manifest: { povNodeIds: ['acc-beliefs-010', 'acc-beliefs-020'] } },
        },
      ],
      argument_network: {
        nodes: [
          { id: 'AN-1', text: 'claim about 010', speaker: 'accelerationist', source_entry_id: 'e1', taxonomy_refs: ['acc-beliefs-010'], turn_number: 1, computed_strength: 0.6 },
          { id: 'AN-6', text: 'claim about 020', speaker: 'safetyist', source_entry_id: 'e1', taxonomy_refs: ['acc-beliefs-020'], turn_number: 1, computed_strength: 0.7 },
        ],
        edges: [],
      },
      ...overrides,
    }) as never,
  });
}

const reflectionNodes = () => (reflectionPrompt as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![4] as { id: string; engagement?: unknown }[];
const sweptNodes = () => (reflectionPrompt as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![11] as { id: string }[] | undefined;

function respondWithEdit(edit: Record<string, unknown>) {
  mockApi.generateText.mockResolvedValue({
    text: JSON.stringify({ reflection_summary: 's', edits: [{ disposition: 'edit_existing', category: 'Beliefs', current_label: 'Old', proposed_label: 'New', current_description: 'd', proposed_description: 'nd', rationale: 'r', confidence: 'high', ...edit }] }),
  });
}

afterEach(() => {
  mockTaxonomyState.accelerationist = { nodes: [] } as never;
});

describe('requestReflections — engaged-node scoping (t/3512)', () => {
  it('passes only the nodes the debate engaged, not the whole camp file', async () => {
    seedTaxonomy();
    seedDebate();
    respondWithEdit({ edit_type: 'revise', node_id: 'acc-beliefs-010', evidence_entries: ['AN-1'] });

    await useDebateStore.getState().requestReflections();

    expect(reflectionNodes().map(n => n.id)).toEqual(['acc-beliefs-010', 'acc-beliefs-020']);
    // The never-engaged nodes that the old code sent are gone.
    expect(reflectionNodes().map(n => n.id)).not.toContain('acc-beliefs-003');
    expect(reflectionNodes().map(n => n.id)).not.toContain('acc-intentions-027');
    expect(sweptNodes()).toBeUndefined();
  });

  it('ranks the cited node above the merely-injected one and attaches the debate record', async () => {
    seedTaxonomy();
    seedDebate();
    respondWithEdit({ edit_type: 'revise', node_id: 'acc-beliefs-010', evidence_entries: ['AN-1'] });

    await useDebateStore.getState().requestReflections();

    const [first, second] = reflectionNodes();
    expect(first.id).toBe('acc-beliefs-010');
    expect(first.engagement).toMatchObject({ injected: true, citations: 1, claimIds: ['AN-1'] });
    expect(second.engagement).toMatchObject({ injected: true, citations: 0, claimIds: ['AN-6'] });
  });

  it('offers the never-engaged remainder only when the sweep is requested', async () => {
    seedTaxonomy();
    seedDebate();
    respondWithEdit({ edit_type: 'revise', node_id: 'acc-beliefs-010', evidence_entries: ['AN-1'] });

    await useDebateStore.getState().requestReflections({ fullTaxonomySweep: true });

    expect(sweptNodes()?.map(n => n.id)).toEqual(['acc-beliefs-003', 'acc-intentions-027']);
  });

  it('falls back to the full taxonomy when the debate engaged nothing for this camp', async () => {
    seedTaxonomy();
    seedDebate({ transcript: [{ id: 'e1', timestamp: 't', type: 'statement', speaker: 'accelerationist', content: 'X', taxonomy_refs: [] }], argument_network: { nodes: [], edges: [] } });
    respondWithEdit({ edit_type: 'revise', node_id: 'acc-beliefs-003', evidence_entries: [] });

    await useDebateStore.getState().requestReflections();

    expect(reflectionNodes()).toHaveLength(4);
    expect(reflectionNodes()[0].engagement).toBeUndefined();
  });
});

describe('reflection edits — evidence validation (t/3512)', () => {
  it('flags an edit whose cited claims reference a different node', async () => {
    seedTaxonomy();
    seedDebate();
    // The acc-beliefs-003 case: cites AN-6, which references acc-beliefs-020.
    respondWithEdit({ edit_type: 'revise', node_id: 'acc-beliefs-003', evidence_entries: ['AN-6'] });

    await useDebateStore.getState().requestReflections();

    const edit = useDebateStore.getState().reflections[0].edits[0];
    expect(edit.evidence_supported).toBe(false);
    expect(edit.evidence_note).toContain('do not reference acc-beliefs-003');
    expect(edit.engagement).toEqual({ injected: false, citations: 0, claim_count: 0, attacked_count: 0 });
  });

  it('marks an edit supported when a cited claim references the edited node', async () => {
    seedTaxonomy();
    seedDebate();
    respondWithEdit({ edit_type: 'revise', node_id: 'acc-beliefs-010', evidence_entries: ['AN-1'] });

    await useDebateStore.getState().requestReflections();

    const edit = useDebateStore.getState().reflections[0].edits[0];
    expect(edit.evidence_supported).toBe(true);
    expect(edit.engagement).toMatchObject({ citations: 1, claim_count: 1 });
  });

  it('refuses to apply a flagged edit, and applies it only under an explicit override', async () => {
    seedTaxonomy();
    seedDebate();
    respondWithEdit({ edit_type: 'revise', node_id: 'acc-beliefs-003', evidence_entries: ['Skeptic turns on leakage'] });
    await useDebateStore.getState().requestReflections();

    const refused = await useDebateStore.getState().applyReflectionEdit('accelerationist', 0);
    expect(refused.ok).toBe(false);
    expect(refused.error).toContain('Unsupported by debate evidence');
    expect(mockTaxonomyState.updatePovNode).not.toHaveBeenCalled();
    expect(useDebateStore.getState().reflections[0].edits[0].status).toBe('pending');

    const overridden = await useDebateStore.getState().applyReflectionEdit('accelerationist', 0, undefined, { allowUnsupportedEvidence: true });
    expect(overridden.ok).toBe(true);
    expect(mockTaxonomyState.updatePovNode).toHaveBeenCalled();
  });
});
