// @vitest-environment node
//
// t/2704 — startup analytics store probe. BlobAnalyticsBackend.probe() surfaces an
// inaccessible or missing container by THROWING (unlike listDates, which swallows and
// returns [] — indistinguishable from "empty"). reportStartupProbe() runs at boot: it
// logs init, probes, and on failure logs error + emits a flight-recorder system.error —
// so a broken or empty analytics pipeline is observable immediately instead of surfacing
// later as a silent empty dashboard (t/2699).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BlobServiceClient } from '@azure/storage-blob';
import { BlobAnalyticsBackend } from '../storage/analyticsBlob.js';
import { initAnalytics, reportStartupProbe } from '../community/analytics.js';
import { log } from '../logger.js';

const rec = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock('../../../../lib/flight-recorder/index.js', () => ({
  getGlobalRecorder: () => ({ record: rec.record }),
}));

interface FakeOpts {
  exists?: boolean | (() => Promise<boolean>);
  blobs?: string[];
}
function makeFakeServiceClient(opts: FakeOpts = {}): BlobServiceClient {
  const blobs = opts.blobs ?? [];
  const fakeContainerClient = {
    containerName: 'analytics',
    exists: vi.fn(() => (typeof opts.exists === 'function' ? opts.exists() : Promise.resolve(opts.exists ?? true))),
    async *listBlobsFlat() { for (const name of blobs) yield { name }; },
    getAppendBlobClient: vi.fn(),
    getBlobClient: vi.fn().mockReturnValue({ delete: vi.fn().mockResolvedValue({}) }),
  };
  return { getContainerClient: vi.fn().mockReturnValue(fakeContainerClient) } as unknown as BlobServiceClient;
}

const blobCfg = (svc: BlobServiceClient) => ({
  accountUrl: 'https://test.blob.core.windows.net',
  container: 'analytics',
  serviceClient: svc,
});

describe('BlobAnalyticsBackend.probe (t/2704)', () => {
  it('resolves when the container exists', async () => {
    const backend = new BlobAnalyticsBackend(blobCfg(makeFakeServiceClient({ exists: true })));
    await expect(backend.probe()).resolves.toBeUndefined();
  });

  it('throws when the container is missing (exists=false)', async () => {
    const backend = new BlobAnalyticsBackend(blobCfg(makeFakeServiceClient({ exists: false })));
    await expect(backend.probe()).rejects.toThrow(/container not found/);
  });

  it('propagates an auth/network failure (exists rejects — the case listDates would swallow)', async () => {
    const svc = makeFakeServiceClient({ exists: () => Promise.reject(new Error('403 AuthorizationFailure')) });
    const backend = new BlobAnalyticsBackend(blobCfg(svc));
    await expect(backend.probe()).rejects.toThrow(/AuthorizationFailure/);
  });
});

describe('reportStartupProbe (t/2704)', () => {
  beforeEach(() => { rec.record.mockClear(); vi.restoreAllMocks(); });

  it('logs "probe OK" and emits no error when the store is reachable with data', async () => {
    const infoSpy = vi.spyOn(log.analytics, 'info').mockImplementation(() => log.analytics);
    const errSpy = vi.spyOn(log.analytics, 'error').mockImplementation(() => log.analytics);
    await initAnalytics('/unused', blobCfg(makeFakeServiceClient({ exists: true, blobs: ['2026-08-15.ndjson'] })));
    await reportStartupProbe('azure-blob', 'analytics');
    expect(infoSpy).toHaveBeenCalledWith(expect.objectContaining({ dateCount: 1 }), 'Analytics store probe OK');
    expect(errSpy).not.toHaveBeenCalled();
    expect(rec.record).not.toHaveBeenCalled();
  });

  it('warns (not errors) when the store is reachable but empty', async () => {
    const warnSpy = vi.spyOn(log.analytics, 'warn').mockImplementation(() => log.analytics);
    vi.spyOn(log.analytics, 'info').mockImplementation(() => log.analytics);
    const errSpy = vi.spyOn(log.analytics, 'error').mockImplementation(() => log.analytics);
    await initAnalytics('/unused', blobCfg(makeFakeServiceClient({ exists: true, blobs: [] })));
    await reportStartupProbe('azure-blob', 'analytics');
    expect(warnSpy).toHaveBeenCalledWith(expect.objectContaining({ dateCount: 0 }), 'Analytics store reachable but contains no data');
    expect(errSpy).not.toHaveBeenCalled();
    expect(rec.record).not.toHaveBeenCalled();
  });

  it('logs error + emits a system.error FR when the container is inaccessible', async () => {
    vi.spyOn(log.analytics, 'info').mockImplementation(() => log.analytics);
    const errSpy = vi.spyOn(log.analytics, 'error').mockImplementation(() => log.analytics);
    await initAnalytics('/unused', blobCfg(makeFakeServiceClient({ exists: false })));
    await reportStartupProbe('azure-blob', 'analytics');
    expect(errSpy).toHaveBeenCalledWith(expect.objectContaining({ container: 'analytics' }), expect.stringMatching(/probe failed/));
    expect(rec.record).toHaveBeenCalledWith(expect.objectContaining({ message: 'Analytics store startup probe failed' }));
  });
});
