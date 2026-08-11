// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Electron bridge — delegates every AppAPI method to window.electronAPI (IPC).
 * Used when the app runs inside Electron (desktop mode).
 */
import type { AppAPI, UserPreferences } from './types';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { ALL_API_KEY_BACKENDS } from '@lib/ai-client/types';
import {
  tryInitLocalEmbedding,
  notifyBridgeFallback,
  isLocalEmbeddingReady,
  localComputeEmbedding,
  localComputeEmbeddings,
} from '../utils/localEmbedding';

// Fire-and-forget: start local embedding init on module load.
// Bridge is always available in Electron, so WASM-init-failed is harmless noise.
notifyBridgeFallback();
void tryInitLocalEmbedding();

// Same-window diagnostics callbacks for the in-app drawer (mobile/narrow).
// When a popout BrowserWindow is open, IPC delivers state to it directly.
// When the drawer is used instead, we also deliver to local callbacks.
const localDiagCallbacks = new Set<(state: unknown) => void>();

// Brief-timeout renderer-local event bus (t/2307). The debate pipeline runs in
// THIS renderer window and the toast/dialog render in the SAME window, so emit
// and consume share a module-local Set — no main-process IPC round-trip. Mirrors
// web-bridge's bus so `@bridge` exposes an aligned channel in both builds. The old
// 'brief-timeout' IPC channel was unfeedable (main never sees a renderer-side
// timeout) and had zero senders — it is retired in favour of this local bus.
// Types mirror the AppAPI inline shapes; NOT imported from useBriefTimeoutEvents.ts
// (that file imports @bridge, which would create a circular dep).
type BriefTimeoutPayload = { debateId: string; speaker: string; attempt: number; maxAttempts: number; currentModel: string };
type BriefExhaustedPayload = { debateId: string; speaker: string; totalAttempts: number; currentModel: string };
const briefTimeoutCbs = new Set<(e: BriefTimeoutPayload) => void>();
const briefExhaustedCbs = new Set<(e: BriefExhaustedPayload) => void>();
export function emitBriefTimeout(e: BriefTimeoutPayload): void { briefTimeoutCbs.forEach(cb => cb(e)); }
export function emitBriefRetriesExhausted(e: BriefExhaustedPayload): void { briefExhaustedCbs.forEach(cb => cb(e)); }

