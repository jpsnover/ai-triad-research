// @vitest-environment node

/**
 * t/1362 — the centralized error() helper must log every 5xx at error level via
 * Pino, so server 500s are visible in `az containerapp logs show` without a
 * browser-triggered flight-recorder dump.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ServerResponse } from 'http';
import { error } from '../httpKit.js';
import { log } from '../logger.js';
import { setGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import type { FlightRecorder, RecordInput } from '../../../../lib/flight-recorder/flightRecorder.js';

function fakeRes(method = 'GET', routePath = '/api/test'): ServerResponse {
  return {
    writeHead: vi.fn(), end: vi.fn(), setHeader: vi.fn(),
    req: { method }, __routePath: routePath,
  } as unknown as ServerResponse;
}

describe('httpKit error() Pino safety net (t/1362)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('logs at error level for a 5xx so the 500 is visible in container logs', () => {
    const spy = vi.spyOn(log.server, 'error').mockImplementation(() => {});
    error(fakeRes(), 'kaboom', 500, new Error('kaboom'));
    expect(spy).toHaveBeenCalledTimes(1);
    const [ctx, msg] = spy.mock.calls[0] as [Record<string, unknown>, string];
    expect(ctx.status).toBe(500);
    expect(String(msg)).toContain('kaboom');
  });

  it('does NOT error-log for a <500 response (client errors are not server faults)', () => {
    const spy = vi.spyOn(log.server, 'error').mockImplementation(() => {});
    error(fakeRes(), 'not found', 404);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('httpKit error() 4xx flight-recorder correlation (t/1379)', () => {
  afterEach(() => { setGlobalRecorder(null as unknown as FlightRecorder); vi.restoreAllMocks(); });

  it('records a 4xx to the FR at warn with method/path/status/requestId/errorMessage', () => {
    const records: RecordInput[] = [];
    setGlobalRecorder({ record: (e: RecordInput) => records.push(e) } as unknown as FlightRecorder);
    error(fakeRes('POST', '/api/debates/:id/news-report'), 'A synthesis must exist', 400);
    const evt = records.find(r => r.type === 'lifecycle' && (r.data as Record<string, unknown>)?.status === 400);
    expect(evt).toBeDefined();
    expect(evt!.level).toBe('warn');
    const data = evt!.data as Record<string, unknown>;
    expect(data.method).toBe('POST');
    expect(data.path).toBe('/api/debates/:id/news-report');
    expect(data.errorMessage).toBe('A synthesis must exist');
    expect('requestId' in data).toBe(true);
  });

  it('does NOT emit the lifecycle 4xx event for a 5xx (that uses the system.error path)', () => {
    const records: RecordInput[] = [];
    setGlobalRecorder({ record: (e: RecordInput) => records.push(e) } as unknown as FlightRecorder);
    error(fakeRes('GET', '/api/x'), 'boom', 500, new Error('boom'));
    expect(records.find(r => r.type === 'lifecycle')).toBeUndefined();
  });
});
