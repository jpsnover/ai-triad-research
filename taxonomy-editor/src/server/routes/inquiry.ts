// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3581 — inquiry REST routes (the transport leg of the "Ask a question" feature, t/3571):
//   POST /api/inquiry          → 202 { jobId }   (starts an async inquiry job)
//   GET  /api/inquiry/:jobId    → job state, or the InquiryResult when done
//
// AUTHENTICATED-ONLY, fail-closed (ADR-0002 #8; Server Auth confirmed p/601#10 — a straight gate
// application, not an accessControl change). An inquiry is a multi-minute debate + ~16 QBAF runs, so
// the anonAiRoutes precedent doesn't transfer. Rate-limited on the per-user request window at
// debate/brief-class sizing (Server Auth p/601#11), plus the 1/user concurrency cap.
//
// The job store (t/3578) owns lifecycle/persistence; the shared pipeline (t/3585) owns stage
// sequencing; this route is the single production wiring — it hands startInquiryJob the real
// runPipeline from buildInquiryRunPipeline() (server deps, inquiryPipelineDeps.ts). Self-cert
// /add-rest-endpoint (routes); the deps wiring is the only non-routine part and was TL-scoped (t/3581).

import type { IncomingMessage, ServerResponse } from 'http';
import type { Router } from '../httpKit.js';
import type { ServerCtx } from './context.js';
import { json, error, param } from '../httpKit.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import { getCurrentUser, getStorageUserId } from '../security/userContext.js';
import * as rateLimiter from '../security/rateLimiter.js';
import { resolveGenerationContext, enforceBackendAllowed } from './generationContext.js';
import { isRegisteredModel } from '../ai/aiBackends.js';
import { InquiryRequestSchema, type InquiryRequest, type InquiryResult } from '../../../../lib/inquiry/index.js';
import {
  startInquiryJob, getInquiryJob, hasInquiryJob, countRunningInquiryJobs,
  findIdempotentInquiryJob, deriveTruncation, MAX_CONCURRENT_INQUIRY_JOBS, type InquiryJob,
} from '../inquiryJobs.js';
import { loadInquiryResult, listInquiryResults } from '../storage/inquiryResultStore.js';
import { buildInquiryRunPipeline } from '../inquiryPipelineDeps.js';

/** The ephemeral poll view of a job — no internals leaked. */
function jobView(job: InquiryJob): Record<string, unknown> {
  return {
    jobId: job.jobId,
    status: job.status,
    progressPct: job.progressPct,
    terminationReason: job.terminationReason ?? null,
    resultId: job.resultId,
    error: job.error,
  };
}

/** Idempotency key from the standard header (kept OUT of the strict request body schema). */
function idempotencyKeyOf(req: IncomingMessage): string | undefined {
  const h = req.headers['idempotency-key'];
  return typeof h === 'string' && h.length > 0 ? h : undefined;
}

/** Validate any model override against ai-models.json at the boundary (t/3563; not a baked enum).
 *  Returns true when it has sent a 400 (caller must return). */
function rejectUnregisteredModel(res: ServerResponse, request: InquiryRequest): boolean {
  for (const m of [request.models?.debaters, request.models?.evaluator]) {
    if (m !== undefined && !isRegisteredModel(m)) { error(res, `Unknown model id: ${m}`, 400); return true; }
  }
  return false;
}

/** Per-user request-window rate limit at the resolved (debate/brief-class) tier — Server Auth p/601#11.
 *  Returns true when it has already responded (403 disallowed backend, or 429 rate-limited). */
function enforceInquiryRateLimit(req: IncomingMessage, res: ServerResponse, model: string | undefined): boolean {
  const { tier, limitKey, backend } = resolveGenerationContext(req, model);
  if (enforceBackendAllowed(res, tier, backend)) return true;
  const rpm = rateLimiter.checkRequestRate(limitKey, tier.limits.requestsPerMinute);
  if (!rpm.allowed) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Rate limit exceeded', limitType: 'requests_per_minute', retryAfterMs: rpm.retryAfterMs }));
    return true;
  }
  return false;
}

