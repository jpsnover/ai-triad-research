// @vitest-environment node
//
// t/3728 (e/221#6 + e/221#7) — two concerns:
//  1. Staleness-threshold invariant: assert STALE_MS ≥ WORST_SYNC_BLOCK_MS + 2×INTERVAL_MS so a
//     future interval raise fails rather than silently narrowing the safety margin (e/221#6 cond 2).
//  2. Direct unit tests for markJobFailedIfStale (e/221#7 GV hold): both the stale arm AND the fresh
//     arm must be tested against the real predicate — not a mock that supplies the verdict externally.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Controllable storage backend for this test file.
const mockBackend = {
  readFile: vi.fn<[string], Promise<string | null>>(),
  writeFile: vi.fn<[string, string], Promise<void>>(),
  deleteFile: vi.fn<[string], Promise<void>>(),
};

vi.mock('../config.js', () => ({ resolveDataPath: (p: string) => `/tmp/${p}` }));
vi.mock('../../../../lib/flight-recorder/index.js', () => ({ getGlobalRecorder: () => null }));
vi.mock('../logger.js', () => ({ log: { server: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } } }));
vi.mock('../security/userContext.js', () => ({ getStorageUserId: () => 'user-1', isAnonymousUser: () => false }));
vi.mock('../storage/fileIO.js', () => ({
  getUserContentBackend: () => mockBackend,
  assertSafeId: vi.fn(),
}));

import {
  INQUIRY_HEARTBEAT_STALE_MS,
  INQUIRY_HEARTBEAT_INTERVAL_MS,
  INQUIRY_HEARTBEAT_WORST_SYNC_BLOCK_MS,
  INQUIRY_JOB_RECORD_FAILED_WINDOW_MS,
  INQUIRY_JOB_RECORD_RELOAD_GRACE_MS,
  INQUIRY_ASSUMED_MAX_RUN_DURATION_MS,
  markJobFailedIfStale,
  type InquiryJobRecord,
} from '../storage/inquiryJobStore.js';

// ── 1. Threshold invariant ─────────────────────────────────────────────────────────────────────

describe('t/3728 — staleness threshold invariant (e/221#6)', () => {
  it('STALE_MS ≥ WORST_SYNC_BLOCK_MS + 2 × INTERVAL_MS', () => {
    // N=2: tolerates worst sync block + one dropped write + one write-latency penalty.
    // If this fails, raise INQUIRY_HEARTBEAT_STALE_MS — never lower INQUIRY_HEARTBEAT_INTERVAL_MS
    // as a workaround (that narrows orphan-detection latency instead of fixing the margin).
    expect(INQUIRY_HEARTBEAT_STALE_MS).toBeGreaterThanOrEqual(
      INQUIRY_HEARTBEAT_WORST_SYNC_BLOCK_MS + 2 * INQUIRY_HEARTBEAT_INTERVAL_MS,
    );
  });

  it('FAILED_WINDOW_MS = ASSUMED_MAX_RUN_DURATION_MS + RELOAD_GRACE_MS (structural floor — e/221#10, e/221#18)', () => {
    // The floor is structural (a sum), not just asserted. RELOAD_GRACE is the policy number —
    // "how long after an error might a user reload?" Cutting it is visible in the diff as cutting it.
    expect(INQUIRY_JOB_RECORD_FAILED_WINDOW_MS).toBe(INQUIRY_ASSUMED_MAX_RUN_DURATION_MS + INQUIRY_JOB_RECORD_RELOAD_GRACE_MS);
    expect(INQUIRY_JOB_RECORD_RELOAD_GRACE_MS).toBeGreaterThan(0);
  });
});

// ── 2. markJobFailedIfStale direct coverage (e/221#7 GV hold) ─────────────────────────────────
//
// The route-level arms (inquiryRoutes.test.ts) prove tier ordering given a mock-supplied verdict.
// These tests prove the actual staleness predicate — `Date.now() - lastBeat < STALE_MS` — using
// real time control. The fresh arm (nothing happens) is the critical one; it is the arm the
// route-level mock substitutes away.

const FAKE_NOW = 1_000_000_000_000; // deterministic epoch anchor

