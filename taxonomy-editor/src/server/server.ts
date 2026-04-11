// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Web server for the Taxonomy Editor.
 * Serves the React SPA and provides REST + WebSocket APIs that mirror
 * the Electron IPC bridge (window.electronAPI).
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn, execFile, ChildProcess } from 'child_process';
import { WebSocketServer, WebSocket } from 'ws';
import {
  PORT, getDataRoot, getApiKey, hasApiKey, storeApiKey, resolveDataPath,
  BROKER_SCRIPT, SCRIPTS_DIR, getProjectRoot, type AIBackend,
} from './config';
import * as fileIO from './fileIO';
import * as ai from './aiBackends';

// ── Express-like micro-router (zero dependencies) ──

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, body: unknown) => Promise<void> | void;
const routes: { method: string; path: string; handler: Handler }[] = [];

function get(p: string, h: Handler) { routes.push({ method: 'GET', path: p, handler: h }); }
function post(p: string, h: Handler) { routes.push({ method: 'POST', path: p, handler: h }); }
function put(p: string, h: Handler) { routes.push({ method: 'PUT', path: p, handler: h }); }
function del(p: string, h: Handler) { routes.push({ method: 'DELETE', path: p, handler: h }); }

function json(res: http.ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function error(res: http.ServerResponse, message: string, status = 500) {
  json(res, { error: message }, status);
}

function param(req: http.IncomingMessage, name: string, routePath: string): string {
  // Simple :param extraction from URL
  const urlParts = new URL(req.url!, `http://localhost`).pathname.split('/');
  const routeParts = routePath.split('/');
  for (let i = 0; i < routeParts.length; i++) {
    if (routeParts[i] === `:${name}`) return decodeURIComponent(urlParts[i]);
  }
  return '';
}

function query(req: http.IncomingMessage, name: string): string | null {
  const url = new URL(req.url!, `http://localhost`);
  return url.searchParams.get(name);
}

// ── Health ──

// Version — injected at build time or read from package.json
const SERVER_VERSION = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));
    return pkg.version || '0.1.0';
  } catch {
    return '0.1.0';
  }
})();

get('/health', (_req, res) => {
  json(res, {
    status: 'ok',
    version: SERVER_VERSION,
    uptime: process.uptime(),
    dataRoot: getDataRoot(),
  });
});

// ── Taxonomy directories ──

get('/api/taxonomy-dirs', (_req, res) => {
  json(res, fileIO.getTaxonomyDirs());
});

get('/api/taxonomy-dir/active', (_req, res) => {
  json(res, fileIO.getActiveTaxonomyDirName());
});

put('/api/taxonomy-dir/active', (_req, res, body) => {
  const { dirName } = body as { dirName: string };
  fileIO.setActiveTaxonomyDir(dirName);
  json(res, { ok: true });
});

// ── Taxonomy CRUD ──

get('/api/taxonomy/:pov', (req, res) => {
  try {
    const pov = param(req, 'pov', '/api/taxonomy/:pov');
    json(res, fileIO.readTaxonomyFile(pov));
  } catch (err) { error(res, String(err)); }
});

put('/api/taxonomy/:pov', (req, res, body) => {
  try {
    const pov = param(req, 'pov', '/api/taxonomy/:pov');
    fileIO.writeTaxonomyFile(pov, body);
    json(res, { ok: true });
  } catch (err) { error(res, String(err)); }
});

// ── Conflicts ──

get('/api/conflicts', (_req, res) => {
  json(res, fileIO.readAllConflictFiles());
});

get('/api/conflicts/clusters', (_req, res) => {
  json(res, fileIO.readConflictClusters());
});

put('/api/conflicts/:id', (req, res, body) => {
  try {
    const id = param(req, 'id', '/api/conflicts/:id');
    fileIO.writeConflictFile(id, body);
    json(res, { ok: true });
  } catch (err) { error(res, String(err)); }
});

