// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { StateCreator } from 'zustand';
import type { TaxonomyStore, ToolbarPanel } from '../types';
import type {
  PovTaxonomyFile,
  CrossCuttingFile as SituationsFile,
  ConflictFile,
  PovNode,
  CrossCuttingNode as SituationNode,
  Edge,
  EdgesFile,
  TabId,
  Pov,
  Category,
  ConflictInstance,
  ConflictNote,
  TextHistoryEntry,
  TextEditSource,
} from '../../../types/taxonomy';
import { interpretationText } from '../../../types/taxonomy';
import {
  povTaxonomyFileSchema,
  crossCuttingFileSchema as situationsFileSchema,
  conflictFileSchema,
  extractPovErrors,
  extractConflictErrors,
  ValidationErrors,
} from '../../../utils/validation';
import {
  generatePovNodeId,
  generateCrossCuttingId as generateSituationId,
  generateConflictId,
  todayISO,
} from '../../../utils/idGenerator';
import { mapErrorToUserMessage } from '../../../utils/errorMessages';
import { normalizeNodeProperties } from '@lib/debate';
import { nodeTypeFromId, nodePovFromId } from '@lib/debate/nodeIdUtils';
import { POV_KEYS } from '@lib/debate/types';
import { validateTaxonomy } from '@lib/debate/validators';
import type { ValidationResult, ValidationIssue } from '@lib/debate/validators';
import { validatePovNodeId } from '@lib/debate/validateNodeId';
import { api } from '@bridge';
import { loadLineageCategoriesData } from '../../../data/lineageCategories';
import { loadLineageInfoData } from '../../../data/lineageLookup';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { trackNodeMutation } from '../../../lib/analyticsEmitter';

export type PinnedData =
  | { type: 'pov'; pov: Pov; node: PovNode }
  | { type: 'situations'; node: SituationNode }
  | { type: 'conflict'; conflict: ConflictFile };

export interface PolicyRegistryEntry {
  id: string;
  action: string;
  description?: string;
  source_povs: string[];
  member_count: number;
}

export interface CruxSource {
  debate_id: string;
  debate_topic: string;
  crux_tracker_id: string;
  identified_turn: number;
  final_state: string;
}

export interface CruxExternalEvidence {
  url: string;
  note?: string;
  added_by: string;
  added_at: string;
}

export interface AggregatedCrux {
  id: string;
  statement: string;
  question_form?: string;
  type: 'empirical' | 'values' | 'definitional';
  sources: CruxSource[];
  linked_node_ids: string[];
  linked_conflict_ids?: string[];
  external_evidence?: CruxExternalEvidence[];
  frequency: number;
  resolution_summary: {
    resolved: number;
    active: number;
    irreducible: number;
  };
}

// ── Slice interface ──

export interface TaxonomyDataSlice {
  accelerationist: PovTaxonomyFile | null;
  safetyist: PovTaxonomyFile | null;
  skeptic: PovTaxonomyFile | null;
  situations: SituationsFile | null;
  policyRegistry: PolicyRegistryEntry[] | null;
  conflicts: ConflictFile[];
  aggregatedCruxes: AggregatedCrux[] | null;

  activeTab: TabId;
  selectedNodeId: string | null;
  dirty: Set<string>;
  validationErrors: ValidationErrors;
  saveError: string | null;
  loadError: string | null;
  integrityIssues: ValidationIssue[];
  fixIntegrityErrors: () => void;
  loading: boolean;
  backgroundLoading: boolean;
  loadingProgress: { completed: string[]; total: number };

  pinnedStack: PinnedData[];
  pinAtDepth: (depth: number, data: PinnedData) => void;
  closePinnedFromDepth: (depth: number) => void;

  setActiveTab: (tab: TabId) => void;
  setSelectedNodeId: (id: string | null) => void;
  navigateToNode: (tab: TabId, id: string) => void;
  /** Reverse of navigateToNode: switch to the Conflicts view and select a conflict by its claim_id. */
  navigateToConflict: (claimId: string) => void;

  loadAll: (force?: boolean) => Promise<void>;
  save: () => Promise<void>;
  dismissSaveError: () => void;

  updatePovNode: (pov: Pov, nodeId: string, updates: Partial<PovNode>, editSource?: { source: TextEditSource; debateId?: string; reason?: string }) => void;
  createPovNode: (pov: Pov, category: Category) => string;
  deletePovNode: (pov: Pov, nodeId: string) => void;
  movePovNodeCategory: (pov: Pov, nodeId: string, newCategory: Category) => void;
  movePovNode: (sourcePov: Pov, nodeId: string, targetPov: Pov, targetCategory: Category) => void;

  updateSituationNode: (nodeId: string, updates: Partial<SituationNode>) => void;
  createSituationNode: () => string;
  deleteSituationNode: (nodeId: string) => void;

  updateConflict: (claimId: string, updates: Partial<ConflictFile>) => void;
  createConflict: (claimLabel: string) => string;
  deleteConflict: (claimId: string) => void;
  addConflictInstance: (claimId: string, instance: ConflictInstance) => void;
  removeConflictInstance: (claimId: string, index: number) => void;
  updateConflictInstance: (claimId: string, index: number, updates: Partial<ConflictInstance>) => void;
  addConflictNote: (claimId: string, note: ConflictNote) => void;
  removeConflictNote: (claimId: string, index: number) => void;
  updateConflictNote: (claimId: string, index: number, updates: Partial<ConflictNote>) => void;

  getAllNodeIds: () => string[];
  getAllConflictIds: () => string[];
  getLabelForId: (id: string) => string;
  getDescriptionForId: (id: string) => string;
  lookupPinnedData: (id: string) => PinnedData | null;