function record(overrides: Partial<InquiryJobRecord> = {}): InquiryJobRecord {
  return {
    jobId: 'job-test', userId: 'user-1', bootId: 'boot-x',
    status: 'debating',
    lastHeartbeatAt: new Date(FAKE_NOW - 1_000).toISOString(), // 1s ago (fresh)
    resultId: null, error: null, debateId: null, startedAt: FAKE_NOW - 5_000,
    ...overrides,
  };
}

describe('t/3728 — markJobFailedIfStale direct (e/221#7 GV hold)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FAKE_NOW);
    mockBackend.readFile.mockReset();
    mockBackend.writeFile.mockReset();
    mockBackend.deleteFile.mockResolvedValue(undefined);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('stale heartbeat → returns failed verdict with restart descriptor', async () => {
    const staleHb = new Date(FAKE_NOW - INQUIRY_HEARTBEAT_STALE_MS - 1_000).toISOString();
    mockBackend.readFile.mockResolvedValueOnce(JSON.stringify(record({ lastHeartbeatAt: staleHb })));

    const result = await markJobFailedIfStale('job-test');

    expect(result?.verdict).toBe('failed');
    expect((result as { verdict: 'failed'; error: { code: string; message: string } }).error.code).toBe('restart');
    expect(typeof (result as { verdict: 'failed'; error: { code: string; message: string } }).error.message).toBe('string');
  });

  it('fresh heartbeat → returns live verdict (must NOT mark failed — the critical arm)', async () => {
    // 1s ago: well within STALE_MS (30s). Tier-3 must return live, not null or failed.
    mockBackend.readFile.mockResolvedValueOnce(JSON.stringify(record()));

    const result = await markJobFailedIfStale('job-test');
    expect(result?.verdict).toBe('live');
  });

  it('heartbeat exactly at threshold boundary → live verdict (< not ≤)', async () => {
    // lastBeat = FAKE_NOW - STALE_MS: diff = STALE_MS, condition is < STALE_MS → false → stale.
    // But one ms inside = STALE_MS - 1: diff = STALE_MS - 1 < STALE_MS → fresh → live.
    const justFreshHb = new Date(FAKE_NOW - INQUIRY_HEARTBEAT_STALE_MS + 1).toISOString();
    mockBackend.readFile.mockResolvedValueOnce(JSON.stringify(record({ lastHeartbeatAt: justFreshHb })));
    const result = await markJobFailedIfStale('job-test');
    expect(result?.verdict).toBe('live');
  });

  it('absent record → returns null', async () => {
    mockBackend.readFile.mockResolvedValueOnce(null);
    expect(await markJobFailedIfStale('job-test')).toBeNull();
  });

  it('terminal record (done) → returns null', async () => {
    const staleHb = new Date(FAKE_NOW - INQUIRY_HEARTBEAT_STALE_MS - 1_000).toISOString();
    mockBackend.readFile.mockResolvedValueOnce(
      JSON.stringify(record({ status: 'done', lastHeartbeatAt: staleHb })),
    );
    expect(await markJobFailedIfStale('job-test')).toBeNull();
  });

  it('already-failed within retention window → returns failed verdict with stored descriptor (second poll after recovery)', async () => {
    const errorDesc = { code: 'restart', message: 'Server restarted while this inquiry was in progress.' };
    // startedAt 5s ago — well within the 24h window.
    mockBackend.readFile.mockResolvedValueOnce(
      JSON.stringify(record({ status: 'failed', error: errorDesc, startedAt: FAKE_NOW - 5_000 })),
    );
    const result = await markJobFailedIfStale('job-test');
    expect(result).toEqual({ verdict: 'failed', error: errorDesc });
    expect(mockBackend.deleteFile).not.toHaveBeenCalled();
  });

  it('already-failed past retention window → deletes and returns null (→ 404)', async () => {
    const errorDesc = { code: 'restart', message: 'Server restarted while this inquiry was in progress.' };
    // startedAt beyond FAILED_WINDOW_MS — record has expired.
    mockBackend.readFile.mockResolvedValueOnce(
      JSON.stringify(record({
        status: 'failed', error: errorDesc,
        startedAt: FAKE_NOW - INQUIRY_JOB_RECORD_FAILED_WINDOW_MS - 1_000,
      })),
    );
    expect(await markJobFailedIfStale('job-test')).toBeNull();
    await vi.runAllTimersAsync(); // flush fire-and-forget delete
    expect(mockBackend.deleteFile).toHaveBeenCalled();
  });
});