post('/api/conflicts/:id', (req, res, body) => {
  try {
    const id = param(req, 'id', '/api/conflicts/:id');
    fileIO.createConflictFile(id, body);
    json(res, { ok: true });
  } catch (err) { error(res, String(err)); }
});

del('/api/conflicts/:id', (req, res) => {
  const id = param(req, 'id', '/api/conflicts/:id');
  fileIO.deleteConflictFile(id);
  json(res, { ok: true });
});

// ── Policy registry ──

get('/api/policy-registry', (_req, res) => {
  json(res, fileIO.readPolicyRegistry());
});

// ── Edges ──

let edgesCache: unknown = null;

get('/api/edges', (_req, res) => {
  edgesCache = fileIO.readEdgesFile();
  json(res, edgesCache);
});

put('/api/edges/status', (_req, res, body) => {
  const { index, status: s } = body as { index: number; status: string };
  if (!edgesCache) edgesCache = fileIO.readEdgesFile();
  edgesCache = fileIO.updateEdgeStatus(edgesCache, index, s);
  json(res, edgesCache);
});

put('/api/edges/bulk-status', (_req, res, body) => {
  const { indices, status: s } = body as { indices: number[]; status: string };
  if (!edgesCache) edgesCache = fileIO.readEdgesFile();
  edgesCache = fileIO.bulkUpdateEdges(edgesCache, indices, s);
  json(res, edgesCache);
});

// ── Source indexes ──

get('/api/node-source-index', (_req, res) => {
  json(res, fileIO.buildNodeSourceIndex());
});

get('/api/policy-source-index', (_req, res) => {
  json(res, fileIO.buildPolicySourceIndex());
});

// ── Data management ──

get('/api/data/available', (_req, res) => {
  json(res, fileIO.isDataAvailable());
});

get('/api/data/root', (_req, res) => {
  json(res, fileIO.getDataRootPath());
});

post('/api/data/set-root', (_req, res, body) => {
  const { newRoot } = body as { newRoot: string };
  try {
    if (!fs.existsSync(newRoot)) {
      json(res, { success: false, message: `Directory does not exist: ${newRoot}` }, 400);
      return;
    }
    process.env.AI_TRIAD_DATA_ROOT = path.resolve(newRoot);
    json(res, { success: true });
  } catch (err) {
    json(res, { success: false, message: String(err) }, 500);
  }
});

post('/api/data/clone', async (_req, res, body) => {
  const { targetPath } = body as { targetPath: string };
  try {
    const result = await new Promise<{ success: boolean; message: string }>((resolve, reject) => {
      execFile('git', ['clone', 'https://github.com/jpsnover/ai-triad-data.git', targetPath], { timeout: 300_000 }, (err) => {
        if (err) reject(err);
        else resolve({ success: true, message: 'Data repository cloned successfully.' });
      });
    });
    json(res, result);
  } catch (err) {
    json(res, { success: false, message: String(err) });
  }
});

post('/api/data/check-updates', async (_req, res) => {
  try {
    const dataRoot = getDataRoot();
    const gitDir = path.join(dataRoot, '.git');
    if (!fs.existsSync(gitDir)) { json(res, { available: false, error: 'Not a git repo' }); return; }

    const runGit = (args: string[]): Promise<string> => new Promise((resolve, reject) => {
      execFile('git', args, { cwd: dataRoot, timeout: 15_000 }, (err, stdout) => {
        if (err) reject(err); else resolve(stdout.trim());
      });
    });

    await runGit(['fetch', 'origin', '--quiet']);
    const local = await runGit(['rev-parse', 'HEAD']);
    const remote = await runGit(['rev-parse', 'origin/main']);
    const count = local === remote ? 0 : parseInt(await runGit(['rev-list', '--count', `HEAD..origin/main`]), 10);

    json(res, { available: count > 0, behindCount: count, currentCommit: local, remoteCommit: remote });
  } catch (err) {
    json(res, { available: false, error: String(err) });
  }
});