export function registerInquiryRoutes(r: Router, _ctx: ServerCtx): void {
  const { get, post } = r;

  // POST /api/inquiry — start an inquiry job. NB: string-literal path so extractRoutes.ts sees it.
  post('/api/inquiry', async (req, res, body) => {
    const user = getCurrentUser();
    if (!user || user.isAnonymous) { error(res, 'Authentication required to run an inquiry', 401); return; }
    try {
      // Strict validation (rejects unknown keys) — a mistyped field fails loudly rather than running
      // a subtly different inquiry (TL t/3574#2). Idempotency rides a header, not the body.
      const parsed = InquiryRequestSchema.safeParse(body);
      if (!parsed.success) { error(res, 'Invalid inquiry request: ' + parsed.error.message, 400); return; }
      const request: InquiryRequest = parsed.data;

      // Model override validated against ai-models.json at the boundary (t/3563; not a baked enum).
      if (rejectUnregisteredModel(res, request)) return;
      // Rate limit (debate/brief-class tier; authenticated, never the light chat tier) — Server Auth p/601#11.
      if (enforceInquiryRateLimit(req, res, request.models?.debaters)) return;

      const userId = getStorageUserId();
      const idempotencyKey = idempotencyKeyOf(req);

      // Idempotency: an in-window job for the same (user, key) returns its jobId (no second run).
      const existing = findIdempotentInquiryJob(userId, idempotencyKey);
      if (existing) { json(res, { jobId: existing.jobId }, 202); return; }

      // Per-user concurrency cap — an inquiry is expensive; one at a time.
      if (countRunningInquiryJobs(userId) >= MAX_CONCURRENT_INQUIRY_JOBS) {
        error(res, 'An inquiry is already running — wait for it to finish before starting another', 429);
        return;
      }

      const job = startInquiryJob({ userId, request, idempotencyKey, runPipeline: buildInquiryRunPipeline() });
      json(res, { jobId: job.jobId }, 202);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'inquiry', level: 'error', message: 'POST /api/inquiry failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      error(res, String(err), 500, err);
    }
  });

  // GET /api/inquiry — list the authenticated user's past inquiries (the "My Questions" surface, t/3619).
  // Bare `InquiryResultSummary[]`, mirroring the /api/debates + /api/chats list shape (t/3619 asks to mirror
  // those; they return a bare array, not an envelope). Registered before /api/inquiry/:jobId — the bare path
  // and the one-segment :jobId path don't unify, but list-before-detail matches the debates.ts convention.
  // Authenticated-only like the rest of this group (ADR-0002 #8): we fail closed at the gate even though
  // listInquiryResults is already per-user (anon → []) as defense in depth.
  get('/api/inquiry', async (_req, res) => {
    const user = getCurrentUser();
    if (!user || user.isAnonymous) { error(res, 'Authentication required', 401); return; }
    try {
      json(res, await listInquiryResults());
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'inquiry', level: 'error', message: 'GET /api/inquiry failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      error(res, String(err), 500, err);
    }
  });

  // GET /api/inquiry/:jobId — poll job state; include the InquiryResult on a terminal job, and fall
  // back to the persisted result when the in-memory job is gone (cross-replica / post-sweep).
  get('/api/inquiry/:jobId', async (req, res) => {
    const user = getCurrentUser();
    if (!user || user.isAnonymous) { error(res, 'Authentication required', 401); return; }
    try {
      const jobId = param(req, 'jobId', '/api/inquiry/:jobId');
      const userId = getStorageUserId();

      const job = getInquiryJob(jobId, userId);
      if (job) {
        const view = jobView(job);
        if ((job.status === 'done' || job.status === 'done_truncated') && job.resultId) {
          const result = await loadInquiryResult(job.resultId);
          json(res, { ...view, result });
        } else {
          json(res, view);
        }
        return;
      }

      // Not in this process's map. If it's genuinely absent here (not just owned by another user),
      // serve the durable result — loadInquiryResult is scoped to the caller's own collection, so a
      // result owned by a different user returns null (no cross-user leak). Cross-replica durability.
      if (!hasInquiryJob(jobId)) {
        const result: InquiryResult | null = await loadInquiryResult(jobId);
        if (result) {
          const { truncated, terminationReason } = deriveTruncation(result);
          json(res, {
            jobId, status: truncated ? 'done_truncated' : 'done', progressPct: 100,
            terminationReason: terminationReason ?? null, resultId: jobId, error: null, result,
          });
          return;
        }
      }
      error(res, 'Inquiry not found', 404);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'inquiry', level: 'error', message: 'GET /api/inquiry/:jobId failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      error(res, String(err), 500, err);
    }
  });
}
