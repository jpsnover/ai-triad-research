// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Web bridge — implements AppAPI via REST and WebSocket calls to the server.
 * Used when the app runs in a browser served by the container.
 */
import type { AppAPI } from './types';
import { instrumentBridge } from './instrumentBridge';
import { ActionableError } from '@lib/debate/errors';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { encryptKeysForSharing, decryptKeysFromSharing } from '../utils/keyShareCrypto';

// ── Auth state cache ──

let _authAnonymous: boolean | null = null;

async function isAnonymous(): Promise<boolean> {
  if (_authAnonymous !== null) return _authAnonymous;
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      _authAnonymous = !!data.anonymous;
    } else {
      _authAnonymous = true;
    }
  } catch { /* telemetry — silent by design */
    _authAnonymous = true;
  }
  return _authAnonymous;
}

// ── HTTP helpers ──

async function get<T = unknown>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    const text = await res.text();
    throw new ActionableError({
      goal: 'Fetch data from server',
      problem: `GET ${path} failed with HTTP ${res.status}: ${text}`,
      location: 'web-bridge.get',
      nextSteps: ['Check the server is running', 'Verify your authentication'],
    });
  }
  return res.json();
}

async function post<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 429) {
    const data = await res.json().catch(() => ({})) as Record<string, unknown>; /* telemetry — silent by design: extracting error payload from already-throwing path */
    const msg = data.limitType === 'tokens_per_day'
      ? 'Daily token limit exceeded. Try again tomorrow or use your own API key.'
      : `Rate limit exceeded. Retry in ${Math.ceil((data.retryAfterMs as number || 60000) / 1000)}s.`;
    throw new ActionableError({
      goal: 'Call AI backend',
      problem: msg,
      location: 'web-bridge.post',
      nextSteps: ['Wait for the rate limit to reset', 'Use your own API key to avoid shared limits'],
    });
  }
  if (!res.ok) {
    const text = await res.text();
    throw new ActionableError({
      goal: 'Send data to server',
      problem: `POST ${path} failed with HTTP ${res.status}: ${text}`,
      location: 'web-bridge.post',
      nextSteps: ['Check the server is running', 'Verify your authentication'],
    });
  }
  return res.json();
}

async function put<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ActionableError({
      goal: 'Update data on server',
      problem: `PUT ${path} failed with HTTP ${res.status}: ${text}`,
      location: 'web-bridge.put',
      nextSteps: ['Check the server is running', 'Verify your authentication'],
    });
  }
  return res.json();
}

async function del<T = unknown>(path: string): Promise<T> {
  const res = await fetch(path, { method: 'DELETE' });
  if (!res.ok) {
    const text = await res.text();
    throw new ActionableError({
      goal: 'Delete data on server',
      problem: `DELETE ${path} failed with HTTP ${res.status}: ${text}`,
      location: 'web-bridge.del',
      nextSteps: ['Check the server is running', 'Verify your authentication'],
    });
  }
  return res.json();
}

// ── WebSocket event bus ──

type EventCallback = (data: unknown) => void;
const eventListeners = new Map<string, Set<EventCallback>>();
let eventWs: WebSocket | null = null;

function ensureEventSocket(): void {
  if (eventWs && eventWs.readyState === WebSocket.OPEN) return;

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  eventWs = new WebSocket(`${protocol}//${location.host}/ws/events`);

  eventWs.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data) as { type: string; data: unknown };
      const listeners = eventListeners.get(msg.type);
      if (listeners) {
        for (const cb of listeners) cb(msg.data);
      }
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'web-bridge',
        level: 'debug',
        message: 'Failed to parse WebSocket event message',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
    }
  };

  eventWs.onclose = () => {
    // Reconnect after delay
    setTimeout(ensureEventSocket, 2000);
  };
}

function addEventListener(type: string, callback: EventCallback): () => void {
  ensureEventSocket();
  if (!eventListeners.has(type)) eventListeners.set(type, new Set());
  eventListeners.get(type)!.add(callback);
  return () => { eventListeners.get(type)?.delete(callback); };
}

// ── Terminal WebSocket ──