post('/api/data/pull', async (_req, res) => {
  try {
    const dataRoot = getDataRoot();
    await new Promise<void>((resolve, reject) => {
      execFile('git', ['pull', 'origin', 'main'], { cwd: dataRoot, timeout: 60_000 }, (err) => {
        if (err) reject(err); else resolve();
      });
    });
    json(res, { success: true, message: 'Data updated.' });
  } catch (err) {
    json(res, { success: false, message: String(err) });
  }
});

// ── AI models & keys ──

get('/api/models', (_req, res) => {
  json(res, fileIO.loadAIModels());
});

post('/api/models/refresh', async (_req, res) => {
  try {
    json(res, await ai.refreshAIModels());
  } catch (err) { error(res, String(err)); }
});

get('/api/keys/has', (req, res) => {
  const backend = (query(req, 'backend') || 'gemini') as AIBackend;
  json(res, hasApiKey(backend));
});

post('/api/keys', (_req, res, body) => {
  const { key, backend } = body as { key: string; backend?: string };
  storeApiKey(key, (backend || 'gemini') as AIBackend);
  json(res, { ok: true });
});

// ── AI generation ──

post('/api/ai/generate', async (_req, res, body) => {
  const { prompt, model, timeout } = body as { prompt: string; model?: string; timeout?: number };
  try {
    const text = await ai.generateText(prompt, model, undefined, timeout);
    json(res, { text });
  } catch (err) { error(res, String(err)); }
});

post('/api/ai/search', async (_req, res, body) => {
  const { prompt, model } = body as { prompt: string; model?: string };
  try {
    json(res, await ai.generateTextWithSearch(prompt, model));
  } catch (err) { error(res, String(err)); }
});

post('/api/ai/temperature', (_req, res, body) => {
  const { temp } = body as { temp: number | null };
  ai.setDebateTemperature(temp);
  json(res, { ok: true });
});

// ── Embeddings & NLI ──

post('/api/embeddings/compute', async (_req, res, body) => {
  const { texts, ids } = body as { texts: string[]; ids?: string[] };
  try {
    const vectors = await ai.computeEmbeddings(texts, ids);
    json(res, { vectors });
  } catch (err) { error(res, String(err)); }
});

post('/api/embeddings/query', async (_req, res, body) => {
  const { text } = body as { text: string };
  try {
    const vector = await ai.computeQueryEmbedding(text);
    json(res, { vector });
  } catch (err) { error(res, String(err)); }
});

post('/api/embeddings/update-nodes', async (_req, res, body) => {
  const { nodes } = body as { nodes: { id: string; text: string; pov: string }[] };
  try {
    await ai.updateNodeEmbeddings(nodes);
    json(res, { ok: true });
  } catch (err) { error(res, String(err)); }
});

post('/api/nli/classify', async (_req, res, body) => {
  const { pairs } = body as { pairs: { text_a: string; text_b: string }[] };
  try {
    const results = await ai.classifyNli(pairs);
    json(res, { results });
  } catch (err) { error(res, String(err)); }
});

// ── Debate sessions ──

get('/api/debates', (_req, res) => { json(res, fileIO.listDebateSessions()); });

get('/api/debates/:id', (req, res) => {
  try { json(res, fileIO.loadDebateSession(param(req, 'id', '/api/debates/:id'))); }
  catch (err) { error(res, String(err), 404); }
});

put('/api/debates', (_req, res, body) => {
  try { fileIO.saveDebateSession(body); json(res, { ok: true }); }
  catch (err) { error(res, String(err)); }
});

del('/api/debates/:id', (req, res) => {
  fileIO.deleteDebateSession(param(req, 'id', '/api/debates/:id'));
  json(res, { ok: true });
});

post('/api/debates/export', (_req, res, body) => {
  // In web mode, return the formatted content for browser download
  const session = body as Record<string, unknown>;
  json(res, { content: JSON.stringify(session, null, 2), filename: `debate-${session.id || 'export'}.json` });
});

// ── Chat sessions ──

get('/api/chats', (_req, res) => { json(res, fileIO.listChatSessions()); });

