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
import { runWithUser } from './userContext';
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

get('/api/keys/has', async (req, res) => {
  const backend = (query(req, 'backend') || 'gemini') as AIBackend;
  json(res, await hasApiKey(backend));
});

post('/api/keys', async (_req, res, body) => {
  const { key, backend } = body as { key: string; backend?: string };
  await storeApiKey(key, (backend || 'gemini') as AIBackend);
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

// ── Summaries & Sources ──

get('/api/sources', (_req, res) => { json(res, fileIO.discoverSources()); });

get('/api/summaries/:docId', (req, res) => {
  const docId = param(req, 'docId', '/api/summaries/:docId');
  const data = fileIO.loadSummary(docId);
  if (data === null) { error(res, `Summary not found: ${docId}`, 404); return; }
  json(res, data);
});

get('/api/snapshots/:sourceId', (req, res) => {
  const sourceId = param(req, 'sourceId', '/api/snapshots/:sourceId');
  const data = fileIO.loadSnapshot(sourceId);
  if (data === null) { error(res, `Snapshot not found: ${sourceId}`, 404); return; }
  json(res, { content: data });
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

// ── Auth: file-based user allowlist ──
// Reads authorized-users.json from the data volume (or repo root as fallback).
// Azure Easy Auth sets X-MS-CLIENT-PRINCIPAL-NAME and X-MS-CLIENT-PRINCIPAL-IDP
// after successful login. We match against emails, GitHub username, or display name.

interface AuthorizedUser {
  name: string;
  emails?: string[];
  github?: string;
}

interface AuthorizedUsersFile {
  users: AuthorizedUser[];
}

function loadAuthorizedUsers(): AuthorizedUsersFile | null {
  // Try data volume first (editable at runtime), then repo-bundled fallback
  const candidates = [
    path.join(getDataRoot(), 'authorized-users.json'),
    path.resolve(__dirname, '../../authorized-users.json'), // Docker: /app/dist/server -> /app/
    path.resolve(__dirname, '../authorized-users.json'),     // dev fallback
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, 'utf-8')) as AuthorizedUsersFile;
        console.log(`[auth] Loaded ${data.users.length} authorized users from ${p}`);
        return data;
      }
    } catch (err) {
      console.error(`[auth] Failed to parse ${p}:`, err);
    }
  }
  return null; // No file found = no restriction
}

let authorizedUsersCache: AuthorizedUsersFile | null | undefined;
let authorizedUsersCacheTime = 0;
const AUTH_CACHE_TTL = 30_000; // Re-read file every 30s

function getAuthorizedUsers(): AuthorizedUsersFile | null {
  const now = Date.now();
  if (authorizedUsersCache === undefined || now - authorizedUsersCacheTime > AUTH_CACHE_TTL) {
    authorizedUsersCache = loadAuthorizedUsers();
    authorizedUsersCacheTime = now;
  }
  return authorizedUsersCache;
}

function isUserAuthorized(principalName: string, idp: string): boolean {
  const auth = getAuthorizedUsers();
  if (!auth) return true; // No file = allow all

  // Opt-in: accept any signed-in user, bypass the allowlist. Sign-in is still
  // required because getAuthorizedUsers() returns non-null, so the gate at the
  // top of the request handler still redirects unauthenticated requests.
  if (process.env.AUTH_ALLOW_ALL_SIGNED_IN === '1') return true;

  const name = principalName.toLowerCase();
  for (const user of auth.users) {
    // Match GitHub username
    if (idp === 'github' && user.github && user.github.toLowerCase() === name) return true;
    // Match email (Google, Microsoft, or any provider)
    if (user.emails?.some(e => e.toLowerCase() === name)) return true;
    // Match display name as last resort
    if (user.name.toLowerCase() === name) return true;
  }
  return false;
}

