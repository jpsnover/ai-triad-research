// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Azure Application Insights — re-add @azure/monitor-opentelemetry when
// upstream OpenTelemetry vulnerabilities are patched (see p/2#12).

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
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { spawn, execFile, ChildProcess } from 'child_process';
import { getGlobalRecorder, setGlobalRecorder } from '../../../lib/flight-recorder/index.js';

const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { WebSocketServer, WebSocket } from 'ws';
import {
  PORT, getDataRoot, getApiKey, hasApiKey, storeApiKey, deleteApiKey, deleteAllApiKeys, rotateApiKeyMaterial,
  getStoredApiKeys, addApiKey, removeApiKey, resolveDataPath,
  getPaidGeminiFallbackKey, setPaidGeminiFallbackKey, deletePaidGeminiFallbackKey,
  BROKER_SCRIPT, SCRIPTS_DIR, getProjectRoot, type AIBackend,
  STORAGE_MODE, CACHE_DIR,
} from './config.js';
import { GitHubAPIBackend } from './storage/githubAPIBackend.js';
import { SessionBranchManager } from './storage/sessionBranchManager.js';
import { runWithUser, getCurrentUser, getCurrentUserId, getStorageUserId, setSessionBranchName, deriveStorageUserId, isAnonymousUser } from './security/userContext.js';
import { isAuthDisabledAllowed, isPathWithinDir, isTerminalAccessAllowed, isAnonAllowedRoute, invalidRouteParam, callerTierIdentity, clientSafeMessage, missingApiKeyError, expiredAuthCookies, hasEasyAuthSessionCookie, resolveTestPersonaOverride } from './security/accessControl.js';
import { sanitizeUserText } from './security/contentSanitizer.js';
import { getRollbackStatus } from './rollbackStatus.js';
import { LLMS_TXT } from './llmsTxt.js';
import { getErrorSummaryCached, type ErrorEntry } from './errorAggregation.js';
import * as supportStore from './support/supportStore.js';
import { isCaseStatus } from './support/types.js';
import * as organizations from './organizations.js';
import { isPov } from './organizations.js';
import { json, error, param, query, getClientIp, createRouter, type Handler } from './httpKit.js';
import { registerDebatesRoutes } from './routes/debates.js';
import { registerSyncRoutes } from './routes/sync.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerKeysRoutes } from './routes/keys.js';
import { registerCommunityRoutes } from './routes/community.js';
import { registerHarvestRoutes } from './routes/harvest.js';
import { registerOrganizationsRoutes } from './routes/organizations.js';
import { registerTaxonomyRoutes } from './routes/taxonomy.js';
import type { ServerCtx } from './routes/context.js';
import { getAllFlags, listFlags, setFlag, deleteFlag, type FlagDef } from './featureFlags.js';
import { writeDump, isValidDumpId, readMergedDump } from './flightRecorderDumps.js';
import { drainServerLogLines } from './serverLogBuffer.js';
import { initAnonymousSessionStore } from './storage/anonymousSessionStore.js';
import { getQuotaLimits } from './security/quotas.js';
import { checkProviderBinding } from './ai/providerBinding.js';
import * as community from './community/community.js';
import * as fileIO from './storage/fileIO.js';
import { FEEDBACK_CATEGORIES, isFeedbackCategory, paginateFeedback } from './storage/feedbackStore.js';
import { stripEdgeRationale, type EdgesData } from './community/edgesApi.js';
import { escapeForInlineScript } from './flightRecorderViewer.js';
import { stampNodeAuthorship, diffNodes, changedFields } from './storage/editMeta.js';
import { computeNodeConflicts } from './community/nodeConflicts.js';
import type { TaxNode, NodeConflict } from './community/nodeConflicts.js';
import * as ai from './ai/aiBackends.js';
import { getConfig, getConfigState, writeConfig, forceReload as reloadRuntimeConfig, diffFromDefaults, getClientConfig } from './runtimeConfig.js';
import { DEFAULT_MODEL } from '../../../lib/ai-client/index.js';
import { setRuntimeCredentials, clearRuntimeCredentials, getCredentials } from './security/githubAppAuth.js';
import * as proxyTiers from './ai/proxyTiers.js';
import * as rateLimiter from './security/rateLimiter.js';
import * as analytics from './community/analytics.js';
import { FlightRecorder } from '../../../lib/flight-recorder/flightRecorder.js';
import { log, runWithRequestContext, generateRequestId, getRequestId, getRequestContext } from './logger.js';
import {
  requireAdmin,
  registerReviewHandler,
  getReviewQueue,
  getReviewStats,
  getReviewDetail,
  executeReviewAction,
} from './community/admin/reviewRegistry.js';
import type { ReviewAction } from './community/admin/types.js';
import { calibrationReviewHandler } from './community/admin/calibrationHandler.js';
import { communityReviewHandler } from './community/admin/communityReviewHandler.js';

// Register review domain handlers at startup so the unified admin endpoints
// (queue/stats/action/detail) can delegate to them (t/646, t/647, t/650).
registerReviewHandler(calibrationReviewHandler);
registerReviewHandler(communityReviewHandler);

// ── Server-side flight recorder ──
const serverRecorder = new FlightRecorder({ capacity: 2000, dumpOnError: false });
// t/803: stamp the per-request correlation id (from the logger ALS) onto every
// flight-recorder event recorded during request handling, so server events
// correlate to the originating HTTP request. An explicit request_id passed to
// record() still wins; outside a request the field is omitted.
const _baseServerRecord = serverRecorder.record.bind(serverRecorder);
serverRecorder.record = (input) => _baseServerRecord({ request_id: getRequestId(), ...input });
serverRecorder.intern('component', 'server');
serverRecorder.intern('component', 'git');
serverRecorder.intern('component', 'data-pull');
serverRecorder.intern('component', 'copy-status');
serverRecorder.intern('component', 'auth');
serverRecorder.intern('component', 'github-api');
serverRecorder.intern('component', 'cache');
serverRecorder.intern('component', 'session');
serverRecorder.intern('component', 'storage');

/* eslint-disable @typescript-eslint/no-use-before-define -- callback runs after module init; SERVER_VERSION, SERVER_START_TIME, githubBackend all safe at call-time */
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
    azure: {
      replica_name: process.env.CONTAINER_APP_REPLICA_NAME ?? null,
      container_start_time: process.env.WEBSITES_CONTAINER_START_TIME ?? null,
      dns_suffix: process.env.CONTAINER_APP_ENV_DNS_SUFFIX ?? null,
      revision: process.env.CONTAINER_APP_REVISION ?? null,
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
/* eslint-enable @typescript-eslint/no-use-before-define */

setGlobalRecorder(serverRecorder);
// The flight-recorder named-pipe listener is Windows-only desktop/dev IPC — its
// path (\\.\pipe\…) is invalid on Linux, where it emits a noisy EACCES and is
// useless to the headless server (which exposes flight-recorder dumps over HTTP).
// Only start it on Windows, and never let a failure abort server startup. (t/722)
if (process.platform === 'win32') {
  try {
    serverRecorder.startPipeListener(process.pid);
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'server',
      level: 'warn',
      message: 'Flight-recorder pipe listener failed to start (non-fatal)',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
  }
}

export { serverRecorder };

// Merge the bounded server-log buffer into a server dump's ndjson as `log.line`
// entries, so a dump is self-contained for offline triage without a Log
// Analytics query (operator request). Log lines are already pino-redacted and
// re-scrubbed in serverLogBuffer; they live in their own capped buffer so they
// never evict curated flight-recorder events.
function appendServerLogs(ndjson: string): string {
  const logs = drainServerLogLines();
  if (logs.length === 0) return ndjson;
  const tail = logs.map(l => JSON.stringify({ type: 'log.line', component: 'server-log', ...l })).join('\n');
  return (ndjson.endsWith('\n') ? ndjson : ndjson + '\n') + tail + '\n';
}

// L1 (t/720): AUTH_DISABLED makes every request an anonymous user with full
// access — fine for local/dev single-operator use, catastrophic in production.
// Hard-block it under NODE_ENV=production (force auth back on) and warn loudly
// whenever it is set so a misconfigured deploy can't silently run wide open.
if (process.env.AUTH_DISABLED === '1') {
  if (!isAuthDisabledAllowed()) {
    delete process.env.AUTH_DISABLED;
    serverRecorder.record({
      type: 'system.error', component: 'server', level: 'error',
      message: 'AUTH_DISABLED=1 is not permitted when NODE_ENV=production — ignoring it and enforcing authentication.',
    });
    log.security.error('AUTH_DISABLED=1 ignored in production; authentication is enforced. Remove AUTH_DISABLED or unset NODE_ENV=production.');
  } else {
    log.security.warn('AUTH_DISABLED=1 — authentication is bypassed (all requests anonymous with full access). Never use this in production.');
  }
}

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

  // User content (chats, debates, community) lives in Azure Blob Storage.
  // Taxonomy/conflicts/calibration stay on the GitHub backend.
  const blobAccountUrl = process.env.AZURE_STORAGE_ACCOUNT_URL;
  if (blobAccountUrl) {
    const { AzureBlobBackend } = await import('./storage/azureBlobBackend.js');
    fileIO.setUserContentBackend(new AzureBlobBackend({
      accountUrl: blobAccountUrl,
      userContentContainer: process.env.AZURE_USER_CONTENT_CONTAINER || 'user-content',
      communityContainer: process.env.AZURE_COMMUNITY_CONTAINER || 'community',
    }));
    serverRecorder.record({
      type: 'storage.mode', component: 'storage', level: 'info',
      message: 'User content storage: azure-blob',
      data: { accountUrl: blobAccountUrl },
    });
  } else {
    log.storage.warn('AZURE_STORAGE_ACCOUNT_URL is unset — Blob backend not initialized; user content will fall back to the primary GitHub backend.');
    serverRecorder.record({
      type: 'storage.mode', component: 'storage', level: 'warn',
      message: 'User content storage: github-api fallback (Azure Blob not configured)',
    });
  }
} else {
  // FilesystemBackend is the default in fileIO.ts — no action needed
  serverRecorder.record({
    type: 'storage.mode', component: 'storage', level: 'info',
    message: `Storage mode: filesystem (data root: ${getDataRoot()})`,
    data: { mode: 'filesystem', dataRoot: getDataRoot() },
  });
}

log.storage.info({ mode: STORAGE_MODE }, 'Storage mode selected');

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

// Handler type + the json/error/param/query helpers live in ./httpKit.ts (t/1295)
// so extracted route clusters (routes/*.ts) share the same contract.
const routes: { method: string; path: string; handler: Handler }[] = [];

function get(p: string, h: Handler) { routes.push({ method: 'GET', path: p, handler: h }); }
function post(p: string, h: Handler) { routes.push({ method: 'POST', path: p, handler: h }); }
function put(p: string, h: Handler) { routes.push({ method: 'PUT', path: p, handler: h }); }
function del(p: string, h: Handler) { routes.push({ method: 'DELETE', path: p, handler: h }); }

// t/1295: registrar + read-mostly context for extracted route clusters
// (routes/*.ts). getGithubBackend is a live getter (not a snapshot) so clusters
// registered at module-load don't capture a stale null before async init assigns it.
const router = createRouter(routes);
// Conflicts response cache (read/written by the /api/conflicts routes below).
// Declared above serverCtx so ctx.invalidateConflictsCache() can null it after a
// harvest write from the extracted routes/harvest.ts (t/1347).
let conflictsCache: { data: unknown[]; ts: number } | null = null;
const serverCtx: ServerCtx = {
  getGithubBackend: () => githubBackend,
  getSessionManager: () => sessionManager,
  broadcastTaxonomyUpdate,
  serverRecorder,
  ensureSessionBranch,
  appendServerLogs,
  invalidateConflictsCache: () => { conflictsCache = null; },
};

// Best-effort client IP for rate limiting — first X-Forwarded-For hop (Azure
// ingress sets it) else the socket address. (M7)
// getClientIp moved to httpKit.ts (t/1347) — shared by server.ts + routes/*.ts.

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
    } catch { /* telemetry — silent by design;  try next */ }
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
    /* telemetry — silent by design */
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

