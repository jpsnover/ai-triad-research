// @vitest-environment node
//
// t/3578 — inquiry async job runner (POST-202 + poll, mirroring briefExportJobs).
// The pipeline is INJECTED (a fake here), so the bookkeeping is tested without running a real
// debate. The store is mocked by an in-memory map that survives a job-registry reset — that's what
// lets the cross-replica fallback test (TL t/3578#6 addition) be exercised deterministically.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { InquiryResult, InquiryRequest } from '../../../../lib/inquiry/index.js';

// ── Mock the durable store with an in-memory map (persistence survives a job-map reset) ──
const persisted = new Map<string, InquiryResult>();
vi.mock('../storage/inquiryResultStore.js', () => ({
  saveInquiryResult: vi.fn(async (jobId: string, result: InquiryResult) => { persisted.set(jobId, result); }),
  loadInquiryResult: vi.fn(async (jobId: string) => persisted.get(jobId) ?? null),
  listInquiryResults: vi.fn(async () => []),
}));
vi.mock('../../../../lib/flight-recorder/index.js', () => ({ getGlobalRecorder: () => ({ record: vi.fn() }) }));
vi.mock('../logger.js', () => ({
  log: { server: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } },
  getRequestId: () => 'req-test',
}));

import {
  startInquiryJob, getInquiryJob, hasInquiryJob, countRunningInquiryJobs,
  findIdempotentInquiryJob, sweepInquiryJobs, isTerminalStatus, deriveTruncation,
  _resetInquiryJobsForTest, INQUIRY_JOB_TTL_MS,
  type InquiryPipelineRunner, type InquiryJob,
} from '../inquiryJobs.js';
import { loadInquiryResult } from '../storage/inquiryResultStore.js';

const USER = 'user-1';
const REQUEST: InquiryRequest = { question: 'What counts as an AI harm?', fidelity: 'standard' };

function cleanResult(): InquiryResult {
  return { calibration: [{ metric: 'situation_crux_alignment', value: 0.8, trust: { verdict: 'trust', reason: 'natural conclusion', terminationReason: 'natural' } }] } as unknown as InquiryResult;
}
function truncatedResult(): InquiryResult {
  return { calibration: [{ metric: 'convergence_score', value: 0.649, trust: { verdict: 'censored', reason: 'run hit the call ceiling mid-argument', terminationReason: 'api_ceiling', metricFamily: 'convergence' } }] } as unknown as InquiryResult;
}

/** A pipeline that walks the stages then resolves with `result`. */
function fakePipeline(result: InquiryResult): InquiryPipelineRunner {
  return async (_req, ctx) => {
    ctx.onStage('grounding'); ctx.onStage('debating'); ctx.onStage('judging'); ctx.onStage('synthesizing');
    return result;
  };
}
/** A pipeline that never resolves — the job stays non-terminal. */
const neverPipeline: InquiryPipelineRunner = () => new Promise<InquiryResult>(() => { /* pending forever */ });

async function waitTerminal(job: InquiryJob): Promise<void> {
  await vi.waitFor(() => { if (!isTerminalStatus(job.status)) throw new Error('still running'); });
}

beforeEach(() => { _resetInquiryJobsForTest(); persisted.clear(); vi.clearAllMocks(); });

describe('t/3578 — inquiry job lifecycle', () => {
  it('a clean run reaches `done` and persists the result under the jobId', async () => {
    const job = startInquiryJob({ userId: USER, request: REQUEST, runPipeline: fakePipeline(cleanResult()) });
    await waitTerminal(job);
    expect(job.status).toBe('done');
    expect(job.progressPct).toBe(100);
    expect(job.resultId).toBe(job.jobId);
    expect(job.terminationReason).toBeUndefined();
    expect(persisted.has(job.jobId)).toBe(true);
  });

  it('a truncated run reaches the DISTINCT `done_truncated` state + surfaces terminationReason', async () => {
    const job = startInquiryJob({ userId: USER, request: REQUEST, runPipeline: fakePipeline(truncatedResult()) });
    await waitTerminal(job);
    expect(job.status).toBe('done_truncated');            // NOT folded into `done`
    expect(job.terminationReason).toBe('api_ceiling');
    expect(job.resultId).toBe(job.jobId);
  });

  it('a pipeline throw reaches `failed` with the error captured', async () => {
    const boom: InquiryPipelineRunner = async () => { throw new Error('pipeline exploded'); };
    const job = startInquiryJob({ userId: USER, request: REQUEST, runPipeline: boom });
    await waitTerminal(job);
    expect(job.status).toBe('failed');
    expect(job.error).toMatch(/pipeline exploded/);
    expect(persisted.has(job.jobId)).toBe(false);
  });
});