export const api: AppAPI = {
  // User preferences — delegates to IPC (get-preferences / set-preferences) once
  // ElectronMain handler lands (t/2118). Graceful-degrade until then.
  getPreferences: (): Promise<UserPreferences | null> =>
    window.electronAPI.getPreferences?.() ?? Promise.resolve(null),
  setPreferences: (prefs: UserPreferences): Promise<void> =>
    window.electronAPI.setPreferences?.(prefs) ?? Promise.resolve(),

  // Taxonomy directories
  getTaxonomyDirs: () => window.electronAPI.getTaxonomyDirs(),
  getActiveTaxonomyDir: () => window.electronAPI.getActiveTaxonomyDir(),
  setTaxonomyDir: (d) => window.electronAPI.setTaxonomyDir(d),

  // Taxonomy CRUD
  loadTaxonomyFile: (pov) => window.electronAPI.loadTaxonomyFile(pov),
  saveTaxonomyFile: (pov, data) => window.electronAPI.saveTaxonomyFile(pov, data),
  // New-edge persistence (t/1816). Graceful-degrade until the `save-edges` IPC handler
  // lands (ElectronMain); delegates automatically once preload exposes saveEdges.
  saveEdges: (data) => window.electronAPI.saveEdges?.(data) ?? Promise.reject(new Error('Edge persistence is not available in desktop mode yet (pending the save-edges IPC handler, t/1816)')),
  loadPolicyRegistry: () => window.electronAPI.loadPolicyRegistry(),
  loadLineageCategories: () => window.electronAPI.loadLineageCategories(),
  loadLineageInfo: () => window.electronAPI.loadLineageInfo(),
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
  addCruxEvidence: () => Promise.resolve(),
  removeCruxEvidence: () => Promise.resolve(),
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
  // Optional-chaining fallback: the IPC handler (ElectronMain, t/1998) lands in parallel;
  // until it's present window.electronAPI.loadGreatestHits is undefined → resolve null so
  // the app degrades gracefully (no exclusion) rather than throwing.
  loadGreatestHits: () => window.electronAPI.loadGreatestHits?.() ?? Promise.resolve(null),
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
  validateApiKey: (key, backend) => window.electronAPI.validateApiKey?.(key, backend) ?? Promise.resolve({ valid: false, error: 'Key validation not available in this version' }),
  verifyStoredKeys: (backend) => window.electronAPI.verifyStoredKeys?.(backend) ?? Promise.resolve({ results: [] }),
  setApiKey: (key, backend) => window.electronAPI.setApiKey(key, backend),
  addApiKey: async (key, backend) => {
    const count = await window.electronAPI.addApiKey(key, backend);
    return { count };
  },
  removeApiKey: (index, backend) => window.electronAPI.removeApiKey(index, backend),
  getApiKeys: async (backend) => {
    const masked: string[] = await window.electronAPI.getApiKeys(backend);
    return masked.map((m, i) => ({ index: i, masked: m }));
  },
  deleteApiKey: (backend) => window.electronAPI.deleteApiKey(backend),
  deleteAllApiKeys: () => window.electronAPI.deleteAllApiKeys(),
  hasApiKey: (backend) => window.electronAPI.hasApiKey(backend),
  getAvailableBackends: async () => {
    // Desktop has no community server and NO tier — main-process generateText uses the
    // user's own keys and never touches the proxy, so availability is purely local key
    // presence. A keyless backend is therefore `no_key`, NEVER `tier_restricted`
    // (t/2036: don't mislabel a missing key as tier-blocked, which used to disable it).
    // Backend list is the canonical exhaustive one (t/1956) — never hand-maintain here (t/1958).
    return Promise.all(
      ALL_API_KEY_BACKENDS.map(async (id) => {
        const available = await window.electronAPI.hasApiKey(id);
        return available ? { id, available } : { id, available, reason: 'no_key' as const };
      }),
    );
  },
  getApiKeySummary: () => window.electronAPI.getApiKeySummary(),
  exportKeysForSharing: (passphrase) => window.electronAPI.exportKeysForSharing(passphrase),
  importKeysFromSharing: (payload, passphrase) => window.electronAPI.importKeysFromSharing(payload, passphrase),

  // AI generation
  generateText: (prompt, model, timeout, temperature) => window.electronAPI.generateText(prompt, model, timeout, temperature),
  generateTextWithSearch: (prompt, model) => window.electronAPI.generateTextWithSearch(prompt, model),
  startChatStream: (sys, msgs, model, temp, urlContext) => window.electronAPI.startChatStream(sys, msgs, model, temp, urlContext),
  onChatStreamChunk: (cb) => window.electronAPI.onChatStreamChunk(cb),
  onChatStreamDone: (cb) => window.electronAPI.onChatStreamDone(cb),
  onChatStreamError: (cb) => window.electronAPI.onChatStreamError(cb),
  onChatStreamUrlMetadata: (cb) => window.electronAPI.onChatStreamUrlMetadata?.(cb) ?? (() => {}),
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
  getDebateQuotaStatus: () => Promise.resolve({ allowed: true, resource: 'debates', current: 0, limit: Infinity }),
  listDebateSessions: () => window.electronAPI.listDebateSessions(),
  listDebateSessionsMeta: () => window.electronAPI.listDebateSessions(), // Electron mode: local fs is fast, reuse full list
  loadDebateSession: (id) => window.electronAPI.loadDebateSession(id),
  saveDebateSession: (s, caller) => window.electronAPI.saveDebateSession(s, caller),
  // Electron has no incremental save path — the local fs write is already cheap,
  // so `saveDebateDelta` exists only to keep `AppAPI` total. The store gates on
  // `isElectronMode()` and always routes Electron saves through the full
  // `saveDebateSession` above; this delegate is therefore not reached in normal
  // flow. If it ever is, we return a synthetic advanced version so the caller's
  // version bookkeeping stays monotonic (local path tracks no server version).
  saveDebateDelta: async (delta) => ({ newVersion: delta.baseVersion + 1 }),
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
  exportChatToFile: (entries, format, options) => window.electronAPI.exportChatToFile(entries, format, options),

  // Harvest
  harvestCreateConflict: (c) => window.electronAPI.harvestCreateConflict(c),
  harvestAddDebateRef: (nid, did) => window.electronAPI.harvestAddDebateRef(nid, did),
  harvestUpdateSteelman: (nid, pov, text) => window.electronAPI.harvestUpdateSteelman(nid, pov, text),
  harvestAddVerdict: (cid, v) => window.electronAPI.harvestAddVerdict(cid, v),
  harvestQueueConcept: (c) => window.electronAPI.harvestQueueConcept(c),
  harvestSaveManifest: (m) => window.electronAPI.harvestSaveManifest(m),

  // Dictionary
  loadDictionary: () => window.electronAPI.loadDictionary(),

  // Proposals
  listProposals: () => window.electronAPI.listProposals(),
  saveProposal: (f, d) => window.electronAPI.saveProposal(f, d),

  // PowerShell prompts
  readPsPrompt: (name) => window.electronAPI.readPsPrompt(name),
  listPsPrompts: () => window.electronAPI.listPsPrompts(),

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

  // Support cases — desktop stubs (not supported in Electron per HLD)
  createSupportCase: () => Promise.reject(new Error('Support cases are only available in the web app')),
  listSupportCases: () => Promise.resolve([]),
  getSupportCaseDetail: () => Promise.reject(new Error('Support cases are only available in the web app')),
  uploadCaseAttachment: () => Promise.reject(new Error('Support cases are only available in the web app')),
  downloadCaseAttachment: () => Promise.reject(new Error('Support cases are only available in the web app')),
  listAdminSupportCases: () => Promise.resolve([]),
  respondToSupportCase: () => Promise.reject(new Error('Support cases are only available in the web app')),
  updateSupportCaseStatus: () => Promise.reject(new Error('Support cases are only available in the web app')),

  // Organizations — delegate to IPC when available, graceful fallback otherwise
  listOrganizations: (filters) => window.electronAPI.listOrganizations?.(filters) ?? Promise.resolve([]),
  getOrganization: (id) => window.electronAPI.getOrganization?.(id) ?? Promise.reject(new Error('Organization data is not available in desktop mode')),
  getOrganizationsByPov: (pov) => window.electronAPI.getOrganizationsByPov?.(pov) ?? Promise.resolve([]),
  getOrganizationsByTopic: (topicRef) => window.electronAPI.getOrganizationsByTopic?.(topicRef) ?? Promise.resolve([]),
  getOrganizationsByPolicy: (policyId) => window.electronAPI.getOrganizationsByPolicy?.(policyId) ?? Promise.resolve([]),
  getOrganizationEdges: (orgId) => window.electronAPI.getOrganizationEdges?.(orgId) ?? Promise.resolve([]),

  // Entity / ref resolution (t/1775). Graceful-degrade until the `entity-resolve`
  // IPC handler lands (t/1809): until preload exposes getEntity, this rejects with a
  // typed, handled error (DetailPane surfaces "detail unavailable") rather than an
  // unhandled throw. Once the handler ships it delegates automatically — no change here.
  getEntity: (ref) => window.electronAPI.getEntity?.(ref) ?? Promise.reject(new Error('Entity resolution is not available in desktop mode yet (pending the entity-resolve IPC handler, t/1809)')),

  // Entity list/browser (t/1883). FAIL LOUD until the list-entities IPC handler lands
  // (ElectronMain, t/1889): a silent [] would make the desktop browser look
  // working-but-empty (false-green — TL p/259#6). Once preload exposes listEntities it
  // delegates automatically; same fail-loud pattern as getEntity (t/1809) / saveEdges (t/1816).
  listEntities: (query) => window.electronAPI.listEntities?.(query) ?? Promise.reject(new Error('Entity listing is not available in desktop mode yet (pending the list-entities IPC handler, t/1889)')),

  // Container mentions (t/1901). FAIL LOUD until the container-mentions IPC handler lands
  // (ElectronMain, t/1903) — same staged pattern as getEntity (t/1809) / listEntities (t/1889);
  // a silent null would render the desktop reading flow link-free with no signal.
  getContainerMentions: (id) => window.electronAPI.getContainerMentions?.(id) ?? Promise.reject(new Error('Container mentions are not available in desktop mode yet (pending the container-mentions IPC handler, t/1903)')),

  // Calibration
  getCalibrationHistory: () => window.electronAPI.getCalibrationHistory(),
  getCalibrationLog: () => window.electronAPI.getCalibrationLog(),

  // Sync — no-op in Electron (writes go directly to filesystem)
  syncCommit: async () => ({ ok: true, commitSha: null, filesCommitted: 0 }),

  // Flight recorder
  dumpFlightRecorder: (ndjson, _dumpId) => window.electronAPI.dumpFlightRecorder(ndjson),
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
  openDebateWindow: (id, source) => window.electronAPI.openDebateWindow(id, source),
  closeDebateWindow: (debateId) => window.electronAPI.closeDebateWindow(debateId),
  getCliFileArg: () => window.electronAPI.getCliFileArg(),

  // Terminal
  terminalSpawn: () => window.electronAPI.terminalSpawn(),
  terminalWrite: (data) => window.electronAPI.terminalWrite(data),
  terminalResize: (cols, rows) => window.electronAPI.terminalResize(cols, rows),
  terminalKill: () => window.electronAPI.terminalKill(),

  // File operations
  fetchUrlContent: (url) => window.electronAPI.fetchUrlContent(url),
  pickDocumentFile: () => window.electronAPI.pickDocumentFile(),
  clipboardWriteText: (text) => window.electronAPI.clipboardWriteText(text),

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
  // Renderer-local bus (t/2307) — see emitBriefTimeout above. Was a dead IPC channel.
  onBriefTimeout: (cb) => { briefTimeoutCbs.add(cb); return () => briefTimeoutCbs.delete(cb); },
  onBriefRetriesExhausted: (cb) => { briefExhaustedCbs.add(cb); return () => briefExhaustedCbs.delete(cb); },
  captureScreenshot: (opts) => window.electronAPI.captureScreenshot(opts),

  // Feature flags — desktop has no server. DEBATE_CHAT_REDESIGN defaults ON for
  // the local/Electron build (t/2257); opt out with VITE_DEBATE_CHAT_REDESIGN=false.
  // Web/server default is separate (companion Azure ticket, gated on t/2243).
  getFlags: () => Promise.resolve({
    DEBATE_CHAT_REDESIGN: import.meta.env.VITE_DEBATE_CHAT_REDESIGN !== 'false',
  }),

  // UsageID registry — stub (desktop has no server-side usage registry)
  getUsageRegistry: () => Promise.resolve({}),

  // Admin Error Dashboard — stubs (desktop has no server-side error collection)
  getErrorSummary: () => Promise.resolve({ total: 0, today: 0, last7d: 0, last30d: 0, topErrors: [], byDay: [] }),
  listErrors: () => Promise.resolve({ items: [], total: 0, hasMore: false }),
  getErrorDetail: () => Promise.resolve(null),

  // Deep-link URL — Electron delegates to main process settings; null if not configured
  getWebAppUrl: () => window.electronAPI.getWebAppUrl?.() ?? Promise.resolve(null),

  // Admin Review (Azure Blob via main process)
  adminReviewConfigured: () => window.electronAPI.adminReviewConfigured(),
  adminReviewQueue: () => window.electronAPI.adminReviewQueue() as Promise<{ items: { id: string; domain: string; submitter: string; submitterDisplay: string; submittedAt: string; summary: string; itemCount: number; status: string }[] }>,
  adminReviewStats: () => window.electronAPI.adminReviewStats() as Promise<{ total: number; byDomain: Record<string, number> }>,
  adminReviewDetail: (groupId) => window.electronAPI.adminReviewDetail(groupId),
  adminReviewAction: (action) => window.electronAPI.adminReviewAction(action),
  adminRemoveCommunityItem: (type, id, reason) => window.electronAPI.adminRemoveCommunityItem(type, id, reason),
};
