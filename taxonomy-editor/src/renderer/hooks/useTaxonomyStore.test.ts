// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ──

const { mockApi } = vi.hoisted(() => {
  const mockApi = {
    loadTaxonomyFile: vi.fn().mockResolvedValue({ nodes: [] }),
    saveTaxonomyFile: vi.fn().mockResolvedValue(undefined),
    loadPolicyRegistry: vi.fn().mockResolvedValue({ policies: [] }),
    loadConflictFiles: vi.fn().mockResolvedValue([]),
    loadConflictClusters: vi.fn().mockResolvedValue({ clusters: [] }),
    loadAggregatedCruxes: vi.fn().mockResolvedValue({ cruxes: [] }),
    saveConflictFile: vi.fn().mockResolvedValue(undefined),
    syncCommit: vi.fn().mockResolvedValue({ commitSha: 'abc', filesCommitted: 1 }),
    updateNodeEmbeddings: vi.fn().mockResolvedValue(undefined),
    loadEdges: vi.fn().mockResolvedValue({ edges: [] }),
    loadAIModels: vi.fn().mockResolvedValue(null),
    computeEmbeddings: vi.fn().mockResolvedValue({ vectors: [] }),
    computeQueryEmbedding: vi.fn().mockResolvedValue({ vector: [] }),
    generateText: vi.fn().mockResolvedValue({ text: '{}' }),
    nliClassify: vi.fn().mockResolvedValue({ results: [] }),
    hasApiKey: vi.fn().mockResolvedValue(false),
    onGenerateTextProgress: vi.fn().mockReturnValue(() => {}),
    trackEvent: vi.fn(),
  };
  return { mockApi };
});

vi.mock('@bridge', () => ({ api: mockApi }));

vi.mock('@lib/debate', () => ({
  normalizeNodeProperties: vi.fn(),
}));

vi.mock('@lib/debate/nodeIdUtils', () => ({
  nodeTypeFromId: vi.fn((id: string) => {
    if (id.startsWith('sit-')) return 'situation';
    if (id.startsWith('cc-')) return 'situation';
    return 'pov';
  }),
}));

vi.mock('@lib/debate/types', () => ({
  POV_KEYS: ['accelerationist', 'safetyist', 'skeptic'],
}));

vi.mock('@lib/debate/validators', () => ({
  validateTaxonomy: vi.fn().mockReturnValue({ issues: [] }),
}));

vi.mock('@lib/debate/validateNodeId', () => ({
  validatePovNodeId: vi.fn().mockReturnValue({ valid: true }),
}));

vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: vi.fn().mockReturnValue({
    record: vi.fn(),
  }),
}));

vi.mock('../utils/validation', () => ({
  povTaxonomyFileSchema: { safeParse: vi.fn().mockReturnValue({ success: true }) },
  crossCuttingFileSchema: { safeParse: vi.fn().mockReturnValue({ success: true }) },
  conflictFileSchema: { safeParse: vi.fn().mockReturnValue({ success: true }) },
  extractPovErrors: vi.fn().mockReturnValue({}),
  extractConflictErrors: vi.fn().mockReturnValue({}),
}));

vi.mock('../utils/similarity', () => ({
  rankBySimilarity: vi.fn().mockReturnValue([]),
}));

vi.mock('../utils/errorMessages', () => ({
  mapErrorToUserMessage: vi.fn((err: unknown) => String(err)),
}));

vi.mock('../prompts/analysis', () => ({
  distinctionAnalysisPrompt: vi.fn().mockReturnValue('mock-distinction-prompt'),
  nodeCritiquePrompt: vi.fn().mockReturnValue('mock-critique-prompt'),
}));

vi.mock('../data/lineageCategories', () => ({
  loadLineageCategoriesData: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../data/lineageLookup', () => ({
  loadLineageInfoData: vi.fn().mockResolvedValue(undefined),
}));

// Mock localStorage
const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: vi.fn((key: string) => storage.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { storage.set(key, value); }),
  removeItem: vi.fn((key: string) => { storage.delete(key); }),
  clear: vi.fn(() => { storage.clear(); }),
  length: 0,
  key: vi.fn(),
});

// Mock document.documentElement for theme/pane-spacing
vi.stubGlobal('document', {
  documentElement: {
    setAttribute: vi.fn(),
    getAttribute: vi.fn(),
  },
});

// Mock window.matchMedia for system theme detection
vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));

import { useTaxonomyStore } from './useTaxonomyStore';
import type { PovTaxonomyFile, CrossCuttingFile, ConflictFile, PovNode, Edge, EdgesFile } from '../types/taxonomy';

// ── Factories ──

function makePovNode(overrides: Partial<PovNode> = {}): PovNode {
  return {
    id: 'acc-beliefs-001',
    category: 'Beliefs',
    label: 'Test node',
    description: 'A test belief node',
    parent_id: null,
    children: [],
    situation_refs: [],
    ...overrides,
  };
}

function makePovFile(nodes: PovNode[] = [makePovNode()]): PovTaxonomyFile {
  return {
    pov: 'accelerationist',
    last_modified: '2026-01-01',
    nodes,
  } as PovTaxonomyFile;
}

function makeSituationsFile(): CrossCuttingFile {
  return {
    last_modified: '2026-01-01',
    nodes: [
      {
        id: 'sit-001',
        label: 'Test situation',
        description: 'A test situation',
        interpretations: { accelerationist: 'acc view', safetyist: 'saf view', skeptic: 'skp view' },
        linked_nodes: [],
        conflict_ids: [],
      },
    ],
  } as CrossCuttingFile;
}

function makeConflict(overrides: Partial<ConflictFile> = {}): ConflictFile {
  return {
    claim_id: 'conflict-test-001',
    claim_label: 'Test conflict',
    description: 'A test conflict claim',
    status: 'open',
    linked_taxonomy_nodes: [],
    instances: [],
    human_notes: [],
    ...overrides,
  } as ConflictFile;
}

function resetStore() {
  useTaxonomyStore.setState({
    accelerationist: null,
    safetyist: null,
    skeptic: null,
    situations: null,
    policyRegistry: null,
    conflicts: [],
    aggregatedCruxes: null,
    activeTab: 'accelerationist',
    selectedNodeId: null,
    dirty: new Set(),
    validationErrors: {},
    saveError: null,
    loading: false,
    backgroundLoading: false,
    loadingProgress: { completed: [], total: 0 },
    pinnedStack: [],
    findQuery: '',
    findMode: 'raw',
    findCaseSensitive: false,
    embeddingCache: new Map(),
    embeddingDirty: true,
    embeddingLoading: false,
    embeddingError: null,
    hasApiKey: false,
    semanticResults: [],
    similarResults: null,
    similarLoading: false,
    similarStep: null,
    similarError: null,
    similarThreshold: 60,
    analysisResult: null,
    analysisLoading: false,
    analysisError: null,
    analysisStep: 0,
    analysisRetry: null,
    analysisCached: false,
    analysisElementA: null,
    analysisElementB: null,
    analysisTitle: 'Analysis',
    analysisCritiquePov: null,
    analysisCritiqueNodeId: null,
    analysisCritiqueOriginalNode: null,
    clusterView: null,
    clusterLoading: false,
    clusterError: null,
    conflictClusters: null,
    conflictClusterLoading: false,
    conflictClusterError: null,
    edgesFile: null,
    edgesLoading: false,
    relatedNodeId: null,
    selectedEdge: null,
    toolbarPanel: null,
    pendingLineageValue: null,
    pendingSearchRelatedId: null,
    previousView: null,
    attributeFilter: null,
    attributeInfo: null,
  });
}

