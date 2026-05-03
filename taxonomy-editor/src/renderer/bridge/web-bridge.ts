// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Web bridge — implements AppAPI via REST and WebSocket calls to the server.
 * Used when the app runs in a browser served by the container.
 */
import type { AppAPI } from './types';
import { instrumentBridge } from './instrumentBridge';
import { ActionableError } from '@lib/debate/errors';

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
    const data = await res.json().catch(() => ({})) as Record<string, unknown>;
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
    } catch { /* ignore */ }
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
    } catch { /* ignore */ }
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

// Receive diagnostics state from the main tab (or from this tab if inline)
diagChannel?.addEventListener('message', (event) => {
  const msg = event.data as { type: string; payload?: unknown };
  if (msg.type === 'diagnostics-state' && msg.payload) {
    for (const cb of diagCallbacks) cb(msg.payload);
  } else if (msg.type === 'diagnostics-closed') {
    for (const cb of diagClosedCallbacks) cb();
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
  loadEdges: () => get('/api/edges'),
  updateEdgeStatus: (index, status) => put('/api/edges/status', { index, status }),
  swapEdgeDirection: (index) => put('/api/edges/swap', { index }),
  bulkUpdateEdges: (indices, status) => put('/api/edges/bulk-status', { indices, status }),
  buildNodeSourceIndex: () => get('/api/node-source-index'),
  buildPolicySourceIndex: () => get('/api/policy-source-index'),

  // Conflict CRUD
  loadConflictFiles: () => get('/api/conflicts'),
  loadConflictClusters: () => get('/api/conflicts/clusters'),
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

  // AI models & keys
  loadAIModels: () => get('/api/models'),
  refreshAIModels: () => post('/api/models/refresh'),
  setApiKey: (key, backend) => post('/api/keys', { key, backend }).then(() => {}),
  hasApiKey: (backend) => get(`/api/keys/has${backend ? `?backend=${backend}` : ''}`),

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

  // Debate sessions
  listDebateSessions: () => get('/api/debates'),
  loadDebateSession: (id) => get(`/api/debates/${encodeURIComponent(id)}`),
  saveDebateSession: (session) => put('/api/debates', session).then(() => {}),
  deleteDebateSession: (id) => del(`/api/debates/${encodeURIComponent(id)}`).then(() => {}),
  loadDebateComments: (id) => get(`/api/debates/${encodeURIComponent(id)}/comments`),
  saveDebateComments: (id, data) => put(`/api/debates/${encodeURIComponent(id)}/comments`, data).then(() => {}),
  getCalibrationHistory: () => get('/api/calibration/history'),
  getCalibrationLog: () => get('/api/calibration/log'),
  exportDebateToFile: async (session, format = 'json') => {
    const { debateToText, debateToMarkdown, debateToHtml, debateToPackage, debateExportFilename } = await import('@lib/debate/debateExport');
    const debate = session as Parameters<typeof debateToText>[0] & { diagnostics?: unknown };
    let content: string;
    let mimeType: string;
    let ext: string;

    switch (format) {
      case 'markdown':
        content = debateToMarkdown(debate);
        mimeType = 'text/markdown';
        ext = 'md';
        break;
      case 'text':
        content = debateToText(debate);
        mimeType = 'text/plain';
        ext = 'txt';
        break;
      case 'pdf': {
        // Open styled HTML in a new tab and trigger browser print dialog
        const html = debateToHtml(debate);
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
        const zipBytes = await debateToPackage(debate);
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

  // Calibration
  getCalibrationHistory: () => get('/api/calibration/history').catch(() => ({ current: null, history: [] })),
  getCalibrationLog: () => get('/api/calibration/log').catch(() => ({ entries: [], validationReport: null })),

  // Flight recorder
  dumpFlightRecorder: (ndjson) => post('/api/flight-recorder/dump', { ndjson }),
  openFile: async () => {}, // No local file access in web mode

  // Diagnostics — in web mode, communicate cross-tab via BroadcastChannel
  openDiagnosticsWindow: async () => {
    // Open diagnostics in a new browser tab using the hash the App checks for
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
  onDebateWindowLoad: () => () => {}, // Web mode: debate ID comes via URL hash
  onDebatePopoutClosed: () => () => {},
  onGenerateTextProgress: (cb) => addEventListener('generate-text-progress', cb as EventCallback),
  onReloadTaxonomy: (cb) => addEventListener('reload-taxonomy', cb as EventCallback),
  onFocusNode: (cb) => addEventListener('focus-node', (d) => cb((d as { nodeId: string }).nodeId)),
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
