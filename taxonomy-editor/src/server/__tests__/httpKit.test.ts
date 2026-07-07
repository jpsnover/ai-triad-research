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

function fakeRes(): ServerResponse {
  return { writeHead: vi.fn(), end: vi.fn(), setHeader: vi.fn() } as unknown as ServerResponse;
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
