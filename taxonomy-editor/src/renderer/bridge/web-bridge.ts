// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Web bridge — implements AppAPI via REST and WebSocket calls to the server.
 * Used when the app runs in a browser served by the container.
 */
import type { AppAPI, SourceDocumentResolution } from './types';
import { instrumentBridge } from './instrumentBridge';
import { ActionableError } from '@lib/debate/errors';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { encryptKeysForSharing, decryptKeysFromSharing } from '../utils/keyShareCrypto';
import { resilientFetch, categorizeEndpoint, type EndpointCategory } from './resilience';
export { getResilienceState, subscribeResilience, resetResilience } from './resilience';
export type { ResilienceStatus, CircuitState, ThrottleState, EndpointCategory } from './resilience';

function throwHttpError(status: number, err: ActionableError): never {
  (err as ActionableError & { httpStatus: number }).httpStatus = status;
  throw err;
}

// ── Resilient fetch options for callers ──

interface FetchOptions {
  timeoutMs?: number;
  maxRetries?: number;
  idempotent?: boolean;
  critical?: boolean;
}

const DEFAULT_READ_TIMEOUT_MS = 30_000;
const DEFAULT_MUTATION_TIMEOUT_MS = 180_000;

function defaultMaxRetries(cat: EndpointCategory, method: string, idempotent?: boolean): number {
  if (cat === 'telemetry') return 0;
  if (method === 'GET') return 3;
  // AI mutations get 0 retries: the server already retries 5× per backend + model fallback chain (t/878)
  return idempotent ? 1 : 0;
}

function throwTimeoutError(method: string, path: string, timeoutMs: number): never {
  throw new ActionableError({
    goal: 'Call server API',
    problem: `${method} ${path} timed out after ${Math.round(timeoutMs / 1000)}s`,
    location: `web-bridge.${method.toLowerCase()}`,
    nextSteps: ['The server may be overloaded — try again', 'Check server logs for errors'],
  });
}

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
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'web-bridge', level: 'warn', message: 'Auth check failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    _authAnonymous = true;
  }
  return _authAnonymous;
}

// ── HTTP helpers ──

