// Fault injection tests for crash recovery persistence (t/1149, Gap 1).
// Tests at two layers per TL review (t/1149#2):
//   1. Unit: atomicWriteSync/safeSerialize throw or degrade correctly
//   2. Integration: debate engine's emitSnapshot catches and continues

import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { safeSerialize, atomicWriteSync } from '../persistence.js';
import { STORAGE_FAULT_PROFILES, makeStorageError } from './faultInjection.js';
import { ActionableError } from '../errors.js';

// ── Helpers ─────────────────────────────────────────────

function tmpPath(suffix: string): string {
  return path.join(os.tmpdir(), `fault-test-${Date.now()}-${suffix}`);
}

function cleanup(...paths: string[]): void {
  for (const p of paths) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
    try { fs.unlinkSync(`${p}.tmp`); } catch { /* ignore */ }
  }
}

// ── Unit layer: atomicWriteSync fault behavior ──────────

describe('atomicWriteSync under storage faults', () => {
  const testFile = tmpPath('atomic.json');

  afterEach(() => cleanup(testFile));

  it('throws ENOSPC when writeFileSync fails (no .tmp orphan)', () => {
    const _profile = STORAGE_FAULT_PROFILES.checkpointWriteEnospc;
    const orig = fs.writeFileSync;
    const spy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      spy.mockRestore();
      throw makeStorageError('ENOSPC', 'no space left on device');
    });

    expect(() => atomicWriteSync(testFile, '{"data":true}')).toThrow('ENOSPC');
    expect(fs.existsSync(`${testFile}.tmp`)).toBe(false);
    expect(fs.existsSync(testFile)).toBe(false);

    // Restore for cleanup
    fs.writeFileSync = orig;
  });

  it('throws EACCES when writeFileSync fails (no .tmp orphan)', () => {
    const _profile = STORAGE_FAULT_PROFILES.checkpointWriteEacces;
    const orig = fs.writeFileSync;
    const spy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      spy.mockRestore();
      throw makeStorageError('EACCES', 'permission denied');
    });

    expect(() => atomicWriteSync(testFile, '{"data":true}')).toThrow('EACCES');
    expect(fs.existsSync(`${testFile}.tmp`)).toBe(false);

    fs.writeFileSync = orig;
  });

  it('cleans up .tmp on renameSync failure (EXDEV)', () => {
    const _profile = STORAGE_FAULT_PROFILES.renameFailure;
    const origRename = fs.renameSync;
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      spy.mockRestore();
      throw makeStorageError('EXDEV', 'cross-device link not permitted');
    });

    expect(() => atomicWriteSync(testFile, '{"data":true}')).toThrow('EXDEV');
    expect(fs.existsSync(`${testFile}.tmp`)).toBe(false);
    expect(fs.existsSync(testFile)).toBe(false);

    fs.renameSync = origRename;
  });

  it('preserves original file when rename fails', () => {
    fs.writeFileSync(testFile, '{"original":true}', 'utf-8');

    const spy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      spy.mockRestore();
      throw makeStorageError('EXDEV', 'cross-device link not permitted');
    });

    expect(() => atomicWriteSync(testFile, '{"updated":true}')).toThrow('EXDEV');
    expect(JSON.parse(fs.readFileSync(testFile, 'utf-8'))).toEqual({ original: true });
    expect(fs.existsSync(`${testFile}.tmp`)).toBe(false);
  });

  it('idempotent: second call overwrites first, no .tmp leftover', () => {
    atomicWriteSync(testFile, '{"version":1}');
    atomicWriteSync(testFile, '{"version":2}');

    expect(JSON.parse(fs.readFileSync(testFile, 'utf-8'))).toEqual({ version: 2 });
    expect(fs.existsSync(`${testFile}.tmp`)).toBe(false);
  });
});

// ── Unit layer: safeSerialize fault behavior ────────────