get('/api/chats/:id', (req, res) => {
  try { json(res, fileIO.loadChatSession(param(req, 'id', '/api/chats/:id'))); }
  catch (err) { error(res, String(err), 404); }
});

put('/api/chats', (_req, res, body) => {
  try { fileIO.saveChatSession(body); json(res, { ok: true }); }
  catch (err) { error(res, String(err)); }
});

del('/api/chats/:id', (req, res) => {
  fileIO.deleteChatSession(param(req, 'id', '/api/chats/:id'));
  json(res, { ok: true });
});

// ── Harvest ──

post('/api/harvest/conflict', (_req, res, body) => {
  json(res, { created: fileIO.harvestCreateConflict(body as Record<string, unknown>) });
});

post('/api/harvest/debate-ref', (_req, res, body) => {
  const { nodeId, debateId } = body as { nodeId: string; debateId: string };
  json(res, { updated: fileIO.harvestAddDebateRef(nodeId, debateId) });
});

post('/api/harvest/steelman', (_req, res, body) => {
  const { nodeId, attackerPov, newText } = body as { nodeId: string; attackerPov: string; newText: string };
  json(res, { updated: fileIO.harvestUpdateSteelman(nodeId, attackerPov, newText) });
});

post('/api/harvest/verdict', (_req, res, body) => {
  const { conflictId, verdict } = body as { conflictId: string; verdict: Record<string, unknown> };
  json(res, { updated: fileIO.harvestAddVerdict(conflictId, verdict) });
});

post('/api/harvest/concept', (_req, res, body) => {
  json(res, { queued: fileIO.harvestQueueConcept(body as Record<string, unknown>) });
});

post('/api/harvest/manifest', (_req, res, body) => {
  json(res, { saved: fileIO.harvestSaveManifest(body as Record<string, unknown>) });
});

// ── Proposals ──

get('/api/proposals', (_req, res) => { json(res, fileIO.listProposals()); });

put('/api/proposals/:filename', (req, res, body) => {
  try {
    fileIO.saveProposal(param(req, 'filename', '/api/proposals/:filename'), body);
    json(res, { saved: true });
  } catch (err) { error(res, String(err)); }
});

// ── PowerShell prompts ──

get('/api/ps-prompts', (_req, res) => { json(res, fileIO.listPsPrompts()); });

get('/api/ps-prompts/:name', (req, res) => {
  json(res, fileIO.readPsPrompt(param(req, 'name', '/api/ps-prompts/:name')));
});

// ── URL content ──

post('/api/fetch-url', async (_req, res, body) => {
  const { url } = body as { url: string };
  json(res, await fileIO.fetchUrlContent(url));
});

// ── File upload (replaces pickDocumentFile dialog) ──

post('/api/upload-document', async (req, res) => {
  // Expects multipart form data or raw text body
  // For now, accept raw text with filename header
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const content = Buffer.concat(chunks).toString('utf-8');
  const filename = req.headers['x-filename'] as string || 'uploaded-document';
  json(res, { cancelled: false, filePath: filename, content });
});

// ── Focus node (inter-app communication) ──

post('/focus-node', (_req, res, body) => {
  const { nodeId } = body as { nodeId: string };
  // Broadcast to connected WebSocket clients
  broadcastEvent('focus-node', { nodeId });
  json(res, { ok: true });
});

// ── Trace channel (observability) ──
//
// Accepts batched trace events from the renderer and emits each as a single
// line of JSON on stdout. In the Azure Container Apps deployment, stdout is
// ingested by Log Analytics via appLogsConfiguration (see deploy/azure/main.bicep)
// which makes the events queryable with KQL:
//
//   ContainerAppConsoleLogs_CL
//   | where Log_s startswith "[trace]"
//   | extend ev = parse_json(substring(Log_s, 8))
//   | where ev.debate_id == "<debate-id>"
//
// See docs/debate-observability-proposal.md for the full rationale.
//
// Events are intentionally not validated beyond basic shape — the renderer
// owns the schema and we want to preserve unexpected fields for future use.
// The per-batch cap prevents accidental payload bombs.