async function get<T = unknown>(path: string, opts?: FetchOptions): Promise<T> {
  const cat = categorizeEndpoint(path, 'GET');
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
  let res: Response;
  try {
    res = await resilientFetch(path, {}, {
      timeoutMs,
      maxRetries: opts?.maxRetries ?? defaultMaxRetries(cat, 'GET'),
      critical: opts?.critical ?? true,
      category: cat,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throwTimeoutError('GET', path, timeoutMs);
    }
    throw err;
  }
  if (!res.ok) {
    const text = await res.text();
    throwHttpError(res.status, new ActionableError({
      goal: 'Fetch data from server',
      problem: `GET ${path} failed with HTTP ${res.status}: ${text}`,
      location: 'web-bridge.get',
      nextSteps: ['Check the server is running', 'Verify your authentication'],
    }));
  }
  return res.json();
}

async function post<T = unknown>(path: string, body?: unknown, opts?: FetchOptions): Promise<T> {
  const cat = categorizeEndpoint(path, 'POST');
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_MUTATION_TIMEOUT_MS;
  let res: Response;
  try {
    res = await resilientFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }, {
      timeoutMs,
      maxRetries: opts?.maxRetries ?? defaultMaxRetries(cat, 'POST', opts?.idempotent),
      critical: opts?.critical ?? (cat !== 'telemetry'),
      category: cat,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throwTimeoutError('POST', path, timeoutMs);
    }
    throw err;
  }
  if (res.status === 429) {
    const data = await res.json().catch(bridgeWarn('Failed to parse rate-limit response body', {})) as Record<string, unknown>;
    const msg = data.limitType === 'tokens_per_day'
      ? 'Daily token limit exceeded. Try again tomorrow or use your own API key.'
      : `Rate limit exceeded. Retry in ${Math.ceil((data.retryAfterMs as number || 60000) / 1000)}s.`;
    throwHttpError(429, new ActionableError({
      goal: 'Call AI backend',
      problem: msg,
      location: 'web-bridge.post',
      nextSteps: ['Wait for the rate limit to reset', 'Use your own API key to avoid shared limits'],
    }));
  }
  if (res.status === 400 && path === '/api/ai/generate') {
    const data = await res.json().catch(bridgeWarn('Failed to parse 400 response body', {})) as Record<string, unknown>;
    if (data.limitType === 'max_prompt_chars') {
      throwHttpError(400, new ActionableError({
        goal: 'Generate AI response',
        problem: `Prompt exceeds the ${(data.limit as number)?.toLocaleString() ?? ''} character limit for the free tier.`,
        location: 'web-bridge.post',
        nextSteps: ['Shorten your prompt or debate topic', 'Use your own API key to remove the limit'],
      }));
    }
  }
  if (res.status === 422 && path === '/api/ai/generate') {
    const data = await res.json().catch(bridgeWarn('Failed to parse 422 response body', {})) as Record<string, unknown>;
    if (data.error === 'missing_api_key') {
      throwHttpError(422, new ActionableError({
        goal: 'Generate AI response',
        problem: (data.message as string) || `No API key configured for ${(data.backend as string) || 'the selected backend'}.`,
        location: 'web-bridge.post',
        nextSteps: ['Open Settings → API Keys and add a key for this backend', 'Switch to a backend that has a key configured'],
      }));
    }
  }
  if (!res.ok) {
    const text = await res.text();
    throwHttpError(res.status, new ActionableError({
      goal: 'Send data to server',
      problem: `POST ${path} failed with HTTP ${res.status}: ${text}`,
      location: 'web-bridge.post',
      nextSteps: ['Check the server is running', 'Verify your authentication'],
    }));
  }
  return res.json();
}

async function put<T = unknown>(path: string, body?: unknown, opts?: FetchOptions): Promise<T> {
  const cat = categorizeEndpoint(path, 'PUT');
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_MUTATION_TIMEOUT_MS;
  let res: Response;
  try {
    res = await resilientFetch(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }, {
      timeoutMs,
      maxRetries: opts?.maxRetries ?? defaultMaxRetries(cat, 'PUT', opts?.idempotent),
      critical: opts?.critical ?? true,
      category: cat,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throwTimeoutError('PUT', path, timeoutMs);
    }
    throw err;
  }
  if (!res.ok) {
    const text = await res.text();
    throwHttpError(res.status, new ActionableError({
      goal: 'Update data on server',
      problem: `PUT ${path} failed with HTTP ${res.status}: ${text}`,
      location: 'web-bridge.put',
      nextSteps: ['Check the server is running', 'Verify your authentication'],
    }));
  }
  return res.json();
}

async function del<T = unknown>(path: string, opts?: FetchOptions): Promise<T> {
  const cat = categorizeEndpoint(path, 'DELETE');
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_MUTATION_TIMEOUT_MS;
  let res: Response;
  try {
    res = await resilientFetch(path, { method: 'DELETE' }, {
      timeoutMs,
      maxRetries: opts?.maxRetries ?? defaultMaxRetries(cat, 'DELETE', opts?.idempotent),
      critical: opts?.critical ?? true,
      category: cat,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throwTimeoutError('DELETE', path, timeoutMs);
    }
    throw err;
  }
  if (!res.ok) {
    const text = await res.text();
    throwHttpError(res.status, new ActionableError({
      goal: 'Delete data on server',
      problem: `DELETE ${path} failed with HTTP ${res.status}: ${text}`,
      location: 'web-bridge.del',
      nextSteps: ['Check the server is running', 'Verify your authentication'],
    }));
  }
  return res.json();
}

export { get as bridgeGet, post as bridgePost, put as bridgePut, del as bridgeDel };

/** Read BYOK keys from sessionStorage, backward-compatible with legacy single-key strings. */
function readByokKeys(backend: string): string[] {
  const raw = sessionStorage.getItem(`byok-${backend}`);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((k: unknown) => typeof k === 'string' && k);
  } catch { /* legacy raw string */ }
  return [raw];
}

