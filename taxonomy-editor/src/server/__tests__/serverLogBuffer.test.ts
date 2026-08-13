// @vitest-environment node

/**
 * Bounded server-log buffer that feeds self-contained flight-recorder dumps
 * (operator request). Verifies parse/scrub/cap behavior and that malformed
 * lines never throw (the buffer sits on the logging hot path).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { recordServerLog, drainServerLogLines, _resetServerLogBuffer, MAX_LOG_LINES, MAX_ERROR_LOG_LINES } from '../serverLogBuffer.js';

describe('serverLogBuffer', () => {
  beforeEach(() => { _resetServerLogBuffer(); });

  it('parses a JSON log line and returns it from drain', () => {
    recordServerLog(JSON.stringify({ level: 30, component: 'server', msg: 'hello' }));
    const lines = drainServerLogLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 30, component: 'server', msg: 'hello' });
  });

  it('splits a multi-line chunk into separate entries and skips blanks', () => {
    recordServerLog(`${JSON.stringify({ msg: 'a' })}\n\n${JSON.stringify({ msg: 'b' })}\n`);
    expect(drainServerLogLines().map(l => l.msg)).toEqual(['a', 'b']);
  });

  it('never throws on malformed input and just skips it', () => {
    expect(() => recordServerLog('not json at all')).not.toThrow();
    expect(() => recordServerLog('')).not.toThrow();
    recordServerLog(`garbage\n${JSON.stringify({ msg: 'ok' })}`);
    expect(drainServerLogLines().map(l => l.msg)).toEqual(['ok']);
  });

  it('scrubs sensitive keys defensively, including nested', () => {
    recordServerLog(JSON.stringify({
      msg: 'auth', token: 'abc123', apiKey: 'sekret',
      headers: { authorization: 'Bearer xyz', cookie: 'sid=1' },
      nested: { password: 'hunter2', ok: 'visible' },
    }));
    const e = drainServerLogLines()[0];
    expect(e.token).toBe('[REDACTED]');
    expect(e.apiKey).toBe('[REDACTED]');
    expect((e.headers as Record<string, unknown>).authorization).toBe('[REDACTED]');
    expect((e.headers as Record<string, unknown>).cookie).toBe('[REDACTED]');
    expect((e.nested as Record<string, unknown>).password).toBe('[REDACTED]');
    expect((e.nested as Record<string, unknown>).ok).toBe('visible');
  });

  it('truncates an oversized line to essentials', () => {
    recordServerLog(JSON.stringify({ level: 50, component: 'server', requestId: 'req-1', msg: 'big', blob: 'x'.repeat(8000) }));
    const e = drainServerLogLines()[0];
    expect(e._truncated).toBe(true);
    expect(e.blob).toBeUndefined();
    expect(e.component).toBe('server');
    expect(e.requestId).toBe('req-1');
  });

  it('caps the buffer at MAX_LOG_LINES, keeping the most recent', () => {
    for (let i = 0; i < MAX_LOG_LINES + 50; i++) recordServerLog(JSON.stringify({ n: i }));
    const lines = drainServerLogLines();
    expect(lines).toHaveLength(MAX_LOG_LINES);
    expect(lines[0].n).toBe(50); // oldest 50 evicted
    expect(lines[lines.length - 1].n).toBe(MAX_LOG_LINES + 49);
  });

  it('drain returns a copy (mutating it does not affect the buffer)', () => {
    recordServerLog(JSON.stringify({ msg: 'a' }));
    drainServerLogLines().push({ msg: 'injected' });
    expect(drainServerLogLines()).toHaveLength(1);
  });

  // t/2552: the incident — an error line (level 50) evicted from the main ring by
  // info-level request traffic before the dump triggered.
  it('pins an error line so info-level flooding cannot evict it (t/2552)', () => {
    recordServerLog(JSON.stringify({ level: 50, component: 'server', requestId: 'req-err', msg: 'boom 500' }));
    // Flood the 250-entry main ring with far more info lines than its cap.
    for (let i = 0; i < MAX_LOG_LINES + 50; i++) recordServerLog(JSON.stringify({ level: 30, n: i }));

    const lines = drainServerLogLines();
    const errors = lines.filter(l => l.level === 50);
    expect(errors).toHaveLength(1);                       // survived, exactly once
    expect(errors[0]).toMatchObject({ requestId: 'req-err', msg: 'boom 500' });
    expect(lines[0]).toMatchObject({ requestId: 'req-err' }); // evicted error prepended (oldest)
  });

  it('does not duplicate an error still within the main ring window (t/2552)', () => {
    recordServerLog(JSON.stringify({ level: 50, msg: 'err-1' }));
    recordServerLog(JSON.stringify({ level: 30, msg: 'info-1' }));
    const lines = drainServerLogLines();
    expect(lines).toHaveLength(2);                        // no dup — error still in main
    expect(lines.filter(l => l.msg === 'err-1')).toHaveLength(1);
  });

  it('caps the pinned error buffer at MAX_ERROR_LOG_LINES (t/2552)', () => {
    const total = MAX_ERROR_LOG_LINES + 20;
    for (let i = 0; i < total; i++) recordServerLog(JSON.stringify({ level: 50, e: i }));
    // Evict every error from the main ring so drain sources them from the error ring.
    for (let i = 0; i < MAX_LOG_LINES; i++) recordServerLog(JSON.stringify({ level: 30, n: i }));

    const errors = drainServerLogLines().filter(l => l.level === 50);
    expect(errors).toHaveLength(MAX_ERROR_LOG_LINES);     // only the most recent 50 pinned
    expect(errors[errors.length - 1].e).toBe(total - 1);  // newest kept
    expect(errors[0].e).toBe(total - MAX_ERROR_LOG_LINES); // oldest 20 dropped
  });
});
