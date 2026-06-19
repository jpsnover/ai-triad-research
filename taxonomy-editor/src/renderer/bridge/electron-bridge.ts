// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Electron bridge — delegates every AppAPI method to window.electronAPI (IPC).
 * Used when the app runs inside Electron (desktop mode).
 */
import type { AppAPI } from './types';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import {
  tryInitLocalEmbedding,
  isLocalEmbeddingReady,
  localComputeEmbedding,
  localComputeEmbeddings,
} from '../utils/localEmbedding';

// Fire-and-forget: start local embedding init on module load
void tryInitLocalEmbedding();

// Same-window diagnostics callbacks for the in-app drawer (mobile/narrow).
// When a popout BrowserWindow is open, IPC delivers state to it directly.
// When the drawer is used instead, we also deliver to local callbacks.
const localDiagCallbacks = new Set<(state: unknown) => void>();

export const api: AppAPI = {
  // Taxonomy directories
  getTaxonomyDirs: () => window.electronAPI.getTaxonomyDirs(),
  getActiveTaxonomyDir: () => window.electronAPI.getActiveTaxonomyDir(),
  setTaxonomyDir: (d) => window.electronAPI.setTaxonomyDir(d),

  // Taxonomy CRUD
  loadTaxonomyFile: (pov) => window.electronAPI.loadTaxonomyFile(pov),
  saveTaxonomyFile: (pov, data) => window.electronAPI.saveTaxonomyFile(pov, data),
  loadPolicyRegistry: () => window.electronAPI.loadPolicyRegistry(),
  loadLineageCategories: () => window.electronAPI.loadLineageCategories(),
  loadLineageInfo: () => (window.electronAPI as Record<string, unknown> & typeof window.electronAPI).loadLineageInfo() as Promise<Record<string, unknown>>,
  loadEdges: () => window.electronAPI.loadEdges(),
  getEdgeDetail: (index) => window.electronAPI.getEdgeDetail(index),
  updateEdgeStatus: (i, s) => window.electronAPI.updateEdgeStatus(i, s),
  swapEdgeDirection: (i) => window.electronAPI.swapEdgeDirection(i),
  bulkUpdateEdges: (indices, s) => window.electronAPI.bulkUpdateEdges(indices, s),
  buildNodeSourceIndex: () => window.electronAPI.buildNodeSourceIndex(),
  buildPolicySourceIndex: () => window.electronAPI.buildPolicySourceIndex(),

  // Conflict CRUD
  loadConflictFiles: () => window.electronAPI.loadConflictFiles(),
  loadConflictClusters: () => window.electronAPI.loadConflictClusters?.() ?? Promise.resolve(null),
  loadAggregatedCruxes: () => window.electronAPI.loadAggregatedCruxes?.() ?? Promise.resolve(null),
  saveConflictFile: (id, data) => window.electronAPI.saveConflictFile(id, data),
  createConflictFile: (id, data) => window.electronAPI.createConflictFile(id, data),
  deleteConflictFile: (id) => window.electronAPI.deleteConflictFile(id),

  // Summaries & Sources
  discoverSources: () => window.electronAPI.discoverSources(),
  loadSummary: (docId) => window.electronAPI.loadSummary(docId),
  loadSnapshot: (sourceId) => window.electronAPI.loadSnapshot(sourceId),
  resolveSourceDocument: (docId) => window.electronAPI.resolveSourceDocument(docId),
  loadSourceEvidenceIndex: () => window.electronAPI.loadSourceEvidenceIndex(),
  loadDocTitles: () => window.electronAPI.loadDocTitles(),
  getSourceEvidence: (nodeIds, pov) => window.electronAPI.getSourceEvidence(nodeIds, pov),
  runEvidenceQbaf: (claimText, claimId, model) => window.electronAPI.runEvidenceQbaf(claimText, claimId, model),

  // Data management
  isDataAvailable: () => window.electronAPI.isDataAvailable(),
  getDataRoot: () => window.electronAPI.getDataRoot(),
  getCopyStatus: () => Promise.resolve({ state: 'complete' }),
  cloneDataRepo: (p) => window.electronAPI.cloneDataRepo(p),
  setDataRoot: (p) => window.electronAPI.setDataRoot(p),
  pickDirectory: (defaultPath) => window.electronAPI.pickDirectory(defaultPath),
  checkDataUpdates: () => window.electronAPI.checkDataUpdates(),
  pullDataUpdates: () => window.electronAPI.pullDataUpdates(),
  getChangedFiles: () => window.electronAPI.getChangedFiles(),
  getFileDiff: (filePath) => window.electronAPI.getFileDiff(filePath),

  // AI models & keys
  loadAIModels: () => window.electronAPI.loadAIModels(),
  refreshAIModels: () => window.electronAPI.refreshAIModels(),
  setApiKey: (key, backend) => window.electronAPI.setApiKey(key, backend),
  hasApiKey: (backend) => window.electronAPI.hasApiKey(backend),
  getApiKeySummary: () => window.electronAPI.getApiKeySummary(),
  exportKeysForSharing: (passphrase) => window.electronAPI.exportKeysForSharing(passphrase),
  importKeysFromSharing: (payload, passphrase) => window.electronAPI.importKeysFromSharing(payload, passphrase),

  // AI generation
  generateText: (prompt, model, timeout, temperature) => window.electronAPI.generateText(prompt, model, timeout, temperature),
  generateTextWithSearch: (prompt, model) => window.electronAPI.generateTextWithSearch(prompt, model),
  startChatStream: (sys, msgs, model, temp) => window.electronAPI.startChatStream(sys, msgs, model, temp),
  onChatStreamChunk: (cb) => window.electronAPI.onChatStreamChunk(cb),
  onChatStreamDone: (cb) => window.electronAPI.onChatStreamDone(cb),
  onChatStreamError: (cb) => window.electronAPI.onChatStreamError(cb),
  setDebateTemperature: (temp) => window.electronAPI.setDebateTemperature(temp),

  // Embeddings & NLI — local WebNN/WASM first, IPC fallback
  computeEmbeddings: async (texts, ids) => {
    // When IDs are provided, local cache in main process is likely faster
    if (ids || !isLocalEmbeddingReady()) {
      return window.electronAPI.computeEmbeddings(texts, ids);
    }
    try {
      const vectors = await localComputeEmbeddings(texts);
      return { vectors };
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'electron-bridge',
        level: 'error',
        message: 'Local batch embedding failed, falling back to IPC',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      return window.electronAPI.computeEmbeddings(texts, ids);
    }
  },
  updateNodeEmbeddings: (nodes) => window.electronAPI.updateNodeEmbeddings(nodes),
  computeQueryEmbedding: async (text) => {
    if (isLocalEmbeddingReady()) {
      try {
        const vector = await localComputeEmbedding(text);
        return { vector };
      } catch (err) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'electron-bridge',
          level: 'error',
          message: 'Local query embedding failed, falling back to IPC',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
        return window.electronAPI.computeQueryEmbedding(text);
      }
    }
    return window.electronAPI.computeQueryEmbedding(text);
  },
  nliClassify: (pairs) => window.electronAPI.nliClassify(pairs),

  // Debate sessions
  listDebateSessions: () => window.electronAPI.listDebateSessions(),
  listDebateSessionsMeta: () => window.electronAPI.listDebateSessions(), // Electron mode: local fs is fast, reuse full list
  loadDebateSession: (id) => window.electronAPI.loadDebateSession(id),
  saveDebateSession: (s) => window.electronAPI.saveDebateSession(s),
  deleteDebateSession: (id) => window.electronAPI.deleteDebateSession(id),
  exportDebateToFile: (s, format, exportOptions) => window.electronAPI.exportDebateToFile(s, format, exportOptions),
  loadDebateComments: (id) => window.electronAPI.loadDebateComments(id),
  saveDebateComments: (id, data) => window.electronAPI.saveDebateComments(id, data),

  // News Report
  generateNewsReport: (debateId) => window.electronAPI.generateNewsReport(debateId),

  // Chat sessions
  listChatSessions: () => window.electronAPI.listChatSessions(),
  loadChatSession: (id) => window.electronAPI.loadChatSession(id),
  saveChatSession: (s) => window.electronAPI.saveChatSession(s),
  deleteChatSession: (id) => window.electronAPI.deleteChatSession(id),

  // Harvest
  harvestCreateConflict: (c) => window.electronAPI.harvestCreateConflict(c),
  harvestAddDebateRef: (nid, did) => window.electronAPI.harvestAddDebateRef(nid, did),
  harvestUpdateSteelman: (nid, pov, text) => window.electronAPI.harvestUpdateSteelman(nid, pov, text),
  harvestAddVerdict: (cid, v) => window.electronAPI.harvestAddVerdict(cid, v),
  harvestQueueConcept: (c) => window.electronAPI.harvestQueueConcept(c),
  harvestSaveManifest: (m) => window.electronAPI.harvestSaveManifest(m),

  // Dictionary
  loadDictionary: () => (window.electronAPI as Record<string, unknown> & typeof window.electronAPI).loadDictionary() as Promise<{ standardized: unknown[]; colloquial: unknown[]; lintViolations: unknown[] }>,

  // Proposals
  listProposals: () => (window.electronAPI as Record<string, unknown> & typeof window.electronAPI).listProposals() as Promise<unknown[]>,
  saveProposal: (f, d) => (window.electronAPI as Record<string, unknown> & typeof window.electronAPI).saveProposal(f, d) as Promise<{ saved?: boolean; error?: string }>,

  // PowerShell prompts
  readPsPrompt: (name) => (window.electronAPI as Record<string, unknown> & typeof window.electronAPI).readPsPrompt(name) as Promise<{ text: string | null; error?: string }>,
  listPsPrompts: () => (window.electronAPI as Record<string, unknown> & typeof window.electronAPI).listPsPrompts() as Promise<string[]>,

  // Research file access
  readResearchFile: (relativePath) => window.electronAPI.readResearchFile(relativePath),
  writeResearchFile: (relativePath, data) => window.electronAPI.writeResearchFile(relativePath, data),

  // Synthetic corpus
  loadSyntheticCorpus: (pov) => window.electronAPI.loadSyntheticCorpus(pov),
  loadSyntheticEmbeddings: () => window.electronAPI.loadSyntheticEmbeddings(),
  updateSyntheticEmbeddings: (nodeId, pov, vectors) => window.electronAPI.updateSyntheticEmbeddings(nodeId, pov, vectors),

  // Feedback & error reporting
  submitFeedback: (rating, text, category, context) => window.electronAPI.submitFeedback(rating, text, category, context),
  reportError: (err, context) => window.electronAPI.reportError(err, context),

  // Telemetry — no-op in Electron (single-user desktop, no server-side telemetry)
  trackEvent: () => {},

  // Community Library — listing/copying are server-only, but sharing works via communitySubmit proxy
  listCommunityChats: async () => [],
  listCommunityDebates: async () => [],
  submitToCommunity: async (type, itemData, note) => {
    const { useTaxonomyStore } = await import('../hooks/useTaxonomyStore');
    const url = useTaxonomyStore.getState().communityServerUrl?.replace(/\/+$/, '');
    if (!url) throw new Error('Community server URL not configured. Set it in Settings to share.');
    return window.electronAPI.communitySubmit(url, { type, data: itemData, note });
  },
  copyFromCommunity: async () => { throw new Error('Community Library is only available in the web app'); },
  loadCommunityDebateSession: async () => { throw new Error('Community Library is only available in the web app'); },
  loadCommunityChatSession: async () => { throw new Error('Community Library is only available in the web app'); },
  // Proxy through the main process so the cross-origin POST is not blocked by browser CORS.
  communitySubmit: (baseUrl, payload) => window.electronAPI.communitySubmit(baseUrl, payload),

  // Calibration
  getCalibrationHistory: () => window.electronAPI.getCalibrationHistory(),
  getCalibrationLog: () => window.electronAPI.getCalibrationLog(),

  // Sync — no-op in Electron (writes go directly to filesystem)
  syncCommit: async () => ({ ok: true, commitSha: null, filesCommitted: 0 }),

  // Flight recorder
  dumpFlightRecorder: (ndjson) => window.electronAPI.dumpFlightRecorder(ndjson),
  openFile: (filePath) => window.electronAPI.openFile(filePath),
  openFlightRecorderViewer: (dumpPath) => window.electronAPI.openFlightRecorderViewer(dumpPath),

  // Diagnostics
  openDiagnosticsWindow: () => {
    const isPopout = window.location.hash.includes('debate-window');
    const width = window.innerWidth;
    console.log(`[diagnostics] openDiagnosticsWindow: width=${width}, isPopout=${isPopout}, hash=${window.location.hash}`);
    if (!isPopout && width <= 1023) {
      console.log('[diagnostics] Using drawer path (narrow main window)');
      window.dispatchEvent(new CustomEvent('open-diagnostics-drawer'));
      return Promise.resolve();
    }
    console.log('[diagnostics] Using IPC path (popout or wide window)');
    return window.electronAPI.openDiagnosticsWindow();
  },
  openPovProgressionWindow: () => window.electronAPI.openPovProgressionWindow(),
  closeDiagnosticsWindow: () => window.electronAPI.closeDiagnosticsWindow(),
  sendDiagnosticsState: (s) => {
    for (const cb of localDiagCallbacks) cb(s);
    window.electronAPI.sendDiagnosticsState(s);
  },

  // Data file diff popout
  openDiffWindow: (filePath) => window.electronAPI.openDiffWindow(filePath),

  // Prompt Diff popout
  openPromptDiffWindow: (debateId, entryId) => window.electronAPI.openPromptDiffWindow(debateId, entryId),

  // Debate popout
  openDebateWindow: (id) => window.electronAPI.openDebateWindow(id),
  closeDebateWindow: () => window.electronAPI.closeDebateWindow(),
  getCliFileArg: () => window.electronAPI.getCliFileArg(),

  // Terminal
  terminalSpawn: () => window.electronAPI.terminalSpawn(),
  terminalWrite: (data) => window.electronAPI.terminalWrite(data),
  terminalResize: (cols, rows) => window.electronAPI.terminalResize(cols, rows),
  terminalKill: () => window.electronAPI.terminalKill(),

  // File operations
  fetchUrlContent: (url) => window.electronAPI.fetchUrlContent(url),
  pickDocumentFile: () => window.electronAPI.pickDocumentFile(),
  clipboardWriteText: (text) => (window.electronAPI as Record<string, unknown> & typeof window.electronAPI).clipboardWriteText(text) as Promise<void>,

  // Window control
  growWindow: (d) => window.electronAPI.growWindow(d),
  shrinkWindow: (d) => window.electronAPI.shrinkWindow(d),
  isMaximized: () => window.electronAPI.isMaximized(),
  openExternal: (url) => window.electronAPI.openExternal(url),

  // Event listeners
  onDiagnosticsStateUpdate: (cb) => {
    localDiagCallbacks.add(cb);
    const unsub = window.electronAPI.onDiagnosticsStateUpdate(cb);
    return () => { localDiagCallbacks.delete(cb); unsub(); };
  },
  onDiagnosticsPopoutClosed: (cb) => window.electronAPI.onDiagnosticsPopoutClosed(cb),
  openChatWindow: () => window.electronAPI.openChatWindow(),
  onChatPopoutClosed: (cb) => window.electronAPI.onChatPopoutClosed(cb),
  requestReExtractClaims: (entryId) => window.electronAPI.requestReExtractClaims(entryId),
  onReExtractClaims: (cb) => window.electronAPI.onReExtractClaims(cb),
  onDebateWindowLoad: (cb) => window.electronAPI.onDebateWindowLoad(cb),
  onDebatePopoutClosed: (cb) => window.electronAPI.onDebatePopoutClosed(cb),
  onGenerateTextProgress: (cb) => window.electronAPI.onGenerateTextProgress(cb),
  onReloadTaxonomy: (cb) => window.electronAPI.onReloadTaxonomy(cb),
  onFocusNode: (cb) => window.electronAPI.onFocusNode(cb),
  onTaxonomyUpdated: () => () => {},
  focusNodeInMainWindow: (nodeId) => window.electronAPI.focusNodeInMainWindow(nodeId),
  onTerminalData: (cb) => window.electronAPI.onTerminalData(cb),
  onTerminalExit: (cb) => window.electronAPI.onTerminalExit(cb),
  captureScreenshot: (opts) => window.electronAPI.captureScreenshot(opts),
};
