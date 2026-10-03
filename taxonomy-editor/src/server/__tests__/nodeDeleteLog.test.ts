// @vitest-environment node

// t/3860 — node-deletion audit log writer + POST /api/node-delete-log endpoint.
//
// Writer tests mirror aiCallLog.test.ts: schema fields, correct types, ISO-8601
// Datetime, advisory monotonic ID, atomic-append, and the non-fatal fail-safe.
//
// Route tests cover: valid POST → 204 + writer called; malformed body → 400, no
// write; anonymous user → 403 (audit-write requires a real user).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'http';
import type { NodeDeleteLogEntry } from '../storage/nodeDeleteLog.js';

// ── Mock the writer for route tests (hoisted — affects the route import below) ──

const { writeNodeDeleteLogEntryMock } = vi.hoisted(() => ({ writeNodeDeleteLogEntryMock: vi.fn() }));
vi.mock('../storage/nodeDeleteLog.js', () => ({
  writeNodeDeleteLogEntry: writeNodeDeleteLogEntryMock,
}));

const { isAnonymousUser } = vi.hoisted(() => ({ isAnonymousUser: vi.fn(() => false) }));
vi.mock('../security/userContext.js', () => ({ isAnonymousUser }));

import { registerNodeDeleteLogRoutes } from '../routes/nodeDeleteLog.js';

// ── Shared fixtures ─────────────────────────────────────────────────────────

type Handler = (req: IncomingMessage, res: ServerResponse, body: unknown) => Promise<void> | void;

function makeRouter() {
  const handlers: Record<string, Handler> = {};
  const reg = (m: string) => (p: string, h: Handler) => { handlers[`${m} ${p}`] = h; };
  return { router: { get: reg('GET'), post: reg('POST'), put: reg('PUT'), patch: reg('PATCH'), del: reg('DELETE') }, handlers };
}

function fakeRes() {
  const res = {
    writeHead: vi.fn((s: number) => { res._status = s; }),
    end: vi.fn((b?: string) => { res._body = b; }),
    setHeader: vi.fn(),
    _status: undefined as number | undefined,
    _body: undefined as string | undefined,
  } as unknown as ServerResponse & { _status?: number; _body?: string };
  return res;
}

const SCHEMA_FIELDS = ['ID', 'Datetime', 'NodeId', 'Pov', 'Label', 'User', 'DanglingEdges', 'DanglingSituationRefs', 'DanglingChildren'];

const sample: NodeDeleteLogEntry = {
  nodeId: 'acc-concern-001', pov: 'acc', label: 'Accelerationist concern',
  user: 'user-1', danglingEdges: 3, danglingSituationRefs: 1, danglingChildren: 0,
};

let tmpDir: string;
let logPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodedeletelog-'));
  logPath = path.join(tmpDir, 'node-delete-log.jsonl');
  writeNodeDeleteLogEntryMock.mockReset();
  isAnonymousUser.mockReturnValue(false);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function readLines() {
  return fs.readFileSync(logPath, 'utf8').split('\n').filter(l => l.length > 0);
}

// ── Writer tests (use importActual to bypass the mock) ──────────────────────

