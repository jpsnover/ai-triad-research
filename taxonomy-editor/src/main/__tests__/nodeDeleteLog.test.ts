// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3859 — main-process node-delete audit log writer. Mirrors the server aiCallLog.test.ts
// coverage (schema contract, advisory monotonic ID, atomic single-line append, IO fail-safe),
// adapted for this log's two differences from aiCallLog.ts: always-on (no enable flag), and the
// '_anonymous' → os.userInfo().username supplement (t/3859#1, Rosetta Stone).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, userInfo: vi.fn(() => ({ username: 'desktop-user' }) as os.UserInfo<string>) };
});

// getDataRootPath (fileIO.js) pulls in Electron's `app` at module load — not exercised here
// since every test passes an explicit pathOverride, so a minimal mock is enough.
vi.mock('../fileIO.js', () => ({ getDataRootPath: vi.fn(() => '/unused') }));
vi.mock('../../../../lib/flight-recorder/index.js', () => ({ getGlobalRecorder: vi.fn(() => null) }));

import { writeNodeDeleteLogEntry, type NodeDeleteLogEntry } from '../nodeDeleteLog.js';

const SCHEMA_FIELDS = ['ID', 'Datetime', 'NodeID', 'Pov', 'Label', 'User', 'DanglingEdges', 'DanglingSituationRefs', 'DanglingChildren'];

const sample: NodeDeleteLogEntry = {
  nodeId: 'acc-intentions-003', pov: 'accelerationist', label: 'Example Node', user: 'jsnover',
  danglingEdges: 194, danglingSituationRefs: 22, danglingChildren: 0,
};

let tmpDir: string;
let logPath: string;

function readLines(): string[] {
  return fs.readFileSync(logPath, 'utf8').split('\n').filter(l => l.length > 0);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodedeletelog-'));
  logPath = path.join(tmpDir, 'node-delete-log.jsonl');
});
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

describe('writeNodeDeleteLogEntry', () => {
  it('always writes (no enable flag, unlike aiCallLog.ts)', () => {
    writeNodeDeleteLogEntry(sample, logPath);
    expect(fs.existsSync(logPath)).toBe(true);
    expect(readLines()).toHaveLength(1);
  });

  it('one JSONL record with the 9 schema fields in order and correct types', () => {
    writeNodeDeleteLogEntry(sample, logPath);
    const rec = JSON.parse(readLines()[0]);
    expect(Object.keys(rec)).toEqual(SCHEMA_FIELDS);
    expect(typeof rec.ID).toBe('number');
    expect(typeof rec.Datetime).toBe('string');
    expect(rec.NodeID).toBe('acc-intentions-003');
    expect(rec.Pov).toBe('accelerationist');
    expect(rec.Label).toBe('Example Node');
    expect(rec.User).toBe('jsnover');
    expect(rec.DanglingEdges).toBe(194);
    expect(rec.DanglingSituationRefs).toBe(22);
    expect(rec.DanglingChildren).toBe(0);
  });

  it('Datetime is ISO-8601 UTC and round-trip parseable', () => {
    writeNodeDeleteLogEntry(sample, logPath);
    const { Datetime } = JSON.parse(readLines()[0]);
    expect(Datetime).toMatch(/Z$/);
    expect(Number.isNaN(Date.parse(Datetime))).toBe(false);
  });

  it('a zero-dangling delete still logs, with 0 rather than an omitted field (ADR: absence must not mean zero)', () => {
    writeNodeDeleteLogEntry({ ...sample, danglingEdges: 0, danglingSituationRefs: 0, danglingChildren: 0 }, logPath);
    const rec = JSON.parse(readLines()[0]);
    expect(Object.keys(rec)).toEqual(SCHEMA_FIELDS);
    expect(rec.DanglingEdges).toBe(0);
    expect(rec.DanglingSituationRefs).toBe(0);
    expect(rec.DanglingChildren).toBe(0);
  });

  it("supplements '_anonymous' with the OS login (desktop has no useAuthStatus identity, t/3859#1)", () => {
    writeNodeDeleteLogEntry({ ...sample, user: '_anonymous' }, logPath);
    const { User } = JSON.parse(readLines()[0]);
    expect(User).toBe('desktop-user');
  });

  it('a real user value passes through unchanged (not overridden)', () => {
    writeNodeDeleteLogEntry({ ...sample, user: 'jsnover' }, logPath);
    const { User } = JSON.parse(readLines()[0]);
    expect(User).toBe('jsnover');
  });

  it('ID is advisory-monotonic within the file (1,2,3), restarting at 1 on a fresh file', () => {
    writeNodeDeleteLogEntry(sample, logPath);
    writeNodeDeleteLogEntry(sample, logPath);
    writeNodeDeleteLogEntry(sample, logPath);
    expect(readLines().map(l => JSON.parse(l).ID)).toEqual([1, 2, 3]);
  });

  it('each line is an atomic-append candidate: sub-PIPE_BUF and newline-terminated', () => {
    writeNodeDeleteLogEntry({ ...sample, label: 'y'.repeat(300) }, logPath);
    writeNodeDeleteLogEntry(sample, logPath);
    const raw = fs.readFileSync(logPath, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    for (const line of raw.split('\n').filter(l => l.length > 0)) {
      expect(Buffer.byteLength(line + '\n', 'utf8')).toBeLessThan(4096);
    }
  });

  // Mirrors aiCallLog.test.ts's t/3516 regression proof: a crafted label carrying embedded
  // newlines + a forged JSON record must not forge a second JSONL line.
  it('a label with embedded newlines/JSON cannot forge a second JSONL line (injection-safe)', () => {
    const malicious = 'safe\n{"ID":999,"NodeID":"FORGED"}\nmore';
    writeNodeDeleteLogEntry({ ...sample, label: malicious }, logPath);
    const lines = readLines();
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]);
    expect(rec.Label).toContain('\n');
    expect(rec.ID).toBe(1);
    expect(rec.NodeID).toBe(sample.nodeId); // NOT 'FORGED'
  });

  it('an IO error is swallowed (fail-safe) — never throws', () => {
    const filePath = path.join(tmpDir, 'not-a-dir');
    fs.writeFileSync(filePath, 'x');
    const badPath = path.join(filePath, 'nested', 'node-delete-log.jsonl');
    expect(() => writeNodeDeleteLogEntry(sample, badPath)).not.toThrow();
  });
});
