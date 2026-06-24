// @vitest-environment node

/**
 * Bounded server-log buffer that feeds self-contained flight-recorder dumps
 * (operator request). Verifies parse/scrub/cap behavior and that malformed
 * lines never throw (the buffer sits on the logging hot path).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { recordServerLog, drainServerLogLines, _resetServerLogBuffer, MAX_LOG_LINES } from '../serverLogBuffer.js';

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
});
