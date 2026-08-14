import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@lib/debate/errors', () => ({
  ActionableError: class ActionableError extends Error {
    goal: string; problem: string; location: string; nextSteps: string[];
    constructor(o: { goal: string; problem: string; location: string; nextSteps: string[] }) {
      super(o.problem); this.name = 'ActionableError';
      this.goal = o.goal; this.problem = o.problem; this.location = o.location; this.nextSteps = o.nextSteps;
    }
  },
}));
vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => ({ record: vi.fn(), intern: vi.fn() }) }));

import { runOpEdCreate, opedProgressBus } from '../opedStream';
import type { CreateOpEdPayload, OpEdProgressEvent } from '../types';

/** A fake SSE Response whose body streams the given frame strings, one per read(). */
function sseResponse(frames: string[]): Response {
  let i = 0;
  const encoder = new TextEncoder();
  return {
    ok: true, status: 200,
    body: { getReader: () => ({ read: () => i < frames.length ? Promise.resolve({ done: false, value: encoder.encode(frames[i++]) }) : Promise.resolve({ done: true, value: undefined }) }) },
  } as unknown as Response;
}
function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as unknown as Response;
}
/** Wrap a lib/oped generator event as a server SSE data frame ({runId, seq, event}). */
function frame(event: Record<string, unknown>): string {
  return `data: ${JSON.stringify({ runId: 'run-1', seq: 0, event })}\n\n`;
}

const PAYLOAD: CreateOpEdPayload = { topic: 'Frontier audits', params: { model: 'm', wordCount: 800 }, voices: ['acc', 'saf'] as CreateOpEdPayload['voices'] };

describe('opedStream.runOpEdCreate', () => {
  let progress: OpEdProgressEvent[];
  let unsub: () => void;
  beforeEach(() => {
    progress = [];
    unsub = opedProgressBus.onProgress((e) => progress.push(e));
  });

  it('maps per-voice events to onProgress and resolves set_id on complete', async () => {
    const fetchFn = vi.fn().mockResolvedValue(sseResponse([
      frame({ type: 'run_started', runId: 'run-1' }),
      frame({ type: 'voice_start', pov: 'acc' }),
      frame({ type: 'voice_complete', pov: 'acc', member: {} }),
      frame({ type: 'voice_failed', pov: 'saf', error: 'boom' }),
      frame({ type: 'complete', set: { set_id: 's1' } }),
    ]));
    const result = await runOpEdCreate(fetchFn, PAYLOAD);
    unsub();
    expect(result).toEqual({ set_id: 's1' });
    expect(progress).toEqual([
      { set_id: '', voice: 'acc', stage: 'generating' },
      { set_id: '', voice: 'acc', stage: 'complete' },
      { set_id: '', voice: 'saf', stage: 'failed', error: 'boom' },
    ]);
  });

  it('maps bridge voices → server povs in the POST body', async () => {
    const fetchFn = vi.fn().mockResolvedValue(sseResponse([frame({ type: 'complete', set: { set_id: 's1' } })]));
    await runOpEdCreate(fetchFn, PAYLOAD);
    unsub();
    const body = JSON.parse(fetchFn.mock.calls[0][1].body as string);
    expect(body).toMatchObject({ topic: 'Frontier audits', povs: ['acc', 'saf'] });
    expect(body.voices).toBeUndefined();
  });

  it('does not dispatch set-level grounding events to onProgress', async () => {
    const fetchFn = vi.fn().mockResolvedValue(sseResponse([
      frame({ type: 'grounding_done', nodeCount: 5 }),
      frame({ type: 'voice_start', pov: 'acc' }),
      frame({ type: 'complete', set: { set_id: 's1' } }),
    ]));
    await runOpEdCreate(fetchFn, PAYLOAD);
    unsub();
    expect(progress).toEqual([{ set_id: '', voice: 'acc', stage: 'generating' }]);
  });

  it('rejects a pre-SSE 429 concurrency error with a user-readable message', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(429, { error: 'concurrency_limit', message: 'You already have an op-ed generating; wait for it to finish.' }));
    await expect(runOpEdCreate(fetchFn, PAYLOAD)).rejects.toThrow(/already have an op-ed generating/);
    unsub();
  });

  it('recovers via run-status GET when the stream ends without a complete frame', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(sseResponse([frame({ type: 'run_started', runId: 'run-1' }), frame({ type: 'voice_start', pov: 'acc' })]))
      .mockResolvedValueOnce(jsonResponse(200, { runId: 'run-1', setId: 's2', status: 'complete', perVoice: {} }));
    const result = await runOpEdCreate(fetchFn, PAYLOAD);
    unsub();
    expect(result).toEqual({ set_id: 's2' });
    // Second call is the run-status recovery GET.
    expect(fetchFn.mock.calls[1][0]).toBe('/api/oped-runs/run-1');
    expect(fetchFn.mock.calls[1][1].method).toBe('GET');
  });

  it('rejects when the recovery run-status reports error', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(sseResponse([frame({ type: 'run_started', runId: 'run-1' })]))
      .mockResolvedValueOnce(jsonResponse(200, { runId: 'run-1', setId: 's3', status: 'error', perVoice: {} }));
    await expect(runOpEdCreate(fetchFn, PAYLOAD)).rejects.toThrow(/failed on the server|interrupted/i);
    unsub();
  });
});
