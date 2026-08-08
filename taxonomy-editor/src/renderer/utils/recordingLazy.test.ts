// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const recordSpy = vi.fn();
vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: recordSpy }),
}));

import { probeModule, recordModuleFetchFailure } from './recordingLazy';

const URL = 'http://127.0.0.1:5173/src/renderer/components/debate/DebateTab.tsx';

function mockFetchOnce(impl: () => Promise<Response> | Response) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(impl())));
}

beforeEach(() => {
  recordSpy.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('probeModule — t/2314 disambiguation', () => {
  it('maps a 200 response to a clean status (stale-chunk cold-cache reload signal)', async () => {
    mockFetchOnce(() => ({ ok: true, status: 200, text: async () => '' }) as unknown as Response);
    const probe = await probeModule(URL);
    expect(probe).toEqual({ status: 200, body: null, error: null });
  });

  it('captures the body of a 500 response (Vite compile-error signal)', async () => {
    const compileError = 'Transform failed with 1 error: Unexpected token';
    mockFetchOnce(() => ({ ok: false, status: 500, text: async () => compileError }) as unknown as Response);
    const probe = await probeModule(URL);
    expect(probe.status).toBe(500);
    expect(probe.body).toBe(compileError);
    expect(probe.error).toBeNull();
  });

  it('truncates a large error body to 500 chars', async () => {
    mockFetchOnce(() => ({ ok: false, status: 500, text: async () => 'x'.repeat(2000) }) as unknown as Response);
    const probe = await probeModule(URL);
    expect(probe.body).toHaveLength(500);
  });

  it('maps a fetch rejection to error (crashed / unreachable server signal)', async () => {
    mockFetchOnce(() => Promise.reject(new Error('Failed to fetch')));
    const probe = await probeModule(URL);
    expect(probe).toEqual({ status: null, body: null, error: 'Failed to fetch' });
  });
});

describe('recordModuleFetchFailure', () => {
  it('records a system.error with the module URL parsed from the rejection message', async () => {
    await recordModuleFetchFailure(new TypeError(`Failed to fetch dynamically imported module: ${URL}`));
    expect(recordSpy).toHaveBeenCalledTimes(1);
    const event = recordSpy.mock.calls[0][0];
    expect(event).toMatchObject({
      type: 'system.error',
      component: 'module-loader',
      level: 'error',
      message: `Dynamic import failed: ${URL}`,
    });
    expect(event.data.module_url).toBe(URL);
    expect(event.error).toMatchObject({ name: 'TypeError' });
  });

  it('records a null module_url when the message carries no URL', async () => {
    await recordModuleFetchFailure(new Error('some unrelated failure'));
    const event = recordSpy.mock.calls[0][0];
    expect(event.message).toBe('Dynamic import failed');
    expect(event.data.module_url).toBeNull();
  });

  it('handles a non-Error rejection value', async () => {
    await recordModuleFetchFailure('boom');
    const event = recordSpy.mock.calls[0][0];
    expect(event.error).toMatchObject({ name: 'Error', message: 'boom' });
  });
});
