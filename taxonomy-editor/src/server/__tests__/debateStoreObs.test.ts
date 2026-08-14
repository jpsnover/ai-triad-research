// @vitest-environment node
// Observability tests for debateStore.ts (t/2624):
// - not-found read logs backendName + blobKey + result='not-found'
// - write-ack log carries backendName + blobKey + bytes + writeAck=true

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { _store, mockBackend } = vi.hoisted(() => {
  const _store = new Map<string, string>();
  const mockBackend = {
    backendName: 'test-mock',
    readFile: vi.fn(async (p: string) => _store.get(p) ?? null),
    writeFile: vi.fn(async (p: string, c: string) => { _store.set(p, c); }),
    deleteFile: vi.fn(async (p: string) => { _store.delete(p); }),
    listDirectory: vi.fn(async () => [..._store.keys()].map(k => k.split('/').pop()!)),
    fileExists: vi.fn(async (p: string) => _store.has(p)),
    readBinaryFile: vi.fn(),
    writeBinaryFile: vi.fn(),
  };
  return { _store, mockBackend };
});

const mockLogInfo = vi.hoisted(() => vi.fn());

vi.mock('../config.js', () => ({
  resolveDataPath: (rel: string) => `/data/${rel}`,
  getDataRoot: () => '/data',
}));

vi.mock('../logger.js', () => ({
  log: { server: { info: mockLogInfo, warn: vi.fn() } },
}));

vi.mock('../security/userContext.js', () => ({
  getStorageUserId: vi.fn(() => 'user-obs'),
  isAnonymousUser: vi.fn(() => false),
  getCurrentUserId: vi.fn(() => 'user-obs'),
}));

vi.mock('../security/quotas.js', () => ({
  checkQuota: vi.fn(() => ({ allowed: true, resource: 'debates', current: 0, limit: 10 })),
}));

vi.mock('../storage/fileIO.js', () => ({
  getUserContentBackend: () => mockBackend,
  assertSafeId: (value: string, label: string) => {
    if (!value || !/^[a-zA-Z0-9_-]+$/.test(value))
      throw Object.assign(new Error(`Invalid ${label}: "${value}"`), { statusCode: 400 });
  },
  getAnonStore: vi.fn(() => null),
}));

import { loadDebateSession, saveDebateSession } from '../storage/debateStore.js';

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _store.clear();
  vi.clearAllMocks();
  mockBackend.readFile.mockImplementation(async (p: string) => _store.get(p) ?? null);
  mockBackend.writeFile.mockImplementation(async (p: string, c: string) => { _store.set(p, c); });
  mockBackend.listDirectory.mockImplementation(async (dir: string) => {
    const prefix = dir.endsWith('/') ? dir : dir + '/';
    return [..._store.keys()]
      .filter(k => k.startsWith(prefix))
      .map(k => k.slice(prefix.length).split('/')[0])
      .filter((v, i, a) => a.indexOf(v) === i);
  });
  mockLogInfo.mockClear();
});

describe('loadDebateSession observability (t/2624)', () => {
  it('logs backendName + blobKey + result=not-found when debate is absent', async () => {
    await expect(loadDebateSession('debate-missing-123')).rejects.toThrow();

    const notFoundCall = mockLogInfo.mock.calls.find(
      ([fields]) => fields?.result === 'not-found',
    );
    expect(notFoundCall).toBeDefined();
    const [fields, msg] = notFoundCall!;
    expect(fields.backendName).toBe('test-mock');
    expect(fields.blobKey).toContain('debate-debate-missing-123.json');
    expect(fields.debateId).toBe('debate-missing-123');
    expect(msg).toMatch(/not found/i);
  });
});

describe('saveDebateSession observability (t/2624)', () => {
  it('logs backendName + blobKey + bytes + writeAck=true after write', async () => {
    const session = {
      id: 'obs-save-001',
      title: 'Obs test',
      created_at: '2026-08-14T00:00:00Z',
      updated_at: '2026-08-14T00:00:00Z',
      phase: 'opening',
    };
    await saveDebateSession(session, 'test-caller');

    const writeAckCall = mockLogInfo.mock.calls.find(
      ([fields]) => fields?.writeAck === true,
    );
    expect(writeAckCall).toBeDefined();
    const [fields] = writeAckCall!;
    expect(fields.backendName).toBe('test-mock');
    expect(fields.blobKey).toContain('debate-obs-save-001.json');
    expect(fields.debateId).toBe('obs-save-001');
    expect(typeof fields.bytes).toBe('number');
    expect(fields.bytes).toBeGreaterThan(0);
  });
});