const LOGIN_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign In — Taxonomy Editor</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #0f172a; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  .card { background: #1e293b; border-radius: 12px; padding: 40px; max-width: 400px; width: 90%; text-align: center; }
  h1 { font-size: 1.5rem; margin-bottom: 8px; }
  .subtitle { color: #94a3b8; font-size: 0.875rem; margin-bottom: 32px; }
  .btn { display: flex; align-items: center; justify-content: center; gap: 12px;
         width: 100%; padding: 12px 16px; margin-bottom: 12px; border: 1px solid #334155;
         border-radius: 8px; background: #0f172a; color: #e2e8f0; font-size: 0.95rem;
         text-decoration: none; transition: background 0.15s, border-color 0.15s; cursor: pointer; }
  .btn:hover { background: #1e293b; border-color: #60a5fa; }
  .btn svg { width: 20px; height: 20px; flex-shrink: 0; }
  .btn-github:hover { border-color: #e2e8f0; }
  .btn-google:hover { border-color: #34d399; }
  .btn-microsoft:hover { border-color: #60a5fa; }
</style>
</head>
<body>
<div class="card">
  <h1>Taxonomy Editor</h1>
  <p class="subtitle">Sign in to continue</p>
  <a class="btn btn-github" href="/.auth/login/github?post_login_redirect_uri=/">
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
    Sign in with GitHub
  </a>
  <a class="btn btn-google" href="/.auth/login/google?post_login_redirect_uri=/">
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
    Sign in with Google
  </a>
  <a class="btn btn-microsoft" href="/.auth/login/aad?post_login_redirect_uri=/">
    <svg viewBox="0 0 24 24" fill="currentColor"><rect x="1" y="1" width="10" height="10" fill="#F25022"/><rect x="13" y="1" width="10" height="10" fill="#7FBA00"/><rect x="1" y="13" width="10" height="10" fill="#00A4EF"/><rect x="13" y="13" width="10" height="10" fill="#FFB900"/></svg>
    Sign in with Microsoft
  </a>
</div>
</body>
</html>`;

const FORBIDDEN_PAGE = (name: string) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Access Denied — Taxonomy Editor</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #0f172a; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  .card { background: #1e293b; border-radius: 12px; padding: 40px; max-width: 400px; width: 90%; text-align: center; }
  h1 { font-size: 1.5rem; color: #ef4444; margin-bottom: 12px; }
  p { color: #94a3b8; margin-bottom: 8px; font-size: 0.9rem; }
  .user { color: #f59e0b; font-weight: 600; }
  .btn { display: inline-block; margin-top: 20px; padding: 10px 24px; border-radius: 8px;
         background: #334155; color: #e2e8f0; text-decoration: none; font-size: 0.9rem; }
  .btn:hover { background: #475569; }
</style>
</head>
<body>
<div class="card">
  <h1>Access Denied</h1>
  <p>Signed in as <span class="user">${name}</span></p>
  <p>You are not in the authorized users list. Contact the administrator to request access.</p>
  <a class="btn" href="/.auth/logout?post_logout_redirect_uri=/">Sign out</a>
</div>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  // CORS headers — locked to ALLOWED_ORIGINS in production, permissive in dev
  res.setHeader('Access-Control-Allow-Origin', getCorsOrigin(req));
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Filename');
  if (ALLOWED_ORIGINS) res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Extract Easy Auth headers up front so the per-request user context is
  // available to deep call sites (keyStore, AI backends) via AsyncLocalStorage.
  const principalName = (req.headers['x-ms-client-principal-name'] as string) || '';
  const idp = (req.headers['x-ms-client-principal-idp'] as string) || '';

  // Auth gate — only enforced when authorized-users.json exists
  const urlPath = req.url?.split('?')[0] || '';
  // /api/models is public: lets the pre-auth renderer populate the model
  // catalog from ai-models.json. Contains no secrets — just labels + ids.
  const isPublicPath = urlPath === '/health' || urlPath === '/api/models' || urlPath.startsWith('/.auth/');
  // Emergency kill-switch: disables the entire auth gate (no sign-in required).
  // Use only for temporary recovery when the allowlist is misconfigured.
  const authDisabled = process.env.AUTH_DISABLED === '1';
  if (!isPublicPath && !authDisabled && getAuthorizedUsers()) {
    if (!principalName) {
      // Not authenticated — serve login picker
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(LOGIN_PAGE);
      return;
    }

    if (!isUserAuthorized(principalName, idp)) {
      // Authenticated but not in allowlist
      res.writeHead(403, { 'Content-Type': 'text/html' });
      res.end(FORBIDDEN_PAGE(principalName));
      return;
    }
  }

  // Run the remainder of request handling inside a user context so that
  // getCurrentUserId() inside getApiKey()/storeApiKey() sees the caller.
  // Unauthenticated paths (local dev, kill-switch, public endpoints) fall
  // back to '_local' — which keyStore ignores in local-file mode.
  const userCtx = { principalName: principalName || '_local', idp: idp || '_local' };
  await runWithUser(userCtx, async () => {
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