describe('writeNodeDeleteLogEntry — writer (t/3860)', () => {
  it('writes one JSONL record with 9 schema fields in order and correct types', async () => {
    const { writeNodeDeleteLogEntry } = await vi.importActual<typeof import('../storage/nodeDeleteLog.js')>('../storage/nodeDeleteLog.js');
    writeNodeDeleteLogEntry(sample, logPath);
    const lines = readLines();
    expect(lines).toHaveLength(1);

    const rec = JSON.parse(lines[0]);
    expect(Object.keys(rec)).toEqual(SCHEMA_FIELDS);
    expect(typeof rec.ID).toBe('number');
    expect(typeof rec.NodeId).toBe('string');
    expect(typeof rec.DanglingEdges).toBe('number');
    expect(rec.NodeId).toBe(sample.nodeId);
    expect(rec.Pov).toBe(sample.pov);
    expect(rec.DanglingEdges).toBe(3);
  });

  it('Datetime is ISO-8601 UTC and round-trip parseable', async () => {
    const { writeNodeDeleteLogEntry } = await vi.importActual<typeof import('../storage/nodeDeleteLog.js')>('../storage/nodeDeleteLog.js');
    writeNodeDeleteLogEntry(sample, logPath);
    const { Datetime } = JSON.parse(readLines()[0]);
    expect(Datetime).toMatch(/Z$/);
    expect(Number.isNaN(Date.parse(Datetime))).toBe(false);
  });

  it('ID is advisory-monotonic (1, 2, 3) on successive writes', async () => {
    const { writeNodeDeleteLogEntry } = await vi.importActual<typeof import('../storage/nodeDeleteLog.js')>('../storage/nodeDeleteLog.js');
    writeNodeDeleteLogEntry(sample, logPath);
    writeNodeDeleteLogEntry(sample, logPath);
    writeNodeDeleteLogEntry(sample, logPath);
    expect(readLines().map(l => JSON.parse(l).ID)).toEqual([1, 2, 3]);
  });

  it('each line is sub-PIPE_BUF and newline-terminated (atomic-append candidate)', async () => {
    const { writeNodeDeleteLogEntry } = await vi.importActual<typeof import('../storage/nodeDeleteLog.js')>('../storage/nodeDeleteLog.js');
    writeNodeDeleteLogEntry(sample, logPath);
    const raw = fs.readFileSync(logPath, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    for (const line of raw.split('\n').filter(l => l.length > 0)) {
      expect(Buffer.byteLength(line + '\n', 'utf8')).toBeLessThan(4096);
    }
  });

  it('an IO error is swallowed (fail-safe) — never throws', async () => {
    const { writeNodeDeleteLogEntry } = await vi.importActual<typeof import('../storage/nodeDeleteLog.js')>('../storage/nodeDeleteLog.js');
    const filePath = path.join(tmpDir, 'not-a-dir');
    fs.writeFileSync(filePath, 'x');
    const badPath = path.join(filePath, 'nested', 'node-delete-log.jsonl');
    expect(() => writeNodeDeleteLogEntry(sample, badPath)).not.toThrow();
  });
});

// ── Route tests ─────────────────────────────────────────────────────────────

describe('POST /api/node-delete-log route (t/3860)', () => {
  let handlers: Record<string, Handler>;

  const validBody: NodeDeleteLogEntry = {
    nodeId: 'saf-belief-002', pov: 'saf', label: 'Safety belief',
    user: 'user-2', danglingEdges: 0, danglingSituationRefs: 0, danglingChildren: 2,
  };

  beforeEach(() => {
    const r = makeRouter();
    registerNodeDeleteLogRoutes(r.router as never, {} as never);
    handlers = r.handlers;
  });

  it('valid body → 204 and calls writeNodeDeleteLogEntry with the entry', async () => {
    const res = fakeRes();
    await handlers['POST /api/node-delete-log']({} as IncomingMessage, res, validBody);
    expect(res._status).toBe(204);
    expect(writeNodeDeleteLogEntryMock).toHaveBeenCalledOnce();
    expect(writeNodeDeleteLogEntryMock).toHaveBeenCalledWith(validBody);
  });

  it('missing nodeId → 400, writer not called', async () => {
    const res = fakeRes();
    await handlers['POST /api/node-delete-log']({} as IncomingMessage, res, { ...validBody, nodeId: '' });
    expect(res._status).toBe(400);
    expect(writeNodeDeleteLogEntryMock).not.toHaveBeenCalled();
  });

  it('non-number danglingEdges → 400, writer not called', async () => {
    const res = fakeRes();
    await handlers['POST /api/node-delete-log']({} as IncomingMessage, res, { ...validBody, danglingEdges: 'three' });
    expect(res._status).toBe(400);
    expect(writeNodeDeleteLogEntryMock).not.toHaveBeenCalled();
  });

  it('anonymous user → 403, writer not called', async () => {
    isAnonymousUser.mockReturnValue(true);
    const res = fakeRes();
    await handlers['POST /api/node-delete-log']({} as IncomingMessage, res, validBody);
    expect(res._status).toBe(403);
    expect(writeNodeDeleteLogEntryMock).not.toHaveBeenCalled();
  });
});
