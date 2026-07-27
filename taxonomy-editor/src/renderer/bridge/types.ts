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

/** Result of resolving a fact's `doc_id` to an actual source document.
 *  PDFs resolve to a fetchable `path` (local file path in Electron, API URL in web);
 *  markdown resolves to inline `content`. */
export interface SourceDocumentResolution {
  available: boolean;
  type: 'pdf' | 'markdown' | null;
  content?: string;
  path?: string;
}

export interface GroundingCitation {
  uri: string;
  title: string;
  segments: GroundingSegment[];
}

export interface SupportCaseCreatePayload {
  subject: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  systemInfo: { appVersion: string; browser: string; os: string; deploymentMode: 'web' | 'electron' };
}

export interface SupportCaseSummary {
  id: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
  attachmentCount: number;
  responseCount: number;
}

export interface SupportCaseDetail extends SupportCaseSummary {
  description: string;
  resolvedAt?: string;
  userDisplayName?: string;
  attachments: { id: string; filename: string; mimeType: string; sizeBytes: number; uploadedAt: string }[];
  responses: { id: string; authorId: string; body: string; createdAt: string }[];
  systemInfo: SupportCaseCreatePayload['systemInfo'];
}

import type { Organization as _Organization, OrganizationEdge as _OrganizationEdge, OrganizationEdgeType as _OrganizationEdgeType, Pov as _Pov, PovAlignmentTier as _PovAlignmentTier, PovStance as _PovStance, TopicEngagement as _TopicEngagement, PolicyEngagement as _PolicyEngagement } from '@lib/organizations/types';
export type Organization = _Organization;
export type OrganizationEdge = _OrganizationEdge;
export type OrganizationEdgeType = _OrganizationEdgeType;
export type Pov = _Pov;
export type PovAlignmentTier = _PovAlignmentTier;
export type PovStance = _PovStance;
export type TopicEngagement = _TopicEngagement;
export type PolicyEngagement = _PolicyEngagement;
export type OrgPovStance = _PovStance;
export type OrgTopicEngagement = _TopicEngagement;
export type OrgPolicyEngagement = _PolicyEngagement;

import type { DebateTestedTier as _DebateTestedTier, DebateTestedRecord as _DebateTestedRecord, DebateTestedEntry as _DebateTestedEntry } from '@lib/debate/taxonomyTypes';
export type DebateTestedTier = _DebateTestedTier;
export type DebateTestedRecord = _DebateTestedRecord;
export type DebateTestedEntry = _DebateTestedEntry;

import type { DebateDelta as _DebateDelta } from '@lib/debate/types';
export type DebateDelta = _DebateDelta;

// Canonical ref-kind contract (t/1767 §5). Re-exported so renderer consumers
// (resolveRef / DetailPane, t/1775) have a single import site alongside `api`,
// without forking the shared union. Never redeclared here — pure re-export.
import type { EntityRef as _EntityRef, EntityDetail as _EntityDetail } from '@lib/entities/types';
export type EntityRef = _EntityRef;
export type EntityDetail = _EntityDetail;

