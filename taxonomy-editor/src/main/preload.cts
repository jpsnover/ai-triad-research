// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { contextBridge, ipcRenderer } from 'electron';

// Buffer debate-window-load IPC so it isn't lost if React mounts after did-finish-load
// (happens with bootstrap.ts dynamic import indirection).
let _bufferedDebateId: string | null = null;
let _debateBufferActive = true;
ipcRenderer.on('debate-window-load', (_event, debateId: string) => {
  if (_debateBufferActive) _bufferedDebateId = debateId;
});

contextBridge.exposeInMainWorld('electronAPI', {
  // Synchronous system info — available without IPC round-trip
  processVersions: { ...process.versions },
  osRelease: process.getSystemVersion?.() ?? process.platform,
  osPlatform: process.platform,
  osArch: process.arch,
  getEmbeddingInfo: (): Promise<{ backend: string; execution_provider?: string; calibration_version?: number }> =>
    ipcRenderer.invoke('get-embedding-info'),

  getTaxonomyDirs: (): Promise<string[]> =>
    ipcRenderer.invoke('get-taxonomy-dirs'),

  getActiveTaxonomyDir: (): Promise<string> =>
    ipcRenderer.invoke('get-active-taxonomy-dir'),

  setTaxonomyDir: (dirName: string): Promise<void> =>
    ipcRenderer.invoke('set-taxonomy-dir', dirName),

  loadTaxonomyFile: (pov: string): Promise<unknown> =>
    ipcRenderer.invoke('load-taxonomy-file', pov),

  saveTaxonomyFile: (pov: string, data: unknown): Promise<void> =>
    ipcRenderer.invoke('save-taxonomy-file', pov, data),

  loadPolicyRegistry: (): Promise<unknown> =>
    ipcRenderer.invoke('load-policy-registry'),

  loadLineageCategories: (): Promise<unknown> =>
    ipcRenderer.invoke('load-lineage-categories'),

  loadLineageInfo: (): Promise<Record<string, unknown>> =>
    ipcRenderer.invoke('load-lineage-info'),

  loadConflictFiles: (): Promise<unknown[]> =>
    ipcRenderer.invoke('load-conflict-files'),

  loadConflictClusters: (): Promise<unknown | null> =>
    ipcRenderer.invoke('load-conflict-clusters'),

  loadAggregatedCruxes: (): Promise<unknown | null> =>
    ipcRenderer.invoke('load-aggregated-cruxes'),

  // Summaries & Sources
  discoverSources: (): Promise<unknown[]> =>
    ipcRenderer.invoke('discover-sources'),

  loadSummary: (docId: string): Promise<unknown | null> =>
    ipcRenderer.invoke('load-summary', docId),

  loadSnapshot: (sourceId: string): Promise<{ content: string } | null> =>
    ipcRenderer.invoke('load-snapshot', sourceId),

  resolveSourceDocument: (docId: string): Promise<{ available: boolean; type: 'pdf' | 'markdown' | null; content?: string; path?: string }> =>
    ipcRenderer.invoke('source-documents:resolve', docId),

  saveConflictFile: (claimId: string, data: unknown): Promise<void> =>
    ipcRenderer.invoke('save-conflict-file', claimId, data),

  createConflictFile: (claimId: string, data: unknown): Promise<void> =>
    ipcRenderer.invoke('create-conflict-file', claimId, data),

  deleteConflictFile: (claimId: string): Promise<void> =>
    ipcRenderer.invoke('delete-conflict-file', claimId),

  loadDictionary: (): Promise<{ standardized: unknown[]; colloquial: unknown[]; lintViolations: unknown[] }> =>
    ipcRenderer.invoke('load-dictionary'),

  isDataAvailable: (): Promise<boolean> =>
    ipcRenderer.invoke('is-data-available'),

  getDataRoot: (): Promise<string> =>
    ipcRenderer.invoke('get-data-root'),

  cloneDataRepo: (targetPath: string): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('clone-data-repo', targetPath),

  setDataRoot: (newRoot: string): Promise<void> =>
    ipcRenderer.invoke('set-data-root', newRoot),

  pickDirectory: (defaultPath?: string): Promise<{ cancelled: boolean; path?: string }> =>
    ipcRenderer.invoke('pick-directory', defaultPath),

  checkDataUpdates: (): Promise<unknown> =>
    ipcRenderer.invoke('check-data-updates'),

  pullDataUpdates: (): Promise<unknown> =>
    ipcRenderer.invoke('pull-data-updates'),

  getChangedFiles: (): Promise<{ path: string; status: string }[]> =>
    ipcRenderer.invoke('get-changed-files'),

  getFileDiff: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('get-file-diff', filePath),

  loadAIModels: (): Promise<unknown> =>
    ipcRenderer.invoke('load-ai-models'),

  refreshAIModels: (): Promise<unknown> =>
    ipcRenderer.invoke('refresh-ai-models'),

  setApiKey: (key: string, backend?: string): Promise<void> =>
    ipcRenderer.invoke('set-api-key', key, backend),

  hasApiKey: (backend?: string): Promise<boolean> =>
    ipcRenderer.invoke('has-api-key', backend),

  getApiKeySummary: (): Promise<{ backend: string; hasKey: boolean; maskedKey: string | null }[]> =>
    ipcRenderer.invoke('get-api-key-summary'),

  deleteApiKey: (backend?: string): Promise<void> =>
    ipcRenderer.invoke('delete-api-key', backend),

  deleteAllApiKeys: (): Promise<void> =>
    ipcRenderer.invoke('delete-all-api-keys'),

  exportKeysForSharing: (passphrase: string): Promise<{ dataUrl: string; payloadText: string }> =>
    ipcRenderer.invoke('export-keys-for-sharing', passphrase),

  importKeysFromSharing: (payload: unknown, passphrase: string): Promise<string[]> =>
    ipcRenderer.invoke('import-keys-from-sharing', payload, passphrase),

  computeEmbeddings: (texts: string[], ids?: string[]): Promise<{ vectors: number[][] }> =>
    ipcRenderer.invoke('compute-embeddings', texts, ids),

  updateNodeEmbeddings: (nodes: { id: string; text: string; pov: string; exclusionText?: string }[]): Promise<void> =>
    ipcRenderer.invoke('update-node-embeddings', nodes),

  computeQueryEmbedding: (text: string): Promise<{ vector: number[] }> =>
    ipcRenderer.invoke('compute-query-embedding', text),

  generateText: (prompt: string, model?: string, timeoutMs?: number, temperature?: number): Promise<{ text: string }> =>
    ipcRenderer.invoke('generate-text', prompt, model, timeoutMs, temperature),

  setDebateTemperature: (temp: number | null): Promise<void> =>
    ipcRenderer.invoke('set-debate-temperature', temp),
  generateTextWithSearch: (prompt: string, model?: string): Promise<{
    text: string;
    searchQueries?: string[];
    citations?: { uri: string; title: string; segments: { startIndex: number; endIndex: number; text?: string; confidence?: number }[] }[];
  }> =>
    ipcRenderer.invoke('generate-text-with-search', prompt, model),

  // Harvest
  harvestCreateConflict: (conflict: Record<string, unknown>): Promise<{ created: boolean }> =>
    ipcRenderer.invoke('harvest-create-conflict', conflict),
  harvestAddDebateRef: (nodeId: string, debateId: string): Promise<{ updated: boolean }> =>
    ipcRenderer.invoke('harvest-add-debate-ref', nodeId, debateId),
  harvestUpdateSteelman: (nodeId: string, attackerPov: string, newText: string): Promise<{ updated: boolean }> =>
    ipcRenderer.invoke('harvest-update-steelman', nodeId, attackerPov, newText),
  harvestAddVerdict: (conflictId: string, verdict: Record<string, unknown>): Promise<{ updated: boolean }> =>
    ipcRenderer.invoke('harvest-add-verdict', conflictId, verdict),
  harvestQueueConcept: (concept: Record<string, unknown>): Promise<{ queued: boolean }> =>
    ipcRenderer.invoke('harvest-queue-concept', concept),

  // Calibration
  getCalibrationHistory: (): Promise<{ current: unknown; history: unknown[] }> =>
    ipcRenderer.invoke('get-calibration-history'),
  getCalibrationLog: (): Promise<{ entries: unknown[]; validationReport: unknown }> =>
    ipcRenderer.invoke('get-calibration-log'),

  // Flight recorder
  dumpFlightRecorder: (ndjson: string): Promise<{ filePath: string; filename: string }> =>
    ipcRenderer.invoke('dump-flight-recorder', ndjson),
  forwardFlightEvent: (event: unknown): void => {
    ipcRenderer.send('forward-flight-event', event);
  },
  triggerMainDump: (): Promise<{ filePath: string }> =>
    ipcRenderer.invoke('trigger-main-dump'),
  onTriggerDump: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('trigger-dump', handler);
    return () => { ipcRenderer.removeListener('trigger-dump', handler); };
  },
  sendDumpResult: (result: { filePath: string }): void => {
    ipcRenderer.send('dump-result', result);
  },
  onFlightEventFromPopup: (callback: (_e: unknown, payload: unknown) => void) => {
    ipcRenderer.on('flight-event-from-popup', callback as (...args: unknown[]) => void);
  },
  openFile: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('open-file', filePath).then(() => {}),
  openFlightRecorderViewer: (dumpPath: string): Promise<void> =>
    ipcRenderer.invoke('open-flight-recorder-viewer', dumpPath).then(() => {}),

  // Diagnostics window
  openDiagnosticsWindow: (): Promise<void> => ipcRenderer.invoke('open-diagnostics-window'),
  openPovProgressionWindow: (): Promise<void> => ipcRenderer.invoke('open-pov-progression-window'),
  closeDiagnosticsWindow: (): Promise<void> => ipcRenderer.invoke('close-diagnostics-window'),

  // Chat popout window
  openChatWindow: (): Promise<void> => ipcRenderer.invoke('open-chat-window'),
  onChatPopoutClosed: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('chat-popout-closed', listener);
    return () => { ipcRenderer.removeListener('chat-popout-closed', listener); };
  },

  // Data file diff window
  openDiffWindow: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('open-diff-window', filePath),

  // Prompt Diff window
  openPromptDiffWindow: (debateId: string, entryId: string): Promise<void> =>
    ipcRenderer.invoke('open-prompt-diff-window', debateId, entryId),
  onPromptDiffContext: (callback: (ctx: { debateId: string; entryId: string }) => void) => {
    ipcRenderer.on('prompt-diff-context', (_event, ctx) => callback(ctx));
  },

  // Debate popout window
  openDebateWindow: (debateId: string): Promise<void> => ipcRenderer.invoke('open-debate-window', debateId),
  closeDebateWindow: (): Promise<void> => ipcRenderer.invoke('close-debate-window'),
  onDebateWindowLoad: (callback: (debateId: string) => void) => {
    // Stop buffering — the React component is now listening directly.
    _debateBufferActive = false;
    // If the IPC arrived before the React component mounted (bootstrap timing),
    // deliver the buffered ID immediately.
    if (_bufferedDebateId) {
      const id = _bufferedDebateId;
      _bufferedDebateId = null;
      queueMicrotask(() => callback(id));
    }
    const listener = (_event: Electron.IpcRendererEvent, debateId: string) => callback(debateId);
    ipcRenderer.on('debate-window-load', listener);
    return () => {
      ipcRenderer.removeListener('debate-window-load', listener);
      // Re-arm buffer so IPC arriving during the next HMR reload cycle is captured
      _debateBufferActive = true;
    };
  },
  onDebatePopoutClosed: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('debate-popout-closed', listener);
    return () => { ipcRenderer.removeListener('debate-popout-closed', listener); };
  },
  sendDiagnosticsState: (state: unknown): void => ipcRenderer.send('diagnostics-state-update', state),
  onDiagnosticsStateUpdate: (callback: (state: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state);
    ipcRenderer.on('diagnostics-state-update', listener);
    return () => { ipcRenderer.removeListener('diagnostics-state-update', listener); };
  },
  requestReExtractClaims: (entryId: string): void => ipcRenderer.send('request-re-extract-claims', entryId),
  onReExtractClaims: (callback: (entryId: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, entryId: string) => callback(entryId);
    ipcRenderer.on('re-extract-claims', listener);
    return () => { ipcRenderer.removeListener('re-extract-claims', listener); };
  },
  getCliFileArg: (): Promise<{ type: string; path: string } | null> =>
    ipcRenderer.invoke('get-cli-file-arg'),
  onDiagnosticsPopoutClosed: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('diagnostics-popout-closed', listener);
    return () => { ipcRenderer.removeListener('diagnostics-popout-closed', listener); };
  },
  harvestSaveManifest: (manifest: Record<string, unknown>): Promise<{ saved: boolean }> =>
    ipcRenderer.invoke('harvest-save-manifest', manifest),

  nliClassify: (pairs: Array<{ text_a: string; text_b: string }>): Promise<{ results: Array<{ nli_label: string; nli_entailment: number; nli_neutral: number; nli_contradiction: number; margin: number }> }> =>
    ipcRenderer.invoke('nli-classify', pairs),

  startChatStream: (systemInstruction: string, messages: { role: 'user' | 'model'; content: string }[], model?: string, temperature?: number): Promise<string> =>
    ipcRenderer.invoke('start-chat-stream', systemInstruction, messages, model, temperature),
  onChatStreamChunk: (callback: (chunk: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, chunk: string) => callback(chunk);
    ipcRenderer.on('chat-stream-chunk', listener);
    return () => { ipcRenderer.removeListener('chat-stream-chunk', listener); };
  },
  onChatStreamDone: (callback: (fullText: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, fullText: string) => callback(fullText);
    ipcRenderer.on('chat-stream-done', listener);
    return () => { ipcRenderer.removeListener('chat-stream-done', listener); };
  },
  onChatStreamError: (callback: (error: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, error: string) => callback(error);
    ipcRenderer.on('chat-stream-error', listener);
    return () => { ipcRenderer.removeListener('chat-stream-error', listener); };
  },

  onGenerateTextProgress: (callback: (progress: { attempt: number; maxRetries: number; backoffSeconds: number; limitType: string; limitMessage: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: { attempt: number; maxRetries: number; backoffSeconds: number; limitType: string; limitMessage: string }) => callback(progress);
    ipcRenderer.on('generate-text-progress', listener);
    return () => { ipcRenderer.removeListener('generate-text-progress', listener); };
  },

  onReloadTaxonomy: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('reload-taxonomy', listener);
    return () => { ipcRenderer.removeListener('reload-taxonomy', listener); };
  },

  onFocusNode: (callback: (nodeId: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, nodeId: string) => callback(nodeId);
    ipcRenderer.on('focus-node', listener);
    return () => { ipcRenderer.removeListener('focus-node', listener); };
  },

  focusNodeInMainWindow: (nodeId: string): void => {
    ipcRenderer.send('focus-node-in-main', nodeId);
  },

  growWindow: (deltaWidth: number): Promise<void> =>
    ipcRenderer.invoke('grow-window', deltaWidth),

  shrinkWindow: (deltaWidth: number): Promise<void> =>
    ipcRenderer.invoke('shrink-window', deltaWidth),

  isMaximized: (): Promise<boolean> =>
    ipcRenderer.invoke('is-maximized'),

  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('open-external', url),

  // Node ↔ Source index
  buildNodeSourceIndex: (): Promise<unknown> =>
    ipcRenderer.invoke('build-node-source-index'),

  // Policy ↔ Source index
  buildPolicySourceIndex: (): Promise<unknown> =>
    ipcRenderer.invoke('build-policy-source-index'),

  // Edges
  loadEdges: (): Promise<unknown> =>
    ipcRenderer.invoke('load-edges'),

  getEdgeDetail: (index: number): Promise<unknown> =>
    ipcRenderer.invoke('load-edge-detail', index),

  updateEdgeStatus: (index: number, status: string): Promise<unknown> =>
    ipcRenderer.invoke('update-edge-status', index, status),

  swapEdgeDirection: (index: number): Promise<unknown> =>
    ipcRenderer.invoke('swap-edge-direction', index),

  bulkUpdateEdges: (indices: number[], status: string): Promise<unknown> =>
    ipcRenderer.invoke('bulk-update-edges', indices, status),

  // Chat sessions
  listChatSessions: (): Promise<unknown[]> =>
    ipcRenderer.invoke('list-chat-sessions'),

  loadChatSession: (id: string): Promise<unknown> =>
    ipcRenderer.invoke('load-chat-session', id),

  saveChatSession: (session: unknown): Promise<void> =>
    ipcRenderer.invoke('save-chat-session', session),

  deleteChatSession: (id: string): Promise<void> =>
    ipcRenderer.invoke('delete-chat-session', id),

  // Source evidence (main process filesystem access)
  loadSourceEvidenceIndex: (): Promise<unknown> =>
    ipcRenderer.invoke('load-source-evidence-index'),
  loadDocTitles: (): Promise<Record<string, string> | null> =>
    ipcRenderer.invoke('load-doc-titles'),
  getSourceEvidence: (nodeIds: string[], pov: string): Promise<unknown> =>
    ipcRenderer.invoke('get-source-evidence', nodeIds, pov),
  runEvidenceQbaf: (claimText: string, claimId: string, model?: string): Promise<unknown> =>
    ipcRenderer.invoke('run-evidence-qbaf', claimText, claimId, model),

  // Debate sessions
  listDebateSessions: (): Promise<unknown[]> =>
    ipcRenderer.invoke('list-debate-sessions'),

  loadDebateSession: (id: string): Promise<unknown> =>
    ipcRenderer.invoke('load-debate-session', id),

  saveDebateSession: (session: unknown): Promise<void> =>
    ipcRenderer.invoke('save-debate-session', session),

  deleteDebateSession: (id: string): Promise<void> =>
    ipcRenderer.invoke('delete-debate-session', id),

  exportDebateToFile: (session: unknown, format?: string, exportOptions?: { includeTaxonomyRefs?: boolean; includeReasoning?: boolean }): Promise<{ cancelled: boolean; filePath?: string }> =>
    ipcRenderer.invoke('export-debate-to-file', session, format, exportOptions),

  loadDebateComments: (debateId: string): Promise<unknown> =>
    ipcRenderer.invoke('load-debate-comments', debateId),

  saveDebateComments: (debateId: string, data: unknown): Promise<void> =>
    ipcRenderer.invoke('save-debate-comments', debateId, data),

  generateNewsReport: (debateId: string): Promise<{ article: string }> =>
    ipcRenderer.invoke('generate-news-report', debateId),

  // URL fetch (from main process to avoid CSP)
  fetchUrlContent: (url: string): Promise<{ content: string; error?: string }> =>
    ipcRenderer.invoke('fetch-url-content', url),

  // Community submit (from main process to avoid renderer CORS against the remote server)
  communitySubmit: (
    baseUrl: string,
    payload: { type: 'chat' | 'debate'; data: unknown; note?: string },
  ): Promise<{ submissionId: string }> =>
    ipcRenderer.invoke('community-submit', baseUrl, payload),

  // File picker
  pickDocumentFile: (): Promise<{ cancelled: boolean; filePath?: string; content?: string }> =>
    ipcRenderer.invoke('pick-document-file'),

  // Taxonomy proposals (for batch approve UI)
  listProposals: (): Promise<unknown[]> =>
    ipcRenderer.invoke('list-proposals'),
  saveProposal: (filename: string, data: unknown): Promise<{ saved?: boolean; error?: string }> =>
    ipcRenderer.invoke('save-proposal', filename, data),

  // PowerShell prompt files (for Prompt Inspector)
  readPsPrompt: (promptName: string): Promise<{ text: string | null; error?: string }> =>
    ipcRenderer.invoke('read-ps-prompt', promptName),
  listPsPrompts: (): Promise<string[]> =>
    ipcRenderer.invoke('list-ps-prompts'),

  // Research file access (path-validated)
  readResearchFile: (relativePath: string): Promise<unknown> =>
    ipcRenderer.invoke('read-research-file', relativePath),
  writeResearchFile: (relativePath: string, data: unknown): Promise<void> =>
    ipcRenderer.invoke('write-research-file', relativePath, data),

  // Synthetic corpus
  loadSyntheticCorpus: (pov: string): Promise<unknown | null> =>
    ipcRenderer.invoke('load-synthetic-corpus', pov),
  updateSyntheticEmbeddings: (nodeId: string, pov: string, vectors: number[][]): Promise<void> =>
    ipcRenderer.invoke('update-synthetic-embeddings', nodeId, pov, vectors),
  loadSyntheticEmbeddings: (): Promise<Record<string, { pov: string; vectors: number[][] }> | null> =>
    ipcRenderer.invoke('load-synthetic-embeddings'),

  // Feedback & error reporting
  submitFeedback: (rating: string, text?: string, category?: string, context?: Record<string, unknown>): Promise<{ ok: boolean; id?: string }> =>
    ipcRenderer.invoke('submit-feedback', rating, text, category, context),
  reportError: (error: Record<string, unknown>, context?: Record<string, unknown>): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('report-error', error, context),

  // Clipboard (Electron 40: renderer clipboard API deprecated)
  clipboardWriteText: (text: string): Promise<void> =>
    ipcRenderer.invoke('clipboard-write-text', text),

  // Screenshot capture
  captureScreenshot: (opts?: { width?: number; height?: number; defaultName?: string }): Promise<{ cancelled: boolean; filePath?: string }> =>
    ipcRenderer.invoke('capture-screenshot', opts),

  // Terminal
  terminalSpawn: (): Promise<void> =>
    ipcRenderer.invoke('terminal:spawn'),
  terminalWrite: (data: string): Promise<void> =>
    ipcRenderer.invoke('terminal:write', data),
  terminalResize: (cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke('terminal:resize', cols, rows),
  terminalKill: (): Promise<void> =>
    ipcRenderer.invoke('terminal:kill'),
  onTerminalData: (callback: (data: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: string) => callback(data);
    ipcRenderer.on('terminal:data', handler);
    return () => { ipcRenderer.removeListener('terminal:data', handler); };
  },
  onTerminalExit: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('terminal:exit', handler);
    return () => { ipcRenderer.removeListener('terminal:exit', handler); };
  },

  // Community review (Azure Blob — desktop admin)
  adminReviewConfigured: (): Promise<boolean> =>
    ipcRenderer.invoke('admin-review-configured'),
  adminReviewQueue: (): Promise<unknown> =>
    ipcRenderer.invoke('admin-review-queue'),
  adminReviewStats: (): Promise<unknown> =>
    ipcRenderer.invoke('admin-review-stats'),
  adminReviewDetail: (groupId: string): Promise<unknown> =>
    ipcRenderer.invoke('admin-review-detail', groupId),
  adminReviewAction: (action: unknown): Promise<void> =>
    ipcRenderer.invoke('admin-review-action', action),
  adminRemoveCommunityItem: (type: string, id: string, reason?: string): Promise<void> =>
    ipcRenderer.invoke('admin-remove-community-item', type, id, reason),
});
