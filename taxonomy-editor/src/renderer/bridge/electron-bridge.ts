// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Electron bridge — delegates every AppAPI method to window.electronAPI (IPC).
 * Used when the app runs inside Electron (desktop mode).
 */
import type { AppAPI } from './types';

export const api: AppAPI = {
  // Taxonomy directories
  getTaxonomyDirs: () => window.electronAPI.getTaxonomyDirs(),
  getActiveTaxonomyDir: () => window.electronAPI.getActiveTaxonomyDir(),
  setTaxonomyDir: (d) => window.electronAPI.setTaxonomyDir(d),

  // Taxonomy CRUD
  loadTaxonomyFile: (pov) => window.electronAPI.loadTaxonomyFile(pov),
  saveTaxonomyFile: (pov, data) => window.electronAPI.saveTaxonomyFile(pov, data),
  loadPolicyRegistry: () => window.electronAPI.loadPolicyRegistry(),
  loadEdges: () => window.electronAPI.loadEdges(),
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
  loadSourceEvidenceIndex: () => window.electronAPI.loadSourceEvidenceIndex(),
  getSourceEvidence: (nodeIds, pov) => window.electronAPI.getSourceEvidence(nodeIds, pov),

  // Data management
  isDataAvailable: () => window.electronAPI.isDataAvailable(),
  getDataRoot: () => window.electronAPI.getDataRoot(),
  getCopyStatus: () => Promise.resolve({ state: 'complete' }),
  cloneDataRepo: (p) => window.electronAPI.cloneDataRepo(p),
  setDataRoot: (p) => window.electronAPI.setDataRoot(p),
  pickDirectory: (defaultPath) => window.electronAPI.pickDirectory(defaultPath),
  checkDataUpdates: () => window.electronAPI.checkDataUpdates(),
  pullDataUpdates: () => window.electronAPI.pullDataUpdates(),

  // AI models & keys
  loadAIModels: () => window.electronAPI.loadAIModels(),
  refreshAIModels: () => window.electronAPI.refreshAIModels(),
  setApiKey: (key, backend) => window.electronAPI.setApiKey(key, backend),
  hasApiKey: (backend) => window.electronAPI.hasApiKey(backend),

  // AI generation
  generateText: (prompt, model, timeout, temperature) => window.electronAPI.generateText(prompt, model, timeout, temperature),
  generateTextWithSearch: (prompt, model) => window.electronAPI.generateTextWithSearch(prompt, model),
  startChatStream: (sys, msgs, model, temp) => window.electronAPI.startChatStream(sys, msgs, model, temp),
  onChatStreamChunk: (cb) => window.electronAPI.onChatStreamChunk(cb),
  onChatStreamDone: (cb) => window.electronAPI.onChatStreamDone(cb),
  onChatStreamError: (cb) => window.electronAPI.onChatStreamError(cb),
  setDebateTemperature: (temp) => window.electronAPI.setDebateTemperature(temp),

  // Embeddings & NLI
  computeEmbeddings: (texts, ids) => window.electronAPI.computeEmbeddings(texts, ids),
  updateNodeEmbeddings: (nodes) => window.electronAPI.updateNodeEmbeddings(nodes),
  computeQueryEmbedding: (text) => window.electronAPI.computeQueryEmbedding(text),
  nliClassify: (pairs) => window.electronAPI.nliClassify(pairs),

  // Debate sessions
  listDebateSessions: () => window.electronAPI.listDebateSessions(),
  listDebateSessionsMeta: () => window.electronAPI.listDebateSessions(), // Electron mode: local fs is fast, reuse full list
  loadDebateSession: (id) => window.electronAPI.loadDebateSession(id),
  saveDebateSession: (s) => window.electronAPI.saveDebateSession(s),
  deleteDebateSession: (id) => window.electronAPI.deleteDebateSession(id),
  exportDebateToFile: (s, format) => window.electronAPI.exportDebateToFile(s, format),
  loadDebateComments: (id) => window.electronAPI.loadDebateComments(id),
  saveDebateComments: (id, data) => window.electronAPI.saveDebateComments(id, data),

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

  // Calibration
  getCalibrationHistory: () => window.electronAPI.getCalibrationHistory(),
  getCalibrationLog: () => window.electronAPI.getCalibrationLog(),

  // Sync — no-op in Electron (writes go directly to filesystem)
  syncCommit: async () => ({ ok: true, commitSha: null, filesCommitted: 0 }),

  // Flight recorder
  dumpFlightRecorder: (ndjson) => window.electronAPI.dumpFlightRecorder(ndjson),
  openFile: (filePath) => window.electronAPI.openFile(filePath),

  // Diagnostics
  openDiagnosticsWindow: () => window.electronAPI.openDiagnosticsWindow(),
  openPovProgressionWindow: () => window.electronAPI.openPovProgressionWindow(),
  closeDiagnosticsWindow: () => window.electronAPI.closeDiagnosticsWindow(),
  sendDiagnosticsState: (s) => window.electronAPI.sendDiagnosticsState(s),

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
  onDiagnosticsStateUpdate: (cb) => window.electronAPI.onDiagnosticsStateUpdate(cb),
  onDiagnosticsPopoutClosed: (cb) => window.electronAPI.onDiagnosticsPopoutClosed(cb),
  onDebateWindowLoad: (cb) => window.electronAPI.onDebateWindowLoad(cb),
  onDebatePopoutClosed: (cb) => window.electronAPI.onDebatePopoutClosed(cb),
  onGenerateTextProgress: (cb) => window.electronAPI.onGenerateTextProgress(cb),
  onReloadTaxonomy: (cb) => window.electronAPI.onReloadTaxonomy(cb),
  onFocusNode: (cb) => window.electronAPI.onFocusNode(cb),
  onTerminalData: (cb) => window.electronAPI.onTerminalData(cb),
  onTerminalExit: (cb) => window.electronAPI.onTerminalExit(cb),
};
