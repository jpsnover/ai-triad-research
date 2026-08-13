// Fault injection tests for sweepOrphanedTempFiles (t/2555).
//
// Self-cert: /add-fault-test pattern. The "fault" (write killed between .tmp
// and rename) is simulated by creating the stranded .tmp file directly —
// equivalent to the state left by atomicWriteSync when its rename budget
// exhausts. No FaultHarness used (FaultHarness targets AI/network; file-system
// faults are injected via real temp files and vi.spyOn(fs)).

import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { setGlobalRecorder, clearGlobalRecorder, type FlightRecorder } from '../../flight-recorder/index.js';
import type { RecordInput } from '../../flight-recorder/types.js';
import { sweepOrphanedTempFiles, type OrphanResult } from '../persistence.js';

beforeAll(() => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('[test] network blocked')));
});
afterAll(() => { vi.unstubAllGlobals(); });

function installCaptureRecorder(): RecordInput[] {
  const captured: RecordInput[] = [];
  const fake = { record: (e: RecordInput) => { captured.push(e); } } as unknown as FlightRecorder;
  setGlobalRecorder(fake);
  return captured;
}

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-test-'));
}

function rmDir(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

afterEach(() => { vi.restoreAllMocks(); clearGlobalRecorder(); });

// ── AC: fault injected → sweep recovers ──────────────────

describe('sweepOrphanedTempFiles — recovery (t/2555)', () => {
  it('recovers a valid stranded .json.tmp file', () => {
    const dir = makeTmpDir();
    try {
      const content = JSON.stringify({ id: 'debate-abc', rounds: [] });
      fs.writeFileSync(path.join(dir, 'debate-abc.json.tmp'), content, 'utf-8');

      const results: OrphanResult[] = [];
      const captured = installCaptureRecorder();
      sweepOrphanedTempFiles(dir, r => results.push(r));

      expect(results).toHaveLength(1);
      expect(results[0].recovered).toBe(true);
      expect(fs.existsSync(path.join(dir, 'debate-abc.json'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'debate-abc.json.tmp'))).toBe(false);

      const events = captured.filter(e => e.type === 'io.tmp-orphan');
      expect(events).toHaveLength(1);
      expect(events[0].level).toBe('warn');
      expect(events[0].data).toMatchObject({ recovered: true });
    } finally {
      rmDir(dir);
    }
  });

  it('recovers a valid stranded .json.tmp2 file', () => {
    const dir = makeTmpDir();
    try {
      const content = JSON.stringify({ id: 'debate-xyz', rounds: [] });
      fs.writeFileSync(path.join(dir, 'debate-xyz.json.tmp2'), content, 'utf-8');

      const results: OrphanResult[] = [];
      sweepOrphanedTempFiles(dir, r => results.push(r));

      expect(results[0].recovered).toBe(true);
      expect(fs.existsSync(path.join(dir, 'debate-xyz.json'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'debate-xyz.json.tmp2'))).toBe(false);
    } finally {
      rmDir(dir);
    }
  });

  it('preserves orphan and emits error-level event when JSON is invalid (truncated write)', () => {
    const dir = makeTmpDir();
    try {
      fs.writeFileSync(path.join(dir, 'debate-bad.json.tmp'), '{"id":"debate-bad","rounds":[{', 'utf-8');

      const results: OrphanResult[] = [];
      const captured = installCaptureRecorder();
      sweepOrphanedTempFiles(dir, r => results.push(r));

      expect(results[0].recovered).toBe(false);
      expect(fs.existsSync(path.join(dir, 'debate-bad.json.tmp'))).toBe(true);

      const events = captured.filter(e => e.type === 'io.tmp-orphan');
      expect(events[0].level).toBe('error');
      expect(events[0].data).toMatchObject({ recovered: false });
    } finally {
      rmDir(dir);
    }
  });

  it('preserves orphan when final path already exists (concurrent write safety)', () => {
    const dir = makeTmpDir();
    try {
      const existing = JSON.stringify({ id: 'debate-exist', rounds: ['round1'] });
      const orphan = JSON.stringify({ id: 'debate-exist', rounds: ['round1', 'round2'] });
      fs.writeFileSync(path.join(dir, 'debate-exist.json'), existing, 'utf-8');
      fs.writeFileSync(path.join(dir, 'debate-exist.json.tmp'), orphan, 'utf-8');

      const results: OrphanResult[] = [];
      sweepOrphanedTempFiles(dir, r => results.push(r));

      expect(results[0].recovered).toBe(false);
      expect(results[0].reason).toMatch(/already exists/);
      // Existing file must not be overwritten
      expect(JSON.parse(fs.readFileSync(path.join(dir, 'debate-exist.json'), 'utf-8')).rounds).toHaveLength(1);
      // Orphan preserved for manual review
      expect(fs.existsSync(path.join(dir, 'debate-exist.json.tmp'))).toBe(true);
    } finally {
      rmDir(dir);
    }
  });

  it('recovers both .tmp and .tmp2 orphans in the same directory', () => {
    const dir = makeTmpDir();
    try {
      fs.writeFileSync(path.join(dir, 'a.json.tmp'), JSON.stringify({ id: 'a' }), 'utf-8');
      fs.writeFileSync(path.join(dir, 'b.json.tmp2'), JSON.stringify({ id: 'b' }), 'utf-8');

      const results: OrphanResult[] = [];
      sweepOrphanedTempFiles(dir, r => results.push(r));

      expect(results).toHaveLength(2);
      expect(results.every(r => r.recovered)).toBe(true);
      expect(fs.existsSync(path.join(dir, 'a.json'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'b.json'))).toBe(true);
    } finally {
      rmDir(dir);
    }
  });
});

// ── AC: clean run emits nothing ───────────────────────────

describe('sweepOrphanedTempFiles — clean run (t/2555)', () => {
  it('emits no FR events and invokes no callback when no orphans exist', () => {
    const dir = makeTmpDir();
    try {
      // Put a regular debate file — should be ignored
      fs.writeFileSync(path.join(dir, 'debate-clean.json'), JSON.stringify({ id: 'clean' }), 'utf-8');

      const results: OrphanResult[] = [];
      const captured = installCaptureRecorder();
      sweepOrphanedTempFiles(dir, r => results.push(r));

      expect(results).toHaveLength(0);
      expect(captured.filter(e => e.type === 'io.tmp-orphan')).toHaveLength(0);
    } finally {
      rmDir(dir);
    }
  });

  it('returns silently when the directory does not exist', () => {
    const nonexistent = path.join(os.tmpdir(), `sweep-nonexistent-${Date.now()}`);
    expect(() => sweepOrphanedTempFiles(nonexistent)).not.toThrow();
  });

  it('does not process .json files or other extensions', () => {
    const dir = makeTmpDir();
    try {
      fs.writeFileSync(path.join(dir, 'debate.json'), '{}', 'utf-8');
      fs.writeFileSync(path.join(dir, 'debate.json.bak'), '{}', 'utf-8');
      fs.writeFileSync(path.join(dir, 'debate.tmp'), '{}', 'utf-8'); // wrong extension pattern

      const results: OrphanResult[] = [];
      sweepOrphanedTempFiles(dir, r => results.push(r));

      expect(results).toHaveLength(0);
    } finally {
      rmDir(dir);
    }
  });
});

// ── Result shape ──────────────────────────────────────────

describe('sweepOrphanedTempFiles — result shape', () => {
  it('OrphanResult contains tmpPath, finalPath, recovered, and optional reason', () => {
    const dir = makeTmpDir();
    try {
      fs.writeFileSync(path.join(dir, 'debate-shape.json.tmp'), JSON.stringify({ id: 'shape' }), 'utf-8');

      const results: OrphanResult[] = [];
      sweepOrphanedTempFiles(dir, r => results.push(r));

      const r = results[0];
      expect(r.tmpPath).toBe(path.join(dir, 'debate-shape.json.tmp'));
      expect(r.finalPath).toBe(path.join(dir, 'debate-shape.json'));
      expect(r.recovered).toBe(true);
      expect(r.reason).toBeUndefined();
    } finally {
      rmDir(dir);
    }
  });
});