let terminalWs: WebSocket | null = null;
const terminalDataCallbacks = new Set<(data: string) => void>();
const terminalExitCallbacks = new Set<() => void>();

function ensureTerminalSocket(): WebSocket {
  if (terminalWs && terminalWs.readyState === WebSocket.OPEN) return terminalWs;

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  terminalWs = new WebSocket(`${protocol}//${location.host}/ws/terminal`);

  terminalWs.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data) as { type: string; data?: string };
      if (msg.type === 'data' && msg.data) {
        for (const cb of terminalDataCallbacks) cb(msg.data);
      } else if (msg.type === 'exit') {
        for (const cb of terminalExitCallbacks) cb();
      }
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'web-bridge',
        level: 'debug',
        message: 'Failed to parse WebSocket terminal message',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
    }
  };

  terminalWs.onclose = () => {
    terminalWs = null;
    for (const cb of terminalExitCallbacks) cb();
  };

  return terminalWs;
}

// ── Diagnostics state (cross-tab via BroadcastChannel) ──

const diagChannel = typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('aitriad-diagnostics')
  : null;

const diagCallbacks = new Set<(state: unknown) => void>();
const diagClosedCallbacks = new Set<() => void>();
const reExtractCallbacks = new Set<(entryId: string) => void>();

// Receive diagnostics state from the main tab (or from this tab if inline)
diagChannel?.addEventListener('message', (event) => {
  const msg = event.data as { type: string; payload?: unknown; entryId?: string };
  if (msg.type === 'diagnostics-state' && msg.payload) {
    for (const cb of diagCallbacks) cb(msg.payload);
  } else if (msg.type === 'diagnostics-closed') {
    for (const cb of diagClosedCallbacks) cb();
  } else if (msg.type === 're-extract-claims' && msg.entryId) {
    for (const cb of reExtractCallbacks) cb(msg.entryId);
  }
});

// ── The bridge ──

