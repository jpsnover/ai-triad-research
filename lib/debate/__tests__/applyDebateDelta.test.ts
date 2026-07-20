// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Unit tests for the pure delta-merge function (t/1634; HLD: docs/hld-delta-debate-save.md).
// Self-certified under /add-test: pure test file, no new public API, no schema change.
//
// Coverage: append-only transcript, AN node/edge upsert-by-id, node/edge removal,
// version-mismatch ActionableError, _saveVersion increment, absent-version-as-0
// lazy migration, meta shallow-merge, absent argument_network init, input purity
// (deep-frozen), the TL-required removal-wins collision case, and the HLD-required
// "changedFields overlay loses to a structured surface / stripped _saveVersion" case.

import { describe, it, expect } from 'vitest';
import { applyDebateDelta } from '../applyDebateDelta.js';
import { ActionableError } from '../errors.js';
import type {
  DebateSession,
  DebateDelta,
  TranscriptEntry,
  ArgumentNetworkNode,
  ArgumentNetworkEdge,
  ANMutation,
} from '../types.js';

// ── Fixture builders ────────────────────────────────────

function makeSession(overrides: Partial<DebateSession> = {}): DebateSession {
  return {
    id: 'debate-1',
    title: 'Test Debate',
    created_at: '2026-07-17T00:00:00.000Z',
    updated_at: '2026-07-17T00:00:00.000Z',
    phase: 'debate',
    topic: { original: 'o', refined: 'r', final: 'f' },
    source_type: 'topic',
    source_ref: '',
    source_content: '',
    active_povers: [],
    user_is_pover: false,
    transcript: [],
    context_summaries: [],
    ...overrides,
  };
}

function makeTranscriptEntry(id: string): TranscriptEntry {
  return {
    id,
    timestamp: '2026-07-17T00:00:01.000Z',
    type: 'statement',
    speaker: 'accelerationist',
    content: `content-${id}`,
    taxonomy_refs: [],
  };
}

function makeNode(id: string, text = `text-${id}`): ArgumentNetworkNode {
  return {
    id,
    text,
    speaker: 'accelerationist',
    source_entry_id: 'entry-1',
    taxonomy_refs: [],
    turn_number: 1,
  };
}

function makeEdge(id: string, type: ArgumentNetworkEdge['type'] = 'supports'): ArgumentNetworkEdge {
  return { id, source: 'n1', target: 'n2', type };
}

function makeMutation(id: string): ANMutation {
  return { id, type: 'add_edge', source: 'claim_extraction', provisional: false, hardened: true };
}

function makeDelta(overrides: Partial<DebateDelta> = {}): DebateDelta {
  return {
    debateId: 'debate-1',
    baseVersion: 0,
    newTranscriptEntries: [],
    changedNodes: [],
    changedEdges: [],
    newMutations: [],
    ...overrides,
  };
}

// Recursively freeze so any in-place mutation of an input throws in strict mode.
function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object') {
    for (const value of Object.values(obj)) deepFreeze(value);
    Object.freeze(obj);
  }
  return obj;
}

// ══════════════════════════════════════════════════════════

