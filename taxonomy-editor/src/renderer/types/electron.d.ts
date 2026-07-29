// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { Organization, OrganizationEdge } from '@lib/organizations/types';
import type { EntityDetail, EntitySummary, EntityListQuery } from '@lib/entities/types';
import type { ContainerMentions } from '@lib/entities/mentionTypes';
import type { EdgesFile } from '@lib/debate/taxonomyTypes';

export interface ElectronAPI {
  processVersions: Record<string, string | undefined>;
  osRelease: string;
  getEmbeddingInfo: () => Promise<{ backend: string; execution_provider?: string; calibration_version?: number }>;

  // Taxonomy directories
  getTaxonomyDirs: () => Promise<string[]>;
  getActiveTaxonomyDir: () => Promise<string>;
  setTaxonomyDir: (dirName: string) => Promise<void>;

  // Taxonomy CRUD
  loadTaxonomyFile: (pov: string) => Promise<unknown>;
  saveTaxonomyFile: (pov: string, data: unknown) => Promise<void>;
  // New-edge persistence (t/1816). Optional — wired by the save-edges IPC handler
  // (ElectronMain); until then undefined and the bridge degrades gracefully.
  saveEdges?: (data: EdgesFile) => Promise<void>;
  loadPolicyRegistry: () => Promise<unknown>;
  loadLineageCategories: () => Promise<unknown>;
  loadLineageInfo: () => Promise<Record<string, unknown>>;
  loadEdges: () => Promise<unknown>;
  getEdgeDetail: (index: number) => Promise<unknown>;
  updateEdgeStatus: (index: number, status: string) => Promise<unknown>;
  swapEdgeDirection: (index: number) => Promise<unknown>;
  bulkUpdateEdges: (indices: number[], status: string) => Promise<unknown>;
  buildNodeSourceIndex: () => Promise<unknown>;
  buildPolicySourceIndex: () => Promise<unknown>;

  // Conflict CRUD
  loadConflictFiles: () => Promise<unknown[]>;
  loadConflictClusters?: () => Promise<unknown | null>;
  loadAggregatedCruxes?: () => Promise<unknown | null>;
  saveConflictFile: (claimId: string, data: unknown) => Promise<void>;
  createConflictFile: (claimId: string, data: unknown) => Promise<void>;
  deleteConflictFile: (claimId: string) => Promise<void>;

  // Summaries & Sources
  discoverSources: () => Promise<unknown[]>;
  loadSummary: (docId: string) => Promise<unknown | null>;
  loadSnapshot: (sourceId: string) => Promise<{ content: string } | null>;
  resolveSourceDocument: (docId: string) => Promise<{ available: boolean; type: 'pdf' | 'markdown' | null; content?: string; path?: string }>;
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

  // Data management
  isDataAvailable: () => Promise<boolean>;
  getDataRoot: () => Promise<string>;
  cloneDataRepo: (targetPath: string) => Promise<{ success: boolean; message: string }>;
  setDataRoot: (newRoot: string) => Promise<void>;
  pickDirectory: (defaultPath?: string) => Promise<{ cancelled: boolean; path?: string }>;
  checkDataUpdates: () => Promise<unknown>;
  pullDataUpdates: () => Promise<unknown>;
  getChangedFiles: () => Promise<{ path: string; status: string }[]>;
  getFileDiff: (filePath: string) => Promise<string>;

  // AI models & keys
  loadAIModels: () => Promise<unknown>;
  refreshAIModels: () => Promise<unknown>;
  validateApiKey?: (key: string, backend: string) => Promise<{ valid: boolean; error?: string }>;
  verifyStoredKeys?: (backend: string) => Promise<{ results: { index: number; masked: string; valid: boolean; error?: string }[] }>;
  setApiKey: (key: string, backend?: string) => Promise<void>;
  hasApiKey: (backend?: string) => Promise<boolean>;
  addApiKey: (key: string, backend?: string) => Promise<number>;
  removeApiKey: (index: number, backend?: string) => Promise<void>;
  getApiKeys: (backend?: string) => Promise<string[]>;
  deleteApiKey: (backend?: string) => Promise<void>;
  deleteAllApiKeys: () => Promise<void>;
  getApiKeySummary: () => Promise<{ backend: string; hasKey: boolean; maskedKey: string | null }[]>;
  exportKeysForSharing: (passphrase: string) => Promise<{ dataUrl: string; payloadText: string }>;
  importKeysFromSharing: (payload: { v: number; salt: string; iv: string; data: string; tag: string }, passphrase: string) => Promise<string[]>;