get('/health', async (_req, res) => {
  // M5: liveness probes (unauthenticated) get a minimal OK. Operational detail
  // (versions, storage internals, GitHub rate limits, paths) only for admins.
  // AI key status is always included so deployment gates can verify readiness.
  const geminiReady = await hasApiKey('gemini');
  const freeKeyPoolSize = proxyTiers.parseFreeTierKeys(process.env.FREE_TIER_GEMINI_KEY).length;
  if (!community.isAdmin()) { json(res, { status: 'ok', ai: { geminiKeyConfigured: geminiReady, freeTierKeyPoolSize: freeKeyPoolSize } }); return; }
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

  base.ai = {
    geminiKeyConfigured: geminiReady,
    freeTierEnabled: freeKeyPoolSize > 0,
    freeTierKeyPoolSize: freeKeyPoolSize,
    freeTierLimits: freeKeyPoolSize > 0 ? { requestsPerMinute: proxyTiers.scaledFreeTierRpm(freeKeyPoolSize), tokensPerDay: getConfig().tiers.free.tokensPerDay } : null,
  };

  if (githubBackend) {
    (base.storage as Record<string, unknown>).mainSha = githubBackend.getMainSha();
    (base.storage as Record<string, unknown>).cacheFileCount = githubBackend.getCachedFileCount();
    (base.storage as Record<string, unknown>).cacheGeneration = githubBackend.getCacheGeneration();
    (base.storage as Record<string, unknown>).fallbackActive = githubBackend.getCircuitState() === 'open';
    (base.storage as Record<string, unknown>).overlay = githubBackend.getOverlayStats(); // t/727 memory monitoring

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

// t/1143: llms.txt convention (https://llmstxt.org) — a public, static markdown
// file so IDE agents / AI tools get structured context about the app instead of
// parsing raw SPA HTML. Static + cacheable.
get('/llms.txt', (_req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/markdown; charset=utf-8',
    'Cache-Control': 'public, max-age=3600',
  });
  res.end(LLMS_TXT);
});

get('/api/taxonomy-dirs', async (_req, res) => {
  json(res, await fileIO.getTaxonomyDirs());
});

get('/api/taxonomy-dir/active', (_req, res) => {
  json(res, fileIO.getActiveTaxonomyDirName());
});

put('/api/taxonomy-dir/active', (_req, res, body) => {
  const { dirName } = body as { dirName: string };
  const previous = fileIO.getActiveTaxonomyDirName();
  try {
    fileIO.setActiveTaxonomyDir(dirName);
    log.api.info({ component: 'taxonomy-dir', previous, active: dirName }, 'Active taxonomy directory changed');
    getGlobalRecorder()?.record({
      type: 'lifecycle', component: 'taxonomy-dir', level: 'info',
      message: 'Active taxonomy directory changed',
      data: { previous, active: dirName },
    });
    json(res, { ok: true });
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'taxonomy-dir', level: 'error',
      message: 'Failed to switch active taxonomy directory',
      data: { previous, requested: dirName },
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    error(res, String(err), 500, err);
  }
});

// ── Taxonomy: synthetic corpus + CRUD + node edit history ──
// t/1383: /api/taxonomy/* cluster extracted to routes/taxonomy.ts (registrar at group position;
// synthetic-embeddings registers before :pov, preserving the collision-pair order).
registerTaxonomyRoutes(router, serverCtx);

// ── Conflicts ──
// t/929: conflicts cache TTL is runtime-configurable — getConfig().server.conflictsCacheTtlMs (default 5m).
// `conflictsCache` is declared above serverCtx (t/1347) so ctx.invalidateConflictsCache can null it.

get('/api/conflicts', async (_req, res) => {
  if (conflictsCache && Date.now() - conflictsCache.ts < getConfig().server.conflictsCacheTtlMs) {
    json(res, conflictsCache.data);
    return;
  }
  const data = await fileIO.readAllConflictFiles();
  conflictsCache = { data, ts: Date.now() };
  json(res, data);
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
    conflictsCache = null;
    json(res, { ok: true });
  } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'server', level: 'error', message: 'Failed to write conflict', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
});

post('/api/conflicts/:id', async (req, res, body) => {
  try {
    await ensureSessionBranch();
    const id = param(req, 'id', '/api/conflicts/:id');
    await fileIO.createConflictFile(id, body);
    conflictsCache = null;
    json(res, { ok: true });
  } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'server', level: 'error', message: 'Failed to create conflict', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
});

del('/api/conflicts/:id', async (req, res) => {
  try {
    await ensureSessionBranch();
    const id = param(req, 'id', '/api/conflicts/:id');
    await fileIO.deleteConflictFile(id);
    conflictsCache = null;
    json(res, { ok: true });
  } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'server', level: 'error', message: 'Failed to delete conflict', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
});

// ── Policy registry ──

get('/api/policy-registry', async (_req, res) => {
  json(res, await fileIO.readPolicyRegistry());
});

// ── Organizations (t/1225) ──
// t/1383: /api/organizations/* cluster extracted to routes/organizations.ts (registrar at group position).
registerOrganizationsRoutes(router, serverCtx);

// ── Lineage categories ──

get('/api/lineage-categories', async (_req, res) => {
  json(res, await fileIO.readLineageCategories());
});

get('/api/lineage-info', async (_req, res) => {
  json(res, await fileIO.readLineageEnrichments());
});

// ── Edges ──

let edgesCache: unknown = null;

get('/api/edges', async (req, res) => {
  edgesCache = await fileIO.readEdgesFile();
  if (!edgesCache) { json(res, null); return; }
  // ?include=rationale returns the full payload (backwards-compat for scripts).
  if (query(req, 'include') === 'rationale') { json(res, edgesCache); return; }
  json(res, stripEdgeRationale(edgesCache));
});

get('/api/edges/:index', async (req, res) => {
  if (!edgesCache) edgesCache = await fileIO.readEdgesFile();
  const data = edgesCache as EdgesData | null;
  const index = parseInt(param(req, 'index', '/api/edges/:index'), 10);
  if (!data?.edges || isNaN(index) || index < 0 || index >= data.edges.length) {
    error(res, 'Edge not found', 404);
    return;
  }
  json(res, data.edges[index]);
});

put('/api/edges/status', async (_req, res, body) => {
  const { index, status: s } = body as { index: number; status: string };
  if (!edgesCache) edgesCache = await fileIO.readEdgesFile();
  edgesCache = await fileIO.updateEdgeStatus(edgesCache, index, s);
  json(res, stripEdgeRationale(edgesCache));
});

put('/api/edges/swap', async (_req, res, body) => {
  const { index } = body as { index: number };
  if (!edgesCache) edgesCache = await fileIO.readEdgesFile();
  edgesCache = await fileIO.swapEdgeDirection(edgesCache, index);
  json(res, stripEdgeRationale(edgesCache));
});