describe('applyDebateDelta', () => {
  it('appends new transcript entries to the base transcript (append-only)', () => {
    const session = makeSession({
      _saveVersion: 3,
      transcript: [makeTranscriptEntry('t1')],
    });
    const delta = makeDelta({
      baseVersion: 3,
      newTranscriptEntries: [makeTranscriptEntry('t2'), makeTranscriptEntry('t3')],
    });

    const result = applyDebateDelta(session, delta);

    expect(result.transcript.map((t) => t.id)).toEqual(['t1', 't2', 't3']);
  });

  it('upserts argument-network nodes by id (last-wins)', () => {
    const session = makeSession({
      _saveVersion: 1,
      argument_network: { nodes: [makeNode('n1', 'old'), makeNode('n2')], edges: [], mutations: [] },
    });
    const delta = makeDelta({
      baseVersion: 1,
      changedNodes: [makeNode('n1', 'new'), makeNode('n3')],
    });

    const result = applyDebateDelta(session, delta);
    const nodes = result.argument_network!.nodes;

    expect(nodes.map((n) => n.id).sort()).toEqual(['n1', 'n2', 'n3']);
    expect(nodes.find((n) => n.id === 'n1')!.text).toBe('new');
  });

  it('upserts argument-network edges by id (last-wins)', () => {
    const session = makeSession({
      _saveVersion: 1,
      argument_network: { nodes: [], edges: [makeEdge('e1', 'supports')], mutations: [] },
    });
    const delta = makeDelta({
      baseVersion: 1,
      changedEdges: [makeEdge('e1', 'attacks'), makeEdge('e2')],
    });

    const result = applyDebateDelta(session, delta);
    const edges = result.argument_network!.edges;

    expect(edges.map((e) => e.id).sort()).toEqual(['e1', 'e2']);
    expect(edges.find((e) => e.id === 'e1')!.type).toBe('attacks');
  });

  it('removes nodes and edges named in removedNodeIds / removedEdgeIds', () => {
    const session = makeSession({
      _saveVersion: 2,
      argument_network: {
        nodes: [makeNode('n1'), makeNode('n2'), makeNode('n3')],
        edges: [makeEdge('e1'), makeEdge('e2')],
        mutations: [],
      },
    });
    const delta = makeDelta({
      baseVersion: 2,
      removedNodeIds: ['n2'],
      removedEdgeIds: ['e1'],
    });

    const result = applyDebateDelta(session, delta);

    expect(result.argument_network!.nodes.map((n) => n.id).sort()).toEqual(['n1', 'n3']);
    expect(result.argument_network!.edges.map((e) => e.id)).toEqual(['e2']);
  });

  it('appends new mutations to the base mutations', () => {
    const session = makeSession({
      _saveVersion: 1,
      argument_network: { nodes: [], edges: [], mutations: [makeMutation('m1')] },
    });
    const delta = makeDelta({ baseVersion: 1, newMutations: [makeMutation('m2')] });

    const result = applyDebateDelta(session, delta);

    expect(result.argument_network!.mutations!.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('initializes argument_network when the base session has none', () => {
    const session = makeSession({ _saveVersion: 0 }); // no argument_network
    const delta = makeDelta({
      baseVersion: 0,
      changedNodes: [makeNode('n1')],
      changedEdges: [makeEdge('e1')],
      newMutations: [makeMutation('m1')],
    });

    const result = applyDebateDelta(session, delta);

    expect(result.argument_network).toEqual({
      nodes: [makeNode('n1')],
      edges: [makeEdge('e1')],
      mutations: [makeMutation('m1')],
    });
  });

  it('throws ActionableError when baseVersion does not match the stored _saveVersion', () => {
    const session = makeSession({ _saveVersion: 5 });
    const delta = makeDelta({ baseVersion: 4 });

    let thrown: unknown;
    try {
      applyDebateDelta(session, delta);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(ActionableError);
    const err = thrown as ActionableError;
    // ActionableError composes its fields into the message.
    expect(err.message).toContain('baseVersion');
    expect(err.message).toContain('4');
    expect(err.message).toContain('5');
  });

  it('increments _saveVersion from N to N+1', () => {
    const session = makeSession({ _saveVersion: 7 });
    const delta = makeDelta({ baseVersion: 7 });

    const result = applyDebateDelta(session, delta);

    expect(result._saveVersion).toBe(8);
  });

  it('treats an absent _saveVersion as 0 (lazy migration) and sets it to 1', () => {
    const session = makeSession(); // _saveVersion undefined
    const delta = makeDelta({ baseVersion: 0 });

    const result = applyDebateDelta(session, delta);

    expect(result._saveVersion).toBe(1);
  });

  it('shallow-merges meta onto the root', () => {
    const session = makeSession({ _saveVersion: 1, title: 'Old', phase: 'debate' });
    const delta = makeDelta({
      baseVersion: 1,
      meta: { title: 'New', phase: 'closed' },
    });

    const result = applyDebateDelta(session, delta);

    expect(result.title).toBe('New');
    expect(result.phase).toBe('closed');
  });

  it('overlays changedFields (per-turn analytics with no dedicated surface)', () => {
    const session = makeSession({ _saveVersion: 1 });
    const delta = makeDelta({
      baseVersion: 1,
      changedFields: { qbaf_timeline: [{ turn: 1 } as never] },
    });

    const result = applyDebateDelta(session, delta);

    expect(result.qbaf_timeline).toEqual([{ turn: 1 }]);
  });

  // ── TL-required: removal-wins collision ──────────────
  it('resolves a same-id changed+removed collision as removal-wins', () => {
    const session = makeSession({
      _saveVersion: 1,
      argument_network: { nodes: [makeNode('n1')], edges: [makeEdge('e1')], mutations: [] },
    });
    const delta = makeDelta({
      baseVersion: 1,
      changedNodes: [makeNode('n1', 'resurrected'), makeNode('n2')],
      removedNodeIds: ['n1'],
      changedEdges: [makeEdge('e1', 'attacks'), makeEdge('e2')],
      removedEdgeIds: ['e1'],
    });

    const result = applyDebateDelta(session, delta);

    // n1/e1 appear in BOTH changed and removed → removal wins.
    expect(result.argument_network!.nodes.map((n) => n.id)).toEqual(['n2']);
    expect(result.argument_network!.edges.map((e) => e.id)).toEqual(['e2']);
  });

  // ── HLD-required: overlay loses to structured surfaces + version authority ──
  it('lets structured surfaces win over a changedFields overlay and strips client _saveVersion', () => {
    const session = makeSession({
      _saveVersion: 4,
      transcript: [makeTranscriptEntry('t1')],
      argument_network: { nodes: [], edges: [], mutations: [] },
    });
    const delta = makeDelta({
      baseVersion: 4,
      newTranscriptEntries: [makeTranscriptEntry('t2')],
      changedNodes: [makeNode('structured')],
      changedFields: {
        // A generic overlay could carry a whole structured surface and a stale
        // version. Both must be overridden by the purpose-built merges + guard.
        _saveVersion: 999,
        transcript: [makeTranscriptEntry('overlay-should-lose')],
        argument_network: { nodes: [makeNode('overlay-node')], edges: [], mutations: [] },
      } as Partial<DebateSession>,
    });

    const result = applyDebateDelta(session, delta);

    // Structured transcript append wins over the overlay's transcript.
    expect(result.transcript.map((t) => t.id)).toEqual(['t1', 't2']);
    // Structured AN upsert wins over the overlay's argument_network.
    expect(result.argument_network!.nodes.map((n) => n.id)).toEqual(['structured']);
    // Client-supplied _saveVersion is ignored; version is baseVersion + 1.
    expect(result._saveVersion).toBe(5);
  });

  // ── Purity ───────────────────────────────────────────
  it('never mutates its inputs (deep-frozen session and delta)', () => {
    const session = deepFreeze(
      makeSession({
        _saveVersion: 1,
        transcript: [makeTranscriptEntry('t1')],
        argument_network: { nodes: [makeNode('n1')], edges: [makeEdge('e1')], mutations: [makeMutation('m1')] },
      }),
    );
    const delta = deepFreeze(
      makeDelta({
        baseVersion: 1,
        newTranscriptEntries: [makeTranscriptEntry('t2')],
        changedNodes: [makeNode('n2')],
        changedEdges: [makeEdge('e2')],
        removedNodeIds: ['n1'],
        newMutations: [makeMutation('m2')],
        meta: { title: 'New' },
        changedFields: { qbaf_timeline: [] },
      }),
    );

    // Would throw if the function mutated any frozen input.
    expect(() => applyDebateDelta(session, delta)).not.toThrow();

    // Base session is untouched.
    expect(session.transcript.map((t) => t.id)).toEqual(['t1']);
    expect(session.argument_network!.nodes.map((n) => n.id)).toEqual(['n1']);
    expect(session._saveVersion).toBe(1);
    expect(session.title).toBe('Test Debate');
  });
});