const TRACE_MAX_EVENTS_PER_BATCH = 100;

post('/debug/events', (_req, res, body) => {
  try {
    const { events } = (body || {}) as { events?: unknown };
    if (!Array.isArray(events)) {
      error(res, 'events must be an array', 400);
      return;
    }
    const accepted = events.slice(0, TRACE_MAX_EVENTS_PER_BATCH);
    for (const ev of accepted) {
      // Single-line JSON so the log ingestion splits on newlines cleanly.
      console.log('[trace] ' + JSON.stringify(ev));
    }
    json(res, { received: accepted.length, dropped: Math.max(0, events.length - accepted.length) });
  } catch (err) {
    error(res, String(err));
  }
});

// ── Static file serving ──

const STATIC_DIR = path.resolve(__dirname, '../renderer');
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const url = new URL(req.url!, 'http://localhost');
  let filePath = path.join(STATIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);

  // Security: prevent directory traversal
  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return true;
  }

  if (!fs.existsSync(filePath)) {
    // SPA fallback: serve index.html for non-API routes
    if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/ws/') && !url.pathname.startsWith('/health')) {
      filePath = path.join(STATIC_DIR, 'index.html');
    } else {
      return false;
    }
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const content = fs.readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': contentType });
  res.end(content);
  return true;
}

// ── Request router ──

function matchRoute(method: string, pathname: string): { handler: Handler; routePath: string } | null {
  for (const route of routes) {
    if (route.method !== method) continue;
    const routeParts = route.path.split('/');
    const urlParts = pathname.split('/');
    if (routeParts.length !== urlParts.length) continue;
    let match = true;
    for (let i = 0; i < routeParts.length; i++) {
      if (routeParts[i].startsWith(':')) continue;
      if (routeParts[i] !== urlParts[i]) { match = false; break; }
    }
    if (match) return { handler: route.handler, routePath: route.path };
  }
  return null;
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf-8');
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch { return raw; }
}

// ── HTTP server ──

// Resolve allowed CORS origins from ALLOWED_ORIGINS env var (comma-separated).
// Falls back to '*' for local development.
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
  : null; // null = allow all (development mode)

function getCorsOrigin(req: http.IncomingMessage): string {
  if (!ALLOWED_ORIGINS) return '*';
  const origin = req.headers.origin || '';
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}

// User allowlist from ALLOWED_USERS env var (comma-separated GitHub usernames).
// Azure Easy Auth sends the authenticated username in X-MS-CLIENT-PRINCIPAL-NAME.
// When set, only listed users can access the app. Unset = no restriction.
const ALLOWED_USERS = process.env.ALLOWED_USERS
  ? new Set(process.env.ALLOWED_USERS.split(',').map(u => u.trim().toLowerCase()).filter(Boolean))
  : null;

const server = http.createServer(async (req, res) => {
  // CORS headers — locked to ALLOWED_ORIGINS in production, permissive in dev
  res.setHeader('Access-Control-Allow-Origin', getCorsOrigin(req));
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Filename');
  if (ALLOWED_ORIGINS) res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // User allowlist check — Azure Easy Auth sets X-MS-CLIENT-PRINCIPAL-NAME
  if (ALLOWED_USERS) {
    const principalName = (req.headers['x-ms-client-principal-name'] as string || '').toLowerCase();
    // Allow health check and static assets without auth (Easy Auth handles login redirect)
    const url_path = req.url?.split('?')[0] || '';
    const isPublicPath = url_path === '/health' || url_path === '/.auth/login/github/callback';
    if (!isPublicPath && principalName && !ALLOWED_USERS.has(principalName)) {
      res.writeHead(403, { 'Content-Type': 'text/html' });
      res.end(`<h1>Access Denied</h1><p>User <strong>${principalName}</strong> is not authorized. Contact the administrator.</p>`);
      return;
    }
  }

  const url = new URL(req.url!, 'http://localhost');
  const route = matchRoute(req.method!, url.pathname);

  if (route) {
    try {
      const body = ['POST', 'PUT'].includes(req.method!) ? await readBody(req) : {};
      await route.handler(req, res, body);
    } catch (err) {
      console.error(`[server] Error handling ${req.method} ${url.pathname}:`, err);
      error(res, String(err));
    }
    return;
  }

  // Static file serving (SPA)
  if (req.method === 'GET') {
    if (serveStatic(req, res)) return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

// ── WebSocket: Terminal ──

const wss = new WebSocketServer({ noServer: true });
const eventClients = new Set<WebSocket>();

function broadcastEvent(type: string, data: unknown) {
  const msg = JSON.stringify({ type, data });
  for (const ws of eventClients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url!, 'http://localhost');

  if (url.pathname === '/ws/terminal') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleTerminalConnection(ws);
    });
  } else if (url.pathname === '/ws/events') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      eventClients.add(ws);
      ws.on('close', () => eventClients.delete(ws));
    });
  } else {
    socket.destroy();
  }
});