put('/api/edges/bulk-status', async (_req, res, body) => {
  const { indices, status: s } = body as { indices: number[]; status: string };
  if (!edgesCache) edgesCache = await fileIO.readEdgesFile();
  edgesCache = await fileIO.bulkUpdateEdges(edgesCache, indices, s);
  json(res, stripEdgeRationale(edgesCache));
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

// ── Feature flags (t/899) ──

// Resolved flags for the current user (any caller). The UI gates features on these.
get('/api/flags', (_req, res) => {
  try { json(res, getAllFlags()); }
  catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'server', level: 'error', message: 'Failed to resolve feature flags',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    error(res, String(err), 500, err);
  }
});

// ── Admin (35 routes, 6 scattered runs) extracted to routes/admin.ts — t/1295 ──
registerAdminRoutes(router, serverCtx);

get('/api/data/root', (_req, res) => {
  if (!requireAdmin(res)) return; // t/855: the data-root filesystem path is admin-only
  json(res, fileIO.getDataRootPath());
});

post('/api/data/set-root', (_req, res, body) => {
  if (!requireAdmin(res)) return; // L2 (t/720): mutating the data root is admin-only
  const { newRoot } = body as { newRoot: string };
  try {
    if (!fs.existsSync(newRoot)) {
      json(res, { success: false, message: `Directory does not exist: ${newRoot}` }, 400);
      return;
    }
    process.env.AI_TRIAD_DATA_ROOT = path.resolve(newRoot);
    json(res, { success: true });
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'server',
      level: 'error',
      message: 'Operation failed',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    json(res, { success: false, message: String(err) }, 500);
  }
});


post('/api/data/clone', async (_req, res, body) => {
  if (!requireAdmin(res)) return; // L3 (t/720): cloning is admin-only
  const { targetPath } = body as { targetPath: string };
  try {
    // L3 (t/720): confine the clone target to the configured data directory.
    // Without this an (admin) caller could write the repo to any filesystem path.
    if (!isPathWithinDir(targetPath, getDataRoot())) {
      json(res, { success: false, message: 'targetPath must be within the configured data directory.' }, 400);
      return;
    }
    // Clone to temp dir first, then copy contents — avoids permission issues
    // when targetPath is root-owned (e.g. /data in Azure containers).
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'data-clone-'));
    await new Promise<void>((resolve, reject) => {
      execFile('git', ['clone', 'https://github.com/jpsnover/ai-triad-data.git', tmpDir], { timeout: getConfig().server.gitCloneTimeoutMs }, (err) => {
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
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'server',
      level: 'error',
      message: 'Operation failed',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
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

    if (local === remote) {
      json(res, { available: false, behindCount: 0, aheadCount: 0, diverged: false, currentCommit: local, remoteCommit: remote });
      return;
    }

    const lrOutput = await runGit(['rev-list', '--left-right', '--count', 'HEAD...origin/main']);
    const [aheadStr, behindStr] = lrOutput.split(/\s+/);
    const aheadCount = parseInt(aheadStr, 10) || 0;
    const behindCount = parseInt(behindStr, 10) || 0;
    const diverged = aheadCount > 0 && behindCount > 0;

    json(res, { available: behindCount > 0, behindCount, aheadCount, diverged, currentCommit: local, remoteCommit: remote });
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'server',
      level: 'error',
      message: 'Operation failed',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
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
    const runGit = (args: string[], timeoutMs = getConfig().server.gitDefaultTimeoutMs): Promise<string> => new Promise((resolve, reject) => {
      execFile('git', args, { cwd: dataRoot, timeout: timeoutMs, maxBuffer: getConfig().server.gitBufferLimitBytes }, (err, stdout, stderr) => {
        if (err) {
          log.dataPull.error({ cmd: `git ${args.join(' ')}`, stderr: stderr?.trim() }, err.message);
          reject(new Error(`git ${args[0]}: ${err.message}${stderr ? ' — ' + stderr.trim() : ''}`));
        } else {
          if (stderr) log.dataPull.debug({ cmd: `git ${args[0]}`, stderr: stderr.trim() }, 'git stderr');
          resolve(stdout.trim());
        }
      });
    });

    serverRecorder.record({ type: 'lifecycle', component: 'data-pull', level: 'info', message: 'pull.start', data: { dataRoot } });
    log.dataPull.info({ dataRoot }, 'Starting pull');
    progress('Starting data update...');

    // Fix: Strip stale tokens from origin URL to avoid 401 on expired GitHub App tokens.
    // Public repos work fine with plain HTTPS; embedded tokens cause auth failures when expired.
    let remoteUrl = await runGit(['remote', 'get-url', 'origin']);
    log.dataPull.info({ remoteUrl: remoteUrl.replace(/:\/\/[^@]+@/, '://<redacted>@') }, 'Remote URL');

    if (remoteUrl.includes('x-access-token:')) {
      const cleanUrl = remoteUrl.replace(/:\/\/x-access-token:[^@]+@/, '://');
      log.dataPull.info('Stripping stale token from origin URL');
      await runGit(['remote', 'set-url', 'origin', cleanUrl]);
      remoteUrl = cleanUrl;
    }

    // If remote is SSH, convert to HTTPS for public repo access without keys
    if (remoteUrl.startsWith('git@github.com:')) {
      const httpsUrl = remoteUrl.replace('git@github.com:', 'https://github.com/').replace(/\.git$/, '.git');
      log.dataPull.info({ httpsUrl }, 'Converting SSH remote to HTTPS');
      await runGit(['remote', 'set-url', 'origin', httpsUrl]);
    }

    // Ensure we're on main before resetting — avoid clobbering a session branch
    const currentBranch = await runGit(['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => 'unknown');
    if (currentBranch !== 'main') {
      log.dataPull.info({ branch: currentBranch }, 'Switching to main before pull');
      await runGit(['checkout', 'main']);
    }

    // Discard any local changes — web deployment treats data as read-only
    await runGit(['checkout', '--', '.']).catch(() => { /* no tracked changes */ });
    await runGit(['clean', '-fd']).catch(() => { /* no untracked files */ });

    progress('Fetching updates from GitHub...');
    serverRecorder.record({ type: 'lifecycle', component: 'data-pull', level: 'info', message: 'pull.fetch_start' });
    log.dataPull.info('Fetching origin');
    const fetchStart = Date.now();
    await runGit(['fetch', 'origin'], getConfig().server.gitFetchTimeoutMs);
    serverRecorder.record({ type: 'lifecycle', component: 'data-pull', level: 'info', message: 'pull.fetch_ok', duration_ms: Date.now() - fetchStart });

    progress('Applying updates...');
    serverRecorder.record({ type: 'lifecycle', component: 'data-pull', level: 'info', message: 'pull.reset_start' });
    log.dataPull.info('Resetting to origin/main');
    const resetStart = Date.now();
    await runGit(['reset', '--hard', 'origin/main'], getConfig().server.gitFetchTimeoutMs);
    serverRecorder.record({ type: 'lifecycle', component: 'data-pull', level: 'info', message: 'pull.reset_ok', duration_ms: Date.now() - resetStart });

    log.dataPull.info('Pull completed successfully');
    serverRecorder.record({ type: 'lifecycle', component: 'data-pull', level: 'info', message: 'pull.ok', duration_ms: Date.now() - pullStart });
    res.write(JSON.stringify({ success: true, message: 'Data updated.' }) + '\n');
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'server',
      level: 'error',
      message: 'Operation failed',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    const msg = err instanceof Error ? err.message : String(err);
    log.dataPull.error({ err: msg }, 'Pull failed');
    serverRecorder.record({ type: 'system.error', component: 'data-pull', level: 'error', message: 'pull.failed', error: { name: 'Error', message: msg, stack: (err as Error).stack }, duration_ms: Date.now() - pullStart });
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
  } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'server', level: 'error', message: 'Failed to refresh AI models', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
});

// t/1347: /api/keys/* cluster extracted to routes/keys.ts, registered here at the
// cluster's original first-route position (the interspersed /api/auth/* routes stay).
registerKeysRoutes(router, serverCtx);

// t/897: Easy Auth's /.auth/logout left AppServiceAuthSession valid, so "Sign
// Out" didn't terminate the session (next browser user inherited it). This GET
// (browser navigates here) expires every Easy Auth session cookie present, then
// hands off to /.auth/logout with a post-logout redirect home. Provider-agnostic
// (same session cookie for GitHub/Google). The client links here, not /.auth/logout.
get('/api/auth/logout', (req, res) => {
  res.writeHead(302, {
    'Set-Cookie': expiredAuthCookies(Object.keys(parseCookies(req))),
    'Location': '/.auth/logout?post_logout_redirect_uri=/',
  });
  res.end();
});

// t/1032: defense-in-depth fresh sign-in. The Workbox service worker serves the
// cached SPA for navigations to '/', so t/940's stale-cookie clearing in the
// server-rendered login page never runs for returning users. Routing the SPA's
// sign-in links through here expires any stale Easy Auth session cookie BEFORE
// initiating OAuth, so every attempt starts from a clean state regardless of SW
// cache. Provider is allowlisted — it's interpolated into the redirect target.
const FRESH_LOGIN_PROVIDERS = new Set(['github', 'google', 'aad']);
get('/api/auth/fresh-login/:provider', (req, res) => {
  const provider = param(req, 'provider', '/api/auth/fresh-login/:provider');
  const location = FRESH_LOGIN_PROVIDERS.has(provider)
    ? `/.auth/login/${provider}?post_login_redirect_uri=/`
    : '/'; // unknown provider → land on the login page rather than an open redirect
  res.writeHead(302, {
    'Set-Cookie': expiredAuthCookies(Object.keys(parseCookies(req))),
    'Location': location,
  });
  res.end();
});


// ── AI generation ──

/**
 * t/848: resolve the caller's identity from the verified ALS user context (set
 * once by the S9 middleware from AZURE_AUTH_ENABLED-guarded headers) — NEVER by
 * re-reading raw x-ms-client-principal-* headers, which are spoofable when the
 * container is reachable without Easy Auth (direct ingress / misconfig). An
 * anonymous caller maps to '' so resolveTier yields the free/anonymous tier
 * (the free tier keys on an empty principal), never platform.
 */
function callerIdentity(): { principalName: string; idp: string } {
  return callerTierIdentity(getCurrentUser());
}

// t/896: user-facing provider names for the missing_api_key fast-fail message.
const BACKEND_DISPLAY: Record<string, string> = {
  gemini: 'Gemini', claude: 'Claude (Anthropic)', groq: 'Groq',
  openai: 'OpenAI', deepseek: 'DeepSeek', tavily: 'Tavily', ollama: 'Ollama',
};

post('/api/ai/generate', async (req, res, body) => {
  const { prompt, model, timeout, apiKey: clientKey, search, debateId } = body as { prompt: string; model?: string; timeout?: number; apiKey?: string; search?: boolean; debateId?: string };
  // t/966: stamp the debate client's debateId onto the request context so it lands
  // in the request-completion log (and every log line for this request) — debate
  // sessions become filterable in one query instead of correlating by user+time.
  if (typeof debateId === 'string' && debateId) {
    const rc = getRequestContext();
    if (rc) rc.debateId = debateId.slice(0, 64);
  }
  try {
    const { principalName, idp } = callerIdentity(); // t/848: verified context, not raw headers
    const tier = proxyTiers.resolveTier(principalName, idp);
    const isFree = tier.level === 'free';
    // Free tier (t/793): keyed per-IP (all keyless users would otherwise share
    // one bucket), with the model pinned and prompts capped. Other tiers key by
    // user and honour the requested model.
    const limitKey = isFree ? `free:${getClientIp(req)}` : (principalName || '_anonymous');
    const effectiveModel = isFree ? (tier.pinnedModel ?? model) : model;

    // Free-tier cost is bounded by tokensPerDay + per-IP rate limits; the
    // redundant per-prompt char cap was removed in t/812 (broke long debate
    // prompts: system instructions + soul docs + taxonomy context > 4000 chars).

    // Check backend is allowed
    const backend = ai.resolveBackend(effectiveModel || DEFAULT_MODEL);
    if (!proxyTiers.isBackendAllowed(tier, backend)) {
      res.writeHead(403); res.end(JSON.stringify({ error: `Backend '${backend}' not available on your tier` })); return;
    }

    // Rate limiting (per-IP sliding window for the free tier)
    const rpmCheck = isFree
      ? rateLimiter.checkRate(limitKey, tier.limits.requestsPerMinute, 60_000)
      : rateLimiter.checkRequestRate(limitKey, tier.limits.requestsPerMinute);
    if (!rpmCheck.allowed) {
      // t/924: rate-limit rejections were silent server-side — log + record so the
      // 429 is diagnosable (which limit, pool state, retry timing).
      log.server.warn({ component: 'rate-limiter', type: 'requests_per_minute', limitKey, limit: rpmCheck.limit, current: rpmCheck.current, retryAfterMs: rpmCheck.retryAfterMs, backend }, 'AI request rate-limited (RPM)');
      getGlobalRecorder()?.record({
        type: 'ai.error', component: 'rate-limiter', level: 'warn',
        message: `RPM limit reached (${rpmCheck.current}/${rpmCheck.limit})`,
        data: { type: 'requests_per_minute', limitKey, limit: rpmCheck.limit, current: rpmCheck.current, retryAfterMs: rpmCheck.retryAfterMs, backend, tier: tier.level },
      });
      res.writeHead(429); res.end(JSON.stringify({ error: 'Rate limit exceeded', limitType: 'requests_per_minute', retryAfterMs: rpmCheck.retryAfterMs, limit: rpmCheck.limit, current: rpmCheck.current })); return;
    }
    const tokenCheck = rateLimiter.checkTokenLimit(limitKey, tier.limits.tokensPerDay);
    if (!tokenCheck.allowed) {
      log.server.warn({ component: 'rate-limiter', type: 'tokens_per_day', limitKey, limit: tokenCheck.limit, current: tokenCheck.current, backend }, 'AI request rate-limited (daily tokens)');
      getGlobalRecorder()?.record({
        type: 'ai.error', component: 'rate-limiter', level: 'warn',
        message: `Daily token limit reached (${tokenCheck.current}/${tokenCheck.limit})`,
        data: { type: 'tokens_per_day', limitKey, limit: tokenCheck.limit, current: tokenCheck.current, backend, tier: tier.level },
      });
      res.writeHead(429); res.end(JSON.stringify({ error: 'Daily token limit exceeded', limitType: 'tokens_per_day', limit: tokenCheck.limit, current: tokenCheck.current })); return;
    }

    // Key injection: free tier uses the server's FREE_TIER_GEMINI_KEY; platform
    // users get server-side keys; BYOK users provide their own.
    let explicitKey: string | string[] | undefined;
    if (tier.serverProvidedKey) {
      // t/846: FREE_TIER_GEMINI_KEY may be a comma-separated list; >1 key
      // round-robins across server keys via callWithKeyRotation in generateText.
      const freeKeys = proxyTiers.parseFreeTierKeys(process.env.FREE_TIER_GEMINI_KEY);
      if (freeKeys.length === 0) { res.writeHead(503); res.end(JSON.stringify({ error: 'Free tier is not available' })); return; }
      explicitKey = freeKeys.length === 1 ? freeKeys[0] : freeKeys;
    } else {
      explicitKey = tier.level === 'platform' ? undefined : (clientKey || undefined);
      // t/945: a BYOK user with no key for the requested backend (e.g. Claude-only,
      // hitting the Gemini-pinned BRIEF/CITE helper stages) falls back to the
      // free-tier Gemini pool instead of a 422. Per-user rate limiting (limitKey =
      // principal, not free:IP) still bounds it.
      explicitKey = explicitKey ?? proxyTiers.byokGeminiFallbackKey(tier.level, backend, explicitKey);
    }

    // t/896: fail fast with a clear, actionable error when there is no usable key
    // for the target backend — before the request reaches the AI adapter (which
    // would otherwise surface an opaque upstream 401/403). Free tier
    // (server-provided key) is exempt, and t/945 resolves a free-tier Gemini key
    // above for Claude-only BYOK users. hasApiKey() only finds a *deployed*
    // GEMINI_API_KEY/AI_API_KEY — prod sets neither (only FREE_TIER_GEMINI_KEY),
    // so env-backed Gemini does NOT save a BYOK user here.
    const haveExplicitKey = (typeof explicitKey === 'string' && explicitKey.length > 0)
      || (Array.isArray(explicitKey) && explicitKey.length > 0);
    const missingKey = missingApiKeyError({
      backend,
      displayName: BACKEND_DISPLAY[backend] ?? backend,
      serverProvidedKey: !!tier.serverProvidedKey,
      haveExplicitKey,
      hasResolvedKey: haveExplicitKey || (!tier.serverProvidedKey && await hasApiKey(backend)),
    });
    if (missingKey) {
      res.writeHead(422, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(missingKey));
      return;
    }

    // t/839: record the AI request/response on the happy path so the web-mode
    // retry timeline is visible in the flight recorder (mirrors lib/debate
    // aiAdapter). Prompt content is never recorded — only its length.
    const requestModel = effectiveModel ?? DEFAULT_MODEL;
    const t0 = Date.now();
    getGlobalRecorder()?.record({
      type: 'ai.request', component: 'ai-generate', level: 'info',
      message: `generate ${backend}/${requestModel}`,
      data: { model: requestModel, backend, tier: tier.level, promptLength: prompt?.length ?? 0, debateId },
    });

    const usageOverrides = {
      ...(effectiveModel ? { model: effectiveModel } : {}),
      ...(timeout ? { timeoutMs: timeout } : {}),
    };

    if (search) {
      const result = await ai.generateTextWithSearchByUsage('server.search', { prompt }, effectiveModel ? { model: effectiveModel } : undefined, explicitKey);

      getGlobalRecorder()?.record({
        type: 'ai.response', component: 'ai-generate', level: 'info',
        duration_ms: Date.now() - t0,
        message: `generate+search success ${backend}/${requestModel}`,
        data: { model: requestModel, backend, responseLength: result.text?.length ?? 0, search: true },
      });

      json(res, result);
    } else {
      let result: Awaited<ReturnType<typeof ai.generateText>>;
      try {
        result = await ai.generateTextByUsage('server.chat-response', { prompt }, usageOverrides, undefined, explicitKey);
      } catch (genErr) {
        // t/948: paid Gemini fallback for the free tier. When the entire free pool
        // is rate-limited (upstream 429), retry once with the admin-registered paid
        // key after a deliberate 3s throttle. The paid key never enters the
        // round-robin pool; free keys recover on their own as cooldowns expire
        // (design: docs/design/paid-gemini-fallback.md).
        const paidKey = (ai.is429Error(genErr) && isFree) ? await getPaidGeminiFallbackKey() : null;
        if (!paidKey) throw genErr; // non-free, non-429, or no paid key → outer 429 mapping records it
        getGlobalRecorder()?.record({
          type: 'ai.fallback', component: 'ai-generate', level: 'info',
          message: 'Free-tier keys exhausted — waiting 3s before paid fallback',
          data: { model: requestModel, backend, fallback: 'paid', delayMs: 3000, freeKeyCount: proxyTiers.parseFreeTierKeys(process.env.FREE_TIER_GEMINI_KEY).length },
        });
        // Throttle: caps paid-key throughput (~20/min) and gives free keys time to
        // exit cooldown so the next request reverts to the free pool.
        await new Promise(r => setTimeout(r, 3000));
        try {
          result = await ai.generateTextByUsage('server.chat-response:paid-fallback', { prompt }, usageOverrides, undefined, paidKey);
          getGlobalRecorder()?.record({
            type: 'ai.response', component: 'ai-generate', level: 'info', duration_ms: Date.now() - t0,
            message: `Paid fallback succeeded for ${backend}/${requestModel}`,
            data: { model: requestModel, backend, fallback: 'paid', delayMs: 3000, responseLength: result.text?.length ?? 0 },
          });
        } catch (fallbackErr) {
          getGlobalRecorder()?.record({
            type: 'ai.error', component: 'ai-generate', level: 'warn',
            message: 'Paid fallback also failed',
            data: { model: requestModel, backend, fallback: 'paid', delayMs: 3000 },
            error: { name: (fallbackErr as Error).name ?? 'Error', message: String(fallbackErr), stack: (fallbackErr as Error).stack },
          });
          throw genErr; // both pools exhausted → outer catch maps to a 429 for the client
        }
      }

      getGlobalRecorder()?.record({
        type: 'ai.response', component: 'ai-generate', level: 'info',
        duration_ms: Date.now() - t0,
        message: `generate success ${backend}/${requestModel}`,
        data: { model: requestModel, backend, responseLength: result.text?.length ?? 0, usage: result.tokenUsage },
      });

      if (result.tokenUsage) {
        const milestone = rateLimiter.recordTokenUsage(limitKey, result.tokenUsage.inputTokens, result.tokenUsage.outputTokens, tier.limits.tokensPerDay);
        if (milestone != null) {
          // t/1132: surface the crossed daily-budget threshold (50/80/95) so the
          // renderer's web-bridge post() can show a dismissable quota banner. The
          // reset is the UTC-midnight boundary the daily token buckets key on.
          res.setHeader('X-Token-Budget-Warning', String(milestone));
          res.setHeader('X-Token-Budget-Resets', rateLimiter.nextDailyResetUtc());
        }
      }

      json(res, { text: result.text, tokenUsage: result.tokenUsage });
    }
  } catch (err) {
    // t/920: an upstream provider rate-limit (common when 3 opening statements
    // fire concurrently on a single free-tier key) was collapsing into an opaque,
    // non-retryable HTTP 500. Surface it as a retryable 429 with Retry-After so the
    // debate flow can back off + retry instead of treating it as a fatal error.
    // t/997: Gemini surfaces a too-long context window as RESOURCE_EXHAUSTED, which
    // would otherwise be misread as a 429. It's a 400-class error (retrying won't
    // help) — return context_too_long so the client shows the right message.
    if (ai.isContextTooLongError(err)) {
      log.server.warn({ component: 'ai-generate', model: model ?? 'default' }, 'AI generate input exceeds model context window');
      getGlobalRecorder()?.record({
        type: 'ai.error', component: 'ai-generate', level: 'warn',
        message: 'AI generate input too long for model context window',
        data: { model: model ?? 'default', source: 'context_overflow' },
      });
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'context_too_long', message: 'Input exceeds the model context window — try a shorter prompt or a model with a larger context window' }));
      return;
    }
    if (ai.is429Error(err)) {
      const retry = ai.retryAfterMs(err);
      log.server.warn({ component: 'ai-generate', model: model ?? 'default', retryAfterMs: retry }, 'AI generate upstream rate-limited — returning 429');
      getGlobalRecorder()?.record({
        type: 'ai.error', component: 'ai-generate', level: 'warn',
        message: 'AI generate upstream rate-limited',
        data: { model: model ?? 'default', retryAfterMs: retry, source: 'upstream' },
      });
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(retry / 1000))));
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Upstream AI provider rate limit — retry shortly', limitType: 'upstream_rate_limit', retryAfterMs: retry, retryable: true }));
      return;
    }
    // t/1362: also log at error level via Pino so the 500 is visible in
    // `az containerapp logs show` — the FR record alone requires a browser-
    // triggered dump, which may be impossible if the UI is broken.
    log.server.error({ component: 'ai-generate', model: model ?? 'default', err }, 'AI generate failed');
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'ai-generate', level: 'error',
      message: `AI generate failed: ${String(err)}`,
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      data: { model: model ?? 'default', promptLength: prompt?.length },
    });
    error(res, String(err), 500, err);
  }
});