  // AI generation
  generateText: (prompt: string, model?: string, timeoutMs?: number, temperature?: number) => Promise<{ text: string }>;
  generateTextWithSearch: (prompt: string, model?: string) => Promise<{
    text: string;
    searchQueries?: string[];
    citations?: { uri: string; title: string; segments: { startIndex: number; endIndex: number; text?: string; confidence?: number }[] }[];
  }>;
  startChatStream: (systemInstruction: string, messages: { role: 'user' | 'model'; content: string }[], model?: string, temperature?: number) => Promise<string>;
  onChatStreamChunk: (callback: (chunk: string) => void) => () => void;
  onChatStreamDone: (callback: (fullText: string) => void) => () => void;
  onChatStreamError: (callback: (error: string) => void) => () => void;
  setDebateTemperature: (temp: number | null) => Promise<void>;
  onGenerateTextProgress: (callback: (progress: { attempt: number; maxRetries: number; backoffSeconds: number; limitType: string; limitMessage: string }) => void) => () => void;

  // Embeddings & NLI
  computeEmbeddings: (texts: string[], ids?: string[]) => Promise<{ vectors: number[][] }>;
  updateNodeEmbeddings: (nodes: { id: string; text: string; pov: string; exclusionText?: string }[]) => Promise<void>;
  computeQueryEmbedding: (text: string) => Promise<{ vector: number[] }>;
  nliClassify: (pairs: Array<{ text_a: string; text_b: string }>) => Promise<{ results: Array<{ nli_label: string; nli_entailment: number; nli_neutral: number; nli_contradiction: number; margin: number }> }>;

  // Debate sessions
  listDebateSessions: () => Promise<unknown[]>;
  loadDebateSession: (id: string) => Promise<unknown>;
  saveDebateSession: (session: unknown) => Promise<void>;
  deleteDebateSession: (id: string) => Promise<void>;
  exportDebateToFile: (session: unknown, format?: string, exportOptions?: { includeTaxonomyRefs?: boolean; includeReasoning?: boolean }) => Promise<{ cancelled: boolean; filePath?: string }>;
  loadDebateComments: (debateId: string) => Promise<unknown>;
  saveDebateComments: (debateId: string, data: unknown) => Promise<void>;
  generateNewsReport: (debateId: string) => Promise<{ article: string }>;

  // Chat sessions
  listChatSessions: () => Promise<unknown[]>;
  loadChatSession: (id: string) => Promise<unknown>;
  saveChatSession: (session: unknown) => Promise<void>;
  deleteChatSession: (id: string) => Promise<void>;
  exportChatToFile: (
    entries: unknown[],
    format: string,
    options: { title: string; mode: string; pov: string },
  ) => Promise<{ cancelled: boolean; filePath?: string }>;

  // Harvest
  harvestCreateConflict: (conflict: Record<string, unknown>) => Promise<{ created: boolean }>;
  harvestAddDebateRef: (nodeId: string, debateId: string) => Promise<{ updated: boolean }>;
  harvestUpdateSteelman: (nodeId: string, attackerPov: string, newText: string) => Promise<{ updated: boolean }>;
  harvestAddVerdict: (conflictId: string, verdict: Record<string, unknown>) => Promise<{ updated: boolean }>;
  harvestQueueConcept: (concept: Record<string, unknown>) => Promise<{ queued: boolean }>;
  harvestSaveManifest: (manifest: Record<string, unknown>) => Promise<{ saved: boolean }>;

  // Dictionary
  loadDictionary: () => Promise<{ standardized: unknown[]; colloquial: unknown[]; lintViolations: unknown[] }>;

  // Proposals
  listProposals: () => Promise<unknown[]>;
  saveProposal: (filename: string, data: unknown) => Promise<{ saved?: boolean; error?: string }>;

  // PowerShell prompts
  readPsPrompt: (promptName: string) => Promise<{ text: string | null; error?: string }>;
  listPsPrompts: () => Promise<string[]>;

  // Research file access
  readResearchFile: (relativePath: string) => Promise<unknown>;
  writeResearchFile: (relativePath: string, data: unknown) => Promise<void>;

  // Synthetic corpus
  loadSyntheticCorpus: (pov: string) => Promise<unknown | null>;
  loadSyntheticEmbeddings: () => Promise<Record<string, { pov: string; vectors: number[][] }> | null>;
  updateSyntheticEmbeddings: (nodeId: string, pov: string, vectors: number[][]) => Promise<void>;

  // Feedback & error reporting
  submitFeedback: (rating: string, text?: string, category?: string, context?: Record<string, unknown>) => Promise<{ ok: boolean; id?: string }>;
  reportError: (error: { name: string; message: string; stack?: string; componentStack?: string }, context?: Record<string, unknown>) => Promise<{ ok: boolean }>;

  // Calibration
  getCalibrationHistory: () => Promise<{ current: unknown; history: unknown[] }>;
  getCalibrationLog: () => Promise<{ entries: unknown[]; validationReport: unknown }>;

