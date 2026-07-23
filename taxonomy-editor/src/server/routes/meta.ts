// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1687 (Phase 2 server.ts split, ADR-007): the meta / liveness / taxonomy-dir
// route run, moved verbatim out of server.ts behind the registration seam. This
// run registers before registerTaxonomyRoutes, so registration order — and the
// routeTable snapshot — is preserved by placing registerMetaRoutes() at its
// former position. /health threads server identity (ctx.serverVersion /
// ctx.serverStartTime, new ctx fields) + live GitHub + flight-recorder state
// through ServerCtx.

import fs from 'fs';
import path from 'path';
import type { Router } from '../httpKit.js';
import type { ServerCtx } from './context.js';
import { json, error } from '../httpKit.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import { getProjectRoot, getDataRoot, hasApiKey, STORAGE_MODE } from '../config.js';
import { getConfig } from '../runtimeConfig.js';
import * as proxyTiers from '../ai/proxyTiers.js';
import * as community from '../community/community.js';
import * as fileIO from '../storage/fileIO.js';
import { log } from '../logger.js';
import { LLMS_TXT } from '../llmsTxt.js';

export function registerMetaRoutes(r: Router, ctx: ServerCtx): void {
  const { get, put } = r;

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
      version: ctx.serverVersion,
      startedAt: ctx.serverStartTime,
      uptime: Math.round(process.uptime()),
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      dataRoot: getDataRoot(),
      memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      flightRecorder: {
        eventsTotal: ctx.serverRecorder.buffer.count,
        eventsRetained: ctx.serverRecorder.buffer.retained,
        capacity: ctx.serverRecorder.buffer.capacity,
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

    const githubBackend = ctx.getGithubBackend();
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
}
