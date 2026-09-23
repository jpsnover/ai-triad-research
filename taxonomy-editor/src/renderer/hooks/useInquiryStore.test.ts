// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3583 — poll-loop bounds (TL t/3583#4 point 3): interval + backoff on poll errors, a hard
// ceiling so a lost job doesn't spin forever, unmount cleanup, and poll-error ≠ job-failed.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    startInquiry: vi.fn(),
    getInquiry: vi.fn(),
  },
}));

vi.mock('@bridge', () => ({ api: mockApi }));
vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => ({ record: vi.fn() }) }));

import { useInquiryStore } from './useInquiryStore';

function pollView(overrides: Record<string, unknown> = {}) {
  return {
    jobId: 'job-1', status: 'debating', progressPct: 40,
    terminationReason: null, resultId: null, error: null,
    ...overrides,
  };
}

describe('useInquiryStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    useInquiryStore.getState().reset();
    useInquiryStore.setState({ question: 'What counts as an AI harm?', fidelity: 'standard' });
  });

  afterEach(() => {
    useInquiryStore.getState()._stopPolling();
    vi.useRealTimers();
  });

  it('polls on a fixed interval until a terminal status, then stops', async () => {
    mockApi.startInquiry.mockResolvedValue({ jobId: 'job-1' });
    mockApi.getInquiry
      .mockResolvedValueOnce(pollView({ status: 'debating', progressPct: 40 }))
      .mockResolvedValueOnce(pollView({ status: 'judging', progressPct: 80 }))
      .mockResolvedValueOnce(pollView({
        status: 'done', progressPct: 100,
        result: { schemaVersion: 1, request: { question: 'q', fidelity: 'standard' }, campVerdicts: [], convergences: [], evidenceLayers: [], unresolvedGaps: [], calibration: [], derivation: { fidelity: 'standard', models: {}, rounds: 4, callBudget: 150 }, grounding: {}, singleRunCaveat: 'n=1',
        },
      }));

    await useInquiryStore.getState().startInquiry();
    expect(mockApi.getInquiry).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(mockApi.getInquiry).toHaveBeenCalledTimes(2);
    expect(useInquiryStore.getState().status).toBe('judging');

    await vi.advanceTimersByTimeAsync(3_000);
    expect(mockApi.getInquiry).toHaveBeenCalledTimes(3);
    expect(useInquiryStore.getState().status).toBe('done');
    expect(useInquiryStore.getState().screen()).toBe('answer');

    // No further polling once terminal.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockApi.getInquiry).toHaveBeenCalledTimes(3);
  });

  it('backs off exponentially on poll errors without treating them as job failure (poll-error ≠ job-failed)', async () => {
    mockApi.startInquiry.mockResolvedValue({ jobId: 'job-2' });
    mockApi.getInquiry
      .mockRejectedValueOnce(new Error('network blip'))
      .mockRejectedValueOnce(new Error('still down'))
      .mockResolvedValueOnce(pollView({ status: 'debating', progressPct: 50 }));

    await useInquiryStore.getState().startInquiry();
    expect(useInquiryStore.getState().pollError).toBe('network blip');
    expect(useInquiryStore.getState().status).toBe('queued'); // NOT 'failed' — a poll error is not a job failure
    expect(useInquiryStore.getState().error).toBeNull();

    // First backoff: 3s * 2^1 = 6s.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(mockApi.getInquiry).toHaveBeenCalledTimes(1); // not yet — interval hasn't elapsed
    await vi.advanceTimersByTimeAsync(3_000);
    expect(mockApi.getInquiry).toHaveBeenCalledTimes(2);
    expect(useInquiryStore.getState().pollError).toBe('still down');

    // Second backoff: 3s * 2^2 = 12s.
    await vi.advanceTimersByTimeAsync(12_000);
    expect(mockApi.getInquiry).toHaveBeenCalledTimes(3);
    expect(useInquiryStore.getState().pollError).toBeNull(); // cleared on the next successful poll
    expect(useInquiryStore.getState().status).toBe('debating');
  });

  it('gives up after the poll ceiling and reports a failure, not an infinite spin', async () => {
    mockApi.startInquiry.mockResolvedValue({ jobId: 'job-3' });
    mockApi.getInquiry.mockResolvedValue(pollView({ status: 'debating', progressPct: 10 }));

    await useInquiryStore.getState().startInquiry();
    await vi.advanceTimersByTimeAsync(60 * 60_000 + 10_000); // past the 1-hour ceiling

    expect(useInquiryStore.getState().status).toBe('failed');
    expect(useInquiryStore.getState().error).toMatch(/gave up polling/);
  });

  it('_stopPolling (unmount cleanup) stops the poll loop from making further calls', async () => {
    mockApi.startInquiry.mockResolvedValue({ jobId: 'job-4' });
    mockApi.getInquiry.mockResolvedValue(pollView({ status: 'debating', progressPct: 10 }));

    await useInquiryStore.getState().startInquiry();
    expect(mockApi.getInquiry).toHaveBeenCalledTimes(1);

    useInquiryStore.getState()._stopPolling();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockApi.getInquiry).toHaveBeenCalledTimes(1); // no further polls after cleanup
  });

  it('reset() during an in-flight poll discards the stale response instead of clobbering fresh state', async () => {
    mockApi.startInquiry.mockResolvedValue({ jobId: 'job-5' });
    let resolvePoll: (v: unknown) => void = () => {};
    mockApi.getInquiry.mockReturnValueOnce(new Promise((resolve) => { resolvePoll = resolve; }));

    await useInquiryStore.getState().startInquiry();
    useInquiryStore.getState().reset();
    resolvePoll(pollView({ status: 'debating', progressPct: 10 }));
    await vi.advanceTimersByTimeAsync(0);

    // reset() already cleared jobId — the late-arriving poll response for the OLD job must not
    // resurrect it.
    expect(useInquiryStore.getState().jobId).toBeNull();
    expect(useInquiryStore.getState().screen()).toBe('ask');
  });
});