const rawApi: AppAPI = {
  // Taxonomy directories
  getTaxonomyDirs: () => get('/api/taxonomy-dirs'),
  getActiveTaxonomyDir: () => get('/api/taxonomy-dir/active'),
  setTaxonomyDir: (dirName) => put('/api/taxonomy-dir/active', { dirName }).then(() => {}),

  // Taxonomy CRUD
  loadTaxonomyFile: (pov) => get(`/api/taxonomy/${encodeURIComponent(pov)}`),
  saveTaxonomyFile: (pov, data) => put(`/api/taxonomy/${encodeURIComponent(pov)}`, data).then(() => {}),
  loadPolicyRegistry: () => get('/api/policy-registry'),
  loadLineageCategories: () => get('/api/lineage-categories'),
  loadLineageInfo: () => get<Record<string, unknown>>('/api/lineage-info'),
  loadEdges: () => get('/api/edges'),
  updateEdgeStatus: (index, status) => put('/api/edges/status', { index, status }),
  swapEdgeDirection: (index) => put('/api/edges/swap', { index }),
  bulkUpdateEdges: (indices, status) => put('/api/edges/bulk-status', { indices, status }),
  buildNodeSourceIndex: () => get('/api/node-source-index'),
  buildPolicySourceIndex: () => get('/api/policy-source-index'),

  // Conflict CRUD
  loadConflictFiles: () => get('/api/conflicts'),
  loadConflictClusters: () => get('/api/conflicts/clusters'),
  loadAggregatedCruxes: () => get('/api/cruxes'),
  saveConflictFile: (id, data) => put(`/api/conflicts/${encodeURIComponent(id)}`, data).then(() => {}),
  createConflictFile: (id, data) => post(`/api/conflicts/${encodeURIComponent(id)}`, data).then(() => {}),
  deleteConflictFile: (id) => del(`/api/conflicts/${encodeURIComponent(id)}`).then(() => {}),

  // Summaries & Sources
  discoverSources: () => get('/api/sources'),
  loadSummary: (docId) => get(`/api/summaries/${encodeURIComponent(docId)}`).catch(() => null),
  loadSnapshot: (sourceId) => get(`/api/snapshots/${encodeURIComponent(sourceId)}`).then(r => r as { content: string } | null).catch(() => null),

  // Data management
  isDataAvailable: () => get('/api/data/available'),
  getDataRoot: () => get('/api/data/root'),
  getCopyStatus: () => get<{ state: string; dir?: string; copied?: number; total?: number }>('/status').catch(() => ({ state: 'unknown' })),
  cloneDataRepo: (targetPath) => post('/api/data/clone', { targetPath }),
  setDataRoot: (newRoot) => post('/api/data/set-root', { newRoot }),
  pickDirectory: () => Promise.resolve({ cancelled: true }),
  checkDataUpdates: () => post('/api/data/check-updates'),
  pullDataUpdates: async () => {
    // This endpoint streams heartbeats + progress lines to prevent proxy timeouts.
    // The final non-empty line is the JSON result.
    const res = await fetch('/api/data/pull', { method: 'POST' });
    const text = await res.text();
    const lines = text.split('\n').filter(l => l.trim() && !l.startsWith('progress:'));
    if (lines.length === 0) {
      throw new ActionableError({
        goal: 'Pull data updates',
        problem: 'Server returned no result',
        location: 'web-bridge.pullDataUpdates',
        nextSteps: ['Check the server logs', 'Try again'],
      });
    }
    return JSON.parse(lines[lines.length - 1]);
  },

  getChangedFiles: () => post<{ path: string; status: string }[]>('/api/data/changed-files').catch(() => []),
  getFileDiff: (filePath) => post<string>('/api/data/file-diff', { filePath }).catch(() => ''),

  // AI models & keys
  loadAIModels: () => get('/api/models'),
  refreshAIModels: () => post('/api/models/refresh'),
  setApiKey: async (key, backend) => {
    const storageKey = backend ? `byok-${backend}` : 'byok-api-key';
    sessionStorage.setItem(storageKey, key);
    if (!(await isAnonymous())) {
      await post('/api/keys', { key, backend });
    }
  },
  hasApiKey: async (backend) => {
    if (await isAnonymous()) {
      const storageKey = backend ? `byok-${backend}` : 'byok-api-key';
      return !!sessionStorage.getItem(storageKey);
    }
    return get(`/api/keys/has${backend ? `?backend=${backend}` : ''}`);
  },
  getApiKeySummary: async () => {
    const ALL_BACKENDS = ['gemini', 'claude', 'groq', 'openai', 'deepseek', 'tavily', 'ollama'] as const;
    return ALL_BACKENDS.map((b) => {
      const stored = sessionStorage.getItem(`byok-${b}`);
      return {
        backend: b,
        hasKey: !!stored,
        maskedKey: stored ? stored.slice(0, 4) + '...' + stored.slice(-4) : null,
      };
    });
  },
  exportKeysForSharing: async (passphrase) => {
    const ALL_BACKENDS = ['gemini', 'claude', 'groq', 'openai', 'deepseek', 'tavily', 'ollama'] as const;
    const keys: Record<string, string> = {};
    for (const b of ALL_BACKENDS) {
      const stored = sessionStorage.getItem(`byok-${b}`);
      if (stored) keys[b] = stored;
    }
    const byok = sessionStorage.getItem('byok-api-key');
    if (byok && Object.keys(keys).length === 0) keys['default'] = byok;
    if (Object.keys(keys).length === 0) throw new Error('No API keys to export — save at least one key first');
    const encrypted = await encryptKeysForSharing(keys, passphrase);
    const payloadStr = JSON.stringify(encrypted);
    const { default: QRCode } = await import('qrcode');
    const dataUrl = await QRCode.toDataURL(payloadStr, { errorCorrectionLevel: 'M', width: 400 });
    return { dataUrl, payloadText: payloadStr };
  },
  importKeysFromSharing: async (payload, passphrase) => {
    const keys = await decryptKeysFromSharing(payload as { v: 1; salt: string; iv: string; data: string; tag: string }, passphrase);
    const imported: string[] = [];
    for (const [backend, key] of Object.entries(keys)) {
      await post('/api/keys', { key, backend });
      imported.push(backend);
    }
    return imported;
  },

  // AI generation
  generateText: (prompt, model, timeout, temperature) => {
    const body: Record<string, unknown> = { prompt, model, timeout, temperature };
    const byokKey = sessionStorage.getItem('byok-api-key');
    if (byokKey) body.apiKey = byokKey;
    return post('/api/ai/generate', body);
  },
  generateTextWithSearch: (prompt, model) =>
    post('/api/ai/search', { prompt, model }),
  startChatStream: () => Promise.reject(new Error('Streaming chat not supported in web mode')),
  onChatStreamChunk: () => () => {},
  onChatStreamDone: () => () => {},
  onChatStreamError: () => () => {},
  setDebateTemperature: (temp) => post('/api/ai/temperature', { temp }).then(() => {}),

  // Proxy tier & usage
  getProxyTier: () => get('/api/proxy/tier'),
  getProxyUsage: () => get('/api/proxy/usage'),

  // Embeddings & NLI
  computeEmbeddings: (texts, ids) => post('/api/embeddings/compute', { texts, ids }),
  updateNodeEmbeddings: (nodes) => post('/api/embeddings/update-nodes', { nodes }).then(() => {}),
  computeQueryEmbedding: (text) => post('/api/embeddings/query', { text }),
  nliClassify: (pairs) => post('/api/nli/classify', { pairs }),

  // Source evidence
  loadSourceEvidenceIndex: () => get<Record<string, unknown> | null>('/api/source-evidence-index').catch(() => null),
  loadDocTitles: () => get<Record<string, string> | null>('/api/doc-titles').catch(() => null),
  getSourceEvidence: (nodeIds, pov) => post('/api/source-evidence', { nodeIds, pov }),
  runEvidenceQbaf: (claimText, claimId, model) => post('/api/evidence-qbaf', { claimText, claimId, model }).catch(() => null),

  // Debate sessions
  listDebateSessions: () => get('/api/debates'),
  listDebateSessionsMeta: () => get('/api/debates/list'),
  loadDebateSession: (id) => get(`/api/debates/${encodeURIComponent(id)}`),
  saveDebateSession: (session) => put('/api/debates', session).then(() => {}),
  deleteDebateSession: (id) => del(`/api/debates/${encodeURIComponent(id)}`).then(() => {}),
  loadDebateComments: (id) => get(`/api/debates/${encodeURIComponent(id)}/comments`),
  saveDebateComments: (id, data) => put(`/api/debates/${encodeURIComponent(id)}/comments`, data).then(() => {}),
  exportDebateToFile: async (session, format = 'json', exportOptions) => {
    const { debateToText, debateToMarkdown, debateToHtml, debateToPackage, debateExportFilename } = await import('@lib/debate/debateExport');
    const debate = session as Parameters<typeof debateToText>[0] & { diagnostics?: unknown };
    let content: string;
    let mimeType: string;
    let ext: string;

    switch (format) {
      case 'markdown':
        content = debateToMarkdown(debate, exportOptions);
        mimeType = 'text/markdown';
        ext = 'md';
        break;
      case 'text':
        content = debateToText(debate, exportOptions);
        mimeType = 'text/plain';
        ext = 'txt';
        break;
      case 'pdf': {
        // Open styled HTML in a new tab and trigger browser print dialog
        const html = debateToHtml(debate, exportOptions);
        const printWindow = window.open('', '_blank');
        if (printWindow) {
          printWindow.document.write(html);
          printWindow.document.close();
          printWindow.addEventListener('load', () => printWindow.print());
        }
        return { cancelled: false, filePath: debateExportFilename(debate.title, 'pdf') };
      }
      case 'package': {
        // ZIP package — no PDF generator in browser, so HTML fallback is included
        const zipBytes = await debateToPackage(debate, exportOptions);
        const filename = debateExportFilename(debate.title, 'zip');
        const blob = new Blob([zipBytes.buffer as ArrayBuffer], { type: 'application/zip' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
        return { cancelled: false, filePath: filename };
      }
      default:
        content = JSON.stringify(debate, null, 2);
        mimeType = 'application/json';
        ext = 'json';
        break;
    }

    const filename = debateExportFilename(debate.title, ext);
    const blob = new Blob([content], { type: mimeType });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
    return { cancelled: false, filePath: filename };
  },

  // News Report
  generateNewsReport: (debateId) => post(`/api/debates/${encodeURIComponent(debateId)}/news-report`, {}),

  // Chat sessions
  listChatSessions: () => get('/api/chats'),
  loadChatSession: (id) => get(`/api/chats/${encodeURIComponent(id)}`),
  saveChatSession: (session) => put('/api/chats', session).then(() => {}),
  deleteChatSession: (id) => del(`/api/chats/${encodeURIComponent(id)}`).then(() => {}),

  // Harvest
  harvestCreateConflict: (conflict) => post('/api/harvest/conflict', conflict),
  harvestAddDebateRef: (nodeId, debateId) => post('/api/harvest/debate-ref', { nodeId, debateId }),
  harvestUpdateSteelman: (nodeId, attackerPov, newText) => post('/api/harvest/steelman', { nodeId, attackerPov, newText }),
  harvestAddVerdict: (conflictId, verdict) => post('/api/harvest/verdict', { conflictId, verdict }),
  harvestQueueConcept: (concept) => post('/api/harvest/concept', concept),
  harvestSaveManifest: (manifest) => post('/api/harvest/manifest', manifest),

  // Dictionary
  loadDictionary: () => get('/api/dictionary'),

  // Proposals
  listProposals: () => get('/api/proposals'),
  saveProposal: (filename, data) => put(`/api/proposals/${encodeURIComponent(filename)}`, data),

  // PowerShell prompts
  readPsPrompt: (name) => get(`/api/ps-prompts/${encodeURIComponent(name)}`),
  listPsPrompts: () => get('/api/ps-prompts'),

  // Feedback & error reporting
  submitFeedback: (rating, text) => post('/api/admin/feedback', { rating, text, context: { url: location.href, userAgent: navigator.userAgent } }),
  reportError: (err, context) => post('/api/admin/errors', { error: err, context: { ...context, url: location.href, userAgent: navigator.userAgent } }).catch(() => ({ ok: false }) /* telemetry — silent by design: logging error-report failures would cause infinite loops */),

  // Research file access
  readResearchFile: (relativePath) => get(`/api/research/${encodeURIComponent(relativePath)}`).catch(() => null),
  writeResearchFile: (relativePath, data) => put(`/api/research/${encodeURIComponent(relativePath)}`, data).then(() => {}),

  // Calibration
  getCalibrationHistory: () => get('/api/calibration/history').catch(() => ({ current: null, history: [] })),
  getCalibrationLog: () => get('/api/calibration/log').catch(() => ({ entries: [], validationReport: null })),

  // Sync
  syncCommit: (message) => post('/api/sync/commit', message ? { message } : undefined),

  // Flight recorder
  dumpFlightRecorder: (ndjson) => post('/api/flight-recorder/dump', { ndjson }),
  openFile: async () => {}, // No local file access in web mode
  openFlightRecorderViewer: async (dumpPath) => {
    // Extract filename from path and open the server-side viewer endpoint
    const filename = dumpPath.split('/').pop() ?? dumpPath;
    window.open(`/api/flight-recorder/view/${encodeURIComponent(filename)}`, '_blank');
  },

  // Diagnostics — in web mode, communicate cross-tab via BroadcastChannel
  openDiagnosticsWindow: async () => {
    const isPopout = window.location.hash.includes('debate-window');
    const width = window.innerWidth;
    console.log(`[diagnostics] openDiagnosticsWindow: width=${width}, isPopout=${isPopout}, hash=${window.location.hash}`);
    if (!isPopout && width <= 1023) {
      console.log('[diagnostics] Using drawer path (narrow main window)');
      window.dispatchEvent(new CustomEvent('open-diagnostics-drawer'));
      return;
    }
    console.log('[diagnostics] Using new-tab path (popout or wide window)');
    window.open(`${location.origin}/#diagnostics-window`, '_blank');
  },
  openPovProgressionWindow: async () => {
    window.open(`${location.origin}/#pov-progression-window`, '_blank');
  },
  closeDiagnosticsWindow: async () => {
    diagChannel?.postMessage({ type: 'diagnostics-closed' });
  },
  sendDiagnosticsState: (state) => {
    // Broadcast to same-window listeners AND cross-tab via BroadcastChannel
    for (const cb of diagCallbacks) cb(state);
    diagChannel?.postMessage({ type: 'diagnostics-state', payload: state });
  },
  // Prompt Diff popout
  openPromptDiffWindow: async (debateId, entryId) => {
    window.open(`${location.origin}/#prompt-diff-window?debateId=${encodeURIComponent(debateId)}&entryId=${encodeURIComponent(entryId)}`, '_blank');
  },
  // Debate popout — in web mode, open in a new browser tab
  openDebateWindow: async (debateId) => {
    window.open(`${location.origin}/#debate-window?id=${encodeURIComponent(debateId)}`, '_blank');
  },
  closeDebateWindow: async () => { /* no-op in web mode */ },

  getCliFileArg: async () => null, // No CLI mode in browser

  // Terminal — via WebSocket
  terminalSpawn: async () => { ensureTerminalSocket(); },
  terminalWrite: async (data) => {
    if (terminalWs?.readyState === WebSocket.OPEN) {
      terminalWs.send(JSON.stringify({ type: 'write', data }));
    }
  },
  terminalResize: async (cols, rows) => {
    if (terminalWs?.readyState === WebSocket.OPEN) {
      terminalWs.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  },
  terminalKill: async () => {
    if (terminalWs?.readyState === WebSocket.OPEN) {
      terminalWs.send(JSON.stringify({ type: 'kill' }));
    }
    terminalWs?.close();
    terminalWs = null;
  },

  // File operations
  fetchUrlContent: (url) => post('/api/fetch-url', { url }),
  pickDocumentFile: async () => {
    // Use browser file picker
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.pdf,.docx,.html,.htm,.txt,.md';
      input.onchange = async () => {
        if (!input.files?.length) { resolve({ cancelled: true }); return; }
        const file = input.files[0];
        const content = await file.text();
        resolve({ cancelled: false, filePath: file.name, content });
      };
      input.oncancel = () => resolve({ cancelled: true });
      input.click();
    });
  },
  clipboardWriteText: async (text) => {
    await navigator.clipboard.writeText(text);
  },

  // Window control — no-ops in browser
  growWindow: async () => {},
  shrinkWindow: async () => {},
  isMaximized: async () => false,
  openExternal: async (url) => { window.open(url, '_blank'); },

  // Event listeners
  onDiagnosticsStateUpdate: (cb) => {
    diagCallbacks.add(cb);
    return () => { diagCallbacks.delete(cb); };
  },
  onDiagnosticsPopoutClosed: (cb) => {
    diagClosedCallbacks.add(cb);
    return () => { diagClosedCallbacks.delete(cb); };
  },
  openChatWindow: async () => {
    window.open(`${window.location.origin}#chat-window`, 'pover-chat', 'width=700,height=800');
  },
  onChatPopoutClosed: () => () => {},
  requestReExtractClaims: (entryId) => {
    diagChannel?.postMessage({ type: 're-extract-claims', entryId });
  },
  onReExtractClaims: (cb) => {
    reExtractCallbacks.add(cb);
    return () => { reExtractCallbacks.delete(cb); };
  },
  onDebateWindowLoad: () => () => {}, // Web mode: debate ID comes via URL hash
  onDebatePopoutClosed: () => () => {},
  onGenerateTextProgress: (cb) => addEventListener('generate-text-progress', cb as EventCallback),
  onReloadTaxonomy: (cb) => addEventListener('reload-taxonomy', cb as EventCallback),
  onFocusNode: (cb) => addEventListener('focus-node', (d) => cb((d as { nodeId: string }).nodeId)),
  focusNodeInMainWindow: (nodeId) => { void post('/api/focus-node', { nodeId }); },
  onTerminalData: (cb) => {
    terminalDataCallbacks.add(cb);
    return () => { terminalDataCallbacks.delete(cb); };
  },
  onTerminalExit: (cb) => {
    terminalExitCallbacks.add(cb);
    return () => { terminalExitCallbacks.delete(cb); };
  },
};

export const api = instrumentBridge(rawApi);