describe('safeSerialize under edge cases', () => {
  it('handles deeply nested circular references', () => {
    const a: Record<string, unknown> = { name: 'a' };
    const b: Record<string, unknown> = { name: 'b', parent: a };
    a.child = b;
    b.sibling = b;

    const { json, hadError } = safeSerialize(a);
    expect(hadError).toBe(true);
    const parsed = JSON.parse(json);
    expect(parsed.name).toBe('a');
    expect(parsed.child.name).toBe('b');
    expect(parsed.child.parent).toBe('[Circular]');
    expect(parsed.child.sibling).toBe('[Circular]');
  });

  it('converts BigInt values to strings in fallback mode', () => {
    const obj = { count: BigInt('9007199254740993') };
    const { json, hadError } = safeSerialize(obj);
    expect(hadError).toBe(true);
    const parsed = JSON.parse(json);
    expect(parsed.count).toBe('9007199254740993');
  });

  it('produces valid JSON even with mixed non-serializable fields', () => {
    const obj: Record<string, unknown> = {
      name: 'session',
      callback: () => 'nope',
      bigVal: BigInt(42),
      nested: { ok: true },
    };
    obj.self = obj;

    const { json, hadError } = safeSerialize(obj);
    expect(hadError).toBe(true);
    const parsed = JSON.parse(json);
    expect(parsed.name).toBe('session');
    expect(parsed.callback).toBeUndefined();
    expect(parsed.bigVal).toBe('42');
    expect(parsed.nested).toEqual({ ok: true });
    expect(parsed.self).toBe('[Circular]');
  });
});

// ── Corrupt checkpoint on resume ────────────────────────

describe('corrupt partial JSON on resume', () => {
  const partialFile = tmpPath('partial.json');

  afterEach(() => cleanup(partialFile));

  it('JSON.parse throws on corrupt checkpoint with clear error', () => {
    const _profile = STORAGE_FAULT_PROFILES.corruptPartialJson;
    fs.writeFileSync(partialFile, '{broken json content!!!', 'utf-8');

    let caught: unknown;
    try {
      JSON.parse(fs.readFileSync(partialFile, 'utf-8'));
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(SyntaxError);
  });

  it('wrapping corrupt checkpoint in ActionableError provides next steps', () => {
    fs.writeFileSync(partialFile, '{truncated: tru', 'utf-8');

    let caught: unknown;
    try {
      const raw = fs.readFileSync(partialFile, 'utf-8');
      try {
        JSON.parse(raw);
      } catch (parseErr) {
        throw new ActionableError({
          goal: 'Resume debate from checkpoint',
          problem: `Corrupt checkpoint file: ${(parseErr as Error).message}`,
          location: 'cli.resume',
          nextSteps: [
            `Verify the partial file is valid JSON: ${partialFile}`,
            'Look for other *-partial.json files in your output directory',
            'Re-run the debate from scratch if no valid checkpoint exists',
          ],
        });
      }
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ActionableError);
    const ae = caught as ActionableError;
    expect(ae.goal).toBe('Resume debate from checkpoint');
    expect(ae.problem).toContain('Corrupt checkpoint');
    expect(ae.nextSteps).toHaveLength(3);
    expect(ae.nextSteps[0]).toContain('valid JSON');
  });
});

// ── Integration layer: engine emitSnapshot resilience ───

describe('debate engine emitSnapshot catches snapshot callback failures', () => {
  it('onSnapshot ENOSPC does not abort the engine (logged to flight recorder)', async () => {
    const { DebateEngine } = await import('../debateEngine.js');

    let snapshotCallCount = 0;
    let snapshotError: Error | null = null;

    const config = {
      topic: 'Test topic',
      rounds: 1,
      model: 'test-model',
      temperature: 0.7,
      onSnapshot: (_session: unknown, _trigger: string) => {
        snapshotCallCount++;
        const err = makeStorageError('ENOSPC', 'no space left on device');
        snapshotError = err;
        throw err;
      },
    };

    // Access the private emitSnapshot method via prototype to test isolation
    const proto = DebateEngine.prototype as unknown as {
      emitSnapshot: (trigger: 'round_complete' | 'error') => void;
      config: typeof config;
      session: { id: string };
    };

    const fakeEngine = Object.create(proto);
    fakeEngine.config = config;
    fakeEngine.session = { id: 'test-fault-session' };

    // emitSnapshot should NOT throw — it catches internally
    expect(() => fakeEngine.emitSnapshot('round_complete')).not.toThrow();
    expect(snapshotCallCount).toBe(1);
    expect(snapshotError).not.toBeNull();
    expect((snapshotError as unknown as NodeJS.ErrnoException).code).toBe('ENOSPC');
  });

  it('onSnapshot EACCES does not abort the engine', async () => {
    const { DebateEngine } = await import('../debateEngine.js');

    let threw = false;
    const config = {
      topic: 'Test topic',
      rounds: 1,
      model: 'test-model',
      temperature: 0.7,
      onSnapshot: () => {
        threw = true;
        throw makeStorageError('EACCES', 'permission denied');
      },
    };

    const proto = DebateEngine.prototype as unknown as {
      emitSnapshot: (trigger: 'round_complete' | 'error') => void;
      config: typeof config;
      session: { id: string };
    };

    const fakeEngine = Object.create(proto);
    fakeEngine.config = config;
    fakeEngine.session = { id: 'test-fault-session' };

    expect(() => fakeEngine.emitSnapshot('error')).not.toThrow();
    expect(threw).toBe(true);
  });
});

// ── Partial result preservation ─────────────────────────

describe('partial result preservation under write failures', () => {
  const checkpointFile = tmpPath('checkpoint.json');

  afterEach(() => cleanup(checkpointFile));

  it('last successful checkpoint survives after subsequent ENOSPC', () => {
    const session1 = { id: 'sess-1', round: 1, data: 'first checkpoint' };
    const session2 = { id: 'sess-1', round: 2, data: 'second checkpoint' };

    // First write succeeds
    atomicWriteSync(checkpointFile, JSON.stringify(session1, null, 2));
    expect(JSON.parse(fs.readFileSync(checkpointFile, 'utf-8'))).toEqual(session1);

    // Second write fails at writeFileSync — original preserved
    const spy = vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
      throw makeStorageError('ENOSPC', 'no space left on device');
    });

    expect(() => atomicWriteSync(checkpointFile, JSON.stringify(session2, null, 2))).toThrow('ENOSPC');
    spy.mockRestore();

    // Original checkpoint is intact
    const preserved = JSON.parse(fs.readFileSync(checkpointFile, 'utf-8'));
    expect(preserved).toEqual(session1);
    expect(preserved.round).toBe(1);
  });

  it('last successful checkpoint survives after rename failure', () => {
    const session1 = { id: 'sess-1', round: 1 };
    const session2 = { id: 'sess-1', round: 2 };

    atomicWriteSync(checkpointFile, JSON.stringify(session1));

    // Rename fails — .tmp written but not moved
    const spy = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw makeStorageError('EXDEV', 'cross-device link not permitted');
    });

    expect(() => atomicWriteSync(checkpointFile, JSON.stringify(session2))).toThrow('EXDEV');
    spy.mockRestore();

    // Original file untouched, .tmp cleaned up
    expect(JSON.parse(fs.readFileSync(checkpointFile, 'utf-8'))).toEqual(session1);
    expect(fs.existsSync(`${checkpointFile}.tmp`)).toBe(false);
  });
});