describe('t/3647 — debateId normalizer (single reader of result.debateId)', () => {
  it('stamps a real debateId onto the job when the result declares one', async () => {
    const result = { ...cleanResult(), debateId: 'debate-abc123' } as unknown as InquiryResult;
    const job = startInquiryJob({ userId: USER, request: REQUEST, runPipeline: fakePipeline(result) });
    await waitTerminal(job);
    expect(job.debateId).toBe('debate-abc123');
  });

  it('normalizes an absent debateId (old pre-t/3641 records) to null', async () => {
    const job = startInquiryJob({ userId: USER, request: REQUEST, runPipeline: fakePipeline(cleanResult()) });
    await waitTerminal(job);
    expect(job.debateId).toBeNull();
  });

  it('normalizes an empty-string debateId to null', async () => {
    const result = { ...cleanResult(), debateId: '' } as unknown as InquiryResult;
    const job = startInquiryJob({ userId: USER, request: REQUEST, runPipeline: fakePipeline(result) });
    await waitTerminal(job);
    expect(job.debateId).toBeNull();
  });
});

describe('t/3578 — truncation derivation (both arms)', () => {
  it('natural conclusion → not truncated', () => {
    expect(deriveTruncation(cleanResult())).toEqual({ truncated: false });
  });
  it('api_ceiling censor → truncated + reason', () => {
    expect(deriveTruncation(truncatedResult())).toEqual({ truncated: true, terminationReason: 'api_ceiling' });
  });
});

describe('t/3578 — concurrency + idempotency', () => {
  it('countRunningInquiryJobs reflects a running job, then drops after it terminates', async () => {
    const running = startInquiryJob({ userId: USER, request: REQUEST, runPipeline: neverPipeline });
    expect(countRunningInquiryJobs(USER)).toBe(1);           // the route rejects a 2nd concurrent start on this
    expect(countRunningInquiryJobs('other-user')).toBe(0);   // per-user
    const done = startInquiryJob({ userId: 'other-user', request: REQUEST, runPipeline: fakePipeline(cleanResult()) });
    await waitTerminal(done);
    expect(countRunningInquiryJobs('other-user')).toBe(0);   // terminal jobs don't count
    expect(running.status).toBe('queued');                   // untouched, still pending
  });

  it('findIdempotentInquiryJob returns the in-window job for the same (user, key)', () => {
    const job = startInquiryJob({ userId: USER, request: REQUEST, idempotencyKey: 'k1', runPipeline: neverPipeline });
    expect(findIdempotentInquiryJob(USER, 'k1')?.jobId).toBe(job.jobId);
    expect(findIdempotentInquiryJob(USER, 'other-key')).toBeNull();
    expect(findIdempotentInquiryJob('other-user', 'k1')).toBeNull();
    expect(findIdempotentInquiryJob(USER, undefined)).toBeNull();
  });
});

describe('t/3578 — TTL sweep', () => {
  it('drops a TERMINAL job past the TTL', async () => {
    const job = startInquiryJob({ userId: USER, request: REQUEST, runPipeline: fakePipeline(cleanResult()) });
    await waitTerminal(job);
    job.startedAt = Date.now() - INQUIRY_JOB_TTL_MS - 1_000;  // backdate past the TTL
    sweepInquiryJobs();
    expect(getInquiryJob(job.jobId, USER)).toBeNull();
    expect(hasInquiryJob(job.jobId)).toBe(false);
  });

  it('TL guard: a NON-terminal job older than the TTL SURVIVES the sweep (deep inquiries run ~45m > 30m TTL)', () => {
    const job = startInquiryJob({ userId: USER, request: REQUEST, runPipeline: neverPipeline });
    job.startedAt = Date.now() - INQUIRY_JOB_TTL_MS - 60_000;  // older than TTL but still running
    sweepInquiryJobs();
    expect(hasInquiryJob(job.jobId)).toBe(true);               // must NOT vanish mid-run
    expect(isTerminalStatus(job.status)).toBe(false);
  });
});

describe('t/3578 — cross-replica fallback (TL addition)', () => {
  it('a job absent from the in-memory map still resolves via the persisted result', async () => {
    const job = startInquiryJob({ userId: USER, request: REQUEST, runPipeline: fakePipeline(cleanResult()) });
    await waitTerminal(job);
    const jobId = job.jobId;

    _resetInquiryJobsForTest();                    // simulate a replica restart — in-memory job is gone

    expect(hasInquiryJob(jobId)).toBe(false);       // GET's "not in this process's Map" signal
    expect(await loadInquiryResult(jobId)).not.toBeNull();  // ...falls back to the durable result
  });
});

describe('t/3578 — terminal-status classification (discriminated union)', () => {
  it('classifies every status', () => {
    expect(['queued', 'grounding', 'debating', 'judging', 'synthesizing'].map(s => isTerminalStatus(s as never))).toEqual([false, false, false, false, false]);
    expect(['done', 'done_truncated', 'failed'].map(s => isTerminalStatus(s as never))).toEqual([true, true, true]);
  });
});
