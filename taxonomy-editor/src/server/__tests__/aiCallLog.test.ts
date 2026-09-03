// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3245 — TS-originated AI Call Log writer. Verifies the SCHEMA CONTRACT (t/3245#3) the PS reader
// (Get-AICallLog) parses: 7 named fields, correct types, ISO-8601 Datetime, PromptStart≤160, plus the
// flag-off no-op, advisory monotonic ID, and the atomic single-line append (sub-PIPE_BUF, newline-terminated).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { writeAICallLogEntry, isAICallLogEnabled, type AICallLogEntry } from '../ai/aiCallLog.js';

const SCHEMA_FIELDS = ['ID', 'Datetime', 'Scenario', 'PromptID', 'PromptStart', 'RetryCount', 'Status'];

const sample: AICallLogEntry = {
  scenario: 'Debate', promptId: 'usage.debate.turn', promptStart: 'Argue the accelerationist case',
  retryCount: 0, status: '200',
};

let tmpDir: string;
let logPath: string;
const priorFlag = process.env.AI_CALL_LOG_ENABLED;

function readLines(): string[] {
  return fs.readFileSync(logPath, 'utf8').split('\n').filter(l => l.length > 0);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalllog-'));
  logPath = path.join(tmpDir, 'ai-call-log.jsonl');
});

afterEach(() => {
  if (priorFlag === undefined) delete process.env.AI_CALL_LOG_ENABLED;
  else process.env.AI_CALL_LOG_ENABLED = priorFlag;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('isAICallLogEnabled', () => {
  it('is true only for truthy tokens (1|true|yes|on, case-insensitive), default off', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'On']) {
      process.env.AI_CALL_LOG_ENABLED = v;
      expect(isAICallLogEnabled(), `"${v}" should enable`).toBe(true);
    }
    for (const v of ['0', 'false', 'no', 'off', '', '  ', 'enabled']) {
      process.env.AI_CALL_LOG_ENABLED = v;
      expect(isAICallLogEnabled(), `"${v}" should NOT enable`).toBe(false);
    }
    delete process.env.AI_CALL_LOG_ENABLED;
    expect(isAICallLogEnabled(), 'unset → off').toBe(false);
  });
});

describe('writeAICallLogEntry', () => {
  it('flag off → no-op, writes nothing', () => {
    delete process.env.AI_CALL_LOG_ENABLED;
    writeAICallLogEntry(sample, logPath);
    expect(fs.existsSync(logPath)).toBe(false);
  });

  it('flag on → one JSONL record with the 7 schema fields in order and correct types', () => {
    process.env.AI_CALL_LOG_ENABLED = '1';
    writeAICallLogEntry(sample, logPath);
    const lines = readLines();
    expect(lines).toHaveLength(1);

    const rec = JSON.parse(lines[0]);
    expect(Object.keys(rec)).toEqual(SCHEMA_FIELDS); // insertion order == schema order
    expect(typeof rec.ID).toBe('number');
    expect(typeof rec.Datetime).toBe('string');
    expect(typeof rec.Scenario).toBe('string');
    expect(typeof rec.PromptID).toBe('string');
    expect(typeof rec.PromptStart).toBe('string');
    expect(typeof rec.RetryCount).toBe('number');
    expect(typeof rec.Status).toBe('string');
    expect(rec.Scenario).toBe('Debate');
    expect(rec.PromptID).toBe('usage.debate.turn');
    expect(rec.Status).toBe('200');
  });

  it('Datetime is ISO-8601 UTC and round-trip parseable (PS TryParse(RoundtripKind))', () => {
    process.env.AI_CALL_LOG_ENABLED = 'true';
    writeAICallLogEntry(sample, logPath);
    const { Datetime } = JSON.parse(readLines()[0]);
    expect(Datetime).toMatch(/Z$/);
    expect(Number.isNaN(Date.parse(Datetime))).toBe(false);
  });

  it('PromptStart is truncated to 160 chars', () => {
    process.env.AI_CALL_LOG_ENABLED = '1';
    writeAICallLogEntry({ ...sample, promptStart: 'x'.repeat(300) }, logPath);
    const { PromptStart } = JSON.parse(readLines()[0]);
    expect(PromptStart).toHaveLength(160);
  });

  it('ID is advisory-monotonic within the file (1,2,3), restarting at 1 on a fresh file', () => {
    process.env.AI_CALL_LOG_ENABLED = 'on';
    writeAICallLogEntry(sample, logPath);
    writeAICallLogEntry(sample, logPath);
    writeAICallLogEntry(sample, logPath);
    expect(readLines().map(l => JSON.parse(l).ID)).toEqual([1, 2, 3]);
  });

  it('each line is an atomic-append candidate: sub-PIPE_BUF and newline-terminated', () => {
    process.env.AI_CALL_LOG_ENABLED = '1';
    writeAICallLogEntry({ ...sample, promptStart: 'y'.repeat(300) }, logPath); // largest realistic record
    writeAICallLogEntry(sample, logPath);
    const raw = fs.readFileSync(logPath, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    for (const line of raw.split('\n').filter(l => l.length > 0)) {
      expect(Buffer.byteLength(line + '\n', 'utf8')).toBeLessThan(4096); // PIPE_BUF floor
    }
  });

  it('an IO error is swallowed (fail-safe) — never throws', () => {
    process.env.AI_CALL_LOG_ENABLED = '1';
    // Point at a path whose parent is a FILE, so mkdir/open fails; the write must not throw.
    const filePath = path.join(tmpDir, 'not-a-dir');
    fs.writeFileSync(filePath, 'x');
    const badPath = path.join(filePath, 'nested', 'ai-call-log.jsonl');
    expect(() => writeAICallLogEntry(sample, badPath)).not.toThrow();
  });
});