post('/api/ai/search', async (_req, res, body) => {
  const { prompt, model } = body as { prompt: string; model?: string };
  try {
    json(res, await ai.generateTextWithSearchByUsage('server.search', { prompt }, model ? { model } : undefined));
  } catch (err) {
    if (ai.isContextTooLongError(err)) {
      log.server.warn({ component: 'ai-search', model: model ?? 'default' }, 'AI search input exceeds model context window');
      getGlobalRecorder()?.record({
        type: 'ai.error', component: 'ai-search', level: 'warn',
        message: 'AI search input too long for model context window',
        data: { model: model ?? 'default', source: 'context_overflow' },
      });
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'context_too_long', message: 'Input exceeds the model context window — try a shorter prompt or a model with a larger context window' }));
      return;
    }
    if (ai.is429Error(err)) {
      const retry = ai.retryAfterMs(err);
      log.server.warn({ component: 'ai-search', model: model ?? 'default', retryAfterMs: retry }, 'AI search upstream rate-limited — returning 429');
      getGlobalRecorder()?.record({
        type: 'ai.error', component: 'ai-search', level: 'warn',
        message: 'AI search upstream rate-limited',
        data: { model: model ?? 'default', retryAfterMs: retry, source: 'upstream' },
      });
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(retry / 1000))));
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Upstream AI provider rate limit — retry shortly', limitType: 'upstream_rate_limit', retryAfterMs: retry, retryable: true }));
      return;
    }
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'ai-search', level: 'error',
      message: `AI search failed: ${String(err)}`,
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      data: { model: model ?? 'default', promptLength: prompt?.length },
    });
    error(res, String(err), 500, err);
  }
});

// ── Proxy info endpoints ──

// t/772: backends that are BOTH key-configured AND tier-authorized. The
// multi-provider debate UI uses this instead of per-backend /api/keys/has, which
// only checks key presence and let it assign models to backends that 403 at
// generation time. Cheap: tier config is cached (proxyTiers), the model registry
// is static, and keyStore.get is cached with bust-on-write — no new cache needed.
get('/api/backends/available', async (_req, res) => {
  try {
    const { principalName, idp } = callerIdentity(); // t/848: verified context, not raw headers
    const tier = proxyTiers.resolveTier(principalName, idp);
    const registry = await fileIO.loadAIModels() as { backends?: { id: string }[]; models?: { id: string; backend: string }[] };
    const ids = (registry.backends ?? []).map(b => b.id);
    const keyPresence: Record<string, boolean> = {};
    await Promise.all(ids.map(async (id) => { keyPresence[id] = await hasApiKey(id as AIBackend); }));
    json(res, { backends: ai.computeAvailableBackends(registry, tier.allowedBackends, keyPresence) });
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'server', level: 'error',
      message: 'Failed to compute backend availability',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    error(res, String(err), 500, err);
  }
});

get('/api/proxy/tier', (_req, res) => {
  const { principalName, idp } = callerIdentity(); // t/848: verified context, not raw headers
  const tier = proxyTiers.resolveTier(principalName, idp);
  json(res, { ...tier, principalName: principalName || null });
});

get('/api/proxy/usage', (_req, res) => {
  const { principalName, idp } = callerIdentity(); // t/848: verified context, not raw headers
  const userId = principalName || '_anonymous';
  const tier = proxyTiers.resolveTier(principalName, idp);
  const usage = rateLimiter.getUsage(userId);
  json(res, { tier: tier.level, limits: tier.limits, usage });
});

post('/api/ai/temperature', (_req, res, body) => {
  const { temp } = body as { temp: number | null };
  const previous = ai.getDebateTemperature();
  ai.setDebateTemperature(temp);
  log.api.info({ component: 'ai-config', previous, temp }, 'Debate temperature changed');
  getGlobalRecorder()?.record({
    type: 'lifecycle', component: 'ai-config', level: 'info',
    message: 'Debate temperature changed',
    data: { previous, temp },
  });
  json(res, { ok: true });
});

// ── Embeddings & NLI ──

// t/1062 / t/1171: shared free-tier gate for the embeddings routes. For free-tier
// callers (anonymous, server-provided key) it enforces the per-IP RPM + daily-token
// limits — writing a 429 and returning { blocked: true } if exceeded — and resolves
// the server free-tier key. Non-free callers pass through with no key (unchanged).
function freeTierEmbeddingGate(req: http.IncomingMessage, res: http.ServerResponse): { blocked: boolean; key?: string } {
  const { principalName, idp } = callerIdentity();
  const tier = proxyTiers.resolveTier(principalName, idp);
  if (tier.level !== 'free') return { blocked: false };
  const limitKey = `free:${getClientIp(req)}`;
  const rpmCheck = rateLimiter.checkRate(limitKey, tier.limits.requestsPerMinute, 60_000);
  if (!rpmCheck.allowed) {
    res.writeHead(429); res.end(JSON.stringify({ error: 'Rate limit exceeded', limitType: 'requests_per_minute', retryAfterMs: rpmCheck.retryAfterMs, limit: rpmCheck.limit, current: rpmCheck.current }));
    return { blocked: true };
  }
  const tokenCheck = rateLimiter.checkTokenLimit(limitKey, tier.limits.tokensPerDay);
  if (!tokenCheck.allowed) {
    res.writeHead(429); res.end(JSON.stringify({ error: 'Daily token limit exceeded', limitType: 'tokens_per_day', limit: tokenCheck.limit, current: tokenCheck.current }));
    return { blocked: true };
  }
  const key = tier.serverProvidedKey ? proxyTiers.parseFreeTierKeys(process.env.FREE_TIER_GEMINI_KEY)[0] : undefined;
  return { blocked: false, key };
}

post('/api/embeddings/compute', async (req, res, body) => {
  const { texts, ids } = body as { texts: string[]; ids?: string[] };
  try {
    const gate = freeTierEmbeddingGate(req, res);
    if (gate.blocked) return;
    const vectors = await ai.computeEmbeddings(texts, ids, gate.key);
    json(res, { vectors });
  } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'server', level: 'error', message: 'Failed to compute embeddings', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
});

// t/1171: same free-tier exemption + rate limiting + key as /compute, so anonymous
// semantic search finishes the cheap query-embedding step (not just the corpus one).
post('/api/embeddings/query', async (req, res, body) => {
  const { text } = body as { text: string };
  try {
    const gate = freeTierEmbeddingGate(req, res);
    if (gate.blocked) return;
    const vector = await ai.computeQueryEmbedding(text, gate.key);
    json(res, { vector });
  } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'server', level: 'error', message: 'Failed to compute query embedding', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
});

post('/api/embeddings/update-nodes', async (_req, res, body) => {
  const { nodes } = body as { nodes: { id: string; text: string; pov: string; exclusionText?: string }[] };
  try {
    await ai.updateNodeEmbeddings(nodes);
    json(res, { ok: true });
  } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'server', level: 'error', message: 'Failed to update node embeddings', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
});

post('/api/nli/classify', async (_req, res, body) => {
  const { pairs } = body as { pairs: { text_a: string; text_b: string }[] };
  try {
    const results = await ai.classifyNli(pairs);
    json(res, { results });
  } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'server', level: 'error', message: 'Failed to classify NLI pairs', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
});

// ── Debate sessions ──

// t/1295: the /api/debates cluster (9 routes) moved to routes/debates.ts. This
// single registration replaces both former debates blocks (was here + ~L1831),
// registering all 9 at this position to preserve collision-pair order.
registerDebatesRoutes(router, serverCtx);

// ── Calibration log (per-debate metrics — JSONL from core/) ──
get('/api/calibration/log', (_req, res) => {
  try {
    const logPath = path.join(getDataRoot(), 'calibration', 'core', 'calibration-log.jsonl');
    if (!fs.existsSync(logPath)) { json(res, { entries: [], validationReport: null }); return; }

    const entries = fs.readFileSync(logPath, 'utf-8')
      .split('\n')
      .filter((line: string) => line.trim().length > 0)
      .map((line: string) => JSON.parse(line));

    const reportPath = path.join(getDataRoot(), 'calibration', 'validation-report.json');
    let validationReport = null;
    if (fs.existsSync(reportPath)) {
      try { validationReport = JSON.parse(fs.readFileSync(reportPath, 'utf-8')); } catch { /* telemetry — silent by design */ }
    }

    json(res, { entries, validationReport });
  } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'server', level: 'error', message: 'Failed to load parameter entries', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
});

// ── Calibration parameter history ──
get('/api/calibration/history', async (_req, res) => {
  try {
    const { readParameterHistory, captureSnapshot } = await import('../../../lib/debate/calibrationLogger.js');
    const history = readParameterHistory(getDataRoot());
    const current = captureSnapshot();
    json(res, { current, history });
  } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'server', level: 'error', message: 'Failed to load parameter history', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
});

// ── Flight recorder dump ──
post('/api/flight-recorder/dump', async (_req, res, body) => {
  try {
    const { ndjson, dumpId } = body as { ndjson: string; dumpId?: string };
    if (!ndjson || typeof ndjson !== 'string') { error(res, 'Missing ndjson field', 400); return; }

    // t/908: when the client supplies a dumpId, write client-{dumpId}.jsonl into
    // the paired-dump dir (joinable to server-{dumpId}.jsonl). Otherwise keep the
    // legacy timestamped behavior.
    if (dumpId !== undefined) {
      if (!isValidDumpId(dumpId)) { error(res, 'dumpId must be a UUID-safe string', 400); return; }
      const filePath = await writeDump(getDataRoot(), 'client', dumpId, ndjson);
      json(res, { filePath, filename: path.basename(filePath), dumpId });
      return;
    }

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
    } catch { /* telemetry — silent by design;  retention cleanup is best-effort */ }

    const filename = path.basename(filePath);
    log.fr.info({ filePath }, 'Dump written');
    json(res, { filePath, filename });
  } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'server', level: 'error', message: 'Failed to write flight-recorder dump', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
});

// Server-side flight recorder dump
post('/api/flight-recorder/server-dump', (_req, res) => {
  try {
    const ndjson = appendServerLogs(serverRecorder.buildDump('manual').ndjson);
    const dumpDir = path.join(getDataRoot(), 'flight-recorder');
    fs.mkdirSync(dumpDir, { recursive: true });
    const ts = new Date().toISOString().replace(/:/g, '-');
    const filename = `server-flight-recorder-${ts}.jsonl`;
    const filePath = path.join(dumpDir, filename);
    fs.writeFileSync(filePath, ndjson, 'utf-8');
    log.fr.info({ filePath }, 'Server dump written');
    json(res, { filePath, filename });
  } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'server', level: 'error', message: 'Failed to write server flight-recorder dump', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
});


