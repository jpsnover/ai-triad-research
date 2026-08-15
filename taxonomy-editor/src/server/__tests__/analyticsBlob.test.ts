// @vitest-environment node
//
// t/2664 — BlobAnalyticsBackend.append failure signaling.
// Verifies that a write failure emits a greppable console.error and resolves
// (best-effort, no rethrow) so analytics failures don't 5xx the caller route.

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { BlobServiceClient } from '@azure/storage-blob';
import { BlobAnalyticsBackend } from '../storage/analyticsBlob.js';

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

describe('BlobAnalyticsBackend.append failure signaling (t/2664)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('emits console.error with greppable tag on write failure', async () => {
    const error = new Error('403 AuthorizationFailure');
    const backend = new BlobAnalyticsBackend({
      accountUrl: 'https://test.blob.core.windows.net',
      container: 'analytics',
      serviceClient: makeFakeServiceClient(error),
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => { /* suppress output */ });
    await backend.append('2026-08-15', ['{"event":1}']); // resolves (best-effort, no throw)
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('analytics-blob-append-failed'),
      expect.anything(),
    );
  });

  it('resolves (does not rethrow) on write failure — safe during backend outage', async () => {
    // Best-effort: a failing append must not 5xx the caller's route.
    // The failure is visible via console.error (greppable log) without propagating.
    const error = new Error('503 ServiceUnavailable');
    const backend = new BlobAnalyticsBackend({
      accountUrl: 'https://test.blob.core.windows.net',
      container: 'analytics',
      serviceClient: makeFakeServiceClient(error),
    });
    vi.spyOn(console, 'error').mockImplementation(() => { /* suppress output */ });
    await expect(backend.append('2026-08-15', ['{"event":1}'])).resolves.toBeUndefined();
  });
});
