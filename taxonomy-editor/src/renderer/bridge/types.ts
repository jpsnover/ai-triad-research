// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * AppAPI — the bridge interface between the renderer and the backend.
 *
 * In Electron builds, this is implemented by delegating to window.electronAPI (IPC).
 * In web/container builds, this is implemented via REST + WebSocket calls to the server.
 *
 * Every renderer file should import `api` from '@bridge' instead of accessing
 * window.electronAPI directly.
 */

export interface GroundingSegment {
  startIndex: number;
  endIndex: number;
  text?: string;
  confidence?: number;
}

export interface GroundingCitation {
  uri: string;
  title: string;
  segments: GroundingSegment[];
}

export interface AppAPI {
  // --- Taxonomy directories ---
  getTaxonomyDirs: () => Promise<string[]>;
  getActiveTaxonomyDir: () => Promise<string>;
  setTaxonomyDir: (dirName: string) => Promise<void>;

  // --- Taxonomy CRUD ---
  loadTaxonomyFile: (pov: string) => Promise<unknown>;
  saveTaxonomyFile: (pov: string, data: unknown) => Promise<void>;
  loadPolicyRegistry: () => Promise<unknown>;
  loadLineageCategories: () => Promise<unknown>;
  loadLineageInfo: () => Promise<Record<string, unknown>>;
  loadEdges: () => Promise<unknown>;
  updateEdgeStatus: (index: number, status: string) => Promise<unknown>;
  swapEdgeDirection: (index: number) => Promise<unknown>;
  bulkUpdateEdges: (indices: number[], status: string) => Promise<unknown>;
  buildNodeSourceIndex: () => Promise<unknown>;
  buildPolicySourceIndex: () => Promise<unknown>;

  // --- Conflict CRUD ---
  loadConflictFiles: () => Promise<unknown[]>;
  loadConflictClusters: () => Promise<unknown | null>;
  loadAggregatedCruxes: () => Promise<unknown | null>;
  saveConflictFile: (claimId: string, data: unknown) => Promise<void>;
  createConflictFile: (claimId: string, data: unknown) => Promise<void>;
  deleteConflictFile: (claimId: string) => Promise<void>;

  // --- Summaries & Sources ---
  discoverSources: () => Promise<unknown[]>;
  loadSummary: (docId: string) => Promise<unknown | null>;
  loadSnapshot: (sourceId: string) => Promise<{ content: string } | null>;

  // --- Data management ---
  isDataAvailable: () => Promise<boolean>;
  getDataRoot: () => Promise<string>;
  getCopyStatus: () => Promise<{ state: string; dir?: string; copied?: number; total?: number }>;
  cloneDataRepo: (targetPath: string) => Promise<{ success: boolean; message: string }>;
  setDataRoot: (newRoot: string) => Promise<void>;
  pickDirectory: (defaultPath?: string) => Promise<{ cancelled: boolean; path?: string }>;
  checkDataUpdates: () => Promise<unknown>;
  pullDataUpdates: () => Promise<unknown>;
  getChangedFiles: () => Promise<{ path: string; status: string }[]>;
  getFileDiff: (filePath: string) => Promise<string>;

  // --- AI models & keys ---
  loadAIModels: () => Promise<unknown>;
  refreshAIModels: () => Promise<unknown>;
  setApiKey: (key: string, backend?: string) => Promise<void>;
  hasApiKey: (backend?: string) => Promise<boolean>;
  getApiKeySummary: () => Promise<{ backend: string; hasKey: boolean; maskedKey: string | null }[]>;
  exportKeysForSharing: (passphrase: string) => Promise<{ dataUrl: string; payloadText: string }>;
  importKeysFromSharing: (payload: { v: number; salt: string; iv: string; data: string; tag: string }, passphrase: string) => Promise<string[]>;