// ── Tests ──

describe('useTaxonomyStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.clear();
    resetStore();
  });

  // ═══════════════════════════════════════════════
  // Settings slice
  // ═══════════════════════════════════════════════

  describe('settings', () => {
    describe('colorScheme', () => {
      it('defaults to harvard', () => {
        expect(useTaxonomyStore.getState().colorScheme).toBe('harvard');
      });

      it('setColorScheme updates state and persists', () => {
        useTaxonomyStore.getState().setColorScheme('dark');
        expect(useTaxonomyStore.getState().colorScheme).toBe('dark');
        expect(storage.get('taxonomy-editor-theme')).toBe('dark');
      });

      it('setColorScheme applies data-theme attribute', () => {
        useTaxonomyStore.getState().setColorScheme('bkc');
        expect(document.documentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'bkc');
      });

      it('system theme delegates to matchMedia', () => {
        (window.matchMedia as ReturnType<typeof vi.fn>).mockReturnValueOnce({ matches: true });
        useTaxonomyStore.getState().setColorScheme('system');
        expect(document.documentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'dark');
      });
    });

    describe('aiBackend', () => {
      it('defaults to gemini', () => {
        expect(useTaxonomyStore.getState().aiBackend).toBe('gemini');
      });

      it('setAIBackend updates backend and switches to default model', () => {
        useTaxonomyStore.getState().setAIBackend('claude');
        const state = useTaxonomyStore.getState();
        expect(state.aiBackend).toBe('claude');
        expect(state.geminiModel).toBe('claude-sonnet-4-6');
        expect(storage.get('taxonomy-editor-ai-backend')).toBe('claude');
      });
    });

    describe('geminiModel', () => {
      it('setGeminiModel updates and persists', () => {
        useTaxonomyStore.getState().setGeminiModel('gemini-2.5-pro');
        expect(useTaxonomyStore.getState().geminiModel).toBe('gemini-2.5-pro');
        expect(storage.get('taxonomy-editor-gemini-model')).toBe('gemini-2.5-pro');
      });
    });

    describe('paneSpacing', () => {
      it('defaults to normal', () => {
        expect(useTaxonomyStore.getState().paneSpacing).toBe('normal');
      });

      it('setPaneSpacing updates and sets DOM attribute', () => {
        useTaxonomyStore.getState().setPaneSpacing('concise');
        expect(useTaxonomyStore.getState().paneSpacing).toBe('concise');
        expect(document.documentElement.setAttribute).toHaveBeenCalledWith('data-pane-spacing', 'concise');
        expect(storage.get('taxonomy-editor-pane-spacing')).toBe('concise');
      });
    });

    describe('qbafEnabled', () => {
      it('setQbafEnabled toggles and persists', () => {
        useTaxonomyStore.getState().setQbafEnabled(false);
        expect(useTaxonomyStore.getState().qbafEnabled).toBe(false);
        expect(storage.get('taxonomy-editor-qbaf')).toBe('false');

        useTaxonomyStore.getState().setQbafEnabled(true);
        expect(useTaxonomyStore.getState().qbafEnabled).toBe(true);
        expect(storage.get('taxonomy-editor-qbaf')).toBe('true');
      });
    });

    describe('zoom', () => {
      it('zoomIn increases by 10, capped at 200', () => {
        useTaxonomyStore.setState({ zoomLevel: 100 });
        useTaxonomyStore.getState().zoomIn();
        expect(useTaxonomyStore.getState().zoomLevel).toBe(110);
      });

      it('zoomIn caps at 200', () => {
        useTaxonomyStore.setState({ zoomLevel: 200 });
        useTaxonomyStore.getState().zoomIn();
        expect(useTaxonomyStore.getState().zoomLevel).toBe(200);
      });

      it('zoomOut decreases by 10, floor at 60', () => {
        useTaxonomyStore.setState({ zoomLevel: 100 });
        useTaxonomyStore.getState().zoomOut();
        expect(useTaxonomyStore.getState().zoomLevel).toBe(90);
      });

      it('zoomOut floors at 60', () => {
        useTaxonomyStore.setState({ zoomLevel: 60 });
        useTaxonomyStore.getState().zoomOut();
        expect(useTaxonomyStore.getState().zoomLevel).toBe(60);
      });

      it('zoomReset restores to 100', () => {
        useTaxonomyStore.setState({ zoomLevel: 150 });
        useTaxonomyStore.getState().zoomReset();
        expect(useTaxonomyStore.getState().zoomLevel).toBe(100);
        expect(storage.get('taxonomy-editor-zoom')).toBe('100');
      });
    });
  });

  // ═══════════════════════════════════════════════
  // Search slice
  // ═══════════════════════════════════════════════

  describe('search', () => {
    describe('find controls', () => {
      it('setFindQuery updates findQuery', () => {
        useTaxonomyStore.getState().setFindQuery('test');
        expect(useTaxonomyStore.getState().findQuery).toBe('test');
      });

      it('setFindMode updates findMode', () => {
        useTaxonomyStore.getState().setFindMode('regex');
        expect(useTaxonomyStore.getState().findMode).toBe('regex');
      });

      it('setFindCaseSensitive updates flag', () => {
        useTaxonomyStore.getState().setFindCaseSensitive(true);
        expect(useTaxonomyStore.getState().findCaseSensitive).toBe(true);
      });
    });

    describe('similarThreshold', () => {
      it('setSimilarThreshold updates threshold', () => {
        useTaxonomyStore.getState().setSimilarThreshold(80);
        expect(useTaxonomyStore.getState().similarThreshold).toBe(80);
      });
    });

    describe('clearSimilarSearch', () => {
      it('clears results and error', () => {
        useTaxonomyStore.setState({ similarResults: [{ id: 'x', score: 0.9 }], similarError: 'err' });
        useTaxonomyStore.getState().clearSimilarSearch();
        expect(useTaxonomyStore.getState().similarResults).toBeNull();
        expect(useTaxonomyStore.getState().similarError).toBeNull();
      });

      it('closes search toolbar panel', () => {
        useTaxonomyStore.setState({ similarResults: [{ id: 'x', score: 0.9 }], toolbarPanel: 'search' });
        useTaxonomyStore.getState().clearSimilarSearch();
        expect(useTaxonomyStore.getState().toolbarPanel).toBeNull();
      });
    });

    describe('buildEmbeddingTexts', () => {
      it('returns all nodes when no scope filters', () => {
        useTaxonomyStore.setState({
          accelerationist: makePovFile([makePovNode({ id: 'acc-beliefs-001', description: 'node1' })]),
          safetyist: makePovFile([makePovNode({ id: 'saf-beliefs-001', description: 'node2' })]),
          skeptic: null,
          situations: makeSituationsFile(),
          conflicts: [makeConflict()],
        });

        const { ids, texts } = useTaxonomyStore.getState().buildEmbeddingTexts(new Set(), new Set());
        expect(ids).toContain('acc-beliefs-001');
        expect(ids).toContain('saf-beliefs-001');
        expect(ids).toContain('sit-001');
        expect(ids).toContain('conflict-test-001');
        expect(ids.length).toBe(4);
      });

      it('filters by POV scope', () => {
        useTaxonomyStore.setState({
          accelerationist: makePovFile([makePovNode({ id: 'acc-beliefs-001' })]),
          safetyist: makePovFile([makePovNode({ id: 'saf-beliefs-001' })]),
          skeptic: null,
          situations: makeSituationsFile(),
          conflicts: [],
        });

        const { ids } = useTaxonomyStore.getState().buildEmbeddingTexts(
          new Set(['accelerationist'] as any),
          new Set(),
        );
        expect(ids).toContain('acc-beliefs-001');
        expect(ids).not.toContain('saf-beliefs-001');
        expect(ids).not.toContain('sit-001');
      });

      it('filters by aspect scope', () => {
        useTaxonomyStore.setState({
          accelerationist: makePovFile([
            makePovNode({ id: 'acc-beliefs-001', category: 'Beliefs' }),
            makePovNode({ id: 'acc-desires-001', category: 'Desires' }),
          ]),
          safetyist: null,
          skeptic: null,
          situations: null,
          conflicts: [],
        });

        const { ids } = useTaxonomyStore.getState().buildEmbeddingTexts(
          new Set(),
          new Set(['Beliefs'] as any),
        );
        expect(ids).toContain('acc-beliefs-001');
        expect(ids).not.toContain('acc-desires-001');
      });
    });

    describe('attributeFilter', () => {
      it('runAttributeFilter matches string fields exactly', () => {
        useTaxonomyStore.setState({
          accelerationist: makePovFile([
            makePovNode({
              id: 'acc-beliefs-001',
              label: 'Node A',
              graph_attributes: { epistemic_status: 'speculative' } as any,
            }),
            makePovNode({
              id: 'acc-beliefs-002',
              label: 'Node B',
              graph_attributes: { epistemic_status: 'established' } as any,
            }),
          ]),
          safetyist: null,
          skeptic: null,
          situations: null,
        });

        useTaxonomyStore.getState().runAttributeFilter('epistemic_status', 'speculative');
        const filter = useTaxonomyStore.getState().attributeFilter;
        expect(filter).not.toBeNull();
        expect(filter!.results).toHaveLength(1);
        expect(filter!.results[0].id).toBe('acc-beliefs-001');
      });

      it('runAttributeFilter matches array fields', () => {
        useTaxonomyStore.setState({
          accelerationist: makePovFile([
            makePovNode({
              id: 'acc-beliefs-001',
              label: 'Node A',
              graph_attributes: { assumes: ['rationality', 'utility-maximization'] } as any,
            }),
          ]),
          safetyist: null,
          skeptic: null,
          situations: null,
        });

        useTaxonomyStore.getState().runAttributeFilter('assumes', 'rationality');
        const filter = useTaxonomyStore.getState().attributeFilter;
        expect(filter!.results).toHaveLength(1);
      });

      it('clearAttributeFilter resets filter and toolbar', () => {
        useTaxonomyStore.setState({
          attributeFilter: { field: 'x', value: 'y', results: [] },
          toolbarPanel: 'attrFilter',
        });
        useTaxonomyStore.getState().clearAttributeFilter();
        expect(useTaxonomyStore.getState().attributeFilter).toBeNull();
        expect(useTaxonomyStore.getState().toolbarPanel).toBeNull();
      });
    });

    describe('attributeInfo', () => {
      it('showAttributeInfo sets info and toolbar panel', () => {
        useTaxonomyStore.getState().showAttributeInfo('field', 'value');
        expect(useTaxonomyStore.getState().attributeInfo).toEqual({ field: 'field', value: 'value' });
        expect(useTaxonomyStore.getState().toolbarPanel).toBe('attrInfo');
      });

      it('clearAttributeInfo resets', () => {
        useTaxonomyStore.setState({ attributeInfo: { field: 'f', value: 'v' }, toolbarPanel: 'attrInfo' });
        useTaxonomyStore.getState().clearAttributeInfo();
        expect(useTaxonomyStore.getState().attributeInfo).toBeNull();
        expect(useTaxonomyStore.getState().toolbarPanel).toBeNull();
      });
    });
  });

  // ═══════════════════════════════════════════════
  // Analysis slice
  // ═══════════════════════════════════════════════

  describe('analysis', () => {
    describe('clearAnalysis', () => {
      it('resets all analysis state', () => {
        useTaxonomyStore.setState({
          analysisResult: 'some result',
          analysisLoading: true,
          analysisError: 'err',
          analysisStep: 3,
          analysisCached: true,
          analysisElementA: { label: 'a', description: 'a', category: 'Beliefs' },
          analysisElementB: { label: 'b', description: 'b', category: 'Desires' },
          analysisTitle: 'Custom Title',
          analysisCritiquePov: 'accelerationist' as any,
          analysisCritiqueNodeId: 'x',
          analysisCritiqueOriginalNode: makePovNode(),
        });

        useTaxonomyStore.getState().clearAnalysis();
        const s = useTaxonomyStore.getState();
        expect(s.analysisResult).toBeNull();
        expect(s.analysisLoading).toBe(false);
        expect(s.analysisError).toBeNull();
        expect(s.analysisStep).toBe(0);
        expect(s.analysisCached).toBe(false);
        expect(s.analysisElementA).toBeNull();
        expect(s.analysisElementB).toBeNull();
        expect(s.analysisTitle).toBe('Analysis');
        expect(s.analysisCritiquePov).toBeNull();
        expect(s.analysisCritiqueNodeId).toBeNull();
        expect(s.analysisCritiqueOriginalNode).toBeNull();
      });
    });

    describe('runAnalyzeDistinction', () => {
      it('calls generateText and updates result on success', async () => {
        mockApi.generateText.mockResolvedValueOnce({ text: 'analysis result text' });
        const elemA = { label: 'A', description: 'desc A', category: 'Beliefs' };
        const elemB = { label: 'B', description: 'desc B', category: 'Desires' };

        await useTaxonomyStore.getState().runAnalyzeDistinction(elemA, elemB);

        expect(mockApi.generateText).toHaveBeenCalled();
        const s = useTaxonomyStore.getState();
        expect(s.analysisResult).toBe('analysis result text');
        expect(s.analysisLoading).toBe(false);
        expect(s.analysisError).toBeNull();
      });

      it('sets error on generateText failure', async () => {
        mockApi.generateText.mockRejectedValueOnce(new Error('API down'));
        const elemA = { label: 'A', description: 'desc A', category: 'Beliefs' };
        const elemB = { label: 'B', description: 'desc B', category: 'Desires' };

        await useTaxonomyStore.getState().runAnalyzeDistinction(elemA, elemB);

        const s = useTaxonomyStore.getState();
        expect(s.analysisResult).toBeNull();
        expect(s.analysisLoading).toBe(false);
        expect(s.analysisError).toBeTruthy();
      });
    });

    describe('clearClusterView', () => {
      it('clears cluster data', () => {
        useTaxonomyStore.setState({
          clusterView: { clusters: [{ label: 'C1', nodeIds: ['a'] }] },
          clusterError: 'err',
        });
        useTaxonomyStore.getState().clearClusterView();
        expect(useTaxonomyStore.getState().clusterView).toBeNull();
        expect(useTaxonomyStore.getState().clusterError).toBeNull();
      });
    });

    describe('clearConflictClusters', () => {
      it('clears conflict cluster data', () => {
        useTaxonomyStore.setState({
          conflictClusters: [{ label: 'CC1', nodeIds: ['a'] }],
          conflictClusterError: 'err',
        });
        useTaxonomyStore.getState().clearConflictClusters();
        expect(useTaxonomyStore.getState().conflictClusters).toBeNull();
        expect(useTaxonomyStore.getState().conflictClusterError).toBeNull();
      });
    });

    describe('checkApiKey', () => {
      it('sets hasApiKey from bridge response', async () => {
        mockApi.hasApiKey.mockResolvedValueOnce(true);
        await useTaxonomyStore.getState().checkApiKey();
        expect(useTaxonomyStore.getState().hasApiKey).toBe(true);
      });

      it('defaults to false on error', async () => {
        mockApi.hasApiKey.mockRejectedValueOnce(new Error('fail'));
        await useTaxonomyStore.getState().checkApiKey();
        expect(useTaxonomyStore.getState().hasApiKey).toBe(false);
      });
    });
  });

  // ═══════════════════════════════════════════════
  // Taxonomy data — navigation
  // ═══════════════════════════════════════════════

  describe('navigation', () => {
    it('setActiveTab changes tab and clears selection', () => {
      useTaxonomyStore.setState({ activeTab: 'accelerationist', selectedNodeId: 'x' });
      useTaxonomyStore.getState().setActiveTab('safetyist');
      expect(useTaxonomyStore.getState().activeTab).toBe('safetyist');
      expect(useTaxonomyStore.getState().selectedNodeId).toBeNull();
    });

    it('setSelectedNodeId updates selection', () => {
      useTaxonomyStore.getState().setSelectedNodeId('acc-beliefs-001');
      expect(useTaxonomyStore.getState().selectedNodeId).toBe('acc-beliefs-001');
    });

    it('navigateToNode sets both tab and node', () => {
      useTaxonomyStore.getState().navigateToNode('skeptic', 'skp-desires-001');
      expect(useTaxonomyStore.getState().activeTab).toBe('skeptic');
      expect(useTaxonomyStore.getState().selectedNodeId).toBe('skp-desires-001');
    });
  });

  // ═══════════════════════════════════════════════
  // Taxonomy data — pinned stack
  // ═══════════════════════════════════════════════

  describe('pinned stack', () => {
    const pinnedA: any = { type: 'pov', pov: 'accelerationist', node: makePovNode() };
    const pinnedB: any = { type: 'situations', node: { id: 'sit-001', label: 'Test' } };

    it('pinAtDepth adds to stack', () => {
      useTaxonomyStore.getState().pinAtDepth(0, pinnedA);
      expect(useTaxonomyStore.getState().pinnedStack).toHaveLength(1);
    });

    it('pinAtDepth truncates deeper items', () => {
      useTaxonomyStore.setState({ pinnedStack: [pinnedA, pinnedB] });
      const pinnedC: any = { type: 'pov', pov: 'safetyist', node: makePovNode({ id: 'saf-beliefs-001' }) };
      useTaxonomyStore.getState().pinAtDepth(1, pinnedC);
      expect(useTaxonomyStore.getState().pinnedStack).toHaveLength(2);
      expect(useTaxonomyStore.getState().pinnedStack[1]).toBe(pinnedC);
    });

    it('closePinnedFromDepth truncates', () => {
      useTaxonomyStore.setState({ pinnedStack: [pinnedA, pinnedB] });
      useTaxonomyStore.getState().closePinnedFromDepth(1);
      expect(useTaxonomyStore.getState().pinnedStack).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════════
  // Taxonomy data — POV node CRUD
  // ═══════════════════════════════════════════════

  describe('POV node CRUD', () => {
    beforeEach(() => {
      useTaxonomyStore.setState({
        accelerationist: makePovFile([
          makePovNode({ id: 'acc-beliefs-001', label: 'Belief 1', description: 'First belief' }),
          makePovNode({ id: 'acc-beliefs-002', label: 'Belief 2', description: 'Second belief', category: 'Beliefs' }),
        ]),
      });
    });

    describe('createPovNode', () => {
      it('adds a new node and returns its ID', () => {
        const newId = useTaxonomyStore.getState().createPovNode('accelerationist', 'Desires');
        expect(newId).toMatch(/^acc-desires-/);
        const file = useTaxonomyStore.getState().accelerationist!;
        expect(file.nodes).toHaveLength(3);
        expect(useTaxonomyStore.getState().selectedNodeId).toBe(newId);
        expect(useTaxonomyStore.getState().dirty.has('accelerationist')).toBe(true);
      });

      it('returns empty string if file not loaded', () => {
        const newId = useTaxonomyStore.getState().createPovNode('skeptic', 'Beliefs');
        expect(newId).toBe('');
      });
    });

    describe('updatePovNode', () => {
      it('updates node fields and marks dirty', () => {
        useTaxonomyStore.getState().updatePovNode('accelerationist', 'acc-beliefs-001', { label: 'Updated' });
        const file = useTaxonomyStore.getState().accelerationist!;
        const node = file.nodes.find(n => n.id === 'acc-beliefs-001')!;
        expect(node.label).toBe('Updated');
        expect(useTaxonomyStore.getState().dirty.has('accelerationist')).toBe(true);
      });

      it('preserves other node fields', () => {
        useTaxonomyStore.getState().updatePovNode('accelerationist', 'acc-beliefs-001', { label: 'New' });
        const node = useTaxonomyStore.getState().accelerationist!.nodes.find(n => n.id === 'acc-beliefs-001')!;
        expect(node.description).toBe('First belief');
        expect(node.category).toBe('Beliefs');
      });

      it('does nothing if POV file not loaded', () => {
        useTaxonomyStore.getState().updatePovNode('skeptic', 'skp-beliefs-001', { label: 'x' });
        expect(useTaxonomyStore.getState().dirty.size).toBe(0);
      });
    });

    describe('deletePovNode', () => {
      it('removes node and marks dirty', () => {
        useTaxonomyStore.getState().deletePovNode('accelerationist', 'acc-beliefs-001');
        const file = useTaxonomyStore.getState().accelerationist!;
        expect(file.nodes).toHaveLength(1);
        expect(file.nodes[0].id).toBe('acc-beliefs-002');
        expect(useTaxonomyStore.getState().dirty.has('accelerationist')).toBe(true);
      });

      it('clears selectedNodeId if deleted node was selected', () => {
        useTaxonomyStore.setState({ selectedNodeId: 'acc-beliefs-001' });
        useTaxonomyStore.getState().deletePovNode('accelerationist', 'acc-beliefs-001');
        expect(useTaxonomyStore.getState().selectedNodeId).toBeNull();
      });

      it('preserves selectedNodeId if different node deleted', () => {
        useTaxonomyStore.setState({ selectedNodeId: 'acc-beliefs-002' });
        useTaxonomyStore.getState().deletePovNode('accelerationist', 'acc-beliefs-001');
        expect(useTaxonomyStore.getState().selectedNodeId).toBe('acc-beliefs-002');
      });
    });

    describe('movePovNodeCategory', () => {
      it('changes category and assigns new ID', () => {
        useTaxonomyStore.getState().movePovNodeCategory('accelerationist', 'acc-beliefs-001', 'Desires');
        const file = useTaxonomyStore.getState().accelerationist!;
        const moved = file.nodes.find(n => n.id.startsWith('acc-desires-'));
        expect(moved).toBeDefined();
        expect(moved!.category).toBe('Desires');
        expect(moved!.label).toBe('Belief 1');
        expect(file.nodes.find(n => n.id === 'acc-beliefs-001')).toBeUndefined();
      });

      it('updates parent_id references in siblings', () => {
        const parent = makePovNode({ id: 'acc-beliefs-001', label: 'Parent', children: ['acc-beliefs-002'] });
        const child = makePovNode({ id: 'acc-beliefs-002', label: 'Child', parent_id: 'acc-beliefs-001' });
        useTaxonomyStore.setState({ accelerationist: makePovFile([parent, child]) });

        useTaxonomyStore.getState().movePovNodeCategory('accelerationist', 'acc-beliefs-001', 'Desires');
        const file = useTaxonomyStore.getState().accelerationist!;
        const childNode = file.nodes.find(n => n.id === 'acc-beliefs-002')!;
        expect(childNode.parent_id).toMatch(/^acc-desires-/);
      });
    });

    describe('movePovNode (cross-POV)', () => {
      it('moves node from source to target POV', () => {
        useTaxonomyStore.setState({
          safetyist: makePovFile([]),
        });

        useTaxonomyStore.getState().movePovNode('accelerationist', 'acc-beliefs-001', 'safetyist', 'Desires');

        const accFile = useTaxonomyStore.getState().accelerationist!;
        const safFile = useTaxonomyStore.getState().safetyist!;

        expect(accFile.nodes.find(n => n.id === 'acc-beliefs-001')).toBeUndefined();
        const moved = safFile.nodes.find(n => n.id.startsWith('saf-desires-'));
        expect(moved).toBeDefined();
        expect(moved!.label).toBe('Belief 1');
        expect(useTaxonomyStore.getState().dirty.has('accelerationist')).toBe(true);
        expect(useTaxonomyStore.getState().dirty.has('safetyist')).toBe(true);
      });

      it('resets parent_id and children on cross-POV move', () => {
        useTaxonomyStore.setState({
          accelerationist: makePovFile([
            makePovNode({ id: 'acc-beliefs-001', children: ['acc-beliefs-002'] }),
            makePovNode({ id: 'acc-beliefs-002', parent_id: 'acc-beliefs-001' }),
          ]),
          safetyist: makePovFile([]),
        });

        useTaxonomyStore.getState().movePovNode('accelerationist', 'acc-beliefs-001', 'safetyist', 'Beliefs');
        const moved = useTaxonomyStore.getState().safetyist!.nodes.find(n => n.id.startsWith('saf-beliefs-'));
        expect(moved!.parent_id).toBeNull();
        expect(moved!.children).toEqual([]);
      });

      it('updates conflict linked_taxonomy_nodes on cross-POV move', () => {
        useTaxonomyStore.setState({
          accelerationist: makePovFile([makePovNode({ id: 'acc-beliefs-001' })]),
          safetyist: makePovFile([]),
          conflicts: [makeConflict({ linked_taxonomy_nodes: ['acc-beliefs-001'] })],
        });

        useTaxonomyStore.getState().movePovNode('accelerationist', 'acc-beliefs-001', 'safetyist', 'Beliefs');
        const conflict = useTaxonomyStore.getState().conflicts[0];
        expect(conflict.linked_taxonomy_nodes).not.toContain('acc-beliefs-001');
        expect(conflict.linked_taxonomy_nodes[0]).toMatch(/^saf-beliefs-/);
      });
    });
  });

  // ═══════════════════════════════════════════════
  // Taxonomy data — situation node CRUD
  // ═══════════════════════════════════════════════

  describe('situation node CRUD', () => {
    beforeEach(() => {
      useTaxonomyStore.setState({ situations: makeSituationsFile() });
    });

    describe('createSituationNode', () => {
      it('adds a new situation node', () => {
        const newId = useTaxonomyStore.getState().createSituationNode();
        expect(newId).toMatch(/^sit-/);
        expect(useTaxonomyStore.getState().situations!.nodes).toHaveLength(2);
        expect(useTaxonomyStore.getState().dirty.has('situations')).toBe(true);
      });

      it('returns empty string if situations not loaded', () => {
        useTaxonomyStore.setState({ situations: null });
        expect(useTaxonomyStore.getState().createSituationNode()).toBe('');
      });
    });

    describe('updateSituationNode', () => {
      it('updates node and marks dirty', () => {
        useTaxonomyStore.getState().updateSituationNode('sit-001', { label: 'Updated situation' });
        const node = useTaxonomyStore.getState().situations!.nodes.find(n => n.id === 'sit-001')!;
        expect(node.label).toBe('Updated situation');
        expect(useTaxonomyStore.getState().dirty.has('situations')).toBe(true);
      });
    });

    describe('deleteSituationNode', () => {
      it('removes node', () => {
        useTaxonomyStore.getState().deleteSituationNode('sit-001');
        expect(useTaxonomyStore.getState().situations!.nodes).toHaveLength(0);
      });

      it('clears selection if deleted node was selected', () => {
        useTaxonomyStore.setState({ selectedNodeId: 'sit-001' });
        useTaxonomyStore.getState().deleteSituationNode('sit-001');
        expect(useTaxonomyStore.getState().selectedNodeId).toBeNull();
      });
    });
  });

  // ═══════════════════════════════════════════════
  // Taxonomy data — conflict CRUD
  // ═══════════════════════════════════════════════

  describe('conflict CRUD', () => {
    beforeEach(() => {
      useTaxonomyStore.setState({
        conflicts: [makeConflict()],
      });
    });

    describe('createConflict', () => {
      it('creates a new conflict with generated ID', () => {
        const newId = useTaxonomyStore.getState().createConflict('New claim');
        expect(newId).toMatch(/^conflict-/);
        expect(useTaxonomyStore.getState().conflicts).toHaveLength(2);
        expect(useTaxonomyStore.getState().dirty.has(newId)).toBe(true);
      });
    });

    describe('updateConflict', () => {
      it('updates conflict fields', () => {
        useTaxonomyStore.getState().updateConflict('conflict-test-001', { status: 'resolved' });
        const conflict = useTaxonomyStore.getState().conflicts.find(c => c.claim_id === 'conflict-test-001')!;
        expect(conflict.status).toBe('resolved');
      });
    });

    describe('deleteConflict', () => {
      it('removes conflict', () => {
        useTaxonomyStore.getState().deleteConflict('conflict-test-001');
        expect(useTaxonomyStore.getState().conflicts).toHaveLength(0);
      });

      it('clears selection if deleted conflict was selected', () => {
        useTaxonomyStore.setState({ selectedNodeId: 'conflict-test-001' });
        useTaxonomyStore.getState().deleteConflict('conflict-test-001');
        expect(useTaxonomyStore.getState().selectedNodeId).toBeNull();
      });
    });

    describe('conflict instances', () => {
      it('addConflictInstance appends to instances', () => {
        const instance = { source_pov: 'accelerationist', context: 'test' } as any;
        useTaxonomyStore.getState().addConflictInstance('conflict-test-001', instance);
        expect(useTaxonomyStore.getState().conflicts[0].instances).toHaveLength(1);
      });

      it('removeConflictInstance removes by index', () => {
        const instances = [{ source_pov: 'a' }, { source_pov: 'b' }] as any[];
        useTaxonomyStore.setState({
          conflicts: [makeConflict({ instances })],
        });
        useTaxonomyStore.getState().removeConflictInstance('conflict-test-001', 0);
        expect(useTaxonomyStore.getState().conflicts[0].instances).toHaveLength(1);
        expect(useTaxonomyStore.getState().conflicts[0].instances[0].source_pov).toBe('b');
      });

      it('updateConflictInstance updates by index', () => {
        const instances = [{ source_pov: 'a', context: 'old' }] as any[];
        useTaxonomyStore.setState({
          conflicts: [makeConflict({ instances })],
        });
        useTaxonomyStore.getState().updateConflictInstance('conflict-test-001', 0, { context: 'new' });
        expect(useTaxonomyStore.getState().conflicts[0].instances[0].context).toBe('new');
      });
    });

    describe('conflict notes', () => {
      it('addConflictNote appends', () => {
        const note = { note: 'Test note', author: 'user' } as any;
        useTaxonomyStore.getState().addConflictNote('conflict-test-001', note);
        expect(useTaxonomyStore.getState().conflicts[0].human_notes).toHaveLength(1);
      });

      it('removeConflictNote removes by index', () => {
        const notes = [{ note: 'A' }, { note: 'B' }] as any[];
        useTaxonomyStore.setState({
          conflicts: [makeConflict({ human_notes: notes })],
        });
        useTaxonomyStore.getState().removeConflictNote('conflict-test-001', 0);
        expect(useTaxonomyStore.getState().conflicts[0].human_notes).toHaveLength(1);
        expect(useTaxonomyStore.getState().conflicts[0].human_notes[0].note).toBe('B');
      });

      it('updateConflictNote updates by index', () => {
        const notes = [{ note: 'old', author: 'user' }] as any[];
        useTaxonomyStore.setState({
          conflicts: [makeConflict({ human_notes: notes })],
        });
        useTaxonomyStore.getState().updateConflictNote('conflict-test-001', 0, { note: 'new' });
        expect(useTaxonomyStore.getState().conflicts[0].human_notes[0].note).toBe('new');
      });
    });
  });

  // ═══════════════════════════════════════════════
  // Taxonomy data — lookup helpers
  // ═══════════════════════════════════════════════

  describe('lookup helpers', () => {
    beforeEach(() => {
      useTaxonomyStore.setState({
        accelerationist: makePovFile([makePovNode({ id: 'acc-beliefs-001', label: 'Acc Belief', description: 'desc-acc' })]),
        safetyist: null,
        skeptic: null,
        situations: makeSituationsFile(),
        conflicts: [makeConflict({ claim_id: 'conflict-test-001', claim_label: 'Test Conflict' })],
        policyRegistry: [{ id: 'pol-001', action: 'Policy Action', source_povs: [], member_count: 0 }],
      });
    });

    describe('getAllNodeIds', () => {
      it('returns IDs from all loaded POVs and situations', () => {
        const ids = useTaxonomyStore.getState().getAllNodeIds();
        expect(ids).toContain('acc-beliefs-001');
        expect(ids).toContain('sit-001');
        expect(ids).toHaveLength(2);
      });
    });

    describe('getAllConflictIds', () => {
      it('returns all conflict IDs', () => {
        const ids = useTaxonomyStore.getState().getAllConflictIds();
        expect(ids).toEqual(['conflict-test-001']);
      });
    });

    describe('getLabelForId', () => {
      it('finds POV node label', () => {
        expect(useTaxonomyStore.getState().getLabelForId('acc-beliefs-001')).toBe('Acc Belief');
      });

      it('finds situation label', () => {
        expect(useTaxonomyStore.getState().getLabelForId('sit-001')).toBe('Test situation');
      });

      it('finds conflict label', () => {
        expect(useTaxonomyStore.getState().getLabelForId('conflict-test-001')).toBe('Test Conflict');
      });

      it('finds policy action', () => {
        expect(useTaxonomyStore.getState().getLabelForId('pol-001')).toBe('Policy Action');
      });

      it('returns empty string for unknown ID', () => {
        expect(useTaxonomyStore.getState().getLabelForId('unknown-999')).toBe('');
      });
    });

    describe('getDescriptionForId', () => {
      it('finds POV node description', () => {
        expect(useTaxonomyStore.getState().getDescriptionForId('acc-beliefs-001')).toBe('desc-acc');
      });

      it('finds situation description', () => {
        expect(useTaxonomyStore.getState().getDescriptionForId('sit-001')).toBe('A test situation');
      });

      it('returns empty string for unknown ID', () => {
        expect(useTaxonomyStore.getState().getDescriptionForId('unknown-999')).toBe('');
      });
    });

    describe('lookupPinnedData', () => {
      it('returns pov pinned data for POV node', () => {
        const result = useTaxonomyStore.getState().lookupPinnedData('acc-beliefs-001');
        expect(result).not.toBeNull();
        expect(result!.type).toBe('pov');
      });

      it('returns situations pinned data for situation node', () => {
        const result = useTaxonomyStore.getState().lookupPinnedData('sit-001');
        expect(result).not.toBeNull();
        expect(result!.type).toBe('situations');
      });

      it('returns conflict pinned data', () => {
        const result = useTaxonomyStore.getState().lookupPinnedData('conflict-test-001');
        expect(result).not.toBeNull();
        expect(result!.type).toBe('conflict');
      });

      it('returns null for unknown ID', () => {
        expect(useTaxonomyStore.getState().lookupPinnedData('unknown-999')).toBeNull();
      });

      it('returns structuredClone (not a reference)', () => {
        const result = useTaxonomyStore.getState().lookupPinnedData('acc-beliefs-001')!;
        if (result.type === 'pov') {
          result.node.label = 'MUTATED';
          expect(useTaxonomyStore.getState().accelerationist!.nodes[0].label).toBe('Acc Belief');
        }
      });
    });
  });

  // ═══════════════════════════════════════════════
  // Taxonomy data — edges
  // ═══════════════════════════════════════════════

  describe('edges', () => {
    describe('loadEdges', () => {
      it('loads edges from API', async () => {
        const edgesFile = { edges: [{ source: 'a', target: 'b', type: 'supports' }] };
        mockApi.loadEdges.mockResolvedValueOnce(edgesFile);

        await useTaxonomyStore.getState().loadEdges();
        expect(useTaxonomyStore.getState().edgesFile).toEqual(edgesFile);
        expect(useTaxonomyStore.getState().edgesLoading).toBe(false);
      });

      it('skips if already loaded', async () => {
        useTaxonomyStore.setState({ edgesFile: { edges: [] } as any });
        await useTaxonomyStore.getState().loadEdges();
        expect(mockApi.loadEdges).not.toHaveBeenCalled();
      });
    });

    describe('showRelatedEdges', () => {
      it('sets relatedNodeId and toolbar panel', () => {
        useTaxonomyStore.setState({ edgesFile: { edges: [] } as any });
        useTaxonomyStore.getState().showRelatedEdges('acc-beliefs-001');
        expect(useTaxonomyStore.getState().relatedNodeId).toBe('acc-beliefs-001');
        expect(useTaxonomyStore.getState().toolbarPanel).toBe('related');
      });

      it('clears when passed null', () => {
        useTaxonomyStore.setState({ relatedNodeId: 'x', toolbarPanel: 'related' });
        useTaxonomyStore.getState().showRelatedEdges(null);
        expect(useTaxonomyStore.getState().relatedNodeId).toBeNull();
        expect(useTaxonomyStore.getState().toolbarPanel).toBeNull();
      });
    });

    describe('selectEdge', () => {
      it('sets selectedEdge', () => {
        const edge = { source: 'a', target: 'b', type: 'supports' } as Edge;
        useTaxonomyStore.getState().selectEdge(edge);
        expect(useTaxonomyStore.getState().selectedEdge).toBe(edge);
      });
    });
  });

  // ═══════════════════════════════════════════════
  // Taxonomy data — toolbar navigation
  // ═══════════════════════════════════════════════

  describe('toolbar navigation', () => {
    it('setToolbarPanel updates panel and saves previousView', () => {
      useTaxonomyStore.setState({ toolbarPanel: 'search', selectedNodeId: 'abc' });
      useTaxonomyStore.getState().setToolbarPanel('lineage');
      expect(useTaxonomyStore.getState().toolbarPanel).toBe('lineage');
      expect(useTaxonomyStore.getState().previousView).toEqual({ panel: 'search', nodeId: 'abc' });
    });

    it('navigateToLineage sets panel and value', () => {
      useTaxonomyStore.getState().navigateToLineage('kantian-ethics');
      expect(useTaxonomyStore.getState().toolbarPanel).toBe('lineage');
      expect(useTaxonomyStore.getState().pendingLineageValue).toBe('kantian-ethics');
    });

    it('navigateToSearchRelated sets panel and nodeId', () => {
      useTaxonomyStore.getState().navigateToSearchRelated('acc-beliefs-001');
      expect(useTaxonomyStore.getState().toolbarPanel).toBe('search');
      expect(useTaxonomyStore.getState().pendingSearchRelatedId).toBe('acc-beliefs-001');
    });

    it('navigateBack restores previousView', () => {
      useTaxonomyStore.setState({
        toolbarPanel: 'lineage',
        previousView: { panel: 'search', nodeId: 'abc' },
      });
      useTaxonomyStore.getState().navigateBack();
      expect(useTaxonomyStore.getState().toolbarPanel).toBe('search');
      expect(useTaxonomyStore.getState().selectedNodeId).toBe('abc');
      expect(useTaxonomyStore.getState().previousView).toBeNull();
    });

    it('navigateBack with no previousView clears panel', () => {
      useTaxonomyStore.setState({ toolbarPanel: 'lineage', previousView: null });
      useTaxonomyStore.getState().navigateBack();
      expect(useTaxonomyStore.getState().toolbarPanel).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════
  // Taxonomy data — loadAll
  // ═══════════════════════════════════════════════

  describe('loadAll', () => {
    it('loads accelerationist first then remaining in parallel', async () => {
      const accFile = makePovFile([makePovNode({ id: 'acc-beliefs-001' })]);
      const safFile = makePovFile([makePovNode({ id: 'saf-beliefs-001' })]);
      const skpFile = makePovFile([makePovNode({ id: 'skp-beliefs-001' })]);
      const sitFile = makeSituationsFile();

      mockApi.loadTaxonomyFile.mockImplementation((pov: string) => {
        if (pov === 'accelerationist') return Promise.resolve(accFile);
        if (pov === 'safetyist') return Promise.resolve(safFile);
        if (pov === 'skeptic') return Promise.resolve(skpFile);
        if (pov === 'situations') return Promise.resolve(sitFile);
        return Promise.resolve(null);
      });
      mockApi.loadPolicyRegistry.mockResolvedValueOnce({ policies: [{ id: 'pol-001', action: 'Act' }] });

      await useTaxonomyStore.getState().loadAll();

      expect(useTaxonomyStore.getState().accelerationist).not.toBeNull();
      expect(useTaxonomyStore.getState().safetyist).not.toBeNull();
      expect(useTaxonomyStore.getState().skeptic).not.toBeNull();
      expect(useTaxonomyStore.getState().situations).not.toBeNull();
      expect(useTaxonomyStore.getState().loading).toBe(false);
      expect(useTaxonomyStore.getState().backgroundLoading).toBe(false);
    });

    it('sets loading state during initial load', async () => {
      let wasLoading = false;
      const unsubscribe = useTaxonomyStore.subscribe((state) => {
        if (state.loading) wasLoading = true;
      });

      mockApi.loadTaxonomyFile.mockResolvedValue({ nodes: [] });
      mockApi.loadPolicyRegistry.mockResolvedValue({ policies: [] });
      await useTaxonomyStore.getState().loadAll();

      unsubscribe();
      expect(wasLoading).toBe(true);
    });

    it('handles load failure gracefully', async () => {
      mockApi.loadTaxonomyFile.mockRejectedValueOnce(new Error('Network error'));
      await useTaxonomyStore.getState().loadAll();
      expect(useTaxonomyStore.getState().loading).toBe(false);
      expect(useTaxonomyStore.getState().saveError).toBeTruthy();
    });
  });

  // ═══════════════════════════════════════════════
  // Taxonomy data — save
  // ═══════════════════════════════════════════════

  describe('save', () => {
    it('does nothing when dirty set is empty', async () => {
      useTaxonomyStore.setState({ dirty: new Set() });
      await useTaxonomyStore.getState().save();
      expect(mockApi.saveTaxonomyFile).not.toHaveBeenCalled();
    });

    it('saves dirty POV files', async () => {
      useTaxonomyStore.setState({
        accelerationist: makePovFile(),
        dirty: new Set(['accelerationist']),
      });

      await useTaxonomyStore.getState().save();
      expect(mockApi.saveTaxonomyFile).toHaveBeenCalledWith('accelerationist', expect.any(Object));
      expect(mockApi.syncCommit).toHaveBeenCalled();
      expect(useTaxonomyStore.getState().dirty.size).toBe(0);
    });

    it('saves dirty situations file', async () => {
      useTaxonomyStore.setState({
        situations: makeSituationsFile(),
        dirty: new Set(['situations']),
      });

      await useTaxonomyStore.getState().save();
      expect(mockApi.saveTaxonomyFile).toHaveBeenCalledWith('situations', expect.any(Object));
    });

    it('saves dirty conflict files', async () => {
      useTaxonomyStore.setState({
        conflicts: [makeConflict()],
        dirty: new Set(['conflict-test-001']),
      });

      await useTaxonomyStore.getState().save();
      expect(mockApi.saveConflictFile).toHaveBeenCalledWith('conflict-test-001', expect.any(Object));
    });

    it('sets saveError on failure', async () => {
      mockApi.saveTaxonomyFile.mockRejectedValueOnce(new Error('Disk full'));
      useTaxonomyStore.setState({
        accelerationist: makePovFile(),
        dirty: new Set(['accelerationist']),
      });

      await useTaxonomyStore.getState().save();
      expect(useTaxonomyStore.getState().saveError).toBeTruthy();
    });

    it('dismissSaveError clears error', () => {
      useTaxonomyStore.setState({ saveError: 'Some error' });
      useTaxonomyStore.getState().dismissSaveError();
      expect(useTaxonomyStore.getState().saveError).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════
  // Semantic search (async)
  // ═══════════════════════════════════════════════

  describe('runSemanticSearch', () => {
    it('returns empty results for blank query', async () => {
      await useTaxonomyStore.getState().runSemanticSearch('   ', new Set(), new Set());
      expect(useTaxonomyStore.getState().semanticResults).toEqual([]);
    });

    it('computes embeddings and runs search', async () => {
      useTaxonomyStore.setState({
        accelerationist: makePovFile([makePovNode({ id: 'acc-beliefs-001', description: 'test' })]),
        safetyist: null,
        skeptic: null,
        situations: null,
        conflicts: [],
      });

      mockApi.computeEmbeddings.mockResolvedValueOnce({ vectors: [[0.1, 0.2]] });
      mockApi.computeQueryEmbedding.mockResolvedValueOnce({ vector: [0.1, 0.2] });
      const { rankBySimilarity } = await import('../utils/similarity');
      (rankBySimilarity as ReturnType<typeof vi.fn>).mockReturnValueOnce([{ id: 'acc-beliefs-001', score: 0.95 }]);

      await useTaxonomyStore.getState().runSemanticSearch('test query', new Set(), new Set());

      expect(useTaxonomyStore.getState().semanticResults).toHaveLength(1);
      expect(useTaxonomyStore.getState().embeddingLoading).toBe(false);
    });

    it('handles embedding error gracefully', async () => {
      useTaxonomyStore.setState({
        accelerationist: makePovFile([makePovNode()]),
        safetyist: null,
        skeptic: null,
        situations: null,
        conflicts: [],
      });

      mockApi.computeEmbeddings.mockRejectedValueOnce(new Error('API error'));

      await useTaxonomyStore.getState().runSemanticSearch('query', new Set(), new Set());

      expect(useTaxonomyStore.getState().embeddingLoading).toBe(false);
      expect(useTaxonomyStore.getState().embeddingError).toBeTruthy();
    });
  });

  // ═══════════════════════════════════════════════
  // Similar search (async)
  // ═══════════════════════════════════════════════

  describe('runSimilarSearch', () => {
    it('returns empty for blank query', async () => {
      await useTaxonomyStore.getState().runSimilarSearch('node1', '', '');
      expect(useTaxonomyStore.getState().similarResults).toEqual([]);
      expect(useTaxonomyStore.getState().similarLoading).toBe(false);
    });

    it('runs search and excludes source node', async () => {
      useTaxonomyStore.setState({
        accelerationist: makePovFile([
          makePovNode({ id: 'acc-beliefs-001', description: 'test' }),
          makePovNode({ id: 'acc-beliefs-002', description: 'similar' }),
        ]),
        safetyist: null,
        skeptic: null,
        situations: null,
        conflicts: [],
      });

      mockApi.computeEmbeddings.mockResolvedValueOnce({ vectors: [[0.1], [0.2]] });
      mockApi.computeQueryEmbedding.mockResolvedValueOnce({ vector: [0.1] });
      const { rankBySimilarity } = await import('../utils/similarity');
      (rankBySimilarity as ReturnType<typeof vi.fn>).mockReturnValueOnce([
        { id: 'acc-beliefs-001', score: 1.0 },
        { id: 'acc-beliefs-002', score: 0.8 },
      ]);

      await useTaxonomyStore.getState().runSimilarSearch('acc-beliefs-001', 'Test', 'test description');

      const results = useTaxonomyStore.getState().similarResults!;
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('acc-beliefs-002');
    });
  });

  describe('fixIntegrityErrors — edge dangling references', () => {
    function makeEdge(overrides: Partial<Edge> = {}): Edge {
      return {
        source: 'acc-beliefs-001',
        target: 'sit-001',
        type: 'CONVERGES_WITH',
        bidirectional: false,
        confidence: 0.8,
        weight: 0.8,
        rationale: 'test',
        status: 'proposed',
        discovered_at: '2026-01-01',
        model: 'test',
        ...overrides,
      } as Edge;
    }

    function makeEdgesFile(edges: Edge[]): EdgesFile {
      return { _schema_version: '1', _doc: '', last_modified: '2026-01-01', edge_types: [], edges } as EdgesFile;
    }

    it('drops an edge with a fabricated dangling source and clears the save error', () => {
      const validEdge = makeEdge();
      const danglingEdge = makeEdge({ source: 'acc-convergence' }); // symbolic, no such node
      useTaxonomyStore.setState({
        accelerationist: makePovFile([makePovNode()]),
        situations: makeSituationsFile(),
        edgesFile: makeEdgesFile([validEdge, danglingEdge]),
        integrityIssues: [
          { severity: 'error', code: 'EDGE_DANGLING_SOURCE', entityId: 'acc-convergence', message: "Edge source 'acc-convergence' does not exist in taxonomy", fix: '' },
        ],
        saveError: 'Integrity check failed (1 error):\nEDGE_DANGLING_SOURCE: acc-convergence',
      });

      useTaxonomyStore.getState().fixIntegrityErrors();

      const state = useTaxonomyStore.getState();
      expect(state.edgesFile!.edges).toHaveLength(1);
      expect(state.edgesFile!.edges[0].source).toBe('acc-beliefs-001');
      expect(state.dirty.has('edges')).toBe(true);
      expect(state.saveError).toBeNull();
      expect(state.integrityIssues).toHaveLength(0);
    });

    it('drops an edge with a dangling target', () => {
      useTaxonomyStore.setState({
        accelerationist: makePovFile([makePovNode()]),
        situations: makeSituationsFile(),
        edgesFile: makeEdgesFile([makeEdge({ target: 'nonexistent-001' })]),
        integrityIssues: [
          { severity: 'error', code: 'EDGE_DANGLING_TARGET', entityId: 'nonexistent-001', message: "Edge target 'nonexistent-001' does not exist in taxonomy", fix: '' },
        ],
        saveError: 'Integrity check failed (1 error):\nEDGE_DANGLING_TARGET: nonexistent-001',
      });

      useTaxonomyStore.getState().fixIntegrityErrors();

      const state = useTaxonomyStore.getState();
      expect(state.edgesFile!.edges).toHaveLength(0);
      expect(state.dirty.has('edges')).toBe(true);
      expect(state.saveError).toBeNull();
    });

    it('keeps edges whose endpoints both resolve (situation target is valid)', () => {
      useTaxonomyStore.setState({
        accelerationist: makePovFile([makePovNode()]),
        situations: makeSituationsFile(),
        edgesFile: makeEdgesFile([makeEdge({ source: 'acc-beliefs-001', target: 'sit-001' })]),
        integrityIssues: [],
        saveError: null,
      });

      useTaxonomyStore.getState().fixIntegrityErrors();

      // No integrity issues → no-op, edge preserved.
      expect(useTaxonomyStore.getState().edgesFile!.edges).toHaveLength(1);
    });
  });
});
