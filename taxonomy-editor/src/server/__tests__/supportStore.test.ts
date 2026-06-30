// @vitest-environment node
//
// t/1189 — support-cases store. Exercises create/list/get with cross-user
// scoping, admin list/find/respond/status, and attachment validation + binary
// round-trip via an in-memory mock StorageBackend (incl. t/1216 writeBinaryFile).

import { describe, it, expect, beforeEach, vi } from 'vitest';

let backend = makeBackend();
const mockRecorder = { record: vi.fn() };

vi.mock('../config.js', () => ({ resolveDataPath: (p: string) => p }));
vi.mock('../storage/fileIO.js', () => ({
  getUserContentBackend: () => backend,
  assertSafeId: () => { /* validity not under test here */ },
}));
vi.mock('../../../../lib/flight-recorder/index.js', () => ({ getGlobalRecorder: () => mockRecorder }));

import * as store from '../support/supportStore.js';
import { ATTACHMENT_MAX_BYTES, CASE_MAX_ATTACHMENTS } from '../support/types.js';

function makeBackend() {
  const text = new Map<string, string>();
  const bin = new Map<string, Buffer>();
  const norm = (p: string) => p.replace(/\\/g, '/');
  return {
    text, bin,
    writeFile: vi.fn(async (p: string, c: string) => { text.set(norm(p), c); }),
    readFile: vi.fn(async (p: string) => text.get(norm(p)) ?? null),
    writeBinaryFile: vi.fn(async (p: string, b: Buffer) => { bin.set(norm(p), b); }),
    readBinaryFile: vi.fn(async (p: string) => bin.get(norm(p)) ?? null),
    listDirectory: vi.fn(async (dir: string) => {
      const d = norm(dir).replace(/\/+$/, '') + '/';
      const names = new Set<string>();
      for (const k of [...text.keys(), ...bin.keys()]) {
        if (k.startsWith(d)) names.add(k.slice(d.length).split('/')[0]);
      }
      return [...names];
    }),
    deleteFile: vi.fn(async () => { /* unused */ }),
    fileExists: vi.fn(async (p: string) => text.has(norm(p)) || bin.has(norm(p))),
  };
}

const SI = { appVersion: '1.0', browser: 'Chrome', os: 'Win', deploymentMode: 'web' as const };

describe('supportStore (t/1189)', () => {
  beforeEach(() => { backend = makeBackend(); mockRecorder.record.mockClear(); });

  it('creates a case and reads it back (scoped to its owner)', async () => {
    const c = await store.createCase('alice', 'Alice', { subject: 'Help', description: 'It broke', systemInfo: SI });
    expect(c.status).toBe('open');
    expect(c.priority).toBe('medium');
    const got = await store.getCase('alice', c.id);
    expect(got?.subject).toBe('Help');
    // Cross-user scoping: another user cannot read alice's case.
    expect(await store.getCase('bob', c.id)).toBeNull();
  });

  it('lists a user\'s own cases, newest first; admin sees all', async () => {
    const a1 = await store.createCase('alice', 'Alice', { subject: 'A1', description: 'x', systemInfo: SI });
    await store.createCase('bob', 'Bob', { subject: 'B1', description: 'y', systemInfo: SI });
    const aliceCases = await store.listCasesForUser('alice');
    expect(aliceCases.map(c => c.id)).toEqual([a1.id]);
    const all = await store.listAllCases();
    expect(all.length).toBe(2);
  });

  it('admin can find by id, respond, and change status (resolvedAt set/cleared)', async () => {
    const c = await store.createCase('alice', 'Alice', { subject: 'S', description: 'd', systemInfo: SI });
    expect((await store.findCaseById(c.id))?.id).toBe(c.id);

    const responded = await store.addResponse(c.id, 'admin1', 'Looking into it');
    expect(responded?.responses).toHaveLength(1);
    expect(responded?.responses[0].authorId).toBe('admin1');

    const resolved = await store.setStatus(c.id, 'resolved');
    expect(resolved?.status).toBe('resolved');
    expect(resolved?.resolvedAt).toBeTruthy();

    const reopened = await store.setStatus(c.id, 'open');
    expect(reopened?.resolvedAt).toBeUndefined();

    expect(await store.addResponse('does-not-exist', 'admin1', 'x')).toBeNull();
  });

  it('saveAttachment validates MIME + per-attachment size, then round-trips the bytes', async () => {
    const c = await store.createCase('alice', 'Alice', { subject: 'S', description: 'd', systemInfo: SI });

    // Disallowed MIME → 400.
    const badMime = await store.saveAttachment('alice', c.id, { filename: 'x.exe', mimeType: 'application/x-msdownload', bytes: Buffer.from('hi') });
    expect(badMime).toEqual(expect.objectContaining({ ok: false, status: 400 }));

    // Over the per-attachment limit → 413 (checked on decoded bytes).
    const tooBig = await store.saveAttachment('alice', c.id, { filename: 'big.png', mimeType: 'image/png', bytes: Buffer.alloc(ATTACHMENT_MAX_BYTES + 1) });
    expect(tooBig).toEqual(expect.objectContaining({ ok: false, status: 413 }));

    // Valid → stored as a real binary blob, downloadable byte-for-byte.
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ok = await store.saveAttachment('alice', c.id, { filename: 'shot.png', mimeType: 'image/png', bytes: png });
    expect(ok.ok).toBe(true);
    const got = await store.getAttachment('alice', c.id, ok.ok ? ok.attachment.id : '');
    expect(got?.meta.mimeType).toBe('image/png');
    expect(got?.bytes.equals(png)).toBe(true);
  });

  it('enforces the max-attachments-per-case count', async () => {
    const c = await store.createCase('alice', 'Alice', { subject: 'S', description: 'd', systemInfo: SI });
    for (let i = 0; i < CASE_MAX_ATTACHMENTS; i++) {
      const r = await store.saveAttachment('alice', c.id, { filename: `f${i}.txt`, mimeType: 'text/plain', bytes: Buffer.from(`a${i}`) });
      expect(r.ok).toBe(true);
    }
    const over = await store.saveAttachment('alice', c.id, { filename: 'extra.txt', mimeType: 'text/plain', bytes: Buffer.from('z') });
    expect(over).toEqual(expect.objectContaining({ ok: false, status: 400 }));
  });
});
