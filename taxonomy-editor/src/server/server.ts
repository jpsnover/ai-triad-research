// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Web server for the Taxonomy Editor.
 * Serves the React SPA and provides REST + WebSocket APIs that mirror
 * the Electron IPC bridge (window.electronAPI).
 */

import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawn, execFile, ChildProcess } from 'child_process';
import { WebSocketServer, WebSocket } from 'ws';
import {
  PORT, getDataRoot, getApiKey, hasApiKey, storeApiKey, resolveDataPath,
  BROKER_SCRIPT, SCRIPTS_DIR, getProjectRoot, type AIBackend,
  STORAGE_MODE, CACHE_DIR,
} from './config';
import { GitHubAPIBackend } from './githubAPIBackend';
import { SessionBranchManager } from './sessionBranchManager';
import { runWithUser, getCurrentUserId, setSessionBranchName } from './userContext';
import * as fileIO from './fileIO';
import * as ai from './aiBackends';
import { setRuntimeCredentials, clearRuntimeCredentials, getCredentials } from './githubAppAuth';
import * as proxyTiers from './proxyTiers';
import * as rateLimiter from './rateLimiter';
import * as analytics from './analytics';
import { FlightRecorder } from '../../../lib/flight-recorder/flightRecorder';

// ── Server-side flight recorder ──
const serverRecorder = new FlightRecorder({ capacity: 2000, dumpOnError: false });
serverRecorder.intern('component', 'server');
serverRecorder.intern('component', 'git');
serverRecorder.intern('component', 'data-pull');
serverRecorder.intern('component', 'copy-status');
serverRecorder.intern('component', 'auth');
serverRecorder.intern('component', 'github-api');
serverRecorder.intern('component', 'cache');
serverRecorder.intern('component', 'session');
serverRecorder.intern('component', 'storage');