// t/939: download a single merged (client+server) dump for a dumpId. Mirrors the
// Merge-FlightRecorderDumps cmdlet — interleaves events by _wall, tags _source,
// merges headers/dictionaries/contexts; handles a single side gracefully. Admin
// only: the merge includes the full server ring buffer (other users' internals).
get('/api/flight-recorder/download-merged/:dumpId', async (req, res) => {
  const dumpId = param(req, 'dumpId', '/api/flight-recorder/download-merged/:dumpId');
  if (!isValidDumpId(dumpId)) { error(res, 'dumpId must be a UUID-safe string', 400); return; }
  // t/1064: the download must NOT fail just because the caller isn't an admin —
  // local/Electron users are '_local' (never admin), so the old blanket
  // requireAdmin gate 403'd the very users running this diagnostic locally. The
  // server ring buffer (other users' internals) stays gated: it's merged in only
  // for admins or single-user/local deployments (no other users). Non-admin web
  // callers still get their own client dump.
  const includeServer = community.isAdmin() || STORAGE_MODE !== 'github-api';
  try {
    const merged = await readMergedDump(getDataRoot(), dumpId, { includeServer });
    if (merged === null) {
      // Actionable, copy-pasteable diagnostics (ADR-001 shape) instead of a bare
      // "failed" — relative paths only, no secrets/absolute fs layout.
      json(res, {
        error: 'merged_dump_unavailable',
        goal: `Download the merged flight-recorder dump for dumpId ${dumpId}`,
        // t/1353: since t/1350 dumps persist through the durable storage backend
        // (Azure Blob in production), so replica recycling / ephemeral-/tmp loss is
        // no longer a cause — the remaining causes are upload timing, retention,
        // a wrong dumpId, or a transient backend read failure.
        problem: 'No readable dump exists for this dumpId in durable storage. Likely: the client dump has not finished uploading yet, the pair was pruned by retention (last 20 dumps / 50 MB), the dumpId is wrong, or a transient storage-backend read failure.',
        location: `admin/flight-recorder-dumps/client-${dumpId}.jsonl${includeServer ? ` (and server-${dumpId}.jsonl)` : ''} in the durable storage backend (Azure Blob in production, local filesystem in dev)`,
        nextSteps: [
          'Re-trigger the dump and wait for the "Flight recorder dump saved" toast before clicking download.',
          "Grep the server flight-recorder log for a `flight-recorder.dump.written` event with this dumpId (t/1352) — it records whether the write landed and which backend received it (blob / github-api / local-fs).",
          'Confirm the client upload succeeded — POST /api/flight-recorder/dump should have returned 200 for this dumpId.',
          includeServer
            ? 'For server-side events, confirm the correlated server dump was written (POST /api/admin/flight-recorder/dump, admin only).'
            : 'Server-side events are admin-only in this deployment, so this download would include client events only.',
          'If the FR log shows a successful write but the read still 404s, inspect the storage backend directly (the admin/flight-recorder-dumps/ prefix in the user-content blob container) — this points to a transient read, not ephemeral loss.',
          `dumpId used: ${dumpId} — verify it matches the saved dump's id.`,
        ],
        dumpId,
        requestId: getRequestId(),
      }, 404);
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson',
      'Content-Disposition': `attachment; filename="merged-${dumpId}.jsonl"`,
    });
    res.end(merged);
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'flight-recorder-dumps', level: 'error',
      message: 'Merged dump download failed',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    json(res, {
      error: 'merged_dump_failed',
      goal: `Download the merged flight-recorder dump for dumpId ${dumpId}`,
      problem: `Merging the dump threw: ${clientSafeMessage(String(err), err)}`,
      location: 'readMergedDump → mergeDumps (server)',
      nextSteps: [
        'Retry the download.',
        'If it persists, download the individual client dump from the same toast and file a bug report with this payload.',
      ],
      dumpId,
      requestId: getRequestId(),
    }, 500);
  }
});

get('/api/flight-recorder/list', (_req, res) => {
  try {
    const dumpDir = path.join(getDataRoot(), 'flight-recorder');
    if (!fs.existsSync(dumpDir)) { json(res, { files: [] }); return; }
    const files = fs.readdirSync(dumpDir)
      .filter(f => f.endsWith('.jsonl') && /^(server-)?flight-recorder-/.test(f))
      .map(f => {
        const stat = fs.statSync(path.join(dumpDir, f));
        return { name: f, size: stat.size, modified: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.modified.localeCompare(a.modified));
    json(res, { files });
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'server',
      level: 'error',
      message: 'Failed to list flight-recorder dumps',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    error(res, String(err));
  }
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
  } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'server', level: 'error', message: 'Failed to download flight-recorder dump', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
});

get('/api/flight-recorder/view/:filename', (req, res) => {
  try {
    const filename = decodeURIComponent(param(req, 'filename', '/api/flight-recorder/view/:filename'));
    if (!/^(server-)?flight-recorder-.+\.jsonl$/.test(filename)) {
      error(res, 'Invalid filename', 400);
      return;
    }
    const dumpDir = path.join(getDataRoot(), 'flight-recorder');
    const filePath = path.join(dumpDir, filename);
    if (!fs.existsSync(filePath)) { error(res, 'File not found', 404); return; }

    const viewerPath = path.join(getProjectRoot(), 'tools', 'flight-recorder-viewer.html');
    if (!fs.existsSync(viewerPath)) { error(res, 'Viewer HTML not found', 500); return; }

    const dumpContent = fs.readFileSync(filePath, 'utf-8');
    const viewerHtml = fs.readFileSync(viewerPath, 'utf-8');

    // Escape for inline <script> embedding — crucially neutralizes any
    // `</script>` sequence in the dump so it can't break out (reflected XSS, M3).
    const escaped = escapeForInlineScript(dumpContent);

    const autoLoadScript = `<script>
document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('fileName').textContent = '${escapeForInlineScript(filename)}';
  parseNdjson(\`${escaped}\`);
});
</script>`;

    const outputHtml = viewerHtml.replace('</body>', `${autoLoadScript}\n</body>`);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(outputHtml);
  } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'server', level: 'error', message: 'Failed to render flight-recorder viewer', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
});

// ── Chat sessions ──

get('/api/chats', async (_req, res) => { json(res, await fileIO.listChatSessions()); });

get('/api/chats/:id', async (req, res) => {
  try { json(res, await fileIO.loadChatSession(param(req, 'id', '/api/chats/:id'))); }
  catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'server', level: 'warn', message: 'Failed to load chat session', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 404, err); }
});

put('/api/chats', async (_req, res, body) => {
  try { await fileIO.saveChatSession(body); json(res, { ok: true }); }
  catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'server',
      level: 'error',
      message: 'Failed to save chat session',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    const qi = (err as { quotaInfo?: { resource: string; current: number; limit: number } }).quotaInfo;
    if (qi) { json(res, { error: 'quota_exceeded', resource: qi.resource, current: qi.current, limit: qi.limit, message: String(err) }, status); }
    else { error(res, String(err), status); }
  }
});

del('/api/chats/:id', async (req, res) => {
  try {
    await fileIO.deleteChatSession(param(req, 'id', '/api/chats/:id'));
    json(res, { ok: true });
  } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'server', level: 'error', message: 'Failed to delete chat session', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
});

// ── Community Library ──

// t/1347: /api/community/* cluster extracted to routes/community.ts (registered here at
// the group's position; the community-only respondRateLimited helper moved with it).
registerCommunityRoutes(router, serverCtx);


// Public (spec §8.2): client-relevant subset, no secrets, cached 60s.
get('/api/config/client', (_req, res) => {
  try {
    res.setHeader('Cache-Control', 'max-age=60');
    json(res, getClientConfig());
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'runtime-config', level: 'error',
      message: 'GET /api/config/client failed',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    error(res, String(err), 500, err);
  }
});


// ── Support cases (t/1189) ──
// User endpoints require a signed-in (non-anonymous) caller and are scoped to the
// caller's own cases (a case owned by another user simply 404s). Admin endpoints
// are requireAdmin-gated. The client renders the "Sign in to file a case" prompt.
post('/api/support/cases', async (_req, res, body) => {
  if (isAnonymousUser()) { error(res, 'Sign in to file a support case', 401); return; }
  try {
    const b = (body ?? {}) as { subject?: unknown; description?: unknown; systemInfo?: unknown; priority?: unknown };
    const subject = typeof b.subject === 'string' ? b.subject.trim() : '';
    const description = typeof b.description === 'string' ? b.description.trim() : '';
    if (!subject || subject.length > 200) { error(res, 'subject is required (≤200 chars)', 400); return; }
    if (!description || description.length > 10_000) { error(res, 'description is required (≤10000 chars)', 400); return; }
    const priority = (b.priority === 'low' || b.priority === 'high') ? b.priority : 'medium';
    const si = (b.systemInfo && typeof b.systemInfo === 'object') ? b.systemInfo as Record<string, unknown> : {};
    const systemInfo = {
      appVersion: String(si.appVersion ?? 'unknown').slice(0, 100),
      browser: String(si.browser ?? 'unknown').slice(0, 200),
      os: String(si.os ?? 'unknown').slice(0, 100),
      deploymentMode: (si.deploymentMode === 'electron' ? 'electron' : 'web') as 'web' | 'electron',
    };
    const userId = getStorageUserId();
    const { principalName } = callerIdentity();
    const c = await supportStore.createCase(userId, principalName || userId, { subject, description, systemInfo, priority });
    json(res, { id: c.id, case: c });
  } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'support', level: 'error', message: 'support: create case failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
});

get('/api/support/cases', async (_req, res) => {
  if (isAnonymousUser()) { error(res, 'Sign in to view support cases', 401); return; }
  try { json(res, { items: await supportStore.listCasesForUser(getStorageUserId()) }); }
  catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'support', level: 'error', message: 'support: list cases failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
});

get('/api/support/cases/:id', async (req, res) => {
  if (isAnonymousUser()) { error(res, 'Sign in to view support cases', 401); return; }
  try {
    const c = await supportStore.getCase(getStorageUserId(), param(req, 'id', '/api/support/cases/:id'));
    if (!c) { error(res, 'Case not found', 404); return; }
    json(res, c);
  } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'support', level: 'error', message: 'support: get case failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
});

post('/api/support/cases/:id/attachments', async (req, res, body) => {
  if (isAnonymousUser()) { error(res, 'Sign in to file a support case', 401); return; }
  try {
    const id = param(req, 'id', '/api/support/cases/:id/attachments');
    const b = (body ?? {}) as { filename?: unknown; mimeType?: unknown; dataBase64?: unknown };
    if (typeof b.mimeType !== 'string' || typeof b.dataBase64 !== 'string') { error(res, 'mimeType and dataBase64 are required', 400); return; }
    const bytes = Buffer.from(b.dataBase64, 'base64'); // size/MIME validated on the decoded bytes in saveAttachment
    const result = await supportStore.saveAttachment(getStorageUserId(), id, {
      filename: typeof b.filename === 'string' ? b.filename : 'attachment',
      mimeType: b.mimeType,
      bytes,
    });
    if (!result.ok) { error(res, result.error, result.status); return; }
    json(res, { attachment: result.attachment });
  } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'support', level: 'error', message: 'support: upload attachment failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
});

get('/api/support/cases/:id/attachments/:aid', async (req, res) => {
  if (isAnonymousUser()) { error(res, 'Sign in to view support cases', 401); return; }
  try {
    const found = await supportStore.getAttachment(
      getStorageUserId(),
      param(req, 'id', '/api/support/cases/:id/attachments/:aid'),
      param(req, 'aid', '/api/support/cases/:id/attachments/:aid'),
    );
    if (!found) { error(res, 'Attachment not found', 404); return; }
    res.writeHead(200, {
      'Content-Type': found.meta.mimeType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${found.meta.filename.replace(/[^\w.\- ]/g, '_')}"`,
      'Content-Length': String(found.bytes.length),
    });
    res.end(found.bytes);
  } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'support', level: 'error', message: 'support: download attachment failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
});


// ── Harvest ──
// t/1347: /api/harvest/* cluster extracted to routes/harvest.ts (registrar at group position).
registerHarvestRoutes(router, serverCtx);

// ── Summaries & Sources ──

get('/api/sources', async (_req, res) => {
  json(res, await fileIO.discoverSources());
});

get('/api/summaries/:docId', async (req, res) => {
  const docId = param(req, 'docId', '/api/summaries/:docId');
  const data = await fileIO.loadSummary(docId);
  if (data === null) { error(res, `Summary not found: ${docId}`, 404); return; }
  json(res, data);
});

get('/api/snapshots/:sourceId', async (req, res) => {
  const sourceId = param(req, 'sourceId', '/api/snapshots/:sourceId');
  const data = await fileIO.loadSnapshot(sourceId);
  if (data === null) { error(res, `Snapshot not found: ${sourceId}`, 404); return; }
  json(res, { content: data });
});

// ── Source documents (resolve doc_id → content/path; serve raw PDF) ──

get('/api/source-documents/:docId', async (req, res) => {
  const docId = param(req, 'docId', '/api/source-documents/:docId');
  try {
    json(res, await fileIO.resolveSourceDocument(docId));
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'server',
      level: 'error',
      message: 'Operation failed',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    log.api.warn({ err, docId }, 'source-document resolution failed');
    // AC #3 graceful degradation — never surface a 500 for a missing/bad doc.
    json(res, { available: false, type: null });
  }
});

get('/api/source-documents/:docId/file', async (req, res) => {
  const docId = param(req, 'docId', '/api/source-documents/:docId/file');
  try {
    const pdf = await fileIO.readSourceDocumentPdf(docId);
    if (pdf === null) { error(res, `Source document not found: ${docId}`, 404); return; }
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': pdf.length,
      'Content-Disposition': `inline; filename="${encodeURIComponent(docId)}.pdf"`,
    });
    res.end(pdf);
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'server',
      level: 'error',
      message: 'Operation failed',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    log.api.warn({ err, docId }, 'source-document file serve failed');
    error(res, String(err));
  }
});

// ── Dictionary ──

get('/api/dictionary', async (_req, res) => {
  json(res, await fileIO.loadDictionary());
});

