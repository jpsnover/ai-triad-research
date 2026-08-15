// @vitest-environment node
//
// t/2664/t/2665 — BlobAnalyticsBackend.append failure signaling.
// Verifies that a write failure emits a structured Pino warn log and resolves
// (best-effort, no rethrow) so analytics failures don't 5xx the caller route.

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { BlobServiceClient } from '@azure/storage-blob';
import { BlobAnalyticsBackend } from '../storage/analyticsBlob.js';
import { log } from '../logger.js';

function makeFakeServiceClient(appendError: Error): BlobServiceClient {
  const fakeAppendBlobClient = {
    createIfNotExists: vi.fn().mockResolvedValue({}),
    appendBlock: vi.fn().mockRejectedValue(appendError),
  };
  const fakeContainerClient = {
    getAppendBlobClient: vi.fn().mockReturnValue(fakeAppendBlobClient),
  };
  return {
    getContainerClient: vi.fn().mockReturnValue(fakeContainerClient),
  } as unknown as BlobServiceClient;
}

describe('BlobAnalyticsBackend.append failure signaling (t/2664, t/2665)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('emits log.analytics.warn on write failure (t/2665)', async () => {
    const error = new Error('403 AuthorizationFailure');
    const backend = new BlobAnalyticsBackend({
      accountUrl: 'https://test.blob.core.windows.net',
      container: 'analytics',
      serviceClient: makeFakeServiceClient(error),
    });
    const spy = vi.spyOn(log.analytics, 'warn').mockImplementation(() => { /* suppress output */ });
    await backend.append('2026-08-15', ['{"event":1}']); // resolves (best-effort, no throw)
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2026-08-15' }),
      'analytics blob append failed',
    );
  });

  it('resolves (does not rethrow) on write failure — safe during backend outage', async () => {
    // Best-effort: a failing append must not 5xx the caller's route.
    const error = new Error('503 ServiceUnavailable');
    const backend = new BlobAnalyticsBackend({
      accountUrl: 'https://test.blob.core.windows.net',
      container: 'analytics',
      serviceClient: makeFakeServiceClient(error),
    });
    vi.spyOn(log.analytics, 'warn').mockImplementation(() => { /* suppress output */ });
    await expect(backend.append('2026-08-15', ['{"event":1}'])).resolves.toBeUndefined();
  });
});