  edgesFile: EdgesFile | null;
  edgesLoading: boolean;
  relatedNodeId: string | null;
  selectedEdge: Edge | null;
  loadEdges: () => Promise<void>;
  showRelatedEdges: (nodeId: string | null) => void;
  selectEdge: (edge: Edge | null) => void;

  toolbarPanel: ToolbarPanel;
  setToolbarPanel: (panel: ToolbarPanel) => void;
  pendingLineageValue: string | null;
  navigateToLineage: (value: string) => void;
  pendingSearchRelatedId: string | null;
  navigateToSearchRelated: (nodeId: string) => void;
  previousView: { panel: ToolbarPanel; nodeId: string | null } | null;
  navigateBack: () => void;

  cruxDetailId: string | null;
  showCruxDetail: (id: string | null) => void;
}

// ── Slice creator ──

export const createTaxonomyDataSlice: StateCreator<TaxonomyStore, [], [], TaxonomyDataSlice> = (set, get) => ({
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
  loadError: null,
  integrityIssues: [],
  loading: false,
  backgroundLoading: false,
  loadingProgress: { completed: [], total: 0 },

  pinnedStack: [],
  pinAtDepth: (depth, data) => set((state) => ({
    pinnedStack: [...state.pinnedStack.slice(0, depth), data],
  })),
  closePinnedFromDepth: (depth) => set((state) => ({
    pinnedStack: state.pinnedStack.slice(0, depth),
  })),

  setActiveTab: (tab) => {
    const prev = get().activeTab;
    set({ activeTab: tab, selectedNodeId: null, validationErrors: {} });
    getGlobalRecorder()?.record({ type: 'ui.navigate', component: 'tab-bar', level: 'info', message: 'tab.switch', data: { from: prev, to: tab } });
    api.trackEvent('view_change', tab, { from: prev });
  },
  setSelectedNodeId: (id) => {
    set({ selectedNodeId: id, validationErrors: {} });
    getGlobalRecorder()?.record({ type: 'ui.select', component: 'node-list', level: 'debug', message: 'node.select', data: { nodeId: id } });
  },
  navigateToNode: (tab, id) => {
    const prev = get().activeTab;
    set({ activeTab: tab, selectedNodeId: id, validationErrors: {} });
    getGlobalRecorder()?.record({ type: 'ui.navigate', component: 'tab-bar', level: 'info', message: 'node.navigate', data: { from: prev, to: tab, nodeId: id } });
  },
  navigateToConflict: (claimId) => {
    const prev = get().activeTab;
    // The Conflicts view selects by claim_id via the shared selectedNodeId field;
    // ConflictsTab/ConflictListItem handle showing + scrolling the selected conflict.
    set({ activeTab: 'conflicts', selectedNodeId: claimId, validationErrors: {} });
    getGlobalRecorder()?.record({ type: 'ui.navigate', component: 'tab-bar', level: 'info', message: 'conflict.navigate', data: { from: prev, to: 'conflicts', claimId } });
  },

  loadAll: async (force = false) => {
    const state = get();
    if (state.loading) return;
    if (!force && state.accelerationist) return;
    const steps = [
      'Accelerationist', 'Safetyist', 'Skeptic', 'Situations',
      'Policy Registry',
    ];
    set({ loading: true, backgroundLoading: false, loadError: null, loadingProgress: { completed: [], total: steps.length } });

    const track = <T,>(label: string, promise: Promise<T>): Promise<T> =>
      promise.then((result) => {
        set((s) => ({
          loadingProgress: {
            ...s.loadingProgress,
            completed: [...s.loadingProgress.completed, label],
          },
        }));
        return result;
      });

    try {
      const acc = await track(steps[0], api.loadTaxonomyFile('accelerationist'));
      const accFile = acc as PovTaxonomyFile;
      if (accFile?.nodes) {
        for (const node of accFile.nodes) {
          normalizeNodeProperties(node as unknown as Record<string, unknown>);
        }
      }
      set({
        accelerationist: accFile,
        loading: false,
        backgroundLoading: true,
        dirty: new Set(),
        embeddingCache: new Map(),
        embeddingDirty: true,
      });

      const [saf, skp, cc, polReg] = await Promise.all([
        track(steps[1], api.loadTaxonomyFile('safetyist')),
        track(steps[2], api.loadTaxonomyFile('skeptic')),
        track(steps[3], api.loadTaxonomyFile('situations')),
        track(steps[4], api.loadPolicyRegistry()),
      ]);
      // Defer conflict file load — on cold starts this triggers 1,242 individual
      // API reads (5s). Let critical taxonomy data render first; the server-side
      // cache warm will likely complete before this fires.
      setTimeout(() => {
        void api.loadConflictFiles().then((c) => set({ conflicts: c as ConflictFile[] })).catch((err) => {
          getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to load conflict files (deferred)', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
        });
      }, 3000);
      void api.loadConflictClusters().then((d) => {
        const clusters = d && typeof d === 'object' && Array.isArray((d as { clusters: unknown }).clusters)
          ? (d as { clusters: { label: string; nodeIds: string[] }[] }).clusters : null;
        set({ conflictClusters: clusters });
      }).catch((err) => {
        getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to load conflict clusters (deferred)', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      });
      void api.loadAggregatedCruxes().then((d) => {
        const cruxes = d && typeof d === 'object' && Array.isArray((d as { cruxes: unknown }).cruxes)
          ? (d as { cruxes: AggregatedCrux[] }).cruxes : null;
        set({ aggregatedCruxes: cruxes });
      }).catch((err) => {
        getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to load aggregated cruxes (deferred)', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      });
      void loadLineageCategoriesData();
      void loadLineageInfoData();
      const regData = polReg as { policies: PolicyRegistryEntry[] } | null;
      for (const povFile of [saf, skp] as PovTaxonomyFile[]) {
        if (povFile?.nodes) {
          for (const node of povFile.nodes) {
            normalizeNodeProperties(node as unknown as Record<string, unknown>);
          }
        }
      }
      set({
        safetyist: saf as PovTaxonomyFile,
        skeptic: skp as PovTaxonomyFile,
        situations: cc as SituationsFile,
        policyRegistry: regData?.policies ?? null,
        backgroundLoading: false,
        embeddingDirty: true,
      });
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'error', message: 'Failed to load taxonomy data', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      const msg = mapErrorToUserMessage(err);
      set({ loading: false, backgroundLoading: false, saveError: msg, loadError: msg });
    }
  },

  dismissSaveError: () => set({ saveError: null, integrityIssues: [] }),

  fixIntegrityErrors: () => {
    const state = get();
    const issues = state.integrityIssues.filter(i => i.severity === 'error');
    if (issues.length === 0) return;

    const dirtyPovs = new Set<string>();
    const povKeys = ['accelerationist', 'safetyist', 'skeptic'] as const;

    // Valid edge endpoints / reference targets = all POV nodes + all situation nodes
    // (mirrors checkReferentialIntegrity's allIds set in validators.ts).
    const validNodeIds = new Set<string>();
    for (const p of povKeys) {
      const f = state[p] as PovTaxonomyFile | null;
      if (f) for (const n of f.nodes) validNodeIds.add(n.id);
    }
    const sitIds = new Set(state.situations?.nodes.map(n => n.id) ?? []);
    for (const id of sitIds) validNodeIds.add(id);

    for (const issue of issues) {
      // Edge-dangling errors are handled in bulk below — they have no owning node to mutate.
      if (issue.code === 'EDGE_DANGLING_SOURCE' || issue.code === 'EDGE_DANGLING_TARGET') continue;

      const entityPov = nodePovFromId(issue.entityId);
      const file = entityPov ? state[entityPov as keyof typeof state] as PovTaxonomyFile | null : null;
      if (!file) continue;
      const node = file.nodes.find(n => n.id === issue.entityId);
      if (!node) continue;

      if (issue.code === 'DANGLING_CHILD') {
        const match = issue.message.match(/Child '([^']+)'/);
        if (match) {
          node.children = node.children.filter(id => validNodeIds.has(id));
          if (entityPov) dirtyPovs.add(entityPov);
        }
      } else if (issue.code === 'DANGLING_PARENT') {
        node.parent_id = null;
        if (entityPov) dirtyPovs.add(entityPov);
      } else if (issue.code === 'DANGLING_SITUATION_REF') {
        node.situation_refs = node.situation_refs.filter(id => sitIds.has(id));
        if (entityPov) dirtyPovs.add(entityPov);
      }
    }

    // Edge integrity: drop any edge whose source or target no longer resolves to a node.
    let removedEdges = 0;
    let repairedEdgesFile = state.edgesFile;
    const hasEdgeIssues = issues.some(i => i.code === 'EDGE_DANGLING_SOURCE' || i.code === 'EDGE_DANGLING_TARGET');
    if (hasEdgeIssues && state.edgesFile) {
      const kept = state.edgesFile.edges.filter(e => validNodeIds.has(e.source) && validNodeIds.has(e.target));
      removedEdges = state.edgesFile.edges.length - kept.length;
      if (removedEdges > 0) {
        repairedEdgesFile = { ...state.edgesFile, edges: kept };
      }
    }

    if (dirtyPovs.size > 0 || removedEdges > 0) {
      const dirty = new Set(state.dirty);
      for (const p of dirtyPovs) dirty.add(p);
      if (removedEdges > 0) dirty.add('edges');
      getGlobalRecorder()?.record({ type: 'state.change', component: 'taxonomy-store', level: 'info', message: 'integrity.auto-fix', data: { fixed: issues.length, removed_edges: removedEdges, dirty: [...dirty] } });
      set({ dirty, edgesFile: repairedEdgesFile, saveError: null, integrityIssues: [], embeddingDirty: true });
    }
  },

  save: async () => {
    const state = get();
    const errors: ValidationErrors = {};
    const dirtyKeys = state.dirty;
    const saveStart = performance.now();

    getGlobalRecorder()?.record({ type: 'state.change', component: 'taxonomy-store', level: 'info', message: 'save.called', data: { dirty: [...dirtyKeys] } });
    if (dirtyKeys.size === 0) return;

    for (const key of dirtyKeys) {
      if ((POV_KEYS as readonly string[]).includes(key)) {
        const file = state[key as typeof POV_KEYS[number]];
        if (!file) continue;
        const result = povTaxonomyFileSchema.safeParse(file);
        if (!result.success) {
          Object.assign(errors, extractPovErrors(result.error, file.nodes));
        }
      } else if (key === 'situations') {
        const file = state.situations;
        if (!file) continue;
        const result = situationsFileSchema.safeParse(file);
        if (!result.success) {
          Object.assign(errors, extractPovErrors(result.error, file.nodes));
        }
      } else if (key.startsWith('conflict-')) {
        const conflict = state.conflicts.find(c => c.claim_id === key);
        if (!conflict) continue;
        const result = conflictFileSchema.safeParse(conflict);
        if (!result.success) {
          Object.assign(errors, extractConflictErrors(result.error, key));
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      getGlobalRecorder()?.record({ type: 'state.error', component: 'taxonomy-store', level: 'error', message: 'save.validation', data: { stage: 'schema', error_count: Object.keys(errors).length, errors, duration_ms: Math.round(performance.now() - saveStart) } });
      set({ validationErrors: errors, saveError: 'Validation failed. Fix errors before saving.' });
      return;
    }

    if (state.accelerationist && state.safetyist && state.skeptic && state.situations) {
      const taxData = {
        accelerationist: { nodes: state.accelerationist.nodes },
        safetyist: { nodes: state.safetyist.nodes },
        skeptic: { nodes: state.skeptic.nodes },
        situations: { nodes: state.situations.nodes },
        edges: state.edgesFile?.edges ?? [],
      };
      const integrity: ValidationResult = validateTaxonomy(taxData);
      const integrityErrors = integrity.issues.filter(i => i.severity === 'error');
      if (integrityErrors.length > 0) {
        const byCode = new Map<string, Map<string, number>>();
        for (const i of integrityErrors) {
          let entities = byCode.get(i.code);
          if (!entities) { entities = new Map(); byCode.set(i.code, entities); }
          entities.set(i.entityId, (entities.get(i.entityId) ?? 0) + 1);
        }
        const lines: string[] = [];
        for (const [code, entities] of byCode) {
          const ids = [...entities.entries()];
          if (ids.length <= 3) {
            lines.push(`${code}: ${ids.map(([id, n]) => n > 1 ? `${id} (×${n})` : id).join(', ')}`);
          } else {
            const shown = ids.slice(0, 2).map(([id, n]) => n > 1 ? `${id} (×${n})` : id).join(', ');
            lines.push(`${code}: ${shown} + ${ids.length - 2} more (${integrityErrors.filter(e => e.code === code).length} total)`);
          }
        }
        const errorSummary = lines.join('\n');
        getGlobalRecorder()?.record({ type: 'state.error', component: 'taxonomy-store', level: 'error', message: 'save.validation', data: { stage: 'integrity', error_count: integrityErrors.length, entities: integrityErrors.slice(0, 10).map(i => `${i.code}: ${i.entityId}`), duration_ms: Math.round(performance.now() - saveStart) } });
        set({
          validationErrors: errors,
          integrityIssues: integrityErrors,
          saveError: `Integrity check failed (${integrityErrors.length} error${integrityErrors.length > 1 ? 's' : ''}):\n${errorSummary}`,
        });
        return;
      }
      const integrityWarnings = integrity.issues.filter(i => i.severity === 'warning');
      if (integrityWarnings.length > 0) {
        getGlobalRecorder()?.record({ type: 'state.change', component: 'taxonomy-store', level: 'warn', message: 'save.validation', data: { stage: 'integrity', warning_count: integrityWarnings.length, entities: integrityWarnings.slice(0, 10).map(i => `${i.code}: ${i.entityId}`) } });
      }
    }

    set({ saveError: null, validationErrors: {} });

    try {
      const promises: Promise<void>[] = [];

      for (const key of dirtyKeys) {
        if ((POV_KEYS as readonly string[]).includes(key)) {
          const file = state[key as typeof POV_KEYS[number]];
          if (file) {
            promises.push(api.saveTaxonomyFile(key as typeof POV_KEYS[number], file));
          }
        } else if (key === 'situations') {
          const file = state.situations;
          if (file) {
            promises.push(api.saveTaxonomyFile('situations', file));
          }
        } else if (key.startsWith('conflict-')) {
          const conflict = state.conflicts.find(c => c.claim_id === key);
          if (conflict) {
            promises.push(api.saveConflictFile(key, conflict));
          }
        }
      }

      await Promise.all(promises);

      const commitResult = await api.syncCommit();
      // save.completed = file write + git commit done — the durable save point (`dirty` is
      // cleared next). The post-save embedding refresh below is a SEPARATE, non-fatal phase
      // that emits its own save.embedding-refresh-{dispatched,failed} events, never
      // save.failed. So save.failed can ONLY be a file-write/commit failure and fires
      // BEFORE this event — never after it. (t/1710; the non-fatal boundary is t/1707.)
      getGlobalRecorder()?.record({ type: 'state.change', component: 'taxonomy-store', level: 'info', message: 'save.completed', data: { files_written: promises.length, duration_ms: Math.round(performance.now() - saveStart), commitSha: commitResult.commitSha, filesCommitted: commitResult.filesCommitted } });
      api.trackEvent('taxonomy_save', 'taxonomy', { files: promises.length });
      set({ dirty: new Set() });

      // Post-save embedding refresh — NON-FATAL, own boundary (t/1707).
      // The file write, commit, and `dirty` clear above have already succeeded. A throw
      // while building or dispatching the embedding batch must NOT surface as
      // "Save failed" (a trust-eroding false negative — the edit IS saved). Record it as
      // a non-blocking event and leave `saveError` untouched. The null-guards below fix
      // today's instance (undefined `node.description`); this boundary fixes the class.
      try {
        const stripExcludes = (text: string | undefined) => (text ?? '').replace(/\s*Excludes:.*/s, '').trim();
        const extractExcludesText = (text: string | undefined): string | undefined => {
          const match = (text ?? '').match(/\bExcludes:\s*([\s\S]*?)\.?\s*$/);
          return match?.[1]?.trim() || undefined;
        };
        const nodesToEmbed: { id: string; text: string; pov: string; exclusionText?: string }[] = [];
        for (const key of dirtyKeys) {
          if ((POV_KEYS as readonly string[]).includes(key)) {
            const file = state[key as typeof POV_KEYS[number]];
            if (file) {
              for (const node of file.nodes) {
                nodesToEmbed.push({ id: node.id, text: node.description, pov: key, exclusionText: extractExcludesText(node.description) });
              }
            }
          } else if (key === 'situations') {
            const file = state.situations;
            if (file) {
              for (const node of file.nodes) {
                nodesToEmbed.push({
                  id: node.id,
                  text: `[situations]\nID: ${node.id}\nLabel: ${node.label}\nDescription: ${stripExcludes(node.description)}\nAccelerationist interpretation: ${interpretationText(node.interpretations.accelerationist)}\nSafetyist interpretation: ${interpretationText(node.interpretations.safetyist)}\nSkeptic interpretation: ${interpretationText(node.interpretations.skeptic)}`,
                  pov: 'situations',
                  exclusionText: extractExcludesText(node.description),
                });
              }
            }
          }
        }
        if (nodesToEmbed.length > 0) {
          // Positive marker that the post-save embedding phase started — distinct from
          // save.completed (file write), pairs with save.embedding-refresh-failed (t/1710).
          getGlobalRecorder()?.record({ type: 'state.change', component: 'taxonomy-store', level: 'info', message: 'save.embedding-refresh-dispatched', data: { node_count: nodesToEmbed.length } });
          api.updateNodeEmbeddings(nodesToEmbed).catch((err) => {
            getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to update node embeddings after save', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
            console.warn('[save] Failed to update embeddings:', err);
          });
        }
      } catch (embedErr) {
        // Non-fatal: the save already succeeded. Surface as a warning, never as saveError.
        getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'save.embedding-refresh-failed', error: { name: (embedErr as Error).name ?? 'Error', message: String(embedErr), stack: (embedErr as Error).stack } });
        console.warn('[save] Post-save embedding refresh failed (save itself succeeded):', embedErr);
      }
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'state.error', component: 'taxonomy-store', level: 'error', message: 'save.failed', data: { error: String(err), duration_ms: Math.round(performance.now() - saveStart) }, error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      set({ saveError: `Save failed: ${mapErrorToUserMessage(err)}` });
    }
  },

  updatePovNode: (pov, nodeId, updates, editSource) => {
    getGlobalRecorder()?.record({ type: 'state.change', component: 'taxonomy-store', level: 'debug', message: 'updatePovNode.called', data: { pov, nodeId, fields: Object.keys(updates), editSource: editSource?.source ?? 'manual' } });
    trackNodeMutation('edit', pov, nodeId);
    if (updates.category) {
      const validation = validatePovNodeId(nodeId, updates.category);
      if (!validation.valid) {
        console.error(`[taxonomy-store] updatePovNode rejected: ${validation.error}`);
        return;
      }
    }
    set((state) => {
      const file = state[pov];
      if (!file) return state;
      const date = todayISO();
      const source = editSource?.source ?? 'interactive';
      const newNodes = file.nodes.map(n => {
        if (n.id !== nodeId) return n;
        const patched = { ...n, ...updates };
        if ('label' in updates && updates.label !== n.label) {
          const entry: TextHistoryEntry = { date, previous: n.label, value: updates.label!, source, ...(editSource?.debateId ? { debate_id: editSource.debateId } : {}), ...(editSource?.reason ? { reason: editSource.reason } : {}) };
          patched.label_history = [...(n.label_history ?? []), entry];
        }
        if ('description' in updates && updates.description !== n.description) {
          const entry: TextHistoryEntry = { date, previous: n.description, value: updates.description!, source, ...(editSource?.debateId ? { debate_id: editSource.debateId } : {}), ...(editSource?.reason ? { reason: editSource.reason } : {}) };
          patched.description_history = [...(n.description_history ?? []), entry];
          patched.plain_description = null;
        }
        return patched;
      });
      const newFile: PovTaxonomyFile = {
        ...file,
        last_modified: date,
        nodes: newNodes,
      };
      const newDirty = new Set(state.dirty);
      newDirty.add(pov);
      return { [pov]: newFile, dirty: newDirty, embeddingDirty: true };
    });
  },

  createPovNode: (pov, category) => {
    const state = get();
    const file = state[pov];
    if (!file) {
      getGlobalRecorder()?.record({ type: 'state.error', component: 'taxonomy-store', level: 'warn', message: 'createPovNode: POV file not loaded', data: { pov, category } });
      return '';
    }
    const existingIds = file.nodes.map(n => n.id);
    const newId = generatePovNodeId(pov, category, existingIds);
    const validation = validatePovNodeId(newId, category);
    if (!validation.valid) {
      console.error(`[taxonomy-store] createPovNode rejected: ${validation.error}`);
      getGlobalRecorder()?.record({ type: 'state.error', component: 'taxonomy-store', level: 'warn', message: 'createPovNode: validation failed', data: { pov, category, error: validation.error } });
      return '';
    }
    const newNode: PovNode = {
      id: newId,
      category,
      label: '',
      description: '',
      parent_id: null,
      children: [],
      situation_refs: [],
    };
    const newFile: PovTaxonomyFile = {
      ...file,
      last_modified: todayISO(),
      nodes: [...file.nodes, newNode],
    };
    const newDirty = new Set(state.dirty);
    newDirty.add(pov);
    set({ [pov]: newFile, dirty: newDirty, selectedNodeId: newId, embeddingDirty: true });
    trackNodeMutation('create', pov, newId);
    return newId;
  },

  deletePovNode: (pov, nodeId) => {
    trackNodeMutation('delete', pov, nodeId);
    set((state) => {
      const file = state[pov];
      if (!file) return state;
      const newNodes = file.nodes.filter(n => n.id !== nodeId);
      const newFile: PovTaxonomyFile = {
        ...file,
        last_modified: todayISO(),
        nodes: newNodes,
      };
      const newDirty = new Set(state.dirty);
      newDirty.add(pov);
      return {
        [pov]: newFile,
        dirty: newDirty,
        embeddingDirty: true,
        selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
      };
    });
  },

  movePovNodeCategory: (pov, nodeId, newCategory) => {
    set((state) => {
      const file = state[pov];
      if (!file) return state;
      const oldNode = file.nodes.find(n => n.id === nodeId);
      if (!oldNode) return state;

      const oldId = oldNode.id;
      const existingIds = file.nodes.map(n => n.id);
      const newId = generatePovNodeId(pov, newCategory, existingIds);
      const validation = validatePovNodeId(newId, newCategory);
      if (!validation.valid) {
        console.error(`[taxonomy-store] movePovNodeCategory rejected: ${validation.error}`);
        return state;
      }

      const newNode: PovNode = {
        ...oldNode,
        id: newId,
        category: newCategory,
      };

      const replaceId = (id: string) => (id === oldId ? newId : id);
      const newNodes = file.nodes.map(n => {
        if (n.id === oldId) return newNode;
        let changed = false;
        let updatedParent = n.parent_id;
        let updatedChildren = n.children;
        if (n.parent_id === oldId) {
          updatedParent = newId;
          changed = true;
        }
        if ((n.children ?? []).includes(oldId)) {
          updatedChildren = (n.children ?? []).map(replaceId);
          changed = true;
        }
        return changed ? { ...n, parent_id: updatedParent, children: updatedChildren } : n;
      });
      const newFile: PovTaxonomyFile = {
        ...file,
        last_modified: todayISO(),
        nodes: newNodes,
      };

      const newDirty = new Set(state.dirty);
      newDirty.add(pov);

      let newSituations = state.situations;
      if (newSituations) {
        let ccChanged = false;
        const ccNodes = newSituations.nodes.map(n => {
          if ((n.linked_nodes ?? []).includes(oldId)) {
            ccChanged = true;
            return { ...n, linked_nodes: (n.linked_nodes ?? []).map(replaceId) };
          }
          return n;
        });
        if (ccChanged) {
          newSituations = { ...newSituations, last_modified: todayISO(), nodes: ccNodes };
          newDirty.add('situations');
        }
      }

      let newConflicts = state.conflicts;
      let conflictsChanged = false;
      newConflicts = newConflicts.map(c => {
        if ((c.linked_taxonomy_nodes ?? []).includes(oldId)) {
          conflictsChanged = true;
          newDirty.add(c.claim_id);
          return { ...c, linked_taxonomy_nodes: (c.linked_taxonomy_nodes ?? []).map(replaceId) };
        }
        return c;
      });

      return {
        [pov]: newFile,
        situations: newSituations,
        conflicts: conflictsChanged ? newConflicts : state.conflicts,
        dirty: newDirty,
        selectedNodeId: newId,
        embeddingDirty: true,
      };
    });
  },

  movePovNode: (sourcePov, nodeId, targetPov, targetCategory) => {
    if (sourcePov === targetPov) {
      get().movePovNodeCategory(sourcePov, nodeId, targetCategory);
      return;
    }

    set((state) => {
      const sourceFile = state[sourcePov];
      const targetFile = state[targetPov];
      if (!sourceFile || !targetFile) return state;

      const oldNode = sourceFile.nodes.find(n => n.id === nodeId);
      if (!oldNode) return state;

      const oldId = oldNode.id;
      const targetExistingIds = targetFile.nodes.map(n => n.id);
      const newId = generatePovNodeId(targetPov, targetCategory, targetExistingIds);
      const validation = validatePovNodeId(newId, targetCategory);
      if (!validation.valid) {
        console.error(`[taxonomy-store] movePovNode rejected: ${validation.error}`);
        return state;
      }

      const newNode: PovNode = {
        ...oldNode,
        id: newId,
        category: targetCategory,
        parent_id: null,
        children: [],
      };

      const newSourceNodes = sourceFile.nodes
        .filter(n => n.id !== oldId)
        .map(n => {
          if (n.parent_id === oldId) return { ...n, parent_id: null };
          if ((n.children ?? []).includes(oldId)) return { ...n, children: (n.children ?? []).filter(c => c !== oldId) };
          return n;
        });

      const newTargetNodes = [...targetFile.nodes, newNode];

      const replaceId = (id: string) => (id === oldId ? newId : id);
      const newDirty = new Set(state.dirty);
      newDirty.add(sourcePov);
      newDirty.add(targetPov);

      let newSituations = state.situations;
      if (newSituations) {
        let ccChanged = false;
        const ccNodes = newSituations.nodes.map(n => {
          if ((n.linked_nodes ?? []).includes(oldId)) {
            ccChanged = true;
            return { ...n, linked_nodes: (n.linked_nodes ?? []).map(replaceId) };
          }
          return n;
        });
        if (ccChanged) {
          newSituations = { ...newSituations, last_modified: todayISO(), nodes: ccNodes };
          newDirty.add('situations');
        }
      }

      let newConflicts = state.conflicts;
      let conflictsChanged = false;
      newConflicts = newConflicts.map(c => {
        if ((c.linked_taxonomy_nodes ?? []).includes(oldId)) {
          conflictsChanged = true;
          newDirty.add(c.claim_id);
          return { ...c, linked_taxonomy_nodes: (c.linked_taxonomy_nodes ?? []).map(replaceId) };
        }
        return c;
      });

      let newEdgesFile = state.edgesFile;
      if (newEdgesFile) {
        let edgesChanged = false;
        const newEdges = newEdgesFile.edges.map(e => {
          const srcMatch = e.source === oldId;
          const tgtMatch = e.target === oldId;
          if (srcMatch || tgtMatch) {
            edgesChanged = true;
            return {
              ...e,
              source: srcMatch ? newId : e.source,
              target: tgtMatch ? newId : e.target,
            };
          }
          return e;
        });
        if (edgesChanged) {
          newEdgesFile = { ...newEdgesFile, edges: newEdges };
          newDirty.add('edges');
        }
      }

      return {
        [sourcePov]: { ...sourceFile, last_modified: todayISO(), nodes: newSourceNodes },
        [targetPov]: { ...targetFile, last_modified: todayISO(), nodes: newTargetNodes },
        situations: newSituations,
        conflicts: conflictsChanged ? newConflicts : state.conflicts,
        edgesFile: newEdgesFile,
        dirty: newDirty,
        selectedNodeId: newId,
        embeddingDirty: true,
      };
    });
  },

  updateSituationNode: (nodeId, updates) => {
    set((state) => {
      const file = state.situations;
      if (!file) return state;
      const newNodes = file.nodes.map(n => {
        if (n.id !== nodeId) return n;
        const patched = { ...n, ...updates };
        if ('description' in updates && updates.description !== n.description) {
          patched.plain_description = null;
        }
        return patched;
      });
      const newFile: SituationsFile = {
        ...file,
        last_modified: todayISO(),
        nodes: newNodes,
      };
      const newDirty = new Set(state.dirty);
      newDirty.add('situations');
      return { situations: newFile, dirty: newDirty, embeddingDirty: true };
    });
  },

  createSituationNode: () => {
    const state = get();
    const file = state.situations;
    if (!file) return '';
    const existingIds = file.nodes.map(n => n.id);
    const newId = generateSituationId(existingIds);
    const newNode: SituationNode = {
      id: newId,
      label: '',
      description: '',
      interpretations: { accelerationist: '', safetyist: '', skeptic: '' },
      linked_nodes: [],
      conflict_ids: [],
    };
    const newFile: SituationsFile = {
      ...file,
      last_modified: todayISO(),
      nodes: [...file.nodes, newNode],
    };
    const newDirty = new Set(state.dirty);
    newDirty.add('situations');
    set({ situations: newFile, dirty: newDirty, selectedNodeId: newId, embeddingDirty: true });
    trackNodeMutation('create', 'situations', newId);
    return newId;
  },

  deleteSituationNode: (nodeId) => {
    trackNodeMutation('delete', 'situations', nodeId);
    set((state) => {
      const file = state.situations;
      if (!file) return state;
      const newNodes = file.nodes.filter(n => n.id !== nodeId);
      const newFile: SituationsFile = {
        ...file,
        last_modified: todayISO(),
        nodes: newNodes,
      };
      const newDirty = new Set(state.dirty);
      newDirty.add('situations');
      return {
        situations: newFile,
        dirty: newDirty,
        embeddingDirty: true,
        selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
      };
    });
  },

  updateConflict: (claimId, updates) => {
    set((state) => {
      const newConflicts = state.conflicts.map(c =>
        c.claim_id === claimId ? { ...c, ...updates } : c,
      );
      const newDirty = new Set(state.dirty);
      newDirty.add(claimId);
      return { conflicts: newConflicts, dirty: newDirty, embeddingDirty: true };
    });
  },

  createConflict: (claimLabel) => {
    const state = get();
    const existingIds = state.conflicts.map(c => c.claim_id);
    const newId = generateConflictId(claimLabel, existingIds);
    const newConflict: ConflictFile = {
      claim_id: newId,
      claim_label: claimLabel,
      description: '',
      status: 'open',
      linked_taxonomy_nodes: [],
      instances: [],
      human_notes: [],
    };
    const newDirty = new Set(state.dirty);
    newDirty.add(newId);
    set({
      conflicts: [...state.conflicts, newConflict],
      dirty: newDirty,
      selectedNodeId: newId,
      embeddingDirty: true,
    });
    return newId;
  },

  deleteConflict: (claimId) => {
    set((state) => {
      const newConflicts = state.conflicts.filter(c => c.claim_id !== claimId);
      const newDirty = new Set(state.dirty);
      newDirty.add(claimId);
      return {
        conflicts: newConflicts,
        dirty: newDirty,
        embeddingDirty: true,
        selectedNodeId: state.selectedNodeId === claimId ? null : state.selectedNodeId,
      };
    });
  },

  addConflictInstance: (claimId, instance) => {
    set((state) => {
      const newConflicts = state.conflicts.map(c =>
        c.claim_id === claimId
          ? { ...c, instances: [...c.instances, instance] }
          : c,
      );
      const newDirty = new Set(state.dirty);
      newDirty.add(claimId);
      return { conflicts: newConflicts, dirty: newDirty, embeddingDirty: true };
    });
  },

  removeConflictInstance: (claimId, index) => {
    set((state) => {
      const newConflicts = state.conflicts.map(c =>
        c.claim_id === claimId
          ? { ...c, instances: c.instances.filter((_, i) => i !== index) }
          : c,
      );
      const newDirty = new Set(state.dirty);
      newDirty.add(claimId);
      return { conflicts: newConflicts, dirty: newDirty, embeddingDirty: true };
    });
  },

  updateConflictInstance: (claimId, index, updates) => {
    set((state) => {
      const newConflicts = state.conflicts.map(c =>
        c.claim_id === claimId
          ? {
              ...c,
              instances: c.instances.map((inst, i) =>
                i === index ? { ...inst, ...updates } : inst,
              ),
            }
          : c,
      );
      const newDirty = new Set(state.dirty);
      newDirty.add(claimId);
      return { conflicts: newConflicts, dirty: newDirty, embeddingDirty: true };
    });
  },

  addConflictNote: (claimId, note) => {
    set((state) => {
      const newConflicts = state.conflicts.map(c =>
        c.claim_id === claimId
          ? { ...c, human_notes: [...c.human_notes, note] }
          : c,
      );
      const newDirty = new Set(state.dirty);
      newDirty.add(claimId);
      return { conflicts: newConflicts, dirty: newDirty, embeddingDirty: true };
    });
  },

  removeConflictNote: (claimId, index) => {
    set((state) => {
      const newConflicts = state.conflicts.map(c =>
        c.claim_id === claimId
          ? { ...c, human_notes: c.human_notes.filter((_, i) => i !== index) }
          : c,
      );
      const newDirty = new Set(state.dirty);
      newDirty.add(claimId);
      return { conflicts: newConflicts, dirty: newDirty, embeddingDirty: true };
    });
  },

  updateConflictNote: (claimId, index, updates) => {
    set((state) => {
      const newConflicts = state.conflicts.map(c =>
        c.claim_id === claimId
          ? {
              ...c,
              human_notes: c.human_notes.map((note, i) =>
                i === index ? { ...note, ...updates } : note,
              ),
            }
          : c,
      );
      const newDirty = new Set(state.dirty);
      newDirty.add(claimId);
      return { conflicts: newConflicts, dirty: newDirty, embeddingDirty: true };
    });
  },

  getAllNodeIds: () => {
    const state = get();
    const ids: string[] = [];
    for (const pov of POV_KEYS) {
      const file = state[pov];
      if (file) ids.push(...file.nodes.map(n => n.id));
    }
    if (state.situations) {
      ids.push(...state.situations.nodes.map(n => n.id));
    }
    return ids;
  },

  getAllConflictIds: () => {
    return get().conflicts.map(c => c.claim_id);
  },

  getLabelForId: (id: string) => {
    const state = get();
    if (id.startsWith('pol-')) {
      const pol = state.policyRegistry?.find(p => p.id === id);
      return pol?.action || '';
    }
    if (nodeTypeFromId(id) === 'situation') {
      const node = state.situations?.nodes.find(n => n.id === id);
      return node?.label || '';
    }
    if (id.startsWith('conflict-')) {
      const conflict = state.conflicts.find(c => c.claim_id === id);
      return conflict?.claim_label || '';
    }
    for (const pov of POV_KEYS) {
      const file = state[pov];
      if (file) {
        const node = file.nodes.find(n => n.id === id);
        if (node) return node.label;
      }
    }
    return '';
  },

  getDescriptionForId: (id: string) => {
    const state = get();
    if (id.startsWith('pol-')) {
      const pol = state.policyRegistry?.find(p => p.id === id);
      return pol?.description || '';
    }
    if (nodeTypeFromId(id) === 'situation') {
      const node = state.situations?.nodes.find(n => n.id === id);
      return node?.description || '';
    }
    for (const pov of POV_KEYS) {
      const file = state[pov];
      if (file) {
        const node = file.nodes.find(n => n.id === id);
        if (node) return node.description;
      }
    }
    return '';
  },

  lookupPinnedData: (id: string): PinnedData | null => {
    const state = get();
    if (nodeTypeFromId(id) === 'situation') {
      const node = state.situations?.nodes.find(n => n.id === id);
      if (node) return { type: 'situations', node: structuredClone(node) };
      return null;
    }
    if (id.startsWith('conflict-')) {
      const conflict = state.conflicts.find(c => c.claim_id === id);
      if (conflict) return { type: 'conflict', conflict: structuredClone(conflict) };
      return null;
    }
    for (const pov of POV_KEYS) {
      const file = state[pov];
      if (file) {
        const node = file.nodes.find(n => n.id === id);
        if (node) return { type: 'pov', pov, node: structuredClone(node) };
      }
    }
    return null;
  },

  edgesFile: null,
  edgesLoading: false,
  relatedNodeId: null,
  selectedEdge: null,

  loadEdges: async () => {
    if (get().edgesFile) return;
    set({ edgesLoading: true });
    try {
      const raw = await api.loadEdges();
      set({ edgesFile: raw as EdgesFile | null, edgesLoading: false });
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'error', message: 'Failed to load edges file', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      set({ edgesLoading: false });
    }
  },

  showRelatedEdges: (nodeId) => {
    set({ relatedNodeId: nodeId, selectedEdge: nodeId ? get().selectedEdge : null, ...(nodeId ? { toolbarPanel: 'related' as const } : { toolbarPanel: null }) });
    if (nodeId && !get().edgesFile) {
      void get().loadEdges();
    }
  },

  selectEdge: (edge) => set({ selectedEdge: edge }),

  toolbarPanel: null,
  setToolbarPanel: (panel) => {
    const state = get();
    set({ toolbarPanel: panel, previousView: { panel: state.toolbarPanel, nodeId: state.selectedNodeId } });
    getGlobalRecorder()?.record({ type: 'ui.toggle', component: 'toolbar', level: 'info', message: 'toolbar.panel', data: { panel, prev: state.toolbarPanel } });
  },
  pendingLineageValue: null,
  navigateToLineage: (value) => {
    const state = get();
    set({
      toolbarPanel: 'lineage',
      pendingLineageValue: value,
      previousView: { panel: state.toolbarPanel, nodeId: state.selectedNodeId },
    });
  },
  pendingSearchRelatedId: null,
  navigateToSearchRelated: (nodeId) => {
    const state = get();
    set({
      toolbarPanel: 'search',
      pendingSearchRelatedId: nodeId,
      previousView: { panel: state.toolbarPanel, nodeId: state.selectedNodeId },
    });
  },
  previousView: null,
  navigateBack: () => {
    const prev = get().previousView;
    if (!prev) {
      set({ toolbarPanel: null, previousView: null });
      return;
    }
    set({
      toolbarPanel: prev.panel,
      previousView: null,
      ...(prev.nodeId ? { selectedNodeId: prev.nodeId } : {}),
    });
  },

  cruxDetailId: null,
  showCruxDetail: (id) => set({ cruxDetailId: id }),
});
