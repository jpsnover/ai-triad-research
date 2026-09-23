// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @INMEMORY_JOB_STORE — job registry is a per-process in-memory Map (not shared across replicas).
// Remove this marker when migrated to a blob-backed shared store. The CI gate
// Test-InMemoryJobStoreScaleGuard.ps1 reads this marker and blocks if maxReplicas > 1.
//
// Inquiry async job runner + registry (t/3578, t/3571 arc). Mirrors briefExportJobs.ts:
// POST → 202 { jobId }, GET polls the evolving state, per-user concurrency cap, TTL sweep,
// idempotency window, progress percentage. Durable truth is the persisted InquiryResult
// (inquiryResultStore, keyed by jobId); the in-memory job is an ephemeral progress view —
// a "job not found" GET falls back to loadInquiryResult(jobId) (cross-replica durability).
//
// TWO DELIBERATE IMPROVEMENTS on the brief precedent (TL t/3578#6):
//  1. The pipeline is INJECTED, not imported. briefExportJobs imports runBriefPipeline directly,
//     which means its bookkeeping can't be tested without running a real debate. Here the runner
//     takes a single typed `runPipeline` function (one production wiring at the route, t/3581;
//     a fake in tests). Kept permanently — not switched to a direct import when t/3585 lands.
//  2. Truncation is a DISTINCT TERMINAL STATE (`done_truncated`), not a boolean on `done`. A client
//     switching on `done` doesn't match a truncated run, so it surfaces as unhandled (fails CLOSED,
//     visibly) rather than rendering a truncated run as clean success (fails open, silently). The
//     status union is exhaustiveness-checked by tsc (see assertNever in isTerminalStatus).

import { randomUUID } from 'crypto';
import { getGlobalRecorder } from '../../../lib/flight-recorder/index.js';
import { errorMessage } from '../../../lib/debate/errors.js';
import { log } from './logger.js';
import type { InquiryRequest, InquiryResult } from '../../../lib/inquiry/index.js';
import { saveInquiryResult, type InquiryResultSummary } from './storage/inquiryResultStore.js';

// Status vocabulary + truncation derivation hoisted to lib/inquiry (t/3609). Imported here for this
// module's own internal use (isTerminalStatus in the concurrency/sweep checks, deriveTruncation in
// startInquiryJob, the types in PROGRESS / InquiryJob) AND re-exported below so existing consumers —
// routes/inquiry.ts, inquiryPipelineDeps.ts, inquiryJobs.test.ts, inquiryRoutes.test.ts — keep
// importing them from '../inquiryJobs.js' with zero churn.
import { isTerminalStatus, deriveTruncation } from '../../../lib/inquiry/index.js';
import type { InquiryJobStatus, InquiryPipelineStage } from '../../../lib/inquiry/index.js';
export { isTerminalStatus, deriveTruncation } from '../../../lib/inquiry/index.js';
export type { InquiryJobStatus, InquiryPipelineStage } from '../../../lib/inquiry/index.js';

export const MAX_CONCURRENT_INQUIRY_JOBS = 1;        // per user — an inquiry is heavier than an export (pilot: 54 turns + 16 QBAF, minutes, real spend). TL t/3578#6.
export const INQUIRY_JOB_TTL_MS = 30 * 60_000;       // 30 min — poll + idempotency window; > export's 10 min because an inquiry runs minutes. TL-confirmed t/3578#6.

// TRUNCATION_REASONS, InquiryPipelineStage, InquiryJobStatus, isTerminalStatus, and deriveTruncation
// were hoisted to lib/inquiry (t/3609) — imported + re-exported above. PROGRESS stays host-local: it
// is this job store's display concern, not shared vocabulary (Electron main keeps its own copy).
const PROGRESS: Record<InquiryJobStatus, number> = {
  queued: 0, grounding: 10, debating: 40, judging: 70, synthesizing: 90,
  done: 100, done_truncated: 100, failed: 100,
};

export interface InquiryJob {
  jobId: string;
  userId: string;
  idempotencyKey?: string;
  status: InquiryJobStatus;
  progressPct: number;
  /** Set on `done_truncated` — the binding termination reason (e.g. `api_ceiling`), for the UI
   *  to render (t/3583 must not re-derive it). Undefined on a clean `done`. */
  terminationReason?: string;
  /** The persisted result's id (== jobId) once stored; the cross-replica fallback loads by it. */
  resultId: string | null;
  error: string | null;
  /** A short label for the source debate, if the pipeline surfaced one (dangle-tolerant; the
   *  contract does not declare debateId, so this is a best-effort passthrough read). */
  debateId: string | null;
  startedAt: number;
}

const jobs = new Map<string, InquiryJob>();

function setStatus(job: InquiryJob, status: InquiryJobStatus): void {
  job.status = status;
  job.progressPct = PROGRESS[status];
}

// ── Registry helpers (mirror briefExportJobs) ──

/** The caller's own job, or null if absent / owned by another user. */
export function getInquiryJob(jobId: string, userId: string): InquiryJob | null {
  const job = jobs.get(jobId);
  return job && job.userId === userId ? job : null;
}