// ── Source evidence ──

type SourceEvidenceIndex = import('../../../lib/debate/evidenceFromSummaries.js').SourceEvidenceIndex;
let _evidenceIndex: SourceEvidenceIndex | null = null;
function loadEvidenceIndex(): SourceEvidenceIndex | null {
  if (_evidenceIndex) return _evidenceIndex;
  try {
    const taxDir = fileIO.getTaxonomyDir();
    const indexPath = path.join(taxDir, 'source_evidence_index.json');
    if (!fs.existsSync(indexPath)) return null;
    _evidenceIndex = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    return _evidenceIndex;
  } catch { /* telemetry — silent by design */ return null; }
}

type DocMetaMap = import('../../../lib/debate/evidenceFromSummaries.js').DocMetaMap;
let _docTitles: DocMetaMap | null | undefined;
function loadDocTitles(): DocMetaMap | null {
  if (_docTitles !== undefined) return _docTitles;
  try {
    // Resolve sources root from .aitriad.json (project root)
    let searchDir = path.resolve(__dirname, '..', '..', '..');
    let aitriadPath = '';
    for (let i = 0; i < 5; i++) {
      const candidate = path.join(searchDir, '.aitriad.json');
      if (fs.existsSync(candidate)) { aitriadPath = candidate; break; }
      searchDir = path.dirname(searchDir);
    }
    if (!aitriadPath) { _docTitles = null; return null; }
    const aitriadConfig = JSON.parse(fs.readFileSync(aitriadPath, 'utf-8'));
    const sourcesRoot = aitriadConfig.sources_root
      ? path.resolve(path.dirname(aitriadPath), aitriadConfig.sources_root)
      : null;
    if (!sourcesRoot || !fs.existsSync(sourcesRoot)) { _docTitles = null; return null; }
    const metaMap: DocMetaMap = {};
    for (const entry of fs.readdirSync(sourcesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const metaPath = path.join(sourcesRoot, entry.name, 'metadata.json');
      if (!fs.existsSync(metaPath)) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        if (meta.title) {
          const docMeta: { title: string; resolved_url?: string; provenance_label?: string } = { title: meta.title };
          if (meta.resolved_url) docMeta.resolved_url = meta.resolved_url;
          if (meta.provenance?.length > 0 && meta.provenance[0].id) docMeta.provenance_label = meta.provenance[0].id;
          if (!docMeta.resolved_url && meta.url) docMeta.resolved_url = meta.url;
          metaMap[entry.name] = docMeta;
        }
      } catch { /* telemetry — silent by design;  skip */ }
    }
    _docTitles = Object.keys(metaMap).length > 0 ? metaMap : null;
    return _docTitles;
  } catch { /* telemetry — silent by design */ _docTitles = null; return null; }
}

get('/api/source-evidence-index', (_req, res) => {
  json(res, loadEvidenceIndex());
});

get('/api/doc-titles', (_req, res) => {
  json(res, loadDocTitles());
});

post('/api/source-evidence', async (_req, res, body) => {
  const { nodeIds, pov } = body as { nodeIds: string[]; pov: string };
  const emptyResult = { facts: [], keyPoints: [], formattedBlock: '', nodesCovered: [], totalCandidates: 0 };
  const index = loadEvidenceIndex();
  if (!index) { json(res, emptyResult); return; }
  try {
    const { retrieveSourceEvidence } = await import('../../../lib/debate/evidenceFromSummaries.js');
    const docTitles = loadDocTitles() ?? undefined;
    json(res, retrieveSourceEvidence(nodeIds, pov, index, 3, 2, docTitles));
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'server',
      level: 'error',
      message: 'Operation failed',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    log.api.warn({ err }, 'source-evidence failed');
    json(res, emptyResult);
  }
});

// ── Evidence QBAF (runs full pipeline server-side) ──

post('/api/evidence-qbaf', async (_req, res, body) => {
  const { claimText, claimId, model } = body as { claimText: string; claimId: string; model?: string };
  if (!claimText || !claimId) { error(res, 'claimText and claimId are required', 400); return; }

  const sourcesDir = fileIO.getSourcesDir();
  if (!sourcesDir || !fs.existsSync(sourcesDir)) { json(res, null); return; }

  try {
    const { retrieveEvidence } = await import('../../../lib/debate/evidenceRetriever.js');
    const { buildEvidenceQbaf } = await import('../../../lib/debate/evidenceQbaf.js');
    type AIAdapter = import('../../../lib/debate/aiAdapter.js').AIAdapter;

    const evidenceItems = retrieveEvidence(claimText, sourcesDir, { topK: 10 });
    if (evidenceItems.length === 0) { json(res, null); return; }

    const adapter: AIAdapter = {
      generateText: async (prompt: string, mdl: string) => {
        const result = await ai.generateText(prompt, mdl);
        return result.text;
      },
    };

    const evalModel = model || DEFAULT_MODEL;
    const result = await buildEvidenceQbaf(claimText, evidenceItems, adapter, evalModel, {
      claimBaseStrength: 0.5,
    });
    json(res, { ...result, claim_id: claimId });
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'server',
      level: 'error',
      message: 'Operation failed',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    log.api.warn({ err }, `evidence-qbaf failed for ${claimId}`);
    json(res, null);
  }
});

// ── Proposals ──

get('/api/proposals', async (_req, res) => { json(res, await fileIO.listProposals()); });

put('/api/proposals/:filename', async (req, res, body) => {
  try {
    await fileIO.saveProposal(param(req, 'filename', '/api/proposals/:filename'), body);
    json(res, { saved: true });
  } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'server', level: 'error', message: 'Failed to save proposal', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
});

// ── PowerShell prompts ──

get('/api/ps-prompts', async (_req, res) => { json(res, await fileIO.listPsPrompts()); });

get('/api/ps-prompts/:name', async (req, res) => {
  json(res, await fileIO.readPsPrompt(param(req, 'name', '/api/ps-prompts/:name')));
});

// ── URL content ──

post('/api/fetch-url', async (_req, res, body) => {
  const { url } = body as { url: string };
  try {
    json(res, await fileIO.fetchUrlContent(url));
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'fetch-url', level: 'warn',
      message: 'Failed to fetch URL content', data: { url },
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    error(res, String(err), 502, err);
  }
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

// ── Git sync ── (17 routes extracted to routes/sync.ts — t/1295)
registerSyncRoutes(router, serverCtx);

// ── Analytics ──

get('/api/auth/me', (req, res) => {
  const azureAuth = process.env.WEBSITE_AUTH_ENABLED === 'True'
    || process.env.WEBSITE_AUTH_ENABLED === 'true';
  const principalName = azureAuth
    ? (req.headers['x-ms-client-principal-name'] as string) || ''
    : '';
  const idp = azureAuth
    ? (req.headers['x-ms-client-principal-idp'] as string) || ''
    : '';
  const isAnon = !principalName;
  const authOpt = process.env.AUTH_OPTIONAL === '1';
  json(res, {
    user: principalName || '_anonymous',
    idp: idp || '',
    anonymous: isAnon,
    capabilities: {
      ai: !isAnon || !authOpt,
      write: !isAnon || !authOpt,
    },
  });
});

get('/api/user/profile', (req, res) => {
  const azureAuth = process.env.WEBSITE_AUTH_ENABLED === 'True'
    || process.env.WEBSITE_AUTH_ENABLED === 'true';
  const principalName = azureAuth
    ? (req.headers['x-ms-client-principal-name'] as string) || ''
    : '';
  const idp = azureAuth
    ? (req.headers['x-ms-client-principal-idp'] as string) || ''
    : '';
  const isAnon = !principalName;
  const userId = deriveStorageUserId(principalName || '_local', idp || '_local');
  const adminUsers = (process.env.ADMIN_USERS || 'jpsnover,jsnover13-at-gmail-com').split(',').map(s => s.trim());
  const quotaLimits = isAnon ? null : getQuotaLimits(userId);
  json(res, {
    userId,
    displayName: principalName || 'Anonymous',
    idp: idp || null,
    isAnonymous: isAnon,
    isAdmin: !isAnon && adminUsers.includes(userId),
    quotas: quotaLimits,
  });
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
  analytics.appendEvents(events).catch((e) => {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'analytics', level: 'error',
      message: 'Analytics append failed',
      error: { name: (e as Error).name ?? 'Error', message: String(e), stack: (e as Error).stack },
    });
  });
  json(res, { ok: true, count: events.length });
});

// t/1128: receives the login page's service-worker state beacon (stuck-SW
// diagnosis, t/1126). Public — the login page is pre-auth. Best-effort: log the
// reported SW registrations/controller (captured in server-log dumps), then 204
// (sendBeacon ignores the response body).
post('/api/diagnostics/sw-state', (req, res, body) => {
  try {
    const info = (body && typeof body === 'object') ? body as Record<string, unknown> : { raw: String(body).slice(0, 500) };
    log.server.info(
      { component: 'sw-diagnostics', sw: info, ip: getClientIp(req), ua: (req.headers['user-agent'] || '').slice(0, 200) },
      'Login-page service-worker state beacon (t/1128)',
    );
  } catch { /* telemetry — silent by design: never fail a diagnostics beacon */ }
  res.writeHead(204);
  res.end();
});

get('/api/analytics/query', async (req, res) => {
  const url = new URL(req.url!, 'http://localhost');
  const from = url.searchParams.get('from') || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const to = url.searchParams.get('to') || new Date().toISOString().slice(0, 10);
  const user = url.searchParams.get('user') || undefined;
  const sessionId = url.searchParams.get('session_id') || undefined;

  if (user || sessionId) {
    // t/850: raw per-user/session events expose other users' telemetry — admin only.
    if (!requireAdmin(res)) return;
    json(res, { events: await analytics.queryRawEvents(from, to, user, sessionId) });
  } else {
    json(res, await analytics.queryAggregated(from, to));
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
      log.trace.debug({ event: ev }, 'Client trace event');
    }
    json(res, { received: accepted.length, dropped: Math.max(0, events.length - accepted.length) });
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'server',
      level: 'error',
      message: 'Operation failed',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
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

  // t/854: never serve source maps in production — *.js.map lets anyone recover
  // the full client source (API shapes, auth flows, internal logic). 404 them.
  if (process.env.NODE_ENV === 'production' && url.pathname.endsWith('.map')) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return true;
  }

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
    // L10: cap request/upload body size, surfaced as HTTP 413 (covers
    // /api/upload-document and every other POST/PUT, which all read via readBody).
    if (totalBytes > MAX_BODY_BYTES) throw Object.assign(new Error('Request body too large'), { statusCode: 413 });
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf-8');
  // Stash raw bytes so HMAC-verified endpoints (webhook) can recompute the
  // signature. Parse-then-stringify would change whitespace and break it.
  (req as RawBodyReq).__rawBody = raw;
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch (err) {
    // Non-JSON bodies (raw text uploads) legitimately land here, so warn-only —
    // but record so malformed-JSON API calls aren't invisible.
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'http-body', level: 'warn',
      message: 'Request body is not valid JSON — passing raw string through',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    return raw;
  }
}

// ── HTTP server ──

// Resolve allowed CORS origins from ALLOWED_ORIGINS env var (comma-separated).
// In production, rejects cross-origin requests when unset (S8).
const ALLOWED_ORIGINS = (() => {
  if (process.env.ALLOWED_ORIGINS) {
    return process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean);
  }
  if (process.env.NODE_ENV === 'production') {
    log.security.warn('ALLOWED_ORIGINS not set in production — CORS will reject cross-origin requests');
    return [];
  }
  return null; // null = allow all (development mode)
})();

function getCorsOrigin(req: http.IncomingMessage): string {
  if (!ALLOWED_ORIGINS) return '*';
  const origin = req.headers.origin || '';
  return ALLOWED_ORIGINS.includes(origin) ? origin : (ALLOWED_ORIGINS[0] ?? '');
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
        log.auth.info({ count: data.users.length, path: p }, 'Loaded authorized users');
        return data;
      }
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'server',
        level: 'error',
        message: 'Operation failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      log.auth.error({ path: p, err }, 'Failed to parse authorized users file');
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

// ── Anonymous route guard ──
// When AUTH_OPTIONAL is enabled, anonymous users get read-only, non-AI access.
// Auth-gate 403 rejection reason codes, surfaced in the response and the flight
// recorder so a 403 can be triaged without reading the auth code (t/763).
type AuthDenyReason = 'anon_route_blocked' | 'no_auth_header' | 'user_not_in_allowlist';

function recordAuthDenied(reason: AuthDenyReason, method: string, urlPath: string): void {
  getGlobalRecorder()?.record({
    type: 'system.error',
    component: 'auth',
    level: 'warn',
    message: `Auth gate 403 (${reason}): ${method} ${urlPath}`,
  });
}

// t/940: a stale Easy Auth cookie (AppServiceAuthSession present but no valid
// principal) makes the OAuth redirect loop back to the login page. Whenever we
// serve that page, expire any such cookie so the next sign-in click starts from a
// clean state — the auto-clear half of AC#1 (the page also offers a manual link).
function loginPageHeaders(req: http.IncomingMessage): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = { 'Content-Type': 'text/html' };
  const cookieNames = Object.keys(parseCookies(req));
  if (hasEasyAuthSessionCookie(cookieNames)) {
    headers['Set-Cookie'] = expiredAuthCookies(cookieNames);
  }
  return headers;
}