  // Diagnostics
  openDiagnosticsWindow: () => Promise<void>;
  openPovProgressionWindow: () => Promise<void>;
  closeDiagnosticsWindow: () => Promise<void>;
  sendDiagnosticsState: (state: unknown) => void;
  onDiagnosticsStateUpdate: (callback: (state: unknown) => void) => () => void;
  onDiagnosticsPopoutClosed: (callback: () => void) => () => void;

  // Debate popout
  openDebateWindow: (debateId: string) => Promise<void>;
  closeDebateWindow: () => Promise<void>;
  getCliFileArg: () => Promise<{ type: string; path: string; data?: unknown; error?: string } | null>;
  onDebateWindowLoad: (callback: (debateId: string) => void) => () => void;
  onDebatePopoutClosed: (callback: () => void) => () => void;
  requestReExtractClaims: (entryId: string) => void;
  onReExtractClaims: (callback: (entryId: string) => void) => () => void;

  // Data file diff popout
  openDiffWindow: (filePath: string) => Promise<void>;

  // Prompt Diff popout
  openPromptDiffWindow: (debateId: string, entryId: string) => Promise<void>;

  // Chat popout
  openChatWindow: () => Promise<void>;
  onChatPopoutClosed: (callback: () => void) => () => void;

  // Flight recorder
  dumpFlightRecorder: (ndjson: string, dumpId?: string) => Promise<{ filePath: string; filename: string }>;
  openFile: (filePath: string) => Promise<void>;
  openFlightRecorderViewer: (dumpPath: string) => Promise<void>;
  forwardFlightEvent?: (event: unknown) => void;
  triggerMainDump?: () => Promise<{ filePath: string }>;
  onTriggerDump?: (callback: () => void) => () => void;
  sendDumpResult?: (result: { filePath: string }) => void;

  // Terminal
  terminalSpawn: () => Promise<void>;
  terminalWrite: (data: string) => Promise<void>;
  terminalResize: (cols: number, rows: number) => Promise<void>;
  terminalKill: () => Promise<void>;
  onTerminalData: (callback: (data: string) => void) => () => void;
  onTerminalExit: (callback: () => void) => () => void;

  // File operations
  fetchUrlContent: (url: string) => Promise<{ content: string; error?: string }>;
  pickDocumentFile: () => Promise<{ cancelled: boolean; filePath?: string; content?: string }>;
  clipboardWriteText: (text: string) => Promise<void>;

  // Window control
  growWindow: (deltaWidth: number) => Promise<void>;
  shrinkWindow: (deltaWidth: number) => Promise<void>;
  isMaximized: () => Promise<boolean>;
  openExternal: (url: string) => Promise<void>;

  // Event listeners
  onReloadTaxonomy: (callback: () => void) => () => void;
  onFocusNode: (callback: (nodeId: string) => void) => () => void;
  focusNodeInMainWindow: (nodeId: string) => void;
  captureScreenshot: (opts?: { width?: number; height?: number; defaultName?: string }) => Promise<{ cancelled: boolean; filePath?: string }>;

  // Community
  communitySubmit: (baseUrl: string, payload: { type: 'chat' | 'debate'; data: unknown; note?: string }) => Promise<{ submissionId: string }>;

  // Admin Review
  adminReviewConfigured: () => Promise<boolean>;
  adminReviewQueue: () => Promise<unknown>;
  adminReviewStats: () => Promise<unknown>;
  adminReviewDetail: (groupId: string) => Promise<unknown>;
  adminReviewAction: (action: unknown) => Promise<void>;
  adminRemoveCommunityItem: (type: string, id: string, reason?: string) => Promise<void>;

  // Organizations
  listOrganizations?: (filters?: { type?: string; pov?: string }) => Promise<Organization[]>;
  getOrganization?: (id: string) => Promise<Organization>;
  getOrganizationsByPov?: (pov: string) => Promise<Organization[]>;
  getOrganizationsByTopic?: (topicRef: string) => Promise<Organization[]>;
  getOrganizationsByPolicy?: (policyId: string) => Promise<Organization[]>;
  getOrganizationEdges?: (orgId: string) => Promise<OrganizationEdge[]>;

  // Entity / ref resolution (t/1775). Optional — wired by the entity-resolve IPC
  // handler in t/1809 (ElectronMain). Until then window.electronAPI.getEntity is
  // undefined and the bridge degrades gracefully.
  getEntity?: (ref: string) => Promise<EntityDetail>;

  // Entity list/browser (t/1883). Optional — wired by the list-entities IPC handler
  // (ElectronMain, later). Until then undefined and the bridge degrades to [].
  listEntities?: (query?: EntityListQuery) => Promise<EntitySummary[]>;

  // Container mentions (t/1901). Optional — wired by the container-mentions IPC handler
  // (ElectronMain, t/1903). Until then undefined and the bridge fails loud.
  getContainerMentions?: (id: string) => Promise<ContainerMentions | null>;

  // Deep-link URL
  getWebAppUrl?: () => Promise<string | null>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
