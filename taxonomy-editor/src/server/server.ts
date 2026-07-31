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
import { runWithUser, getCurrentUserId, setSessionBranchName, deriveStorageUserId } from './security/userContext.js';
import { isAuthDisabledAllowed, isPathWithinDir, isTerminalAccessAllowed, isAnonAllowedRoute, invalidRouteParam, missingApiKeyError, anonymousSessionCookies, resolveTestPersonaOverride } from './security/accessControl.js';
import { sanitizeUserText } from './security/contentSanitizer.js';
import { getRollbackStatus } from './rollbackStatus.js';
import { getErrorSummaryCached, type ErrorEntry } from './errorAggregation.js';
import { isCaseStatus } from './support/types.js';
import * as organizations from './organizations.js';
import { isPov } from './organizations.js';
import { json, error, param, query, getClientIp, createRouter, withEndpointTimeout, normalizedRequestPath, type Handler } from './httpKit.js';
import { computeIsPublicPath } from './publicPaths.js';
import { parseCookies } from './httpCookies.js';
import { registerDebatesRoutes } from './routes/debates.js';
import { registerSyncRoutes } from './routes/sync.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerKeysRoutes } from './routes/keys.js';
import { registerCommunityRoutes } from './routes/community.js';
import { registerHarvestRoutes } from './routes/harvest.js';
import { registerOrganizationsRoutes } from './routes/organizations.js';
import { registerEntityRoutes } from './routes/entity.js';
import { registerMentionsRoutes } from './routes/mentions.js';
import { registerPublicShareRoutes } from './routes/publicShare.js';
import { registerTaxonomyRoutes } from './routes/taxonomy.js';
import { registerMetaRoutes } from './routes/meta.js';
import { registerEdgesRoutes } from './routes/edges.js';
import { registerConflictsRoutes, invalidateConflictsCache, warmConflictsCache } from './routes/conflicts.js';
import { registerDataRoutes } from './routes/data.js';
import { registerAiRoutes } from './routes/ai.js';
import { registerDiagnosticsRoutes } from './routes/diagnostics.js';
import { registerSupportRoutes } from './routes/support.js';
import { registerSourcesRoutes } from './routes/sources.js';
import { registerSessionRoutes } from './routes/session.js';
import { buildLoginPage, FORBIDDEN_PAGE, SW_HEAL_SCRIPT_CSP_HASH, loginPageHeaders } from './loginPage.js';
import type { ServerCtx } from './routes/context.js';
import { listFlags, setFlag, deleteFlag, type FlagDef } from './featureFlags.js';
import { drainServerLogLines } from './serverLogBuffer.js';
import { initAnonymousSessionStore } from './storage/anonymousSessionStore.js';
import { checkProviderBinding } from './ai/providerBinding.js';
import * as community from './community/community.js';
import * as fileIO from './storage/fileIO.js';
import { FEEDBACK_CATEGORIES, isFeedbackCategory, paginateFeedback } from './storage/feedbackStore.js';
import { stampNodeAuthorship, diffNodes, changedFields } from './storage/editMeta.js';
import { computeNodeConflicts } from './community/nodeConflicts.js';
import type { TaxNode, NodeConflict } from './community/nodeConflicts.js';
import { getConfig, getConfigState, writeConfig, forceReload as reloadRuntimeConfig, diffFromDefaults } from './runtimeConfig.js';
import { setRuntimeCredentials, clearRuntimeCredentials, getCredentials } from './security/githubAppAuth.js';
import * as proxyTiers from './ai/proxyTiers.js';
import * as rateLimiter from './security/rateLimiter.js';
import * as analytics from './community/analytics.js';
import { FlightRecorder } from '../../../lib/flight-recorder/flightRecorder.js';
import { log, runWithRequestContext, generateRequestId, getRequestId, getRequestContext } from './logger.js';
import {
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
function patch(p: string, h: Handler) { routes.push({ method: 'PATCH', path: p, handler: h }); }
function del(p: string, h: Handler) { routes.push({ method: 'DELETE', path: p, handler: h }); }

// t/1295: registrar + read-mostly context for extracted route clusters
// (routes/*.ts). getGithubBackend is a live getter (not a snapshot) so clusters
// registered at module-load don't capture a stale null before async init assigns it.
const router = createRouter(routes);

// Server identity — resolved once at startup. Threaded to routes/meta.ts (/health)
// via ServerCtx; also used by the startup log + flight-recorder context provider.
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

const serverCtx: ServerCtx = {
  getGithubBackend: () => githubBackend,
  getSessionManager: () => sessionManager,
  broadcastTaxonomyUpdate,
  serverRecorder,
  ensureSessionBranch,
  appendServerLogs,
  invalidateConflictsCache,
  serverVersion: SERVER_VERSION,
  serverStartTime: SERVER_START_TIME,
  broadcastEvent,
};

// Best-effort client IP for rate limiting — first X-Forwarded-For hop (Azure
// ingress sets it) else the socket address. (M7)
// getClientIp moved to httpKit.ts (t/1347) — shared by server.ts + routes/*.ts.

// ── Meta / liveness / taxonomy-dirs (t/1687: extracted to routes/meta.ts) ──
// Registers before registerTaxonomyRoutes, preserving the routeTable snapshot order.
registerMetaRoutes(router, serverCtx);

// ── Taxonomy: synthetic corpus + CRUD + node edit history ──
// t/1383: /api/taxonomy/* cluster extracted to routes/taxonomy.ts (registrar at group position;
// synthetic-embeddings registers before :pov, preserving the collision-pair order).
registerTaxonomyRoutes(router, serverCtx);

// ── Conflicts / cruxes / policy-registry (t/1687: extracted to routes/conflicts.ts) ──
// Registers between registerTaxonomyRoutes and registerOrganizationsRoutes, preserving
// the routeTable snapshot order. The module owns conflictsCache; its exported
// invalidateConflictsCache() is wired into serverCtx above so harvest can null it.
registerConflictsRoutes(router, serverCtx);

// ── Organizations (t/1225) ──
// t/1383: /api/organizations/* cluster extracted to routes/organizations.ts (registrar at group position).
registerOrganizationsRoutes(router, serverCtx);

// ── Entity resolver (t/1786) ──
// GET /api/entity/:ref — public read; resolves the entity-ref discriminated union
// (lib/entities/types.ts) to the record type that owns each kind. Grouped with
// organizations (shares the public read tier). Brand-new path — no collision.
registerEntityRoutes(router, serverCtx);

// ── Container mentions (t/1902) ──
// GET /api/container-mentions/:containerId — the entity mentions extracted for one
// container (web transport for C's fileIO.readContainerMentions). Session-gated;
// an absent container → 200 null (designed miss, not 404). Brand-new path — no collision.
registerMentionsRoutes(router, serverCtx);

// ── Public share (t/1788) ──
// GET /api/public/pov/:pov/node/:nodeId — public, no-login, read-only POV node
// share. Grouped with organizations/entity (public read tier). Brand-new path —
// no collision. The auth-exemption is the isPublicPath '/api/public/' clause.
registerPublicShareRoutes(router, serverCtx);

// ── Lineage / edges / source-indexes / data-availability / flags (t/1687: routes/edges.ts) ──
// Registers between organizations and admin, preserving the routeTable snapshot order.
registerEdgesRoutes(router, serverCtx);

// ── Admin (35 routes, 6 scattered runs) extracted to routes/admin.ts — t/1295 ──
registerAdminRoutes(router, serverCtx);

// ── Data management + AI models (t/1687: extracted to routes/data.ts) ──
// Registers between registerAdminRoutes and registerKeysRoutes, preserving the routeTable snapshot order.
registerDataRoutes(router, serverCtx);

// t/1347: /api/keys/* cluster extracted to routes/keys.ts, registered here at the
// cluster's original first-route position (the interspersed /api/auth/* routes stay).
registerKeysRoutes(router, serverCtx);

// ── Auth-logout / AI generation / proxy-info / embeddings+NLI (t/1687: routes/ai.ts) ──
// Registers between registerKeysRoutes and registerDebatesRoutes, preserving the routeTable snapshot order.
registerAiRoutes(router, serverCtx);

// ── Debate sessions ──

// t/1295: the /api/debates cluster (9 routes) moved to routes/debates.ts. This
// single registration replaces both former debates blocks (was here + ~L1831),
// registering all 9 at this position to preserve collision-pair order.
registerDebatesRoutes(router, serverCtx);

// t/1687: the calibration / flight-recorder / chat-sessions route run moved to
// routes/diagnostics.ts (registered here at its former position, between
// registerDebatesRoutes and registerCommunityRoutes, to preserve snapshot order).
registerDiagnosticsRoutes(router, serverCtx);

// ── Community Library ──

// t/1347: /api/community/* cluster extracted to routes/community.ts (registered here at
// the group's position; the community-only respondRateLimited helper moved with it).
registerCommunityRoutes(router, serverCtx);

// t/1687: the public client-config + support-cases route run moved to
// routes/support.ts (registered here at its former position, between
// registerCommunityRoutes and registerHarvestRoutes, to preserve snapshot order).
registerSupportRoutes(router, serverCtx);


// ── Harvest ──
// t/1347: /api/harvest/* cluster extracted to routes/harvest.ts (registrar at group position).
registerHarvestRoutes(router, serverCtx);

// t/1687: the summaries / sources / source-documents / dictionary / source-
// evidence / evidence-qbaf / proposals / ps-prompts / fetch-url / upload-document
// route run moved to routes/sources.ts (registered here at its former position,
// between registerHarvestRoutes and registerSyncRoutes, to preserve snapshot
// order). Its two module-local caches moved in with it.
registerSourcesRoutes(router, serverCtx);

// ── Git sync ── (17 routes extracted to routes/sync.ts — t/1295)
registerSyncRoutes(router, serverCtx);

// t/1687: the auth-identity / analytics / diagnostics-beacon / focus-node /
// trace-channel route run moved to routes/session.ts (registered here at its
// former position, immediately after registerSyncRoutes and before the static-
// file pipeline, to preserve snapshot order). /focus-node broadcasts via the new
// ctx.broadcastEvent (broadcastEvent stays in server.ts with the WebSocket set).
registerSessionRoutes(router, serverCtx);

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

// parseCookies now lives in ./httpCookies.ts (t/2019) — shared with loginPage.ts and
// prototype-pollution-safe.

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
type AuthDenyReason = 'anon_route_blocked' | 'no_auth_header' | 'user_not_in_allowlist' | 'no_session';

function recordAuthDenied(reason: AuthDenyReason, method: string, urlPath: string): void {
  getGlobalRecorder()?.record({
    type: 'system.error',
    component: 'auth',
    level: 'warn',
    message: `Auth gate 403 (${reason}): ${method} ${urlPath}`,
  });
}

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
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
  // t/2019 (js/user-controlled-bypass): derive the gate path from the SAME normalized
  // pathname the router matches on (normalizedRequestPath) — not raw
  // req.url.split('?') — so an encoded-traversal path can't read as a public prefix
  // here (e.g. /api/public/%2e%2e/admin) while resolving elsewhere at the router.
  const urlPath = normalizedRequestPath(req);
  // ACCEPTED RISK — CodeQL js/user-controlled-bypass on the urlPath-guarded auth
  // branches below (alerts #4068/#5345/#4847/#4851, dismissed won't-fix; t/2019,
  // t/2001#5, TL-approved p/87#164/#168): path-based auth inherently branches on a
  // user-controlled request path, so the query fires by design and cannot be removed
  // without removing path-based auth. The exploitable parser-differential IS closed —
  // this gate and the router both decide on ONE canonical normalized path
  // (normalizedRequestPath), and the allowlist (computeIsPublicPath) evaluated on that
  // normalized path is the control. See t/2019#5/#10 for the full rationale.
  // /api/models is public: lets the pre-auth renderer populate the model
  // catalog from ai-models.json. Contains no secrets — just labels + ids.
  // /api/sync/webhook/github is public: GitHub POSTs unauthenticated; the
  // handler does its own HMAC verification against GITHUB_WEBHOOK_SECRET.
  // t/1910: the auth-exempt allowlist (15 exact + 7 prefix terms) moved verbatim to
  // publicPaths.ts so it's testable in isolation; the exact-vs-prefix match-kind split
  // is load-bearing and Server-Auth-reviewed (p/135#8) — do not add paths here.
  const isPublicPath = computeIsPublicPath(urlPath);
  // AUTH_DISABLED='1' (default) = anonymous access, no login page.
  // AUTH_OPTIONAL='1' = show login page with anonymous option; sign-in
  //   unlocks platform-tier keys, anonymous users get lower limits + BYOK.
  // Neither = required auth (must sign in + be in authorized-users.json).
  const authDisabled = process.env.AUTH_DISABLED === '1';
  const authOptional = process.env.AUTH_OPTIONAL === '1';

  // /.auth/anonymous — sets a session cookie and redirects to the app (browser
  // link on the login page). POST /api/auth/anonymous below is the JSON sibling.
  if (urlPath === '/.auth/anonymous' && authOptional) {
    res.writeHead(302, {
      'Location': '/',
      'Set-Cookie': anonymousSessionCookies(() => crypto.randomUUID()),
    });
    res.end();
    return;
  }

  // POST /api/auth/anonymous — JSON sibling of GET /.auth/anonymous (t/1483,
  // follow-up from t/1476). Establishes an anonymous session for programmatic
  // callers (the web-bridge session-recovery path) with the same two cookies but
  // a JSON 200 instead of a 302 + ~2KB HTML round-trip. Must run before the auth
  // gate below — the caller has no session yet. POST-only so a stray GET still
  // falls through to the 302 link / login page. The session id stays in the
  // HttpOnly cookie and is never echoed in the body.
  if (urlPath === '/api/auth/anonymous' && req.method === 'POST' && authOptional) {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': anonymousSessionCookies(() => crypto.randomUUID()),
    });
    res.end(JSON.stringify({ ok: true, anonymous: true }));
    return;
  }

  // Clear anonymous cookies when user signs in via EasyAuth
  if (principalName && parseCookies(req).get('auth_anonymous') === '1') {
    res.setHeader('Set-Cookie', [
      'auth_anonymous=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
      'anon_session_id=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
    ]);
  }

  if (!isPublicPath && !authDisabled) {
    if (authOptional) {
      // Optional mode: show login page unless user signed in or chose anonymous
      if (!principalName) {
        const isAnonymousSession = parseCookies(req).get('auth_anonymous') === '1';
        if (!isAnonymousSession) {
          // t/1473: API clients can't act on an HTML login page — anonymous /api/*
          // calls (no auth_anonymous cookie) were getting 200 text/html, which the
          // client mis-parsed as "corrupted data" and got permanently stuck. Return
          // a structured 401 so the client can re-establish an anonymous session and
          // retry (client recovery is the child ticket). Mirrors the required-mode
          // /api/ check (t/763) but 401 (a session CAN be established here) not 403.
          // t/1501: skip 401 for routes that don't need a session — isAnonAllowedRoute
          // and freeTierRoute are designed for truly cookie-less anonymous access.
          if (urlPath.startsWith('/api/')) {
            const m = req.method || 'GET';
            const freeTier = m === 'POST'
              && (urlPath === '/api/ai/generate' || urlPath === '/api/embeddings/compute' || urlPath === '/api/embeddings/query')
              && proxyTiers.freeTierEnabled();
            if (!freeTier && !isAnonAllowedRoute(m, urlPath)) {
              recordAuthDenied('no_session', m, urlPath);
              res.writeHead(401, { 'Content-Type': 'application/json', 'X-Auth-Reason': 'no_session' });
              res.end(JSON.stringify({ error: 'Anonymous session required', reason: 'no_session' }));
              return;
            }
          }
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
  const anonymousSessionId = isAnon ? parseCookies(req).get('anon_session_id') : undefined;
  const userCtx = { principalName: effectivePrincipal, idp: effectiveIdp, branchName: sessionBranch, storageUserId, isAnonymous: isAnon, anonymousSessionId };
  await runWithUser(userCtx, async () => {

    // t/2019: same canonical parse as the auth gate above (normalizedRequestPath) —
    // gate and router decide on the identical normalized path by construction, not two
    // parses that happen to agree. Named reqPath to not shadow the gate's urlPath.
    const reqPath = normalizedRequestPath(req);
    const route = matchRoute(req.method!, reqPath);

    // M7: per-IP rate limit on API write methods (100/min) — basic DoS/abuse guard.
    if (route && (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE') && reqPath.startsWith('/api/')) {
      const wr = rateLimiter.checkRate(`write:${getClientIp(req)}`, 100, 60_000);
      if (!wr.allowed) {
        const retryAfter = Math.max(1, Math.ceil((wr.retryAfterMs ?? 60_000) / 1000));
        // t/925: write-rate 429s were silent — log so abuse/DoS spikes are visible.
        log.server.warn({ component: 'rate-limiter', type: 'write_per_minute', method: req.method, path: reqPath, retryAfter }, 'API write rate-limited');
        res.setHeader('Retry-After', String(retryAfter));
        json(res, { error: 'rate_limited', message: 'Too many requests', retryAfter }, 429);
        return;
      }
    }

    if (route) {
      (res as any).__routePath = route.routePath;
      // t/810: validate user-provided path params at the routing layer (primary
      // gate) before the handler runs. Handlers keep assertSafe* as defense-in-depth.
      const badParam = invalidRouteParam(route.routePath, reqPath);
      if (badParam) {
        getGlobalRecorder()?.record({
          type: 'system.error', component: 'server', level: 'warn',
          message: `Blocked invalid path parameter '${badParam}': ${req.method} ${reqPath}`,
        });
        json(res, { error: `Invalid path parameter: ${badParam}`, requestId: getRequestId() }, 400);
        return;
      }
      try {
        const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method!) ? await readBody(req) : {};
        await route.handler(req, res, body);
      } catch (err) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: route.routePath,
          level: 'error',
          message: `Unhandled error in ${route.routePath}`,
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
        log.server.error({ err, method: req.method, path: reqPath, route: route.routePath }, 'Error handling request');
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
    return cookies.get('auth_anonymous') === '1';
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
        const count = await warmConflictsCache();
        log.server.info({ count }, 'Conflicts cache warmed');
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
