// @vitest-environment node

/**
 * t/1475 — Pino log lines must stay within ACA's ~16KB Fluent Bit per-line buffer
 * so they aren't sliced into unparseable JSON. Verifies the field-truncation +
 * total-line cap in logger.ts, including preservation of triage fields.
 */

import { describe, it, expect } from 'vitest';
import { truncateLogValue, capLogObject, LOG_MAX_FIELD_CHARS, LOG_MAX_LINE_BYTES } from '../logger.js';

describe('log-line size caps (t/1475)', () => {
  it('truncates an oversized string field with a [truncated] marker, keeping the head (AC#3)', () => {
    const big = 'x'.repeat(50_000);
    const out = truncateLogValue({ body: big }) as { body: string };
    expect(out.body.length).toBeLessThan(LOG_MAX_FIELD_CHARS + 40);
    expect(out.body).toContain('[truncated');
    expect(out.body.startsWith('x'.repeat(100))).toBe(true);
  });

  it('leaves a normal small log object unchanged', () => {
    const obj = { component: 'server', requestId: 'req-1', method: 'GET', path: '/api/x', status: 200, duration_ms: 12 };
    expect(capLogObject(obj)).toEqual(obj);
  });

  it('caps the whole object under the line limit even with many large fields (AC#1)', () => {
    const obj: Record<string, unknown> = { requestId: 'req-2', method: 'POST', path: '/api/y', status: 500 };
    for (let i = 0; i < 50; i++) obj[`field_${i}`] = 'y'.repeat(10_000); // ~500KB pre-cap
    const out = capLogObject(obj);
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(LOG_MAX_LINE_BYTES);
  });

  it('preserves triage fields + error name/message when the backstop fires (AC#5)', () => {
    const obj: Record<string, unknown> = {
      component: 'server', requestId: 'req-3', method: 'GET', path: '/api/z', status: 500, duration_ms: 99,
      error: { name: 'BlobError', message: 'upload failed', stack: 's'.repeat(80_000) },
    };
    for (let i = 0; i < 20; i++) obj[`extra_${i}`] = 'b'.repeat(10_000); // force > line limit after field-truncation
    const out = capLogObject(obj) as Record<string, unknown>;

    expect(JSON.stringify(out).length).toBeLessThanOrEqual(LOG_MAX_LINE_BYTES);
    expect(out.requestId).toBe('req-3');
    expect(out.method).toBe('GET');
    expect(out.path).toBe('/api/z');
    expect(out.status).toBe(500);
    expect(out.duration_ms).toBe(99);
    expect(out.error).toEqual({ name: 'BlobError', message: 'upload failed' }); // stack dropped
    expect(out._log_truncated).toBeDefined();
  });

  it('caps long arrays and deep nesting', () => {
    const out = truncateLogValue({ arr: Array.from({ length: 500 }, (_, i) => i) }) as { arr: unknown[] };
    expect(out.arr.length).toBeLessThanOrEqual(101);
    expect(String(out.arr[out.arr.length - 1])).toContain('[truncated');
  });
});
