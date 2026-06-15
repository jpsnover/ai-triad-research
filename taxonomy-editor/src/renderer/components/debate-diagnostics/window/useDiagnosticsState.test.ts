// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDiagnosticsState } from './useDiagnosticsState';
import type { DebateSession, ArgumentNetworkNode } from '../../../types/debate';

vi.mock('@bridge', () => ({
  api: {
    onDiagnosticsStateUpdate: vi.fn().mockReturnValue(() => {}),
    onReloadTaxonomy: vi.fn().mockReturnValue(() => {}),
    loadTaxonomyFile: vi.fn().mockResolvedValue(null),
    loadPolicyRegistry: vi.fn().mockResolvedValue(null),
    loadEdges: vi.fn().mockResolvedValue(null),
    clipboardWriteText: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: vi.fn().mockReturnValue(null),
}));
vi.mock('@lib/debate/qbaf', () => ({
  computeQbafStrengths: vi.fn().mockReturnValue([]),
}));
vi.mock('@lib/debate/types', async (importOriginal) => {
  const original = await importOriginal<typeof import('@lib/debate/types')>();
  return {
    ...original,
    POVER_INFO: {
      accelerationist: { label: 'Accelerationist', pov: 'accelerationist' },
      safetyist:       { label: 'Safetyist', pov: 'safetyist' },
      skeptic:         { label: 'Skeptic', pov: 'skeptic' },
    },
  };
});
vi.mock('@lib/debate/soul-docs/accelerationist.soul.json', () => ({ default: { label: 'Accelerationist' } }));
vi.mock('@lib/debate/soul-docs/safetyist.soul.json',       () => ({ default: { label: 'Safetyist' } }));
vi.mock('@lib/debate/soul-docs/skeptic.soul.json',         () => ({ default: { label: 'Skeptic' } }));

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

function makeDebate(overrides: Partial<DebateSession> = {}): DebateSession {
  return {
    id: 'test-debate',
    title: 'Test',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    phase: 'debate',
    topic: { original: 'Test', refined: null, final: 'Test topic' },
    source_type: 'topic',
    source_ref: '',
    source_content: '',
    active_povers: ['accelerationist', 'safetyist', 'skeptic'],
    user_is_pover: false,
    transcript: [],
    context_summaries: [],
    ...overrides,
  } as DebateSession;
}

function makeNode(overrides: Partial<ArgumentNetworkNode> = {}): ArgumentNetworkNode {
  return {
    id: 'n1',
    text: 'Test claim',
    type: 'I-node',
    speaker: 'accelerationist',
    source_entry_id: 'e1',
    turn_number: 1,
    base_strength: 0.7,
    ...overrides,
  } as ArgumentNetworkNode;
}

describe('useDiagnosticsState — initial state', () => {
  it('returns null debate when no initialData', () => {
    const { result } = renderHook(() => useDiagnosticsState());
    expect(result.current.debate).toBeNull();
    expect(result.current.selectedEntry).toBeNull();
    expect(result.current.entryTab).toBe('details');
    expect(result.current.overviewTab).toBe('argument-network');
  });

  it('accepts initialData with a debate field', () => {
    const debate = makeDebate({ title: 'Init test' });
    const { result } = renderHook(() => useDiagnosticsState({ debate } as any));
    expect(result.current.debate).not.toBeNull();
    expect(result.current.debate!.title).toBe('Init test');
  });

  it('accepts initialData as a raw DebateSession', () => {
    const debate = makeDebate({ title: 'Raw init' });
    const { result } = renderHook(() => useDiagnosticsState(debate as any));
    expect(result.current.debate).not.toBeNull();
  });
});

describe('useDiagnosticsState — derived values', () => {
  it('entry is null when no selectedEntry', () => {
    const debate = makeDebate({ transcript: [{ id: 'e1', type: 'statement', speaker: 'accelerationist', content: 'Hello' }] as any });
    const { result } = renderHook(() => useDiagnosticsState({ debate } as any));
    expect(result.current.entry).toBeNull();
  });

  it('entry is found when selectedEntry matches transcript', () => {
    const debate = makeDebate({ transcript: [{ id: 'e1', type: 'statement', speaker: 'accelerationist', content: 'Hello' }] as any });
    const { result } = renderHook(() => useDiagnosticsState({ debate } as any));
    act(() => { result.current.setSelectedEntry('e1'); });
    expect(result.current.entry).not.toBeNull();
    expect(result.current.entry!.id).toBe('e1');
  });

  it('diag is undefined when no diagnostics entries', () => {
    const debate = makeDebate({
      transcript: [{ id: 'e1', type: 'statement', speaker: 'accelerationist', content: 'X' }] as any,
      diagnostics: { entries: {} },
    });
    const { result } = renderHook(() => useDiagnosticsState({ debate, selectedEntry: 'e1' } as any));
    expect(result.current.diag).toBeUndefined();
  });

  it('diag is found when diagnostics entries has matching key', () => {
    const debate = makeDebate({
      transcript: [{ id: 'e1', type: 'statement', speaker: 'accelerationist', content: 'X' }] as any,
      diagnostics: { entries: { e1: { prompt: 'test prompt' } } },
    });
    const { result } = renderHook(() => useDiagnosticsState({ debate } as any));
    act(() => { result.current.setSelectedEntry('e1'); });
    expect(result.current.diag).toBeDefined();
    expect(result.current.diag!.prompt).toBe('test prompt');
  });
});

describe('useDiagnosticsState — perTurnUtilities', () => {
  it('returns empty array when no argument network', () => {
    const debate = makeDebate();
    const { result } = renderHook(() => useDiagnosticsState({ debate } as any));
    expect(result.current.perTurnUtilities).toEqual([]);
  });

  it('returns empty array when argument_network has no nodes', () => {
    const debate = makeDebate({ argument_network: { nodes: [], edges: [] } });
    const { result } = renderHook(() => useDiagnosticsState({ debate } as any));
    expect(result.current.perTurnUtilities).toEqual([]);
  });

  it('computes utilities per turn when AN has nodes', () => {
    const debate = makeDebate({
      argument_network: {
        nodes: [
          makeNode({ id: 'n1', speaker: 'accelerationist', turn_number: 1, base_strength: 0.8, source_entry_id: 'e1' }),
          makeNode({ id: 'n2', speaker: 'safetyist', turn_number: 2, base_strength: 0.6, source_entry_id: 'e2' }),
        ],
        edges: [],
      },
    });
    const { result } = renderHook(() => useDiagnosticsState({ debate } as any));
    const utils = result.current.perTurnUtilities;
    expect(utils.length).toBe(2);
    expect(utils[0].turn).toBe(1);
    expect(utils[1].turn).toBe(2);
    expect(utils[0].byAgent).toHaveProperty('accelerationist');
    expect(utils[1].byAgent).toHaveProperty('safetyist');
  });

  it('composite is weighted sum of position, attack, crux', () => {
    const debate = makeDebate({
      argument_network: {
        nodes: [
          makeNode({ id: 'n1', speaker: 'accelerationist', turn_number: 1, base_strength: 0.7, source_entry_id: 'e1' }),
        ],
        edges: [],
      },
    });
    const { result } = renderHook(() => useDiagnosticsState({ debate } as any));
    const agent = result.current.perTurnUtilities[0].byAgent['accelerationist'];
    const expected = 0.33 * agent.position_strength + 0.34 * agent.attack_effectiveness + 0.33 * agent.crux_engagement;
    expect(agent.composite).toBeCloseTo(expected, 5);
  });
});

describe('useDiagnosticsState — matchCount', () => {
  it('returns 0 when no search query', () => {
    const debate = makeDebate({ transcript: [{ id: 'e1', type: 'statement', speaker: 'accelerationist', content: 'Hello world' }] as any });
    const { result } = renderHook(() => useDiagnosticsState({ debate } as any));
    expect(result.current.matchCount).toBe(0);
  });

  it('counts matches in transcript content', () => {
    const debate = makeDebate({ transcript: [{ id: 'e1', type: 'statement', speaker: 'accelerationist', content: 'AI safety is important for AI' }] as any });
    const { result } = renderHook(() => useDiagnosticsState({ debate } as any));
    act(() => { result.current.setSearchQuery('AI'); });
    expect(result.current.matchCount).toBeGreaterThanOrEqual(2);
  });

  it('counts matches in nested stage_diagnostics work_product objects', () => {
    const debate = makeDebate({
      transcript: [{ id: 'e1', type: 'statement', speaker: 'accelerationist', content: 'test' }] as any,
      diagnostics: {
        entries: {
          e1: {
            stage_diagnostics: [
              { stage: 'brief', work_product: { summary: 'alignment risk overview', context: 'alignment matters' } },
            ],
          },
        },
      },
    } as any);
    const { result } = renderHook(() => useDiagnosticsState({ debate } as any));
    act(() => { result.current.setSelectedEntry('e1'); });
    act(() => { result.current.setSearchQuery('alignment'); });
    expect(result.current.matchCount).toBeGreaterThanOrEqual(2);
  });

  it('counts matches in work_product arrays of objects', () => {
    const debate = makeDebate({
      transcript: [{ id: 'e1', type: 'statement', speaker: 'accelerationist', content: 'test' }] as any,
      diagnostics: {
        entries: {
          e1: {
            stage_diagnostics: [
              { stage: 'draft', work_product: { changes: [{ original: 'governance model', revised: 'updated governance approach' }] } },
            ],
          },
        },
      },
    } as any);
    const { result } = renderHook(() => useDiagnosticsState({ debate } as any));
    act(() => { result.current.setSelectedEntry('e1'); });
    act(() => { result.current.setSearchQuery('governance'); });
    expect(result.current.matchCount).toBeGreaterThanOrEqual(2);
  });
});

describe('useDiagnosticsState — proxiedModeratorTrace', () => {
  it('returns null when entry is not system type', () => {
    const debate = makeDebate({
      transcript: [
        { id: 'e1', type: 'statement', speaker: 'accelerationist', content: 'Hello', metadata: {} },
      ] as any,
    });
    const { result } = renderHook(() => useDiagnosticsState({ debate, selectedEntry: 'e1' } as any));
    expect(result.current.proxiedModeratorTrace).toBeNull();
  });

  it('proxies moderator_trace from next entry when system entry has none', () => {
    const debate = makeDebate({
      transcript: [
        { id: 'e1', type: 'system', speaker: 'system', content: 'System msg', metadata: {} },
        { id: 'e2', type: 'statement', speaker: 'accelerationist', content: 'Reply', metadata: { moderator_trace: { selected: 'safetyist' } } },
      ] as any,
    });
    const { result } = renderHook(() => useDiagnosticsState({ debate } as any));
    act(() => { result.current.setSelectedEntry('e1'); });
    expect(result.current.proxiedModeratorTrace).not.toBeNull();
    expect((result.current.proxiedModeratorTrace as any).selected).toBe('safetyist');
  });

  it('does not proxy when system entry already has moderator_trace', () => {
    const debate = makeDebate({
      transcript: [
        { id: 'e1', type: 'system', speaker: 'system', content: 'System msg', metadata: { moderator_trace: { selected: 'skeptic' } } },
        { id: 'e2', type: 'statement', speaker: 'accelerationist', content: 'Reply', metadata: { moderator_trace: { selected: 'safetyist' } } },
      ] as any,
    });
    const { result } = renderHook(() => useDiagnosticsState({ debate, selectedEntry: 'e1' } as any));
    expect(result.current.proxiedModeratorTrace).toBeNull();
  });
});

describe('useDiagnosticsState — effectiveOverviewTab', () => {
  it('returns current overviewTab when it is visible', () => {
    const debate = makeDebate({
      transcript: [{ id: 'e1', type: 'statement', speaker: 'accelerationist', content: 'X' }] as any,
      argument_network: { nodes: [makeNode()], edges: [] },
    });
    const { result } = renderHook(() => useDiagnosticsState({ debate } as any));
    expect(result.current.effectiveOverviewTab).toBe('argument-network');
  });

  it('falls back to transcript when selected tab has no data', () => {
    const debate = makeDebate({
      transcript: [{ id: 'e1', type: 'statement', speaker: 'accelerationist', content: 'X' }] as any,
    });
    const { result } = renderHook(() => useDiagnosticsState({ debate } as any));
    act(() => { result.current.setOverviewTab('convergence'); });
    expect(result.current.effectiveOverviewTab).toBe('transcript');
  });

  it('keeps argument-network when AN has nodes', () => {
    const debate = makeDebate({
      transcript: [{ id: 'e1', type: 'statement', speaker: 'accelerationist', content: 'X' }] as any,
      argument_network: { nodes: [makeNode()], edges: [] },
    });
    const { result } = renderHook(() => useDiagnosticsState({ debate } as any));
    expect(result.current.effectiveOverviewTab).toBe('argument-network');
  });
});

describe('useDiagnosticsState — state setters', () => {
  it('setSelectedEntry updates selectedEntry', () => {
    const { result } = renderHook(() => useDiagnosticsState());
    act(() => { result.current.setSelectedEntry('e1'); });
    expect(result.current.selectedEntry).toBe('e1');
  });

  it('setEntryTab updates entryTab', () => {
    const { result } = renderHook(() => useDiagnosticsState());
    act(() => { result.current.setEntryTab('brief'); });
    expect(result.current.entryTab).toBe('brief');
  });

  it('setSearchQuery updates searchQuery and sq', () => {
    const { result } = renderHook(() => useDiagnosticsState());
    act(() => { result.current.setSearchQuery('  test  '); });
    expect(result.current.searchQuery).toBe('  test  ');
    expect(result.current.sq).toBe('test');
  });
});

describe('useDiagnosticsState — handleChatNavigate', () => {
  it('navigates to entry', () => {
    const { result } = renderHook(() => useDiagnosticsState());
    act(() => { result.current.handleChatNavigate({ entry: 'e2' }); });
    expect(result.current.selectedEntry).toBe('e2');
  });

  it('clears entry when entry is null', () => {
    const { result } = renderHook(() => useDiagnosticsState());
    act(() => { result.current.setSelectedEntry('e1'); });
    act(() => { result.current.handleChatNavigate({ entry: null }); });
    expect(result.current.selectedEntry).toBeNull();
  });

  it('sets tab when provided', () => {
    const { result } = renderHook(() => useDiagnosticsState());
    act(() => { result.current.handleChatNavigate({ tab: 'brief' }); });
    expect(result.current.entryTab).toBe('brief');
  });

  it('sets overviewTab when provided', () => {
    const { result } = renderHook(() => useDiagnosticsState());
    act(() => { result.current.handleChatNavigate({ overviewTab: 'commitments' }); });
    expect(result.current.overviewTab).toBe('commitments');
  });
});

describe('useDiagnosticsState — handleUpdateSubScore', () => {
  it('updates bdi_sub_scores on the matching node', () => {
    const debate = makeDebate({
      argument_network: {
        nodes: [makeNode({ id: 'n1', bdi_sub_scores: { evidence_quality: 0.5 } } as any)],
        edges: [],
      },
    });
    const { result } = renderHook(() => useDiagnosticsState({ debate } as any));
    act(() => { result.current.handleUpdateSubScore('n1', 'evidence_quality', 0.9); });
    const node = result.current.an!.nodes.find(n => n.id === 'n1')!;
    expect((node as any).bdi_sub_scores.evidence_quality).toBe(0.9);
  });

  it('recalculates base_strength as average of sub-scores', () => {
    const debate = makeDebate({
      argument_network: {
        nodes: [makeNode({ id: 'n1', base_strength: 0.5, bdi_sub_scores: { a: 0.4, b: 0.6 } } as any)],
        edges: [],
      },
    });
    const { result } = renderHook(() => useDiagnosticsState({ debate } as any));
    act(() => { result.current.handleUpdateSubScore('n1', 'a', 1.0); });
    const node = result.current.an!.nodes.find(n => n.id === 'n1')!;
    expect(node.base_strength).toBeCloseTo(0.8, 5);
  });
});