// t/1128: login-page service-worker self-heal + state beacon. The server-rendered
// login page otherwise has no JS, so a stuck old SW (from before the /.auth/
// denylist) can intercept the sign-in navigations (t/1126) with no signal. This
// (1) beacons the SW registration state for diagnosis and (2) unregisters any SW
// once (sessionStorage-guarded against reload loops) so the sign-in links work —
// the current SW re-registers after a successful login. The script text is static,
// so its CSP sha256 is derived from this same constant and can never drift out of
// sync (script-src has no 'unsafe-inline'; a hash source is the safe way in).
const SW_HEAL_SCRIPT =
  `(function(){try{if(!('serviceWorker' in navigator))return;` +
  `navigator.serviceWorker.getRegistrations().then(function(regs){` +
  `var info={page:'login',controller:navigator.serviceWorker.controller?navigator.serviceWorker.controller.scriptURL:null,` +
  `registrations:regs.map(function(r){return{scope:r.scope,script:(r.active&&r.active.scriptURL)||null};}),` +
  `ua:navigator.userAgent,ts:Date.now()};` +
  `try{navigator.sendBeacon('/api/diagnostics/sw-state',new Blob([JSON.stringify(info)],{type:'application/json'}));}catch(e){}` +
  `var stuck=regs.length>0||!!navigator.serviceWorker.controller;` +
  `if(stuck&&sessionStorage.getItem('sw_login_cleared')!=='1'){sessionStorage.setItem('sw_login_cleared','1');` +
  `Promise.all(regs.map(function(r){return r.unregister();})).then(function(){location.reload();}).catch(function(){});}` +
  `}).catch(function(){});}catch(e){}})();`;
const SW_HEAL_SCRIPT_CSP_HASH = `'sha256-${crypto.createHash('sha256').update(SW_HEAL_SCRIPT).digest('base64')}'`;