// ── Terminal WebSocket handler ──

let terminalProcess: ChildProcess | null = null;

function handleTerminalConnection(ws: WebSocket) {
  if (terminalProcess) {
    ws.send(JSON.stringify({ type: 'error', data: 'Terminal already active' }));
    return;
  }

  const importCmd = `Import-Module '${path.join(SCRIPTS_DIR, 'AITriad', 'AITriad.psd1')}' -Force`;

  terminalProcess = spawn('python3', [BROKER_SCRIPT], {
    cwd: getProjectRoot(),
    env: { ...process.env, TERM: 'xterm-256color', PTY_COLS: '120', PTY_ROWS: '30' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  terminalProcess.stdout?.on('data', (data: Buffer) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'data', data: data.toString() }));
    }
  });

  terminalProcess.stderr?.on('data', (data: Buffer) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'data', data: data.toString() }));
    }
  });

  terminalProcess.on('exit', () => {
    terminalProcess = null;
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'exit' }));
    }
  });

  // Import AITriad module after shell startup
  setTimeout(() => {
    if (terminalProcess?.stdin) terminalProcess.stdin.write(importCmd + '\r');
  }, 500);

  ws.on('message', (msg) => {
    try {
      const parsed = JSON.parse(msg.toString());
      if (parsed.type === 'write' && terminalProcess?.stdin) {
        terminalProcess.stdin.write(parsed.data);
      } else if (parsed.type === 'resize' && terminalProcess?.stdin) {
        terminalProcess.stdin.write(`\x1b]R;${parsed.cols};${parsed.rows}\x07`);
      } else if (parsed.type === 'kill') {
        if (terminalProcess) { terminalProcess.kill(); terminalProcess = null; }
      }
    } catch { /* ignore malformed messages */ }
  });

  ws.on('close', () => {
    if (terminalProcess) { terminalProcess.kill(); terminalProcess = null; }
  });
}

// ── Graceful shutdown ──

let isShuttingDown = false;

function shutdown(signal: string) {
  if (isShuttingDown) return; // Prevent double-shutdown
  isShuttingDown = true;
  console.log(`[server] Received ${signal}, shutting down gracefully...`);

  // 1. Kill terminal PTY
  if (terminalProcess) {
    console.log('[server] Terminating PTY process');
    terminalProcess.kill();
    terminalProcess = null;
  }

  // 2. Close all WebSocket connections
  for (const ws of eventClients) {
    try { ws.close(1001, 'Server shutting down'); } catch { /* ignore */ }
  }
  eventClients.clear();

  // 3. Stop accepting new connections and wait for in-flight requests
  server.close(() => {
    console.log('[server] All connections closed. Exiting.');
    process.exit(0);
  });

  // 4. Force exit after 10s if graceful shutdown stalls
  setTimeout(() => {
    console.error('[server] Graceful shutdown timed out after 10s, forcing exit.');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ── Start ──

server.listen(PORT, () => {
  console.log(`[server] Taxonomy Editor running at http://localhost:${PORT}`);
  console.log(`[server] Data root: ${getDataRoot()}`);
});