  // --- AI generation ---
  generateText: (prompt: string, model?: string, timeoutMs?: number, temperature?: number) => Promise<{ text: string; tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number } }>;
  generateTextWithSearch: (prompt: string, model?: string) => Promise<{
    text: string;
    searchQueries?: string[];
    citations?: GroundingCitation[];
  }>;
  startChatStream: (systemInstruction: string, messages: { role: 'user' | 'model'; content: string }[], model?: string, temperature?: number) => Promise<string>;
  onChatStreamChunk: (callback: (chunk: string) => void) => () => void;
  onChatStreamDone: (callback: (fullText: string) => void) => () => void;
  onChatStreamError: (callback: (error: string) => void) => () => void;
  setDebateTemperature: (temp: number | null) => Promise<void>;

  // --- Proxy tier & usage ---
  getProxyTier?: () => Promise<{ level: string; limits: { requestsPerMinute: number; tokensPerDay: number }; allowedBackends: string[]; principalName: string | null }>;
  getProxyUsage?: () => Promise<{ tier: string; limits: { requestsPerMinute: number; tokensPerDay: number }; usage: { requestsInWindow: number; tokensToday: number } }>;

  // --- Embeddings & NLI ---
  computeEmbeddings: (texts: string[], ids?: string[]) => Promise<{ vectors: number[][] }>;
  updateNodeEmbeddings: (nodes: { id: string; text: string; pov: string; exclusionText?: string }[]) => Promise<void>;
  computeQueryEmbedding: (text: string) => Promise<{ vector: number[] }>;
  nliClassify: (pairs: Array<{ text_a: string; text_b: string }>) => Promise<{
    results: Array<{
      nli_label: string;
      nli_entailment: number;
      nli_neutral: number;
      nli_contradiction: number;
      margin: number;
    }>;
  }>;

  // --- Source evidence ---
  loadSourceEvidenceIndex: () => Promise<Record<string, unknown> | null>;
  loadDocTitles: () => Promise<Record<string, string> | null>;
  getSourceEvidence: (nodeIds: string[], pov: string) => Promise<{
    facts: unknown[]; keyPoints: unknown[]; formattedBlock: string;
    nodesCovered: string[]; totalCandidates: number;
  }>;
  runEvidenceQbaf: (claimText: string, claimId: string, model?: string) => Promise<{
    computed_strength: number;
    qbaf_iterations: number;
    evidence_items: Array<{ id: string; source_doc_id: string; text: string; relation: 'support' | 'contradict'; similarity: number }>;
    claim_id: string;
  } | null>;

  // --- Debate sessions ---
  listDebateSessions: () => Promise<unknown[]>;
  listDebateSessionsMeta: () => Promise<unknown[]>;
  loadDebateSession: (id: string) => Promise<unknown>;
  saveDebateSession: (session: unknown) => Promise<void>;
  deleteDebateSession: (id: string) => Promise<void>;
  exportDebateToFile: (session: unknown, format?: 'json' | 'markdown' | 'text' | 'pdf' | 'package', exportOptions?: { includeTaxonomyRefs?: boolean; includeReasoning?: boolean }) => Promise<{ cancelled: boolean; filePath?: string }>;
  loadDebateComments: (debateId: string) => Promise<unknown>;
  saveDebateComments: (debateId: string, data: unknown) => Promise<void>;

  // --- News Report ---
  generateNewsReport: (debateId: string) => Promise<{ article: string }>;

  // --- Chat sessions ---
  listChatSessions: () => Promise<unknown[]>;
  loadChatSession: (id: string) => Promise<unknown>;
  saveChatSession: (session: unknown) => Promise<void>;
  deleteChatSession: (id: string) => Promise<void>;

  // --- Harvest ---
  harvestCreateConflict: (conflict: Record<string, unknown>) => Promise<{ created: boolean }>;
  harvestAddDebateRef: (nodeId: string, debateId: string) => Promise<{ updated: boolean }>;
  harvestUpdateSteelman: (nodeId: string, attackerPov: string, newText: string) => Promise<{ updated: boolean }>;
  harvestAddVerdict: (conflictId: string, verdict: Record<string, unknown>) => Promise<{ updated: boolean }>;
  harvestQueueConcept: (concept: Record<string, unknown>) => Promise<{ queued: boolean }>;
  harvestSaveManifest: (manifest: Record<string, unknown>) => Promise<{ saved: boolean }>;

  // --- Dictionary ---
  loadDictionary: () => Promise<{ standardized: unknown[]; colloquial: unknown[]; lintViolations: unknown[] }>;

  // --- Proposals ---
  listProposals: () => Promise<unknown[]>;
  saveProposal: (filename: string, data: unknown) => Promise<{ saved?: boolean; error?: string }>;

  // --- PowerShell prompts ---
  readPsPrompt: (promptName: string) => Promise<{ text: string | null; error?: string }>;
  listPsPrompts: () => Promise<string[]>;

  // --- Research file access ---
  readResearchFile: (relativePath: string) => Promise<unknown>;
  writeResearchFile: (relativePath: string, data: unknown) => Promise<void>;

  // --- Synthetic corpus ---
  loadSyntheticCorpus: (pov: string) => Promise<unknown | null>;
  loadSyntheticEmbeddings: () => Promise<Record<string, { pov: string; vectors: number[][] }> | null>;

  // --- Feedback & error reporting ---
  submitFeedback: (rating: 'up' | 'down', text?: string) => Promise<{ ok: boolean; id?: string }>;
  reportError: (error: { name: string; message: string; stack?: string; componentStack?: string }, context?: Record<string, unknown>) => Promise<{ ok: boolean }>;

  // --- Telemetry ---
  trackEvent: (type: string, view?: string, metadata?: Record<string, unknown>) => void;

  // --- Calibration ---
  getCalibrationHistory: () => Promise<{ current: unknown; history: unknown[] }>;
  getCalibrationLog: () => Promise<{ entries: unknown[]; validationReport: unknown }>;

  // --- Diagnostics ---
  openDiagnosticsWindow: () => Promise<void>;
  openPovProgressionWindow: () => Promise<void>;
  closeDiagnosticsWindow: () => Promise<void>;
  sendDiagnosticsState: (state: unknown) => void;

  // --- Data file diff popout ---
  openDiffWindow: (filePath: string) => Promise<void>;

  // --- Prompt Diff popout ---
  openPromptDiffWindow: (debateId: string, entryId: string) => Promise<void>;

  // --- Debate popout ---
  openDebateWindow: (debateId: string) => Promise<void>;
  closeDebateWindow: () => Promise<void>;
  getCliFileArg: () => Promise<{ type: string; path: string; data?: unknown; error?: string } | null>;

  // --- Terminal ---
  terminalSpawn: () => Promise<void>;
  terminalWrite: (data: string) => Promise<void>;
  terminalResize: (cols: number, rows: number) => Promise<void>;
  terminalKill: () => Promise<void>;

  // --- File operations ---
  fetchUrlContent: (url: string) => Promise<{ content: string; error?: string }>;
  pickDocumentFile: () => Promise<{ cancelled: boolean; filePath?: string; content?: string }>;
  clipboardWriteText: (text: string) => Promise<void>;

  // --- Window control ---
  growWindow: (deltaWidth: number) => Promise<void>;
  shrinkWindow: (deltaWidth: number) => Promise<void>;
  isMaximized: () => Promise<boolean>;
  openExternal: (url: string) => Promise<void>;

  // --- Sync ---
  /** Flush overlay writes to GitHub via Trees API batch commit. No-op in filesystem/Electron mode. */
  syncCommit: (message?: string) => Promise<{ ok: boolean; commitSha: string | null; filesCommitted: number }>;

  // --- Flight recorder ---
  dumpFlightRecorder: (ndjson: string) => Promise<{ filePath: string; filename: string }>;
  openFile: (filePath: string) => Promise<void>;
  openFlightRecorderViewer: (dumpPath: string) => Promise<void>;

  // --- Event listeners (return unsubscribe function) ---
  onDiagnosticsStateUpdate: (callback: (state: unknown) => void) => () => void;
  onDiagnosticsPopoutClosed: (callback: () => void) => () => void;
  openChatWindow: () => Promise<void>;
  onChatPopoutClosed: (callback: () => void) => () => void;
  requestReExtractClaims: (entryId: string) => void;
  onReExtractClaims: (callback: (entryId: string) => void) => () => void;
  onDebateWindowLoad: (callback: (debateId: string) => void) => () => void;
  onDebatePopoutClosed: (callback: () => void) => () => void;
  onGenerateTextProgress: (callback: (progress: {
    attempt: number;
    maxRetries: number;
    backoffSeconds: number;
    limitType: string;
    limitMessage: string;
  }) => void) => () => void;
  onReloadTaxonomy: (callback: () => void) => () => void;
  onFocusNode: (callback: (nodeId: string) => void) => () => void;
  focusNodeInMainWindow: (nodeId: string) => void;
  onTerminalData: (callback: (data: string) => void) => () => void;
  onTerminalExit: (callback: () => void) => () => void;
}