function maskByokKey(key: string): string {
  if (key.length <= 4) return key.slice(0, 2) + '***';
  return key.slice(0, 4) + '...' + key.slice(-4);
}

function bridgeWarn<T>(message: string, fallback: T) {
  return (err: unknown) => {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'web-bridge',
      level: 'warn',
      message,
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    return fallback;
  };
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
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
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
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
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
  getEdgeDetail: (index) => get(`/api/edges/${index}`),
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
  loadSummary: (docId) => get(`/api/summaries/${encodeURIComponent(docId)}`).catch(bridgeWarn('loadSummary failed', null)),
  loadSnapshot: (sourceId) => get(`/api/snapshots/${encodeURIComponent(sourceId)}`).then(r => r as { content: string } | null).catch(bridgeWarn('loadSnapshot failed', null)),
  resolveSourceDocument: (docId) => get(`/api/source-documents/${encodeURIComponent(docId)}`).then(r => r as SourceDocumentResolution).catch(bridgeWarn('resolveSourceDocument failed', { available: false, type: null })),

  // Data management
  isDataAvailable: () => get('/api/data/available'),
  getDataRoot: () => get('/api/data/root'),
  getCopyStatus: () => get<{ state: string; dir?: string; copied?: number; total?: number }>('/status').catch(bridgeWarn('getCopyStatus failed', { state: 'unknown' })),
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

  getChangedFiles: () => post<{ path: string; status: string }[]>('/api/data/changed-files').catch(bridgeWarn('getChangedFiles failed', [])),
  getFileDiff: (filePath) => post<string>('/api/data/file-diff', { filePath }).catch(bridgeWarn('getFileDiff failed', '')),

  // AI models & keys
  loadAIModels: () => get('/api/models'),
  refreshAIModels: () => post('/api/models/refresh'),
  setApiKey: async (key, backend) => {
    const storageKey = backend ? `byok-${backend}` : 'byok-api-key';
    sessionStorage.setItem(storageKey, JSON.stringify([key]));
    if (!(await isAnonymous())) {
      await post('/api/keys', { key, backend });
    }
  },
  addApiKey: async (key, backend) => {
    if (await isAnonymous()) {
      const keys = readByokKeys(backend);
      if (!keys.includes(key)) keys.push(key);
      sessionStorage.setItem(`byok-${backend}`, JSON.stringify(keys));
      return { count: keys.length };
    }
    const res = await post<{ keys: { index: number; masked: string }[] }>(`/api/keys/${backend}/add`, { key });
    return { count: res.keys.length };
  },
  removeApiKey: async (index, backend) => {
    if (await isAnonymous()) {
      const keys = readByokKeys(backend);
      if (index >= 0 && index < keys.length) keys.splice(index, 1);
      sessionStorage.setItem(`byok-${backend}`, JSON.stringify(keys));
      return;
    }
    await del(`/api/keys/${backend}/${index}`);
  },
  getApiKeys: async (backend) => {
    if (await isAnonymous()) {
      return readByokKeys(backend).map((k, i) => ({ index: i, masked: maskByokKey(k) }));
    }
    const res = await get<{ keys: { index: number; masked: string }[] }>(`/api/keys/${backend}`);
    return res.keys;
  },
  deleteApiKey: async (backend) => {
    const storageKey = backend ? `byok-${backend}` : 'byok-api-key';
    sessionStorage.removeItem(storageKey);
    if (!(await isAnonymous())) {
      await post('/api/keys/delete', { backend });
    }
  },
  deleteAllApiKeys: async () => {
    const ALL_BACKENDS = ['gemini', 'claude', 'groq', 'openai', 'deepseek', 'tavily', 'ollama'] as const;
    for (const b of ALL_BACKENDS) {
      sessionStorage.removeItem(`byok-${b}`);
    }
    sessionStorage.removeItem('byok-api-key');
    if (!(await isAnonymous())) {
      await post('/api/keys/delete-all');
    }
  },
  hasApiKey: async (backend) => {
    if (await isAnonymous()) {
      const storageKey = backend ? `byok-${backend}` : 'byok-api-key';
      return !!sessionStorage.getItem(storageKey);
    }
    return get(`/api/keys/has${backend ? `?backend=${backend}` : ''}`);
  },
  getAvailableBackends: async () => {
    // Anonymous (BYOK) keys live in sessionStorage — the server can't see them,
    // so derive availability locally, mirroring hasApiKey's anonymous branch.
    if (await isAnonymous()) {
      const ALL_BACKENDS = ['gemini', 'claude', 'groq', 'openai', 'deepseek', 'tavily', 'ollama'] as const;
      return ALL_BACKENDS.map((id) => ({ id, available: !!sessionStorage.getItem(`byok-${id}`) }));
    }
    const res = await get<{ backends: { id: string; available: boolean; models?: string[]; reason?: string }[] }>('/api/backends/available')
      .catch(bridgeWarn('getAvailableBackends failed', { backends: [] }));
    return res.backends;
  },
  getApiKeySummary: async () => {
    const ALL_BACKENDS = ['gemini', 'claude', 'groq', 'openai', 'deepseek', 'tavily', 'ollama'] as const;
    return ALL_BACKENDS.map((b) => {
      const keys = readByokKeys(b);
      return {
        backend: b,
        hasKey: keys.length > 0,
        maskedKey: keys.length > 0 ? maskByokKey(keys[0]) : null,
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
  generateTextWithSearch: (prompt, model) => {
    const body: Record<string, unknown> = { prompt, model, search: true };
    const byokKey = sessionStorage.getItem('byok-api-key');
    if (byokKey) body.apiKey = byokKey;
    return post('/api/ai/generate', body);
  },
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
  loadSourceEvidenceIndex: () => get<Record<string, unknown> | null>('/api/source-evidence-index').catch(bridgeWarn('loadSourceEvidenceIndex failed', null)),
  loadDocTitles: () => get<Record<string, string> | null>('/api/doc-titles').catch(bridgeWarn('loadDocTitles failed', null)),
  getSourceEvidence: (nodeIds, pov) => post('/api/source-evidence', { nodeIds, pov }),
  runEvidenceQbaf: (claimText, claimId, model) => post('/api/evidence-qbaf', { claimText, claimId, model }).catch(bridgeWarn('runEvidenceQbaf failed', null)),

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
  submitFeedback: (rating, text, category, context) => post('/api/admin/feedback', { rating, text, category: category ?? 'general', context: { ...context, url: location.href, userAgent: navigator.userAgent } }),
  reportError: (err, context) => post('/api/admin/errors', { error: err, context: { ...context, url: location.href, userAgent: navigator.userAgent } }).catch(bridgeWarn('Error report submission failed', { ok: false })),

  // Telemetry
  trackEvent: (type, view, metadata) => { void post('/api/admin/telemetry', { type, view, metadata }).catch(bridgeWarn('Telemetry event failed', undefined)); },

  // Research file access
  readResearchFile: (relativePath) => get(`/api/research/${encodeURIComponent(relativePath)}`).catch(bridgeWarn('readResearchFile failed', null)),
  writeResearchFile: (relativePath, data) => put(`/api/research/${encodeURIComponent(relativePath)}`, data).then(() => {}),

  // Synthetic corpus
  loadSyntheticCorpus: (pov) => get(`/api/taxonomy/synthetic/${encodeURIComponent(pov)}`).catch(bridgeWarn('loadSyntheticCorpus failed', null)),
  loadSyntheticEmbeddings: () => get('/api/taxonomy/synthetic-embeddings').catch(bridgeWarn('loadSyntheticEmbeddings failed', null)),
  updateSyntheticEmbeddings: (nodeId, pov, vectors) => post('/api/taxonomy/synthetic-embeddings', { nodeId, pov, vectors }).then(() => {}),

  // Community Library
  listCommunityChats: () => get('/api/community/chats').catch(bridgeWarn('listCommunityChats failed', [])),
  listCommunityDebates: () => get('/api/community/debates').catch(bridgeWarn('listCommunityDebates failed', [])),
  submitToCommunity: (type, itemData, note) => post('/api/community/submit', { type, data: itemData, note }),
  copyFromCommunity: (type, communityId) => post('/api/community/copy', { type, communityId }),
  loadCommunityDebateSession: (id) => get(`/api/community/debates/${encodeURIComponent(id)}`),
  loadCommunityChatSession: (id) => get(`/api/community/chats/${encodeURIComponent(id)}`),
  // Web mode is same-origin; baseUrl is ignored and the relative path is used.
  communitySubmit: (_baseUrl, payload) => post('/api/community/submit', payload),

  // Calibration
  getCalibrationHistory: () => get('/api/calibration/history').catch(bridgeWarn('getCalibrationHistory failed', { current: null, history: [] })),
  getCalibrationLog: () => get('/api/calibration/log').catch(bridgeWarn('getCalibrationLog failed', { entries: [], validationReport: null })),

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
  // Data file diff popout
  openDiffWindow: async (filePath) => {
    window.open(`${location.origin}/#diff-window?file=${encodeURIComponent(filePath)}`, '_blank');
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
    window.open(`${window.location.origin}#chat-window`, 'pover-chat', 'width=900,height=800');
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
  onTaxonomyUpdated: (cb) => addEventListener('taxonomy-updated', (d) => cb(d as { user: string; nodeCount: number; povs: string[] })),
  focusNodeInMainWindow: (nodeId) => { void post('/api/focus-node', { nodeId }); },
  onTerminalData: (cb) => {
    terminalDataCallbacks.add(cb);
    return () => { terminalDataCallbacks.delete(cb); };
  },
  onTerminalExit: (cb) => {
    terminalExitCallbacks.add(cb);
    return () => { terminalExitCallbacks.delete(cb); };
  },
  captureScreenshot: () => Promise.resolve({ cancelled: true }),

  // Admin Review (HTTP to server)
  adminReviewConfigured: () => Promise.resolve(true),
  adminReviewQueue: async () => {
    const res = await fetch('/api/admin/review/queue');
    if (!res.ok) throw new Error(`GET queue failed: HTTP ${res.status}`);
    const body = await res.json();
    return { items: body.items ?? body };
  },
  adminReviewStats: async () => {
    const res = await fetch('/api/admin/review/stats');
    if (!res.ok) throw new Error(`GET stats failed: HTTP ${res.status}`);
    return res.json();
  },
  adminReviewDetail: async (groupId: string) => {
    const res = await fetch(`/api/admin/review/detail/${encodeURIComponent(groupId)}`);
    if (!res.ok) throw new Error(`GET detail failed: HTTP ${res.status}`);
    return res.json();
  },
  adminReviewAction: async (action: unknown) => {
    const res = await fetch('/api/admin/review/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action),
    });
    if (!res.ok) throw new Error(`POST action failed: HTTP ${res.status}`);
  },
  adminRemoveCommunityItem: async (type, id, reason) => {
    const res = await fetch(`/api/community/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) throw new Error(`DELETE community item failed: HTTP ${res.status}`);
  },
};

export const api = instrumentBridge(rawApi);

export function isElectronMode(): boolean {
  return typeof window !== 'undefined' && 'electronAPI' in window;
}
