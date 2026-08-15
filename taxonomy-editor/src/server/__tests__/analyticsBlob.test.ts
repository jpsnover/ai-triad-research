// @vitest-environment node
//
// t/2664 — BlobAnalyticsBackend.append failure signaling.
// Verifies that a write failure is surfaced (console.error + rethrow) rather
// than swallowed into a silent 200.

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
    await expect(backend.append('2026-08-15', ['{"event":1}'])).rejects.toThrow();
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('analytics-blob-append-failed'),
      expect.anything(),
    );
  });

  it('rethrows on write failure — does not swallow into silent success', async () => {
    const error = new Error('503 ServiceUnavailable');
    const backend = new BlobAnalyticsBackend({
      accountUrl: 'https://test.blob.core.windows.net',
      container: 'analytics',
      serviceClient: makeFakeServiceClient(error),
    });
    vi.spyOn(console, 'error').mockImplementation(() => { /* suppress output */ });
    await expect(backend.append('2026-08-15', ['{"event":1}'])).rejects.toThrow('503 ServiceUnavailable');
  });
});