/** Raw membership (any user) — lets the GET handler distinguish "not in this process's Map at all"
 *  (the cross-replica-fallback signal → load the persisted result) from "present but wrong user". */
export function hasInquiryJob(jobId: string): boolean {
  return jobs.has(jobId);
}

export function countRunningInquiryJobs(userId: string): number {
  let n = 0;
  for (const j of jobs.values()) {
    if (j.userId === userId && !isTerminalStatus(j.status)) n++;
  }
  return n;
}

/** Idempotency: an in-window job for the same (userId, key) returns its jobId. */
export function findIdempotentInquiryJob(userId: string, key: string | undefined): InquiryJob | null {
  if (!key) return null;
  for (const j of jobs.values()) {
    if (j.userId === userId && j.idempotencyKey === key) return j;
  }
  return null;
}

/** Drop terminal jobs past the TTL. NEVER touches a non-terminal job — `deep` fidelity can run
 *  ~45 min, longer than the 30-min TTL, and sweeping a running job would make deep inquiries vanish
 *  mid-run (TL guard t/3578#6). The TTL clock restarts at the terminal state (see finally, below). */
export function sweepInquiryJobs(): void {
  const now = Date.now();
  for (const [id, j] of jobs) {
    if (isTerminalStatus(j.status) && now - j.startedAt > INQUIRY_JOB_TTL_MS) jobs.delete(id);
  }
}

/** Best-effort dangle-tolerant debate reference off the (passthrough) result. The contract does not
 *  declare `debateId`; if the pipeline carries one as a passthrough field it is captured, else null. */
function readDebateRef(result: InquiryResult): string | null {
  const v = (result as unknown as Record<string, unknown>).debateId;
  return typeof v === 'string' && v.length > 0 ? v : null;
}

// ── Injected pipeline seam (the single typed function; one prod wiring at t/3581) ──

export interface InquiryPipelineContext {
  onStage: (stage: InquiryPipelineStage) => void;
  signal?: AbortSignal;
}
/** The one injected dependency. The route (t/3581) wires the real `runInquiryPipeline` (t/3585,
 *  lib/debate) closing over its deps; tests pass a fake. Kept injected permanently (TL t/3578#6). */
export type InquiryPipelineRunner = (request: InquiryRequest, ctx: InquiryPipelineContext) => Promise<InquiryResult>;

// ── Job creation + async runner ──

export interface CreateInquiryJobArgs {
  userId: string;
  request: InquiryRequest;
  idempotencyKey?: string;
  /** The single injected pipeline function (see InquiryPipelineRunner). */
  runPipeline: InquiryPipelineRunner;
}

/** Create a queued job, return it, and kick off the async pipeline (fire-and-forget). The route
 *  returns 202 { jobId } immediately; GET polls the evolving state. Concurrency + idempotency are
 *  the caller's pre-check (mirrors briefExportJobs — the route uses countRunningInquiryJobs /
 *  findIdempotentInquiryJob before calling this). */
export function startInquiryJob(args: CreateInquiryJobArgs): InquiryJob {
  const job: InquiryJob = {
    jobId: randomUUID(),
    userId: args.userId,
    idempotencyKey: args.idempotencyKey,
    status: 'queued',
    progressPct: 0,
    resultId: null,
    error: null,
    debateId: null,
    startedAt: Date.now(),
  };
  jobs.set(job.jobId, job);
  void runInquiryJob(job, args);
  return job;
}

async function runInquiryJob(job: InquiryJob, args: CreateInquiryJobArgs): Promise<void> {
  try {
    const result = await args.runPipeline(args.request, {
      onStage: (stage) => setStatus(job, stage),
    });

    job.debateId = readDebateRef(result);
    const { truncated, terminationReason } = deriveTruncation(result);
    if (truncated) job.terminationReason = terminationReason;

    const summary: InquiryResultSummary = {
      jobId: job.jobId,
      question: args.request.question,
      debateId: job.debateId,
      truncated,
      terminationReason,
      createdAt: new Date().toISOString(),
    };
    // Persist BEFORE flipping to a terminal state, so a poll that observes `done`/`done_truncated`
    // is guaranteed the result is loadable (the cross-replica fallback can't race ahead of the write).
    await saveInquiryResult(job.jobId, result, summary);
    job.resultId = job.jobId;
    setStatus(job, truncated ? 'done_truncated' : 'done');
  } catch (err) {
    job.error = errorMessage(err);
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'inquiry', level: 'error',
      message: `Inquiry job failed at ${job.status}`,
      error: { name: (err as Error).name ?? 'Error', message: job.error, stack: (err as Error).stack },
    });
    log.server.error({ component: 'inquiry', jobId: job.jobId, stage: job.status, err }, 'Inquiry job failed');
    setStatus(job, 'failed');
  } finally {
    job.startedAt = Date.now(); // restart the TTL clock from the terminal state
  }
}

/** Test-only: clear the in-memory registry (simulates a fresh process / replica restart). */
export function _resetInquiryJobsForTest(): void {
  jobs.clear();
}