export interface OrgFilters { type?: string; pov?: string }

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
  getEdgeDetail: (index: number) => Promise<unknown>;
  updateEdgeStatus: (index: number, status: string) => Promise<unknown>;
  swapEdgeDirection: (index: number) => Promise<unknown>;
  bulkUpdateEdges: (indices: number[], status: string) => Promise<unknown>;
  buildNodeSourceIndex: () => Promise<unknown>;
  buildPolicySourceIndex: () => Promise<unknown>;

  // --- Conflict CRUD ---
  loadConflictFiles: () => Promise<unknown[]>;
  loadConflictClusters: () => Promise<unknown | null>;
  loadAggregatedCruxes: () => Promise<unknown | null>;
  addCruxEvidence: (cruxId: string, entry: { url: string; note?: string; added_by: string }) => Promise<void>;
  removeCruxEvidence: (cruxId: string, entryIndex: number) => Promise<void>;
  saveConflictFile: (claimId: string, data: unknown) => Promise<void>;
  createConflictFile: (claimId: string, data: unknown) => Promise<void>;
  deleteConflictFile: (claimId: string) => Promise<void>;

  // --- Summaries & Sources ---
  discoverSources: () => Promise<unknown[]>;
  loadSummary: (docId: string) => Promise<unknown | null>;
  loadSnapshot: (sourceId: string) => Promise<{ content: string } | null>;
  resolveSourceDocument: (docId: string) => Promise<SourceDocumentResolution>;

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
  validateApiKey: (key: string, backend: string) => Promise<{ valid: boolean; error?: string }>;
  verifyStoredKeys: (backend: string) => Promise<{ results: { index: number; masked: string; valid: boolean; error?: string }[] }>;
  setApiKey: (key: string, backend?: string) => Promise<void>;
  addApiKey: (key: string, backend: string) => Promise<{ count: number }>;
  removeApiKey: (index: number, backend: string) => Promise<void>;
  getApiKeys: (backend: string) => Promise<{ index: number; masked: string }[]>;
  deleteApiKey: (backend?: string) => Promise<void>;
  deleteAllApiKeys: () => Promise<void>;
  hasApiKey: (backend?: string) => Promise<boolean>;
  /**
   * Which AI backends are actually usable (key present + reachable). Backed by the
   * server's GET /api/backends/available in authed web mode; derived from local key
   * presence in anonymous (BYOK) and Electron modes. Used to gate multi-provider
   * debates so speakers are only assigned to usable backends.
   */
  getAvailableBackends: () => Promise<{ id: string; available: boolean; models?: string[]; reason?: string }[]>;
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
  getProxyTier?: () => Promise<{ level: string; limits: { requestsPerMinute: number; tokensPerDay: number }; allowedBackends: string[]; principalName: string | null; serverProvidedKey?: boolean; pinnedModel?: string }>;
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
  getDebateQuotaStatus: () => Promise<{ allowed: boolean; resource: string; current: number; limit: number }>;
  listDebateSessions: () => Promise<unknown[]>;
  listDebateSessionsMeta: () => Promise<unknown[]>;
  loadDebateSession: (id: string) => Promise<unknown>;
  saveDebateSession: (session: unknown) => Promise<void>;
  /** Incremental save (web-only optimization; Electron delegates to a full save).
   *  Sends only the surfaces that changed since the last synced version. The server
   *  accepts the delta only if `delta.baseVersion` matches the stored `_saveVersion`
   *  and returns the new authoritative version. On a version mismatch the web bridge
   *  falls back to a full `saveDebateSession` PUT (see web-bridge.ts). */
  saveDebateDelta: (delta: DebateDelta) => Promise<{ newVersion: number }>;
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
  exportChatToFile: (
    entries: { id: string; timestamp: string; speaker: string; content: string; taxonomy_refs: { node_id: string; label?: string; relevance: string }[] }[],
    format: 'markdown' | 'text' | 'pdf',
    options: { title: string; mode: 'brainstorm' | 'inform' | 'decide'; pov: 'accelerationist' | 'safetyist' | 'skeptic' },
  ) => Promise<{ cancelled: boolean; filePath?: string }>;

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
  updateSyntheticEmbeddings: (nodeId: string, pov: string, vectors: number[][]) => Promise<void>;

  // --- Feedback & error reporting ---
  submitFeedback: (rating: 'up' | 'down', text?: string, category?: 'bug' | 'feature_request' | 'confusing' | 'general', context?: Record<string, unknown>) => Promise<{ ok: boolean; id?: string }>;
  reportError: (error: { name: string; message: string; stack?: string; componentStack?: string }, context?: Record<string, unknown>) => Promise<{ ok: boolean }>;

  // --- Telemetry ---
  trackEvent: (type: string, view?: string, metadata?: Record<string, unknown>) => void;

  // --- Community Library ---
  listCommunityChats: () => Promise<unknown[]>;
  listCommunityDebates: () => Promise<unknown[]>;
  submitToCommunity: (type: 'chat' | 'debate', itemData: unknown, note?: string) => Promise<{ submissionId: string }>;
  copyFromCommunity: (type: 'chats' | 'debates', communityId: string) => Promise<{ newId: string }>;
  loadCommunityDebateSession: (id: string) => Promise<unknown>;
  loadCommunityChatSession: (id: string) => Promise<unknown>;
  // Submit to a remote community server. In Electron this is proxied through the main
  // process (net.fetch) so it is not blocked by browser CORS; baseUrl is the server origin.
  communitySubmit: (baseUrl: string, payload: { type: 'chat' | 'debate'; data: unknown; note?: string }) => Promise<{ submissionId: string }>;

  // --- Support cases ---
  createSupportCase: (payload: SupportCaseCreatePayload) => Promise<{ id: string }>;
  listSupportCases: () => Promise<SupportCaseSummary[]>;
  getSupportCaseDetail: (caseId: string) => Promise<SupportCaseDetail>;
  uploadCaseAttachment: (caseId: string, file: File) => Promise<{ id: string; filename: string }>;
  downloadCaseAttachment: (caseId: string, attachmentId: string) => Promise<Blob>;
  listAdminSupportCases: () => Promise<SupportCaseSummary[]>;
  respondToSupportCase: (caseId: string, body: string) => Promise<{ id: string }>;
  updateSupportCaseStatus: (caseId: string, status: string) => Promise<void>;

  // --- Organizations ---
  listOrganizations: (filters?: OrgFilters) => Promise<Organization[]>;
  getOrganization: (id: string) => Promise<Organization>;
  getOrganizationsByPov: (pov: string) => Promise<Organization[]>;
  getOrganizationsByTopic: (topicRef: string) => Promise<Organization[]>;
  getOrganizationsByPolicy: (policyId: string) => Promise<Organization[]>;
  getOrganizationEdges: (orgId: string) => Promise<OrganizationEdge[]>;

  // --- Entity / ref resolution (t/1775) ---
  /**
   * Resolve a raw entity-ref token to its {@link EntityDetail} via the server
   * (`GET /api/entity/:ref`). Used by `resolveRef` for the SERVER-ONLY kinds
   * (`org-*`, `ent-*`, `term:*`); the client-side kinds (node/situation/policy)
   * resolve from the taxonomy store without a round-trip. Follows merge tombstones
   * server-side, stamping `redirected_from` on the result.
   */
  getEntity: (ref: string) => Promise<EntityDetail>;

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
  dumpFlightRecorder: (ndjson: string, dumpId?: string) => Promise<{ filePath: string; filename: string }>;
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
  onTaxonomyUpdated: (callback: (evt: { user: string; nodeCount: number; povs: string[] }) => void) => () => void;
  focusNodeInMainWindow: (nodeId: string) => void;
  onTerminalData: (callback: (data: string) => void) => () => void;
  onTerminalExit: (callback: () => void) => () => void;

  // --- Screenshot capture ---
  captureScreenshot: (opts?: { width?: number; height?: number; defaultName?: string }) => Promise<{ cancelled: boolean; filePath?: string }>;

  // --- Feature flags ---
  getFlags: () => Promise<Record<string, boolean>>;

  // --- Admin Error Dashboard ---
  getErrorSummary: () => Promise<{
    total: number; today: number; last7d: number; last30d: number;
    topErrors: Array<{ key: string; count: number; lastSeen: string; affectedUsers: number }>;
    byDay: Array<{ date: string; count: number }>;
  }>;
  listErrors: (opts?: { since?: string; until?: string; userId?: string; errorName?: string; limit?: number; offset?: number }) => Promise<{
    items: Array<{ id: string; name: string; message: string; timestamp: string; userId?: string; context?: Record<string, unknown> }>;
    total: number; hasMore: boolean;
  }>;
  getErrorDetail: (id: string) => Promise<{
    entry: { id: string; name: string; message: string; timestamp: string; userId?: string; context?: Record<string, unknown>; stack?: string };
    relatedDumps: Array<{ dumpId: string; kind: string; timestamp: string }>;
  } | null>;

  // --- UsageID registry ---
  getUsageRegistry: () => Promise<Record<string, { description: string; model: string; temperature?: number; maxTokens?: number; timeoutMs?: number; tags?: string[]; _extends?: string }>>;

  // --- Deep-link URL ---
  getWebAppUrl: () => Promise<string | null>;

  // --- Admin Review (Azure Blob in Electron, HTTP in web) ---
  adminReviewConfigured: () => Promise<boolean>;
  adminReviewQueue: () => Promise<{ items: { id: string; domain: string; submitter: string; submitterDisplay: string; submittedAt: string; summary: string; itemCount: number; status: string }[] }>;
  adminReviewStats: () => Promise<{ total: number; byDomain: Record<string, number> }>;
  adminReviewDetail: (groupId: string) => Promise<unknown>;
  adminReviewAction: (action: { domain: string; groupId: string; action: string; itemIds: string[]; reason?: string; edits?: Record<string, unknown> }) => Promise<void>;
  adminRemoveCommunityItem: (type: 'chats' | 'debates', id: string, reason?: string) => Promise<void>;
}