function buildLoginPage(showAnonymous: boolean): string {
  const subtitle = showAnonymous
    ? 'Sign in for full access, or browse read-only without signing in'
    : 'Sign in to continue';

  const anonymousSection = showAnonymous ? `
  <div class="divider"><span>or</span></div>
  <a class="btn btn-anonymous" href="/.auth/anonymous">
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>
    Continue without signing in
  </a>
  <p class="anon-note">Anonymous users have read-only access — sign in to use AI features and edit content</p>` : '';

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
  .clear-link { display: inline-block; margin-top: 24px; color: #64748b; font-size: 0.75rem; text-decoration: underline; }
  .clear-link:hover { color: #94a3b8; }
</style>
<script>${SW_HEAL_SCRIPT}</script>
</head>
<body>
<div class="card">
  <h1>Taxonomy Editor</h1>
  <p class="subtitle">${subtitle}</p>
  <a class="btn btn-github" href="/api/auth/fresh-login/github">
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
    Sign in with GitHub
  </a>
  <a class="btn btn-google" href="/api/auth/fresh-login/google">
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
    Sign in with Google
  </a>
  <a class="btn btn-microsoft" href="/api/auth/fresh-login/aad">
    <svg viewBox="0 0 24 24" fill="currentColor"><rect x="1" y="1" width="10" height="10" fill="#F25022"/><rect x="13" y="1" width="10" height="10" fill="#7FBA00"/><rect x="1" y="13" width="10" height="10" fill="#00A4EF"/><rect x="13" y="13" width="10" height="10" fill="#FFB900"/></svg>
    Sign in with Microsoft
  </a>
  ${anonymousSection}
  <a class="clear-link" href="/api/auth/logout">Trouble signing in? Clear session &amp; retry</a>
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
  <a class="btn" href="/api/auth/logout">Sign out</a>
</div>
</body>
</html>`;

// S9: Only trust Easy Auth headers when running on Azure with auth enabled.
// Without this gate, clients can spoof X-MS-CLIENT-PRINCIPAL-NAME if the
// container is exposed directly (not behind Azure's front-end proxy).
const AZURE_AUTH_ENABLED = process.env.WEBSITE_AUTH_ENABLED === 'True'
  || process.env.WEBSITE_AUTH_ENABLED === 'true';

const server = http.createServer((req, res) => { void handleRequest(req, res); });
async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  // Correlation ID: use incoming header or generate a new one
  const requestId = (req.headers['x-request-id'] as string) || generateRequestId();
  res.setHeader('X-Request-Id', requestId);

  const requestStart = Date.now();
  const urlPath = req.url?.split('?')[0] || '';

  return runWithRequestContext(
    { requestId, method: req.method, path: urlPath },
    () => handleRequestInner(req, res, requestId, requestStart),
  );
}

async function handleRequestInner(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  requestId: string,
  requestStart: number,
) {
  // Log request completion when response finishes
  res.on('finish', () => {
    const duration = Date.now() - requestStart;
    const urlPath = req.url?.split('?')[0] || '';
    // Skip noisy static asset and health check logging
    const isQuiet = urlPath.startsWith('/assets/') || urlPath === '/health' || urlPath === '/healthz';
    if (!isQuiet) {
      log.server.info({
        requestId,
        method: req.method,
        path: urlPath,
        status: res.statusCode,
        duration_ms: duration,
      }, 'Request completed');
      // t/1022: a 404 on /api/*/assets/*.js means index.html was served for an API
      // path (service-worker navigateFallback or SPA catch-all) — this should never
      // happen under normal operation, so surface it as a warning instead of burying
      // it as a routine info-level 404.
      if (res.statusCode === 404 && /^\/api\/.*\/assets\//.test(urlPath)) {
        log.server.warn({
          requestId,
          path: urlPath,
        }, 'Anomalous 404: SPA index.html likely served for an API path (service-worker interception or SPA fallback misconfiguration)');
      }
      serverRecorder.record({
        type: 'lifecycle',
        component: serverRecorder.intern('component', 'server') as string | number,
        level: duration > 5000 ? 'warn' : 'info',
        message: `${req.method} ${urlPath} ${res.statusCode} ${duration}ms`,
        duration_ms: duration,
        data: { method: req.method, path: urlPath, status: res.statusCode, requestId },
      });
    }
  });

  // S10: Security headers on all responses
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // L8: deny powerful features the app never uses.
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production' || process.env.ALLOWED_ORIGINS) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    // L9: style-src keeps 'unsafe-inline' — accepted risk. React applies inline
    // style attributes (style={{…}}) which CSP blocks without it; removing it
    // breaks the UI. script-src has NO unsafe-inline, so the XSS surface is small.
    // t/856: scope WebSocket origins instead of a bare `wss:` (which allowed any
    // host). Same-origin ws/wss is covered by 'self'; additionally allow each
    // configured ALLOWED_ORIGINS host over wss.
    const wssOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean)
      .map(o => o.replace(/^https?:/i, 'wss:'));
    const connectSrc = ["connect-src 'self'", ...wssOrigins].join(' ');
    // script-src adds the sha256 of the login page's static SW-heal script (t/1128)
    // so it runs without re-opening 'unsafe-inline'. The hash is derived from the
    // script constant, so it stays in sync automatically.
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' ${SW_HEAL_SCRIPT_CSP_HASH}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; ${connectSrc}; font-src 'self'; worker-src 'self'`);
  }

  // CORS headers — locked to ALLOWED_ORIGINS in production, permissive in dev.
  // (L11: X-Admin-Key dropped — the static admin-key auth path was removed;
  //  admin access is OAuth + ADMIN_USERS only, so there's no key to brute-force.)
  res.setHeader('Access-Control-Allow-Origin', getCorsOrigin(req));
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Filename');
  // t/1132: let the renderer read the token-budget milestone headers cross-origin
  // (same-origin reads them anyway; this covers proxied/cross-origin topologies).
  res.setHeader('Access-Control-Expose-Headers', 'X-Token-Budget-Warning, X-Token-Budget-Resets');
  if (ALLOWED_ORIGINS) res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // S9: Only read Easy Auth headers when Azure auth is confirmed via env var.
  let principalName = AZURE_AUTH_ENABLED
    ? (req.headers['x-ms-client-principal-name'] as string) || ''
    : '';
  let idp = AZURE_AUTH_ENABLED
    ? (req.headers['x-ms-client-principal-idp'] as string) || ''
    : '';

  // t/1125: dev/staging-only X-Test-Persona override (production-inert — requires
  // ENABLE_TEST_PERSONA_HEADER=1 + a matching X-Test-Persona-Secret). Lets the
  // persona regression matrix exercise authenticated/admin rows from the CLI.
  const personaOverride = resolveTestPersonaOverride(req.headers, community.getAdminUsers());
  if (personaOverride && 'error' in personaOverride) {
    res.writeHead(401, { 'Content-Type': 'application/json', 'X-Auth-Reason': personaOverride.error });
    res.end(JSON.stringify({ error: 'Invalid test persona', reason: personaOverride.error }));
    return;
  }
  if (personaOverride) {
    principalName = personaOverride.principalName;
    idp = personaOverride.idp;
    log.server.info(
      { persona: personaOverride.persona, principalName: principalName || null, idp: idp || null },
      'Test-persona override applied (dev/staging Easy Auth short-circuit)',
    );
  }

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
    || urlPath === '/api/data/available'
    || urlPath === '/api/auth/me'
    || urlPath === '/api/auth/logout' // t/897: logout must work even for authed-but-unauthorized users
    || urlPath.startsWith('/api/auth/fresh-login/') // t/1032: pre-auth fresh sign-in (clears stale cookies, then OAuth)
    || urlPath === '/api/diagnostics/sw-state' // t/1128: pre-auth SW-state beacon from the login page
    || urlPath === '/llms.txt' // t/1143: public llms.txt discovery file
    || urlPath === '/api/config/client' // t/927: public client config subset (no secrets)
    || urlPath === '/api/user/profile'
    || urlPath === '/api/sync/webhook/github'
    || urlPath === '/api/community/submit'
    || urlPath.startsWith('/.auth/')
    || urlPath.startsWith('/assets/')
    || urlPath === '/manifest.webmanifest'
    || urlPath === '/sw.js'
    || urlPath.startsWith('/workbox-')
    || urlPath.startsWith('/icons/');
  // AUTH_DISABLED='1' (default) = anonymous access, no login page.
  // AUTH_OPTIONAL='1' = show login page with anonymous option; sign-in
  //   unlocks platform-tier keys, anonymous users get lower limits + BYOK.
  // Neither = required auth (must sign in + be in authorized-users.json).
  const authDisabled = process.env.AUTH_DISABLED === '1';
  const authOptional = process.env.AUTH_OPTIONAL === '1';

  // /.auth/anonymous — sets a session cookie and redirects to the app
  if (urlPath === '/.auth/anonymous' && authOptional) {
    const secureSuffix = process.env.NODE_ENV === 'production' || process.env.ALLOWED_ORIGINS ? '; Secure' : '';
    const anonSessionId = crypto.randomUUID();
    res.writeHead(302, {
      'Location': '/',
      'Set-Cookie': [
        `auth_anonymous=1; Path=/; HttpOnly; SameSite=Lax${secureSuffix}`,
        `anon_session_id=${anonSessionId}; Path=/; HttpOnly; SameSite=Lax${secureSuffix}`,
      ],
    });
    res.end();
    return;
  }

  // Clear anonymous cookies when user signs in via EasyAuth
  if (principalName && parseCookies(req)['auth_anonymous'] === '1') {
    res.setHeader('Set-Cookie', [
      'auth_anonymous=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
      'anon_session_id=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
    ]);
  }

  if (!isPublicPath && !authDisabled) {
    if (authOptional) {
      // Optional mode: show login page unless user signed in or chose anonymous
      if (!principalName) {
        const isAnonymousSession = parseCookies(req)['auth_anonymous'] === '1';
        if (!isAnonymousSession) {
          res.writeHead(200, loginPageHeaders(req));
          res.end(buildLoginPage(true));
          return;
        }
      }
    } else if (getAuthorizedUsers()) {
      // Required mode: must sign in and be in the allowlist
      if (!principalName) {
        // API clients can't act on an HTML login page — return a structured 403
        // with a machine-readable reason (t/763). Browser routes keep the login
        // page so the sign-in flow is unchanged.
        if (urlPath.startsWith('/api/')) {
          recordAuthDenied('no_auth_header', req.method || 'GET', urlPath);
          res.writeHead(403, { 'Content-Type': 'application/json', 'X-Auth-Reason': 'no_auth_header' });
          res.end(JSON.stringify({ error: 'Sign in required', reason: 'no_auth_header' }));
          return;
        }
        res.writeHead(200, loginPageHeaders(req));
        res.end(buildLoginPage(false));
        return;
      }

      if (!isUserAuthorized(principalName, idp)) {
        recordAuthDenied('user_not_in_allowlist', req.method || 'GET', urlPath);
        // Browser-facing forbidden page; reason exposed via header for triage.
        res.writeHead(403, { 'Content-Type': 'text/html', 'X-Auth-Reason': 'user_not_in_allowlist' });
        res.end(FORBIDDEN_PAGE(principalName));
        return;
      }
    }
  }

  // Anonymous route guard: in AUTH_OPTIONAL mode, block AI + write routes
  if (authOptional && !principalName && !isPublicPath) {
    const method = req.method || 'GET';
    // Free tier (t/793): when configured, keyless users may reach AI generation;
    // the handler enforces the free-tier model pin, per-IP limits, and key. Inert
    // until FREE_TIER_GEMINI_KEY is set, so the AI block otherwise stands.
    const freeTierRoute = method === 'POST'
      && (urlPath === '/api/ai/generate' || urlPath === '/api/embeddings/compute' || urlPath === '/api/embeddings/query')
      && proxyTiers.freeTierEnabled();
    if (!freeTierRoute && !isAnonAllowedRoute(method, urlPath)) {
      recordAuthDenied('anon_route_blocked', method, urlPath);
      res.writeHead(403, { 'Content-Type': 'application/json', 'X-Auth-Reason': 'anon_route_blocked' });
      res.end(JSON.stringify({ error: 'Sign in required', reason: 'anon_route_blocked', detail: 'AI features and editing require authentication. Sign in at /.auth/login/github to unlock full access.' }));
      return;
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
    ? await sessionManager.resolveBranch(principalName || '_local')
    : undefined;
  const isAnon = !principalName;
  const effectivePrincipal = principalName || '_local';
  const effectiveIdp = idp || '_local';
  const storageUserId = deriveStorageUserId(effectivePrincipal, effectiveIdp);

  // Cross-provider collision guard: verify the idp matches the one that first
  // claimed this storageUserId. Prevents a different provider from accessing
  // another user's data by presenting the same normalized email.
  if (!isAnon) {
    const binding = checkProviderBinding(storageUserId, effectiveIdp);
    if (!binding.ok) {
      json(res, {
        error: 'provider_mismatch',
        message: `This account is bound to a different identity provider (${binding.boundTo}). Sign in with your original provider.`,
      }, 403);
      return;
    }
  }

  // t/803: surface the sanitized storage id (e.g. "jpsnover") in the request log
  // context — never the raw email/principal (PII).
  const reqCtx = getRequestContext();
  if (reqCtx) reqCtx.userId = storageUserId;
  const anonymousSessionId = isAnon ? parseCookies(req)['anon_session_id'] : undefined;
  const userCtx = { principalName: effectivePrincipal, idp: effectiveIdp, branchName: sessionBranch, storageUserId, isAnonymous: isAnon, anonymousSessionId };
  await runWithUser(userCtx, async () => {

    const url = new URL(req.url!, 'http://localhost');
    const route = matchRoute(req.method!, url.pathname);

    // M7: per-IP rate limit on API write methods (100/min) — basic DoS/abuse guard.
    if (route && (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') && url.pathname.startsWith('/api/')) {
      const wr = rateLimiter.checkRate(`write:${getClientIp(req)}`, 100, 60_000);
      if (!wr.allowed) {
        const retryAfter = Math.max(1, Math.ceil((wr.retryAfterMs ?? 60_000) / 1000));
        // t/925: write-rate 429s were silent — log so abuse/DoS spikes are visible.
        log.server.warn({ component: 'rate-limiter', type: 'write_per_minute', method: req.method, path: url.pathname, retryAfter }, 'API write rate-limited');
        res.setHeader('Retry-After', String(retryAfter));
        json(res, { error: 'rate_limited', message: 'Too many requests', retryAfter }, 429);
        return;
      }
    }

    if (route) {
      (res as any).__routePath = route.routePath;
      // t/810: validate user-provided path params at the routing layer (primary
      // gate) before the handler runs. Handlers keep assertSafe* as defense-in-depth.
      const badParam = invalidRouteParam(route.routePath, url.pathname);
      if (badParam) {
        getGlobalRecorder()?.record({
          type: 'system.error', component: 'server', level: 'warn',
          message: `Blocked invalid path parameter '${badParam}': ${req.method} ${url.pathname}`,
        });
        json(res, { error: `Invalid path parameter: ${badParam}`, requestId: getRequestId() }, 400);
        return;
      }
      try {
        const body = ['POST', 'PUT', 'DELETE'].includes(req.method!) ? await readBody(req) : {};
        await route.handler(req, res, body);
      } catch (err) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: route.routePath,
          level: 'error',
          message: `Unhandled error in ${route.routePath}`,
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
        log.server.error({ err, method: req.method, path: url.pathname, route: route.routePath }, 'Error handling request');
        const status = (err as { statusCode?: number }).statusCode ?? 500;
        // M4: full detail is recorded/logged above; clients get a generic message
        // for server errors in production (the error string can carry file paths).
        const clientError = (status >= 500 && process.env.NODE_ENV === 'production') ? 'Internal server error' : String(err);
        const payload: Record<string, unknown> = { error: clientError };
        if ((err as { quotaInfo?: unknown }).quotaInfo) payload.quotaInfo = (err as { quotaInfo: unknown }).quotaInfo;
        json(res, payload, status);
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

// M8: cap WebSocket frames at 1 MB (chat/debate messages are far smaller); the
// ws default is 100 MB, an easy memory-exhaustion vector.
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
const eventClients = new Set<WebSocket>();

function broadcastEvent(type: string, data: unknown) {
  const msg = JSON.stringify({ type, data });
  for (const ws of eventClients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

// POV/taxonomy file keys the client toast knows how to label (Phase 5F / t/652).
const TAXONOMY_POV_FILES = new Set(['accelerationist', 'safetyist', 'skeptic', 'cross-cutting', 'situations']);

/** Map a committed file path to its POV key, or null if it isn't a taxonomy POV file. */
function povKeyForPath(p: string): string | null {
  const base = p.split('/').pop() ?? p;
  if (!base.endsWith('.json')) return null;
  const key = base.slice(0, -'.json'.length);
  return TAXONOMY_POV_FILES.has(key) ? key : null;
}

/**
 * Best-effort Phase 5F broadcast (t/652): after a session save commits, tell other
 * web clients which POV files changed and a changed-node count. Affected POVs come
 * from the committed paths; the count diffs each written POV file against its cached
 * base. Never throws and never fires when no POV file changed — a broadcast failure
 * must not affect the save (web/container mode only; filesystem commits return early).
 */
async function broadcastTaxonomyUpdate(
  backend: GitHubAPIBackend,
  pending: { writes: { path: string; content: string }[]; deletes: string[] } | null,
  user: string,
): Promise<void> {
  try {
    if (!pending) return;
    const povs = new Set<string>();
    let nodeCount = 0;

    for (const w of pending.writes) {
      const key = povKeyForPath(w.path);
      if (!key) continue;
      povs.add(key);
      try {
        const newNodes = (JSON.parse(w.content) as { nodes?: unknown[] }).nodes ?? [];
        const baseRaw = await backend.readBaseFromCache(w.path);
        const oldNodes = baseRaw ? ((JSON.parse(baseRaw.replace(/^﻿/, '')) as { nodes?: unknown[] }).nodes ?? []) : [];
        const diff = diffNodes(
          oldNodes as Parameters<typeof diffNodes>[0],
          newNodes as Parameters<typeof diffNodes>[1],
        );
        nodeCount += diff.added.length + diff.modified.length + diff.deleted.length;
      } catch { /* telemetry — silent by design: node count is best-effort */ }
    }
    for (const p of pending.deletes) {
      const key = povKeyForPath(p);
      if (key) povs.add(key);
    }

    if (povs.size === 0) return; // not a taxonomy change — nothing to announce
    broadcastEvent('taxonomy-updated', { user, nodeCount, povs: [...povs] });
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'server',
      level: 'warn',
      message: 'taxonomy-updated broadcast failed',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
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

// L6 (t/720): the terminal WS spawns a server-side shell, so restrict it to
// admins. AUTH_DISABLED is single-operator local/dev mode (L1 forbids it in
// production), so the local operator keeps terminal access; every authenticated
// deployment requires an admin user. Runs outside the per-request ALS context,
// so the userId is derived from the principal headers directly.
function isTerminalWebSocketAllowed(req: http.IncomingMessage): boolean {
  const principalName = AZURE_AUTH_ENABLED
    ? (req.headers['x-ms-client-principal-name'] as string) || ''
    : '';
  const idp = AZURE_AUTH_ENABLED
    ? (req.headers['x-ms-client-principal-idp'] as string) || ''
    : '';
  return isTerminalAccessAllowed({
    authDisabled: process.env.AUTH_DISABLED === '1',
    principalName,
    isAdmin: !!principalName && community.isAdmin(deriveStorageUserId(principalName, idp)),
  });
}

server.on('upgrade', (req, socket, head) => {
  // S-WS-ORIGIN: Validate Origin header against ALLOWED_ORIGINS to prevent
  // cross-origin WebSocket hijacking (WebSocket bypasses CORS).
  if (ALLOWED_ORIGINS) {
    const origin = (req.headers.origin || '') as string;
    if (!ALLOWED_ORIGINS.includes(origin)) {
      log.security.warn({ origin }, 'Blocked WebSocket upgrade from disallowed origin');
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
    if (!isTerminalWebSocketAllowed(req)) {
      log.security.warn('Blocked non-admin terminal WebSocket upgrade');
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
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
    } catch { /* telemetry — silent by design;  ignore malformed messages */ }
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
  log.server.info({ signal }, 'Shutting down gracefully');

  // Dump server flight recorder on shutdown
  try {
    serverRecorder.record({ type: 'lifecycle', component: 'server', level: 'info', message: `Shutdown: ${signal}` });
    const ndjson = appendServerLogs(serverRecorder.buildDump('manual').ndjson);
    const dumpDir = path.join(getDataRoot(), 'flight-recorder');
    fs.mkdirSync(dumpDir, { recursive: true });
    fs.writeFileSync(path.join(dumpDir, `server-shutdown-${Date.now()}.jsonl`), ndjson);
  } catch { /* telemetry — silent by design;  best effort */ }

  // 1a. Stop GitHubAPIBackend polling
  if (githubBackend) {
    githubBackend.shutdown();
  }

  // 1. Kill terminal PTY
  if (terminalProcess) {
    log.server.info('Terminating PTY process');
    terminalProcess.kill();
    terminalProcess = null;
  }

  // 2. Close all WebSocket connections
  for (const ws of eventClients) {
    try { ws.close(1001, 'Server shutting down'); } catch { /* telemetry — silent by design;  ignore */ }
  }
  eventClients.clear();

  // 3. Stop accepting new connections and wait for in-flight requests
  server.close(() => {
    log.server.info('All connections closed, exiting');
    process.exit(0);
  });

  // 4. Force exit after 10s if graceful shutdown stalls
  setTimeout(() => {
    log.server.error('Graceful shutdown timed out after 10s, forcing exit');
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
  } catch { /* telemetry — silent by design;  best effort */ }
  log.server.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  serverRecorder.record({ type: 'system.error', component: 'server', level: 'error', message: err.message, error: { name: err.name, message: err.message, stack: err.stack?.slice(0, 500) } });
  log.server.error({ err }, 'Unhandled promise rejection');
});

// ── Anonymous session store (in-memory, ephemeral) ──
initAnonymousSessionStore({
  sessionTtlMs: parseInt(process.env.ANON_SESSION_TTL_MS || '0', 10) || undefined,
  maxSessions: parseInt(process.env.ANON_MAX_SESSIONS || '0', 10) || undefined,
});

// ── Start ──

server.listen(PORT, '0.0.0.0', () => {
  serverRecorder.record({ type: 'lifecycle', component: 'server', level: 'info', message: 'Server started', data: { port: PORT, version: SERVER_VERSION, dataRoot: getDataRoot(), platform: process.platform, arch: process.arch, storageMode: STORAGE_MODE } });
  log.server.info({ port: PORT }, 'Taxonomy Editor running');
  log.server.info({ dataRoot: getDataRoot() }, 'Data root');

  // t/924: surface the free-tier key pool + effective RPM so rate-limit
  // behavior is observable from startup logs (not inferred from 429 timing).
  const freeTierKeyPool = proxyTiers.parseFreeTierKeys(process.env.FREE_TIER_GEMINI_KEY).length;
  log.server.info({ component: 'server', freeTierKeyPool, effectiveRpm: proxyTiers.scaledFreeTierRpm(freeTierKeyPool) }, 'Free-tier key pool');

  // Initialize analytics storage — uses Azure Append Blobs in container
  // deployments, local NDJSON files in Electron/dev.
  const analyticsBlobUrl = process.env.AZURE_STORAGE_ACCOUNT_URL;
  const analyticsContainer = process.env.AZURE_ANALYTICS_CONTAINER || 'analytics';
  analytics.initAnalytics(
    getDataRoot(),
    analyticsBlobUrl ? { accountUrl: analyticsBlobUrl, container: analyticsContainer } : undefined,
  ).then(() => {
    log.analytics.info({ backend: analyticsBlobUrl ? 'azure-blob' : 'filesystem' }, 'Analytics initialized');
  }).catch((e) => { /* telemetry — silent by design */ log.analytics.warn({ err: e }, 'Analytics init failed'); });

  if (githubBackend) {
    // Initialize GitHubAPIBackend (token + cache check) AFTER health check is
    // ready. Health passes immediately, then async init.
    log.storage.info('Initializing GitHubAPIBackend');
    githubBackend.initialize().then(async () => {
      log.storage.info('GitHubAPIBackend initialized');
      // Warm the conflicts cache in the background so the first user request
      // doesn't pay the 5s cold-start penalty (1,242 individual file reads).
      try {
        const data = await fileIO.readAllConflictFiles();
        conflictsCache = { data, ts: Date.now() };
        log.server.info({ count: data.length }, 'Conflicts cache warmed');
      } catch (e) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'server',
          level: 'warn',
          message: 'Conflicts cache warm failed (non-fatal)',
          error: { name: (e as Error).name ?? 'Error', message: String(e), stack: (e as Error).stack },
        });
        log.server.warn({ err: e }, 'Conflicts cache warm failed (non-fatal)');
      }
    }).catch((err) => {
      log.storage.error({ err }, 'GitHubAPIBackend initialization failed');
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