// ── EPERM/EACCES retry on rename (t/1271) ─────────────

describe('atomicWriteSync EPERM retry (t/1271)', () => {
  const testFile = tmpPath('eperm-retry.json');

  afterEach(() => cleanup(testFile));

  it('retries on EPERM and succeeds when lock clears', () => {
    let callCount = 0;
    const origRename = fs.renameSync;
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation((...args: Parameters<typeof fs.renameSync>) => {
      callCount++;
      if (callCount <= 2) throw makeStorageError('EPERM', 'operation not permitted');
      spy.mockRestore();
      return origRename(...args);
    });

    atomicWriteSync(testFile, '{"recovered":true}');
    expect(callCount).toBe(3);
    expect(JSON.parse(fs.readFileSync(testFile, 'utf-8'))).toEqual({ recovered: true });
    expect(fs.existsSync(`${testFile}.tmp`)).toBe(false);
  });

  it('retries on EACCES and succeeds when lock clears', () => {
    let callCount = 0;
    const origRename = fs.renameSync;
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation((...args: Parameters<typeof fs.renameSync>) => {
      callCount++;
      if (callCount <= 1) throw makeStorageError('EACCES', 'permission denied');
      spy.mockRestore();
      return origRename(...args);
    });

    atomicWriteSync(testFile, '{"recovered":true}');
    expect(callCount).toBe(2);
    expect(JSON.parse(fs.readFileSync(testFile, 'utf-8'))).toEqual({ recovered: true });
  });

  it('throws after exhausting all retries on persistent EPERM', () => {
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw makeStorageError('EPERM', 'operation not permitted');
    });

    expect(() => atomicWriteSync(testFile, '{"data":true}')).toThrow('EPERM');
    // 1 initial + 5 retries = 6 calls
    expect(spy).toHaveBeenCalledTimes(6);
    expect(fs.existsSync(`${testFile}.tmp`)).toBe(false);
    spy.mockRestore();
  });

  it('does NOT retry on non-transient errors (EXDEV)', () => {
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw makeStorageError('EXDEV', 'cross-device link not permitted');
    });

    expect(() => atomicWriteSync(testFile, '{"data":true}')).toThrow('EXDEV');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
