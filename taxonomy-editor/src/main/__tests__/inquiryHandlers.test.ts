// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Inquiry — Electron main-process handler tests (t/3579). Mocks the shared runInquiryPipeline
// and every host-specific dep it's wired with, exercising the three load-bearing cases:
// lifecycle (start returns immediately, poll observes queued → terminal), the error path, and
// truncation classification (done_truncated vs done).

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));

vi.mock('../fileIO.js', () => ({
  PROJECT_ROOT: '/fake/root',
  readTaxonomyFile: vi.fn(() => ({ nodes: [] })),
}));
vi.mock('../embeddings.js', () => ({ computeEmbeddings: vi.fn(async () => []) }));
vi.mock('../electronAIAdapter.js', () => ({
  makeElectronAIAdapter: vi.fn(() => ({ generateText: vi.fn(), getModelMinTimeout: () => 0 })),
}));
vi.mock('../../../../lib/debate/relevanceSelection.js', () => ({
  assembleNodeEmbeddings: vi.fn(async () => ({ nodeEmbeddings: {}, allNodeIds: [] })),
}));
vi.mock('../../../../lib/debate/headlessRunner.js', () => ({ runHeadlessDebate: vi.fn() }));
vi.mock('../../../../lib/debate/taxonomyLoader.js', () => ({ loadTaxonomy: vi.fn(() => ({})) }));
vi.mock('../../../../lib/ai-client/registry.js', () => ({ loadModelRegistry: vi.fn(() => ({})) }));
vi.mock('../../../../lib/flight-recorder/index.js', () => ({ getGlobalRecorder: vi.fn(() => null) }));

const runInquiryPipeline = vi.hoisted(() => vi.fn());
vi.mock('../../../../lib/debate/inquiryPipeline.js', () => ({ runInquiryPipeline }));

import { ipcMain } from 'electron';
import { registerInquiryHandlers } from '../ipc/inquiryHandlers.js';
import type { InquiryResult } from '../../../../lib/inquiry/index.js';

type Handler = (...args: unknown[]) => unknown;
function handlers(): Record<string, Handler> {
  const map: Record<string, Handler> = {};
  for (const [ch, fn] of (ipcMain.handle as unknown as { mock: { calls: [string, Handler][] } }).mock.calls) map[ch] = fn;
  return map;
}

const VALID_REQUEST = { question: 'Should AI be paused?', fidelity: 'quick' as const };

function fakeResult(over: Partial<InquiryResult> = {}): InquiryResult {
  return {
    schemaVersion: 1,
    request: VALID_REQUEST,
    campVerdicts: [],
    convergences: [],
    evidenceLayers: [],
    unresolvedGaps: [],
    calibration: [],
    derivation: { fidelity: 'quick', models: {}, rounds: 4, callBudget: 20 },
    grounding: { nodesByCamp: {} },
    singleRunCaveat: 'Single run; not yet replicated.',
    ...over,
  } as InquiryResult;
}

async function createAndWait(h: Record<string, Handler>, request: unknown = VALID_REQUEST) {
  const { jobId } = (await h['start-inquiry'](null, request)) as { jobId: string };
  for (let i = 0; i < 100; i++) {
    const job = (await h['get-inquiry'](null, jobId)) as { status: string } & Record<string, unknown>;
    if (job.status === 'done' || job.status === 'done_truncated' || job.status === 'failed') return { jobId, job };
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('job did not terminate');
}

describe('inquiryHandlers — Electron parity (t/3579)', () => {
  beforeEach(() => {
    (ipcMain.handle as unknown as { mockReset: () => void }).mockReset();
    runInquiryPipeline.mockReset();
    registerInquiryHandlers();
  });

  it('start-inquiry returns { jobId } immediately, without waiting on the pipeline', async () => {
    let resolvePipeline: (r: InquiryResult) => void = () => {};
    runInquiryPipeline.mockImplementation(() => new Promise<InquiryResult>((res) => { resolvePipeline = res; }));
    const h = handlers();
    const { jobId } = (await h['start-inquiry'](null, VALID_REQUEST)) as { jobId: string };
    expect(jobId).toBeTruthy();
    const job = (await h['get-inquiry'](null, jobId)) as { status: string };
    expect(job.status).toBe('queued');
    resolvePipeline(fakeResult());
  });

  it('lifecycle: queued → done, with result embedded and terminationReason null', async () => {
    runInquiryPipeline.mockResolvedValue(fakeResult());
    const h = handlers();
    const { job } = await createAndWait(h);
    expect(job.status).toBe('done');
    expect(job.terminationReason).toBeNull();
    expect(job.result).toBeTruthy();
    expect((job as { resultId: string }).resultId).toBeTruthy();
  });

  it('truncation: a censored calibration entry classifies the job as done_truncated with terminationReason surfaced', async () => {
    runInquiryPipeline.mockResolvedValue(fakeResult({
      calibration: [{ metric: 'convergence', value: 0.4, trust: { verdict: 'censored', reason: 'budget ceiling hit', terminationReason: 'api_ceiling' } }],
    }));
    const h = handlers();
    const { job } = await createAndWait(h);
    expect(job.status).toBe('done_truncated');
    expect(job.terminationReason).toBe('api_ceiling');
    expect(job.result).toBeTruthy();
  });

  it('error path: pipeline throws → job fails, get-inquiry surfaces the error message', async () => {
    runInquiryPipeline.mockRejectedValue(new Error('provider 503'));
    const h = handlers();
    const { job } = await createAndWait(h);
    expect(job.status).toBe('failed');
    expect(job.error).toBe('provider 503');
    expect(job.result).toBeUndefined();
  });

  it('start-inquiry rejects an invalid request (schema boundary) — never starts a job for it', () => {
    const h = handlers();
    expect(() => h['start-inquiry'](null, { question: '' })).toThrow(/Invalid inquiry request/);
    expect(runInquiryPipeline).not.toHaveBeenCalled();
  });

  it('get-inquiry on an unknown jobId returns null', async () => {
    const h = handlers();
    const result = await h['get-inquiry'](null, 'nonexistent');
    expect(result).toBeNull();
  });
});