serverRecorder.setContextProvider(() => {
  const ctx: Record<string, unknown> = {
    server: {
      version: SERVER_VERSION,
      started_at: SERVER_START_TIME,
      uptime_s: Math.round(process.uptime()),
      node_version: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    memory: {
      rss_mb: Math.round(process.memoryUsage().rss / 1048576),
      heap_used_mb: Math.round(process.memoryUsage().heapUsed / 1048576),
      heap_total_mb: Math.round(process.memoryUsage().heapTotal / 1048576),
    },
    data: {
      data_root: getDataRoot(),
    },
    environment: {
      deploy_tag: process.env.DEPLOY_TAG ?? null,
      auth_disabled: process.env.AUTH_DISABLED ?? null,
      storage_mode: STORAGE_MODE,
    },
  };

  // Add GitHub API state when in API mode (githubBackend populated after startup)
  if (githubBackend) {
    ctx.storage = {
      mode: STORAGE_MODE,
      cache_generation: githubBackend.getCacheGeneration(),
      cache_file_count: githubBackend.getCachedFileCount(),
      cache_hit_rate: githubBackend.getCacheHitRate(),
      main_sha: githubBackend.getMainSha(),
      last_poll_age_s: githubBackend.getLastPollAge(),
    };
    ctx.github = {
      rate_limit_remaining: githubBackend.getRateLimitRemaining(),
      rate_limit_resets_at: githubBackend.getRateLimitResetsAt(),
      circuit_state: githubBackend.getCircuitState(),
      active_branches: githubBackend.getActiveBranchCount(),
    };
  }

  return ctx;
});

export { serverRecorder };

// ── Storage backend selection ──

let githubBackend: GitHubAPIBackend | null = null;
let sessionManager: SessionBranchManager | null = null;

if (STORAGE_MODE === 'github-api') {
  githubBackend = new GitHubAPIBackend({
    cacheDir: CACHE_DIR,
    recorder: serverRecorder,
  });
  sessionManager = new SessionBranchManager(githubBackend, serverRecorder);
  fileIO.setBackend(githubBackend);
  serverRecorder.record({
    type: 'storage.mode', component: 'storage', level: 'info',
    message: `Storage mode: github-api (cache: ${CACHE_DIR})`,
    data: { mode: 'github-api', cacheDir: CACHE_DIR },
  });
} else {
  // FilesystemBackend is the default in fileIO.ts — no action needed
  serverRecorder.record({
    type: 'storage.mode', component: 'storage', level: 'info',
    message: `Storage mode: filesystem (data root: ${getDataRoot()})`,
    data: { mode: 'filesystem', dataRoot: getDataRoot() },
  });
}

console.log(`[server] Storage mode: ${STORAGE_MODE}`);

/**
 * Ensure a session branch exists before any write operation.
 * In API mode, writes cannot target main directly (branch protection).
 * This lazily creates `api-session/{userId}` from main HEAD on first edit
 * and updates the ALS context so GitHubAPIBackend.getEffectiveRef() sees the branch.
 */
async function ensureSessionBranch(): Promise<void> {
  if (!githubBackend || !sessionManager) return; // filesystem mode — no-op
  const userId = getCurrentUserId();
  const branchName = await sessionManager.ensureBranch(userId);
  setSessionBranchName(branchName);
}

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

const SERVER_VERSION = (() => {
  const candidates = [
    path.resolve(__dirname, '../package.json'),
    path.resolve(__dirname, '../../package.json'),
    '/app/package.json',
  ];
  for (const p of candidates) {
    try {
      const pkg = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (pkg.version) return pkg.version as string;
    } catch { /* try next */ }
  }
  return '0.0.0';
})();

const SERVER_START_TIME = new Date().toISOString();

get('/third-party-notices', (_req, res) => {
  const noticesPath = path.join(getProjectRoot(), 'taxonomy-editor', 'THIRD-PARTY-NOTICES.txt');
  try {
    const content = fs.readFileSync(noticesPath, 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('License notices file not found. Run npm run licenses to generate.');
  }
});

get('/healthz', async (_req, res) => {
  const dataAvailable = await fileIO.isDataAvailable();
  if (dataAvailable) {
    json(res, { status: 'healthy', dataRoot: fileIO.getDataRootPath() });
  } else {
    json(res, { status: 'unhealthy', reason: 'taxonomy data not found', dataRoot: fileIO.getDataRootPath() }, 503);
  }
});

get('/health', (_req, res) => {
  const base: Record<string, unknown> = {
    status: 'ok',
    version: SERVER_VERSION,
    startedAt: SERVER_START_TIME,
    uptime: Math.round(process.uptime()),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    dataRoot: getDataRoot(),
    memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    flightRecorder: {
      eventsTotal: serverRecorder.buffer.count,
      eventsRetained: serverRecorder.buffer.retained,
      capacity: serverRecorder.buffer.capacity,
    },
    storage: {
      mode: STORAGE_MODE,
    },
  };

  if (githubBackend) {
    (base.storage as Record<string, unknown>).mainSha = githubBackend.getMainSha();
    (base.storage as Record<string, unknown>).cacheFileCount = githubBackend.getCachedFileCount();
    (base.storage as Record<string, unknown>).cacheGeneration = githubBackend.getCacheGeneration();
    (base.storage as Record<string, unknown>).fallbackActive = githubBackend.getCircuitState() === 'open';

    base.github = {
      rateLimit: {
        remaining: githubBackend.getRateLimitRemaining(),
        resetsAt: githubBackend.getRateLimitResetsAt(),
      },
      cacheHitRate: githubBackend.getCacheHitRate(),
      circuitState: githubBackend.getCircuitState(),
      coherencyViolations: githubBackend.getCoherencyViolations(),
      activeBranches: githubBackend.getActiveBranchCount(),
      lastPollAgeS: githubBackend.getLastPollAge(),
    };
  }

  json(res, base);
});

// ── Taxonomy directories ──

get('/api/taxonomy-dirs', async (_req, res) => {
  json(res, await fileIO.getTaxonomyDirs());
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

get('/api/taxonomy/:pov', async (req, res) => {
  try {
    const pov = param(req, 'pov', '/api/taxonomy/:pov');
    json(res, await fileIO.readTaxonomyFile(pov));
  } catch (err) { error(res, String(err)); }
});

put('/api/taxonomy/:pov', async (req, res, body) => {
  try {
    await ensureSessionBranch();
    const pov = param(req, 'pov', '/api/taxonomy/:pov');
    await fileIO.writeTaxonomyFile(pov, body);
    json(res, { ok: true });
  } catch (err) { error(res, String(err)); }
});

// ── Conflicts ──

get('/api/conflicts', async (_req, res) => {
  json(res, await fileIO.readAllConflictFiles());
});

get('/api/conflicts/clusters', async (_req, res) => {
  json(res, await fileIO.readConflictClusters());
});

// ── Cruxes ──

get('/api/cruxes', async (_req, res) => {
  json(res, await fileIO.readAggregatedCruxes());
});

put('/api/conflicts/:id', async (req, res, body) => {
  try {
    await ensureSessionBranch();
    const id = param(req, 'id', '/api/conflicts/:id');
    await fileIO.writeConflictFile(id, body);
    json(res, { ok: true });
  } catch (err) { error(res, String(err)); }
});

post('/api/conflicts/:id', async (req, res, body) => {
  try {
    await ensureSessionBranch();
    const id = param(req, 'id', '/api/conflicts/:id');
    await fileIO.createConflictFile(id, body);
    json(res, { ok: true });
  } catch (err) { error(res, String(err)); }
});

del('/api/conflicts/:id', async (req, res) => {
  try {
    await ensureSessionBranch();
    const id = param(req, 'id', '/api/conflicts/:id');
    await fileIO.deleteConflictFile(id);
    json(res, { ok: true });
  } catch (err) { error(res, String(err)); }
});

// ── Policy registry ──

get('/api/policy-registry', async (_req, res) => {
  json(res, await fileIO.readPolicyRegistry());
});

// ── Edges ──

let edgesCache: unknown = null;

get('/api/edges', async (_req, res) => {
  edgesCache = await fileIO.readEdgesFile();
  json(res, edgesCache);
});

put('/api/edges/status', async (_req, res, body) => {
  const { index, status: s } = body as { index: number; status: string };
  if (!edgesCache) edgesCache = await fileIO.readEdgesFile();
  edgesCache = await fileIO.updateEdgeStatus(edgesCache, index, s);
  json(res, edgesCache);
});

put('/api/edges/swap', async (_req, res, body) => {
  const { index } = body as { index: number };
  if (!edgesCache) edgesCache = await fileIO.readEdgesFile();
  edgesCache = await fileIO.swapEdgeDirection(edgesCache, index);
  json(res, edgesCache);
});

put('/api/edges/bulk-status', async (_req, res, body) => {
  const { indices, status: s } = body as { indices: number[]; status: string };
  if (!edgesCache) edgesCache = await fileIO.readEdgesFile();
  edgesCache = await fileIO.bulkUpdateEdges(edgesCache, indices, s);
  json(res, edgesCache);
});

// ── Source indexes ──

get('/api/node-source-index', async (_req, res) => {
  json(res, await fileIO.buildNodeSourceIndex());
});

get('/api/policy-source-index', async (_req, res) => {
  json(res, await fileIO.buildPolicySourceIndex());
});

// ── Data management ──

get('/api/data/available', async (_req, res) => {
  json(res, await fileIO.isDataAvailable());
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
    // Clone to temp dir first, then copy contents — avoids permission issues
    // when targetPath is root-owned (e.g. /data in Azure containers).
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'data-clone-'));
    await new Promise<void>((resolve, reject) => {
      execFile('git', ['clone', 'https://github.com/jpsnover/ai-triad-data.git', tmpDir], { timeout: 300_000 }, (err) => {
        if (err) reject(err); else resolve();
      });
    });
    const entries = fs.readdirSync(tmpDir).filter(f => f !== '.git');
    fs.mkdirSync(targetPath, { recursive: true });
    await new Promise<void>((resolve, reject) => {
      execFile('cp', ['-a', ...entries.map(f => path.join(tmpDir, f)), targetPath], (err) => {
        if (err) reject(err); else resolve();
      });
    });
    fs.rmSync(tmpDir, { recursive: true, force: true });
    json(res, { success: true, message: 'Data repository cloned successfully.' });
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
  // Stream heartbeats to prevent Azure Container Apps' Envoy proxy from
  // returning 504 "stream timeout" during long-running git operations.
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });

  const heartbeat = setInterval(() => { res.write('\n'); }, 15_000);
  const progress = (msg: string) => { res.write(`progress: ${msg}\n`); };
  const pullStart = Date.now();

  try {
    const dataRoot = getDataRoot();
    const runGit = (args: string[], timeoutMs = 120_000): Promise<string> => new Promise((resolve, reject) => {
      execFile('git', args, { cwd: dataRoot, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          console.error(`[data-pull] git ${args.join(' ')} failed:`, err.message, stderr);
          reject(new Error(`git ${args[0]}: ${err.message}${stderr ? ' — ' + stderr.trim() : ''}`));
        } else {
          if (stderr) console.log(`[data-pull] git ${args[0]} stderr:`, stderr.trim());
          resolve(stdout.trim());
        }
      });
    });

    serverRecorder.record({ type: 'lifecycle', component: 'data-pull', level: 'info', message: 'pull.start', data: { dataRoot } });
    console.log('[data-pull] Starting pull in', dataRoot);
    progress('Starting data update...');

    // Fix: Strip stale tokens from origin URL to avoid 401 on expired GitHub App tokens.
    // Public repos work fine with plain HTTPS; embedded tokens cause auth failures when expired.
    let remoteUrl = await runGit(['remote', 'get-url', 'origin']);
    console.log('[data-pull] Remote URL:', remoteUrl.replace(/:\/\/[^@]+@/, '://<redacted>@'));

    if (remoteUrl.includes('x-access-token:')) {
      const cleanUrl = remoteUrl.replace(/:\/\/x-access-token:[^@]+@/, '://');
      console.log('[data-pull] Stripping stale token from origin URL');
      await runGit(['remote', 'set-url', 'origin', cleanUrl]);
      remoteUrl = cleanUrl;
    }

    // If remote is SSH, convert to HTTPS for public repo access without keys
    if (remoteUrl.startsWith('git@github.com:')) {
      const httpsUrl = remoteUrl.replace('git@github.com:', 'https://github.com/').replace(/\.git$/, '.git');
      console.log('[data-pull] Converting SSH remote to HTTPS:', httpsUrl);
      await runGit(['remote', 'set-url', 'origin', httpsUrl]);
    }

    // Ensure we're on main before resetting — avoid clobbering a session branch
    const currentBranch = await runGit(['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => 'unknown');
    if (currentBranch !== 'main') {
      console.log(`[data-pull] On branch '${currentBranch}', switching to main first`);
      await runGit(['checkout', 'main']);
    }

    // Discard any local changes — web deployment treats data as read-only
    await runGit(['checkout', '--', '.']).catch(() => { /* no tracked changes */ });
    await runGit(['clean', '-fd']).catch(() => { /* no untracked files */ });

    progress('Fetching updates from GitHub...');
    serverRecorder.record({ type: 'lifecycle', component: 'data-pull', level: 'info', message: 'pull.fetch_start' });
    console.log('[data-pull] Fetching origin...');
    const fetchStart = Date.now();
    await runGit(['fetch', 'origin'], 600_000);
    serverRecorder.record({ type: 'lifecycle', component: 'data-pull', level: 'info', message: 'pull.fetch_ok', duration_ms: Date.now() - fetchStart });

    progress('Applying updates...');
    serverRecorder.record({ type: 'lifecycle', component: 'data-pull', level: 'info', message: 'pull.reset_start' });
    console.log('[data-pull] Resetting to origin/main...');
    const resetStart = Date.now();
    await runGit(['reset', '--hard', 'origin/main'], 600_000);
    serverRecorder.record({ type: 'lifecycle', component: 'data-pull', level: 'info', message: 'pull.reset_ok', duration_ms: Date.now() - resetStart });

    console.log('[data-pull] Success');
    serverRecorder.record({ type: 'lifecycle', component: 'data-pull', level: 'info', message: 'pull.ok', duration_ms: Date.now() - pullStart });
    res.write(JSON.stringify({ success: true, message: 'Data updated.' }) + '\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[data-pull] FAILED:', msg);
    serverRecorder.record({ type: 'system.error', component: 'data-pull', level: 'error', message: 'pull.failed', error: { name: 'Error', message: msg }, duration_ms: Date.now() - pullStart });
    res.write(JSON.stringify({ success: false, message: msg }) + '\n');
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

// ── AI models & keys ──

get('/api/models', async (_req, res) => {
  json(res, await fileIO.loadAIModels());
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

post('/api/ai/generate', async (req, res, body) => {
  const { prompt, model, timeout, apiKey: clientKey } = body as { prompt: string; model?: string; timeout?: number; apiKey?: string };
  try {
    const principalName = (req.headers['x-ms-client-principal-name'] as string) || '';
    const idp = (req.headers['x-ms-client-principal-idp'] as string) || '';
    const tier = proxyTiers.resolveTier(principalName, idp);
    const userId = principalName || '_anonymous';

    // Check backend is allowed
    const backend = ai.resolveBackend(model || 'gemini-3.1-flash-lite-preview');
    if (!tier.allowedBackends.includes(backend)) {
      res.writeHead(403); res.end(JSON.stringify({ error: `Backend '${backend}' not available on your tier` })); return;
    }

    // Rate limiting
    const rpmCheck = rateLimiter.checkRequestRate(userId, tier.limits.requestsPerMinute);
    if (!rpmCheck.allowed) {
      res.writeHead(429); res.end(JSON.stringify({ error: 'Rate limit exceeded', limitType: 'requests_per_minute', retryAfterMs: rpmCheck.retryAfterMs, limit: rpmCheck.limit, current: rpmCheck.current })); return;
    }
    const tokenCheck = rateLimiter.checkTokenLimit(userId, tier.limits.tokensPerDay);
    if (!tokenCheck.allowed) {
      res.writeHead(429); res.end(JSON.stringify({ error: 'Daily token limit exceeded', limitType: 'tokens_per_day', limit: tokenCheck.limit, current: tokenCheck.current })); return;
    }

    // Key injection: platform users get server-side keys, BYOK users provide their own
    const explicitKey = tier.level === 'platform' ? undefined : (clientKey || undefined);
    const result = await ai.generateText(prompt, model, undefined, timeout, explicitKey);

    if (result.tokenUsage) {
      rateLimiter.recordTokenUsage(userId, result.tokenUsage.inputTokens, result.tokenUsage.outputTokens);
    }

    json(res, { text: result.text, tokenUsage: result.tokenUsage });
  } catch (err) { error(res, String(err)); }
});

post('/api/ai/search', async (_req, res, body) => {
  const { prompt, model } = body as { prompt: string; model?: string };
  try {
    json(res, await ai.generateTextWithSearch(prompt, model));
  } catch (err) { error(res, String(err)); }
});

// ── Proxy info endpoints ──

get('/api/proxy/tier', (req, res) => {
  const principalName = (req.headers['x-ms-client-principal-name'] as string) || '';
  const idp = (req.headers['x-ms-client-principal-idp'] as string) || '';
  const tier = proxyTiers.resolveTier(principalName, idp);
  json(res, { ...tier, principalName: principalName || null });
});

get('/api/proxy/usage', (req, res) => {
  const principalName = (req.headers['x-ms-client-principal-name'] as string) || '';
  const idp = (req.headers['x-ms-client-principal-idp'] as string) || '';
  const userId = principalName || '_anonymous';
  const tier = proxyTiers.resolveTier(principalName, idp);
  const usage = rateLimiter.getUsage(userId);
  json(res, { tier: tier.level, limits: tier.limits, usage });
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

get('/api/debates', async (_req, res) => { json(res, await fileIO.listDebateSessions()); });

// ── Calibration parameter history ──
get('/api/calibration/history', (_req, res) => {
  try {
    const { readParameterHistory, captureSnapshot } = require('../../../lib/debate/calibrationLogger');
    const history = readParameterHistory(getDataRoot());
    const current = captureSnapshot();
    json(res, { current, history });
  } catch (err) { error(res, String(err)); }
});

// ── Flight recorder dump ──
post('/api/flight-recorder/dump', (_req, res, body) => {
  try {
    const { ndjson } = body as { ndjson: string };
    if (!ndjson || typeof ndjson !== 'string') { error(res, 'Missing ndjson field', 400); return; }

    const dumpDir = path.join(getDataRoot(), 'flight-recorder');
    fs.mkdirSync(dumpDir, { recursive: true });

    const ts = new Date().toISOString().replace(/:/g, '-');
    const filePath = path.join(dumpDir, `flight-recorder-${ts}.jsonl`);
    fs.writeFileSync(filePath, ndjson, 'utf-8');

    // Retention: keep last 20 files, max 50 MB
    try {
      const files = fs.readdirSync(dumpDir)
        .filter(f => f.startsWith('flight-recorder-') && f.endsWith('.jsonl'))
        .map(f => {
          const fp = path.join(dumpDir, f);
          const stat = fs.statSync(fp);
          return { name: f, path: fp, mtime: stat.mtimeMs, size: stat.size };
        })
        .sort((a, b) => b.mtime - a.mtime);
      for (const f of files.slice(20)) fs.unlinkSync(f.path);
      const remaining = files.slice(0, 20);
      let totalSize = remaining.reduce((s, f) => s + f.size, 0);
      for (let i = remaining.length - 1; i >= 0 && totalSize > 50 * 1024 * 1024; i--) {
        fs.unlinkSync(remaining[i].path);
        totalSize -= remaining[i].size;
      }
    } catch { /* retention cleanup is best-effort */ }

    const filename = path.basename(filePath);
    console.log(`[flight-recorder] Dump written: ${filePath}`);
    json(res, { filePath, filename });
  } catch (err) { error(res, String(err)); }
});

// Server-side flight recorder dump
post('/api/flight-recorder/server-dump', (_req, res) => {
  try {
    const { ndjson } = serverRecorder.buildDump('manual');
    const dumpDir = path.join(getDataRoot(), 'flight-recorder');
    fs.mkdirSync(dumpDir, { recursive: true });
    const ts = new Date().toISOString().replace(/:/g, '-');
    const filename = `server-flight-recorder-${ts}.jsonl`;
    const filePath = path.join(dumpDir, filename);
    fs.writeFileSync(filePath, ndjson, 'utf-8');
    console.log(`[flight-recorder] Server dump written: ${filePath}`);
    json(res, { filePath, filename });
  } catch (err) { error(res, String(err)); }
});

get('/api/flight-recorder/download/:filename', (req, res) => {
  try {
    const filename = decodeURIComponent(param(req, 'filename', '/api/flight-recorder/download/:filename'));
    // Sanitize: allow flight-recorder-*.jsonl and server-flight-recorder-*.jsonl
    if (!/^(server-)?flight-recorder-.+\.jsonl$/.test(filename)) {
      error(res, 'Invalid filename', 400);
      return;
    }
    const dumpDir = path.join(getDataRoot(), 'flight-recorder');
    const filePath = path.join(dumpDir, filename);
    if (!fs.existsSync(filePath)) { error(res, 'File not found', 404); return; }
    const content = fs.readFileSync(filePath, 'utf-8');
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.end(content);
  } catch (err) { error(res, String(err)); }
});

get('/api/debates/:id', async (req, res) => {
  try { json(res, await fileIO.loadDebateSession(param(req, 'id', '/api/debates/:id'))); }
  catch (err) { error(res, String(err), 404); }
});

put('/api/debates', async (_req, res, body) => {
  try {
    await ensureSessionBranch();
    await fileIO.saveDebateSession(body);

    // Log calibration data if debate has synthesis (completed debate)
    try {
      const session = body as { id?: string; transcript?: { type: string }[]; neutral_evaluations?: unknown[] };
      if (session?.transcript?.some(e => e.type === 'concluding')) {
        const { extractCalibrationData, appendCalibrationLog } = require('../../../lib/debate/calibrationLogger');
        const dataPoint = extractCalibrationData(session, 'azure' as const);
        appendCalibrationLog(dataPoint, getDataRoot());
      }
    } catch { /* calibration logging never blocks save */ }

    json(res, { ok: true });
  }
  catch (err) { error(res, String(err)); }
});

del('/api/debates/:id', async (req, res) => {
  try {
    await ensureSessionBranch();
    await fileIO.deleteDebateSession(param(req, 'id', '/api/debates/:id'));
    json(res, { ok: true });
  } catch (err) { error(res, String(err)); }
});

get('/api/debates/:id/comments', async (req, res) => {
  try { json(res, await fileIO.loadDebateComments(param(req, 'id', '/api/debates/:id/comments'))); }
  catch (err) { error(res, String(err), 404); }
});

put('/api/debates/:id/comments', async (req, res, body) => {
  try {
    await ensureSessionBranch();
    const debateId = param(req, 'id', '/api/debates/:id/comments');
    await fileIO.saveDebateComments(debateId, body);
    json(res, { ok: true });
  } catch (err) { error(res, String(err)); }
});

post('/api/debates/export', (_req, res, body) => {
  // In web mode, return the formatted content for browser download
  const session = body as Record<string, unknown>;
  json(res, { content: JSON.stringify(session, null, 2), filename: `debate-${session.id || 'export'}.json` });
});

// ── Chat sessions ──

get('/api/chats', async (_req, res) => { json(res, await fileIO.listChatSessions()); });

get('/api/chats/:id', async (req, res) => {
  try { json(res, await fileIO.loadChatSession(param(req, 'id', '/api/chats/:id'))); }
  catch (err) { error(res, String(err), 404); }
});

put('/api/chats', async (_req, res, body) => {
  try { await ensureSessionBranch(); await fileIO.saveChatSession(body); json(res, { ok: true }); }
  catch (err) { error(res, String(err)); }
});

del('/api/chats/:id', async (req, res) => {
  try {
    await ensureSessionBranch();
    await fileIO.deleteChatSession(param(req, 'id', '/api/chats/:id'));
    json(res, { ok: true });
  } catch (err) { error(res, String(err)); }
});

// ── Harvest ──

post('/api/harvest/conflict', async (_req, res, body) => {
  try {
    await ensureSessionBranch();
    json(res, { created: await fileIO.harvestCreateConflict(body as Record<string, unknown>) });
  } catch (err) { error(res, String(err)); }
});

post('/api/harvest/debate-ref', async (_req, res, body) => {
  try {
    await ensureSessionBranch();
    const { nodeId, debateId } = body as { nodeId: string; debateId: string };
    json(res, { updated: await fileIO.harvestAddDebateRef(nodeId, debateId) });
  } catch (err) { error(res, String(err)); }
});

post('/api/harvest/steelman', async (_req, res, body) => {
  try {
    await ensureSessionBranch();
    const { nodeId, attackerPov, newText } = body as { nodeId: string; attackerPov: string; newText: string };
    json(res, { updated: await fileIO.harvestUpdateSteelman(nodeId, attackerPov, newText) });
  } catch (err) { error(res, String(err)); }
});

post('/api/harvest/verdict', async (_req, res, body) => {
  const { conflictId, verdict } = body as { conflictId: string; verdict: Record<string, unknown> };
  json(res, { updated: await fileIO.harvestAddVerdict(conflictId, verdict) });
});

post('/api/harvest/concept', async (_req, res, body) => {
  json(res, { queued: await fileIO.harvestQueueConcept(body as Record<string, unknown>) });
});

post('/api/harvest/manifest', async (_req, res, body) => {
  json(res, { saved: await fileIO.harvestSaveManifest(body as Record<string, unknown>) });
});

// ── Summaries & Sources ──

get('/api/sources', async (_req, res) => {
  if (STORAGE_MODE === 'github-api') {
    json(res, { available: false, message: 'Source documents are available in the desktop app only' });
    return;
  }
  json(res, await fileIO.discoverSources());
});

get('/api/summaries/:docId', async (req, res) => {
  const docId = param(req, 'docId', '/api/summaries/:docId');
  const data = await fileIO.loadSummary(docId);
  if (data === null) { error(res, `Summary not found: ${docId}`, 404); return; }
  json(res, data);
});

get('/api/snapshots/:sourceId', async (req, res) => {
  if (STORAGE_MODE === 'github-api') {
    error(res, 'Snapshots available in desktop app only', 404);
    return;
  }
  const sourceId = param(req, 'sourceId', '/api/snapshots/:sourceId');
  const data = await fileIO.loadSnapshot(sourceId);
  if (data === null) { error(res, `Snapshot not found: ${sourceId}`, 404); return; }
  json(res, { content: data });
});

// ── Proposals ──

get('/api/proposals', async (_req, res) => { json(res, await fileIO.listProposals()); });

put('/api/proposals/:filename', async (req, res, body) => {
  try {
    await fileIO.saveProposal(param(req, 'filename', '/api/proposals/:filename'), body);
    json(res, { saved: true });
  } catch (err) { error(res, String(err)); }
});

// ── PowerShell prompts ──

get('/api/ps-prompts', async (_req, res) => { json(res, await fileIO.listPsPrompts()); });

get('/api/ps-prompts/:name', async (req, res) => {
  json(res, await fileIO.readPsPrompt(param(req, 'name', '/api/ps-prompts/:name')));
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

// ── Git sync ──

post('/api/sync/credentials', async (_req, res, body) => {
  try {
    const data = body as { repo?: string; token?: string; clear?: boolean };
    if (data.clear) {
      clearRuntimeCredentials();
      json(res, { ok: true, configured: false });
      return;
    }
    const repo = typeof data.repo === 'string' ? data.repo.trim() : '';
    const token = typeof data.token === 'string' ? data.token.trim() : '';
    if (!repo || !repo.includes('/')) {
      error(res, 'repo must be in "owner/repo" format', 400);
      return;
    }
    if (!token) {
      error(res, 'token is required', 400);
      return;
    }
    setRuntimeCredentials(repo, token);
    // Validate by checking if credentials resolve
    const creds = await getCredentials();
    json(res, { ok: true, configured: !!creds });
  } catch (err) { error(res, String(err)); }
});

get('/api/sync/status', async (_req, res) => {
  try {
    if (!githubBackend || !sessionManager) {
      json(res, { enabled: false, unsynced_count: 0, session_branch: null, pr_number: null, pr_url: null, push_pending: false, github_configured: false, main_updated_available: false, rebase_in_progress: false });
      return;
    }
    const userId = getCurrentUserId();
    const branch = sessionManager.getActiveBranch(userId) ?? null;
    const state = sessionManager.getSessionState(userId);

    let unsyncedCount = 0;
    let behindBy = 0;
    let hasConflicts = false;
    if (branch) {
      const cmp = await githubBackend.compareBranches('main', branch);
      unsyncedCount = cmp.files.length;
      behindBy = cmp.behind_by;
      hasConflicts = cmp.status === 'diverged' && cmp.behind_by > 0;
    }

    json(res, {
      enabled: true,
      mode: 'github-api' as const,
      unsynced_count: unsyncedCount,
      session_branch: branch,
      pr_number: state?.prNumber ?? null,
      pr_url: state?.prUrl ?? null,
      push_pending: false,
      github_configured: true,
      main_updated_available: behindBy > 0,
      rebase_in_progress: false,
      main_sha: githubBackend.getMainSha(),
      behind_by: behindBy,
      has_conflicts: hasConflicts,
      cache: {
        hit_rate: githubBackend.getCacheHitRate(),
        last_poll: new Date(Date.now() - githubBackend.getLastPollAge() * 1000).toISOString(),
        age_seconds: githubBackend.getLastPollAge(),
      },
    });
  } catch (err) { error(res, String(err)); }
});

get('/api/sync/diagnostics', async (_req, res) => {
  try {
    if (!githubBackend || !sessionManager) {
      json(res, { git_sync_enabled: false, data_root: '', data_root_has_git: false, github_repo: null, github_credentials_valid: false, current_branch: null, head_sha: null, origin_main_sha: null, ahead_of_main: 0, behind_main: 0, active_taxonomy_dir: '', files: [], recent_commits: [] });
      return;
    }
    const userId = getCurrentUserId();
    const branch = sessionManager.getActiveBranch(userId);
    const divergence = branch ? await sessionManager.getDivergence(userId) : null;

    json(res, {
      git_sync_enabled: true,
      mode: 'github-api',
      data_root: CACHE_DIR,
      data_root_has_git: false,
      github_repo: null,
      github_credentials_valid: true,
      current_branch: branch ?? 'main',
      head_sha: githubBackend.getMainSha(),
      origin_main_sha: githubBackend.getMainSha(),
      ahead_of_main: divergence?.ahead_by ?? 0,
      behind_main: divergence?.behind_by ?? 0,
      active_taxonomy_dir: '',
      files: [],
      recent_commits: [],
      cache_hit_rate: githubBackend.getCacheHitRate(),
      cache_file_count: githubBackend.getCachedFileCount(),
      circuit_state: githubBackend.getCircuitState(),
      rate_limit_remaining: githubBackend.getRateLimitRemaining(),
      active_sessions: sessionManager.getActiveBranches(),
    });
  } catch (err) { error(res, String(err)); }
});

get('/api/sync/unsynced', async (_req, res) => {
  try {
    if (!githubBackend || !sessionManager) { json(res, []); return; }
    const userId = getCurrentUserId();
    const branch = sessionManager.getActiveBranch(userId);
    if (!branch) { json(res, []); return; }

    const cmp = await githubBackend.compareBranches('main', branch);
    const statusMap: Record<string, string> = {
      added: 'A', removed: 'D', modified: 'M', renamed: 'R', changed: 'M',
    };
    json(res, cmp.files.map(f => ({
      path: f.filename,
      status: statusMap[f.status] || 'M',
    })));
  } catch (err) { error(res, String(err)); }
});

get('/api/sync/diff', async (req, res) => {
  const p = query(req, 'path');
  if (!p) { error(res, 'path query parameter is required', 400); return; }
  try {
    if (!githubBackend || !sessionManager) { json(res, { path: p, diff: '' }); return; }
    const userId = getCurrentUserId();
    const branch = sessionManager.getActiveBranch(userId);
    if (!branch) { json(res, { path: p, diff: '' }); return; }

    const cmp = await githubBackend.compareBranches('main', branch);
    const file = cmp.files.find(f => f.filename === p);
    json(res, { path: p, diff: file?.patch ?? '' });
  } catch (err) { error(res, String(err), 400); }
});

post('/api/sync/discard', async (_req, res, body) => {
  const { all } = (body || {}) as { path?: string; all?: boolean };
  try {
    if (!githubBackend || !sessionManager) { error(res, 'Storage backend not initialized', 503); return; }
    const userId = getCurrentUserId();
    if (all) {
      await sessionManager.deleteBranch(userId, 'manual');
      // ALS context for this request still has the old branch, but the branch
      // is now deleted. Future requests will get branchName=undefined from
      // sessionManager.getActiveBranch() → reads fall back to main.
      json(res, { ok: true, scope: 'all' });
      return;
    }
    error(res, 'Per-file discard is not supported. Use "Discard All" to reset.', 400);
  } catch (err) { error(res, String(err), 400); }
});

post('/api/sync/create-pr', async (_req, res, body) => {
  const { title, body: prBody } = (body || {}) as { title?: string; body?: string };
  try {
    if (!githubBackend || !sessionManager) {
      error(res, 'GitHub API backend not configured', 503);
      return;
    }
    const userId = getCurrentUserId();
    const branch = sessionManager.getActiveBranch(userId);
    if (!branch) {
      error(res, 'No session branch — make edits first', 400);
      return;
    }
    const pr = await sessionManager.createPR(userId, title, prBody);
    json(res, {
      ok: true,
      number: pr.number,
      url: pr.url,
      branch,
      created: true,
    });
  } catch (err) { error(res, String(err)); }
});

post('/api/sync/resync', async (_req, res, body) => {
  const { mode } = (body || {}) as { mode?: 'rebase' | 'fetch-only' | 'reset-main' };
  if (mode !== 'rebase' && mode !== 'fetch-only' && mode !== 'reset-main') {
    error(res, 'mode must be "rebase", "fetch-only", or "reset-main"', 400);
    return;
  }
  try {
    if (!githubBackend || !sessionManager) {
      error(res, 'GitHub API backend not configured', 503);
      return;
    }
    const userId = getCurrentUserId();
    const branch = sessionManager.getActiveBranch(userId);

    if (mode === 'reset-main') {
      // Delete session branch → fresh start from main
      if (branch) await sessionManager.deleteBranch(userId, 'manual');
      json(res, {
        ok: true, mode: 'reset-main', session_ahead: 0,
        main_sha: githubBackend.getMainSha(),
        conflicts: false, message: 'Session reset to main',
      });
      return;
    }

    if (!branch) {
      // No session branch — nothing to resync
      json(res, {
        ok: true, mode, session_ahead: 0,
        main_sha: githubBackend.getMainSha(),
        conflicts: false, message: 'No session branch to resync',
      });
      return;
    }

    // 'rebase' and 'fetch-only' both merge main into session branch in API mode
    const mergeResult = await githubBackend.mergeBranch(branch);
    const cmp = mergeResult.ok
      ? await githubBackend.compareBranches('main', branch)
      : { ahead_by: 0 };

    json(res, {
      ok: true, mode,
      session_ahead: cmp.ahead_by,
      main_sha: githubBackend.getMainSha(),
      conflicts: mergeResult.conflicts,
      conflict_files: mergeResult.conflicts ? [] : undefined,
      message: mergeResult.message,
    });
  } catch (err) { error(res, String(err)); }
});

// ── Phase 4: interactive rebase conflict resolution ──
//
// When resync('rebase') hits merge conflicts we leave the rebase paused. These
// endpoints let the UI walk the user through resolving each conflicted file
// and then continue (or abort) the rebase.

get('/api/sync/rebase-state', async (_req, res) => {
  // Interactive rebase is not available in API mode — conflicts resolve on GitHub
  json(res, { in_progress: false, conflict_files: [], onto_branch: null });
});

get('/api/sync/rebase-file', async (_req, res) => {
  error(res, 'Interactive rebase is not available in API mode — resolve conflicts on GitHub', 400);
});

post('/api/sync/rebase/resolve', async (_req, res) => {
  error(res, 'Interactive rebase is not available in API mode — resolve conflicts on GitHub', 400);
});

post('/api/sync/rebase/continue', async (_req, res) => {
  error(res, 'Interactive rebase is not available in API mode — resolve conflicts on GitHub', 400);
});

post('/api/sync/rebase/abort', async (_req, res) => {
  error(res, 'Interactive rebase is not available in API mode — resolve conflicts on GitHub', 400);
});

// Phase-3 webhook: GitHub posts pull_request / ping events here. We verify the
// X-Hub-Signature-256 HMAC against GITHUB_WEBHOOK_SECRET, then — for a merged
// PR — flip the "upstream moved" flag so the UI banners a Resync prompt.
// All responses are 2xx once the signature is valid: GitHub interprets 4xx/5xx
// as delivery failures and retries, which would spam the logs.
post('/api/sync/webhook/github', async (req, res, _body) => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    // The endpoint is dormant when no secret is configured. Respond 404 so a
    // probing attacker can't distinguish "disabled" from "route missing".
    error(res, 'Not found', 404);
    return;
  }

  const raw = (req as RawBodyReq).__rawBody ?? '';
  const sigHeader = (req.headers['x-hub-signature-256'] as string | undefined) ?? '';
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
  // timingSafeEqual needs equal-length buffers; mismatched length = fail fast.
  const sigBuf = Buffer.from(sigHeader);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    error(res, 'Invalid signature', 401);
    return;
  }

  const event = (req.headers['x-github-event'] as string | undefined) ?? '';
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(raw) as Record<string, unknown>; } catch { /* empty payload */ }

  if (event === 'ping') {
    json(res, { ok: true, pong: true });
    return;
  }

  if (event === 'pull_request') {
    const action = parsed.action;
    const pr = parsed.pull_request as { merged?: boolean; base?: { ref?: string } } | undefined;
    if (action === 'closed' && pr?.merged === true && pr.base?.ref === 'main') {
      // In API mode, behind_by is detected dynamically via compareBranches.
      console.log('[sync] webhook: main merged');
    }
  }

  // Acknowledge everything else so GitHub doesn't retry.
  json(res, { ok: true });
});

// ── Analytics ──

get('/api/auth/me', (req, res) => {
  const principalName = (req.headers['x-ms-client-principal-name'] as string) || '_anonymous';
  const idp = (req.headers['x-ms-client-principal-idp'] as string) || '';
  json(res, { user: principalName, idp });
});

post('/api/analytics/event', (_req, res, body) => {
  const raw = (body as { events?: unknown[] }).events;
  if (!Array.isArray(raw)) { json(res, { error: 'events array required' }, 400); return; }
  // Sanitize: only keep events that have the required string fields
  const events: analytics.AnalyticsEvent[] = [];
  for (const e of raw) {
    if (typeof e !== 'object' || e === null) continue;
    const o = e as Record<string, unknown>;
    if (typeof o.user !== 'string' || typeof o.session_id !== 'string' ||
        typeof o.timestamp !== 'string' || typeof o.event_type !== 'string' ||
        typeof o.category !== 'string') continue;
    events.push({
      user: o.user.slice(0, 200),
      session_id: o.session_id.slice(0, 100),
      timestamp: o.timestamp.slice(0, 30),
      event_type: o.event_type.slice(0, 100),
      category: o.category.slice(0, 50),
      detail: (typeof o.detail === 'object' && o.detail !== null ? o.detail : {}) as Record<string, unknown>,
      duration_ms: typeof o.duration_ms === 'number' ? o.duration_ms : undefined,
    });
  }
  analytics.appendEvents(events);
  json(res, { ok: true, count: events.length });
});

get('/api/analytics/query', (req, res) => {
  const url = new URL(req.url!, 'http://localhost');
  const from = url.searchParams.get('from') || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const to = url.searchParams.get('to') || new Date().toISOString().slice(0, 10);
  const user = url.searchParams.get('user') || undefined;
  const sessionId = url.searchParams.get('session_id') || undefined;

  if (user || sessionId) {
    json(res, { events: analytics.queryRawEvents(from, to, user, sessionId) });
  } else {
    json(res, analytics.queryAggregated(from, to));
  }
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

type RawBodyReq = http.IncomingMessage & { __rawBody?: string };

const MAX_BODY_BYTES = 50 * 1024 * 1024; // 50 MB — debate sessions can reach 10+ MB at 14 rounds

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    totalBytes += (chunk as Buffer).length;
    if (totalBytes > MAX_BODY_BYTES) throw new Error('Request body too large');
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf-8');
  // Stash raw bytes so HMAC-verified endpoints (webhook) can recompute the
  // signature. Parse-then-stringify would change whitespace and break it.
  (req as RawBodyReq).__rawBody = raw;
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch { return raw; }
}

// ── HTTP server ──

// Resolve allowed CORS origins from ALLOWED_ORIGINS env var (comma-separated).
// In production, rejects cross-origin requests when unset (S8).
const ALLOWED_ORIGINS = (() => {
  if (process.env.ALLOWED_ORIGINS) {
    return process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean);
  }
  if (process.env.NODE_ENV === 'production') {
    console.warn('[security] ALLOWED_ORIGINS not set in production — CORS will reject cross-origin requests');
    return [];
  }
  return null; // null = allow all (development mode)
})();

function getCorsOrigin(req: http.IncomingMessage): string {
  if (!ALLOWED_ORIGINS) return '*';
  const origin = req.headers.origin || '';
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}

function parseCookies(req: http.IncomingMessage): Record<string, string> {
  const cookies: Record<string, string> = {};
  const header = req.headers.cookie;
  if (!header) return cookies;
  for (const pair of header.split(';')) {
    const [key, ...rest] = pair.trim().split('=');
    if (key) cookies[key] = rest.join('=');
  }
  return cookies;
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
  // Only load from the data volume — auth is opt-in per deployment.
  // Drop authorized-users.json into /data/ (Azure Files) to enable the gate.
  const candidates = [
    path.join(getDataRoot(), 'authorized-users.json'),
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

function buildLoginPage(showAnonymous: boolean): string {
  const subtitle = showAnonymous
    ? 'Sign in for server-managed API keys, or continue anonymously with your own'
    : 'Sign in to continue';

  const anonymousSection = showAnonymous ? `
  <div class="divider"><span>or</span></div>
  <a class="btn btn-anonymous" href="/.auth/anonymous">
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>
    Continue without signing in
  </a>
  <p class="anon-note">Anonymous users have lower rate limits and must provide their own API keys</p>` : '';

  return `<!DOCTYPE html>
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
  .btn-anonymous { border-color: #475569; }
  .btn-anonymous:hover { border-color: #94a3b8; }
  .divider { display: flex; align-items: center; gap: 12px; margin: 20px 0; color: #64748b; font-size: 0.8rem; }
  .divider::before, .divider::after { content: ''; flex: 1; border-top: 1px solid #334155; }
  .anon-note { color: #64748b; font-size: 0.75rem; margin-top: 4px; }
</style>
</head>
<body>
<div class="card">
  <h1>Taxonomy Editor</h1>
  <p class="subtitle">${subtitle}</p>
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
  </a>${anonymousSection}
</div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

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
  <p>Signed in as <span class="user">${escapeHtml(name)}</span></p>
  <p>You are not in the authorized users list. Contact the administrator to request access.</p>
  <a class="btn" href="/.auth/logout?post_logout_redirect_uri=/">Sign out</a>
</div>
</body>
</html>`;

// S9: Only trust Easy Auth headers when running on Azure with auth enabled.
// Without this gate, clients can spoof X-MS-CLIENT-PRINCIPAL-NAME if the
// container is exposed directly (not behind Azure's front-end proxy).
const AZURE_AUTH_ENABLED = process.env.WEBSITE_AUTH_ENABLED === 'True'
  || process.env.WEBSITE_AUTH_ENABLED === 'true';

// S-ADMIN: Admin API key for headless scripts (e.g., Sync-AzureTriadData.ps1).
// Set ADMIN_API_KEY on the container to enable. Minimum 16 chars enforced.
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';

function isAdminRequest(req: http.IncomingMessage): boolean {
  if (!ADMIN_API_KEY || ADMIN_API_KEY.length < 16) return false;
  const key = (req.headers['x-admin-key'] as string) || '';
  if (!key) return false;
  // Constant-time comparison to prevent timing attacks
  const keyBuf = Buffer.from(key);
  const expectedBuf = Buffer.from(ADMIN_API_KEY);
  if (keyBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, expectedBuf);
}

const server = http.createServer((req, res) => { void handleRequest(req, res); });
async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  // S10: Security headers on all responses
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (process.env.NODE_ENV === 'production' || process.env.ALLOWED_ORIGINS) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' wss:; font-src 'self'");
  }

  // CORS headers — locked to ALLOWED_ORIGINS in production, permissive in dev
  res.setHeader('Access-Control-Allow-Origin', getCorsOrigin(req));
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Filename, X-Admin-Key');
  if (ALLOWED_ORIGINS) res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // S9: Only read Easy Auth headers when Azure auth is confirmed via env var.
  const principalName = AZURE_AUTH_ENABLED
    ? (req.headers['x-ms-client-principal-name'] as string) || ''
    : '';
  const idp = AZURE_AUTH_ENABLED
    ? (req.headers['x-ms-client-principal-idp'] as string) || ''
    : '';

  // Auth gate — only enforced when authorized-users.json exists
  const urlPath = req.url?.split('?')[0] || '';
  // /api/models is public: lets the pre-auth renderer populate the model
  // catalog from ai-models.json. Contains no secrets — just labels + ids.
  // /api/sync/webhook/github is public: GitHub POSTs unauthenticated; the
  // handler does its own HMAC verification against GITHUB_WEBHOOK_SECRET.
  const isPublicPath = urlPath === '/health'
    || urlPath === '/healthz'
    || urlPath === '/status'
    || urlPath === '/api/models'
    || urlPath === '/api/sync/webhook/github'
    || urlPath.startsWith('/.auth/');
  // AUTH_DISABLED='1' (default) = anonymous access, no login page.
  // AUTH_OPTIONAL='1' = show login page with anonymous option; sign-in
  //   unlocks platform-tier keys, anonymous users get lower limits + BYOK.
  // Neither = required auth (must sign in + be in authorized-users.json).
  const authDisabled = process.env.AUTH_DISABLED === '1';
  const authOptional = process.env.AUTH_OPTIONAL === '1';

  // /.auth/anonymous — sets a session cookie and redirects to the app
  if (urlPath === '/.auth/anonymous' && authOptional) {
    const secureSuffix = process.env.NODE_ENV === 'production' || process.env.ALLOWED_ORIGINS ? '; Secure' : '';
    res.writeHead(302, {
      'Location': '/',
      'Set-Cookie': `auth_anonymous=1; Path=/; HttpOnly; SameSite=Lax${secureSuffix}`,
    });
    res.end();
    return;
  }

  // Clear anonymous cookie when user signs in via EasyAuth
  if (principalName && parseCookies(req)['auth_anonymous'] === '1') {
    res.setHeader('Set-Cookie', 'auth_anonymous=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  }

  if (!isPublicPath && !authDisabled && !isAdminRequest(req)) {
    if (authOptional) {
      // Optional mode: show login page unless user signed in or chose anonymous
      if (!principalName) {
        const isAnonymousSession = parseCookies(req)['auth_anonymous'] === '1';
        if (!isAnonymousSession) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(buildLoginPage(true));
          return;
        }
      }
    } else if (getAuthorizedUsers()) {
      // Required mode: must sign in and be in the allowlist
      if (!principalName) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(buildLoginPage(false));
        return;
      }

      if (!isUserAuthorized(principalName, idp)) {
        res.writeHead(403, { 'Content-Type': 'text/html' });
        res.end(FORBIDDEN_PAGE(principalName));
        return;
      }
    }
  }

  // Run the remainder of request handling inside a user context so that
  // getCurrentUserId() inside getApiKey()/storeApiKey() sees the caller.
  // Unauthenticated paths (local dev, kill-switch, public endpoints) fall
  // back to '_local' — which keyStore ignores in local-file mode.
  // Resolve session branch for the ALS context (if any).
  // Reads start with the active branch (or undefined → 'main').
  // Writes call ensureSessionBranch() which updates the ALS mid-request.
  const sessionBranch = (githubBackend && sessionManager)
    ? sessionManager.getActiveBranch(principalName || '_local') ?? undefined
    : undefined;
  const userCtx = { principalName: principalName || '_local', idp: idp || '_local', branchName: sessionBranch };
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
}

// ── WebSocket: Terminal ──

const wss = new WebSocketServer({ noServer: true });
const eventClients = new Set<WebSocket>();

function broadcastEvent(type: string, data: unknown) {
  const msg = JSON.stringify({ type, data });
  for (const ws of eventClients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

function isWebSocketAuthorized(req: http.IncomingMessage): boolean {
  const authDisabled = process.env.AUTH_DISABLED === '1';
  if (authDisabled) return true;

  // S-WS-AUTH: Only trust Azure auth headers when Azure Auth is enabled,
  // matching the HTTP handler behavior. Prevents header spoofing when
  // the container is exposed directly (not behind Azure Front Door).
  const principalName = AZURE_AUTH_ENABLED
    ? (req.headers['x-ms-client-principal-name'] as string) || ''
    : '';
  const idp = AZURE_AUTH_ENABLED
    ? (req.headers['x-ms-client-principal-idp'] as string) || ''
    : '';
  const authOptional = process.env.AUTH_OPTIONAL === '1';

  if (authOptional) {
    if (principalName) return true;
    const cookies = parseCookies(req);
    return cookies['auth_anonymous'] === '1';
  }

  if (getAuthorizedUsers()) {
    return !!principalName && isUserAuthorized(principalName, idp);
  }

  return true;
}

server.on('upgrade', (req, socket, head) => {
  // S-WS-ORIGIN: Validate Origin header against ALLOWED_ORIGINS to prevent
  // cross-origin WebSocket hijacking (WebSocket bypasses CORS).
  if (ALLOWED_ORIGINS) {
    const origin = (req.headers.origin || '') as string;
    if (!ALLOWED_ORIGINS.includes(origin)) {
      console.warn(`[security] Blocked WebSocket upgrade from disallowed origin: ${origin}`);
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
  }

  if (!isWebSocketAuthorized(req)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

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

  // S-ENV: Only pass safe environment variables to the terminal process.
  // Prevents leaking API keys, webhook secrets, and other sensitive env vars.
  const SAFE_ENV_KEYS = ['PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE',
    'LOGNAME', 'TMPDIR', 'TMP', 'TEMP', 'HOSTNAME', 'PWD', 'COLORTERM',
    'SystemRoot', 'SYSTEMROOT', 'windir', 'COMSPEC', 'PATHEXT', 'APPDATA',
    'LOCALAPPDATA', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'NODE_ENV',
    'AI_TRIAD_DATA_ROOT'];
  const safeEnv: Record<string, string> = {};
  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key]) safeEnv[key] = process.env[key]!;
  }
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
  terminalProcess = spawn(pythonCmd, [BROKER_SCRIPT], {
    cwd: getProjectRoot(),
    env: { ...safeEnv, TERM: 'xterm-256color', PTY_COLS: '120', PTY_ROWS: '30' },
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

  // Dump server flight recorder on shutdown
  try {
    serverRecorder.record({ type: 'lifecycle', component: 'server', level: 'info', message: `Shutdown: ${signal}` });
    const { ndjson } = serverRecorder.buildDump('manual');
    const dumpDir = path.join(getDataRoot(), 'flight-recorder');
    fs.mkdirSync(dumpDir, { recursive: true });
    fs.writeFileSync(path.join(dumpDir, `server-shutdown-${Date.now()}.jsonl`), ndjson);
  } catch { /* best effort */ }

  // 1a. Stop GitHubAPIBackend polling
  if (githubBackend) {
    githubBackend.shutdown();
  }

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

// Auto-dump server recorder on uncaught errors
process.on('uncaughtException', (err) => {
  try {
    serverRecorder.record({ type: 'system.error', component: 'server', level: 'fatal', message: err.message, error: { name: err.name, message: err.message, stack: err.stack?.slice(0, 500) } });
    const { ndjson } = serverRecorder.buildDump('uncaught_error', { name: err.name, message: err.message, stack: err.stack?.slice(0, 500) });
    const dumpDir = path.join(getDataRoot(), 'flight-recorder');
    fs.mkdirSync(dumpDir, { recursive: true });
    fs.writeFileSync(path.join(dumpDir, `server-crash-${Date.now()}.jsonl`), ndjson);
  } catch { /* best effort */ }
  console.error('[server] Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  serverRecorder.record({ type: 'system.error', component: 'server', level: 'error', message: err.message, error: { name: err.name, message: err.message, stack: err.stack?.slice(0, 500) } });
});

// ── Start ──

server.listen(PORT, () => {
  serverRecorder.record({ type: 'lifecycle', component: 'server', level: 'info', message: 'Server started', data: { port: PORT, version: SERVER_VERSION, dataRoot: getDataRoot(), platform: process.platform, arch: process.arch, storageMode: STORAGE_MODE } });
  console.log(`[server] Taxonomy Editor running at http://localhost:${PORT}`);
  console.log(`[server] Data root: ${getDataRoot()}`);

  // Initialize analytics storage (daily NDJSON files + 90-day pruning)
  try { analytics.initAnalytics(getDataRoot()); } catch (e) { console.warn('[server] Analytics init failed:', e); }

  if (githubBackend) {
    // Initialize GitHubAPIBackend (token + cache check) AFTER health check is
    // ready. Health passes immediately, then async init.
    console.log('[server] Initializing GitHubAPIBackend...');
    githubBackend.initialize().then(() => {
      console.log('[server] GitHubAPIBackend initialized');
    }).catch((err) => {
      console.error('[server] GitHubAPIBackend initialization failed:', err);
      serverRecorder.record({
        type: 'storage.fallback', component: 'storage', level: 'warn',
        message: `GitHubAPIBackend init failed: ${err instanceof Error ? err.message : String(err)}`,
        error: err instanceof Error
          ? { name: err.name, message: err.message, stack: err.stack?.slice(0, 500) }
          : { name: 'Error', message: String(err) },
      });
    });
  }
});
