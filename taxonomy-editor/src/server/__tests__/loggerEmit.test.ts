// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2860: regression test for the ACTUAL emitted server-log line (not capLogObject
// in isolation — that was the t/1475 test gap that let prod keep slicing). Wires a
// logger to an in-process capture sink (the production non-pretty emit path) and
// asserts every emitted line stays <= LOG_MAX_LINE_BYTES for the escapes TL
// enumerated: a large object field, a large `msg` string (H2), and a pathological
// large URL path on a `Request completed`-shaped call.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

let buildLogger: (sink?: (chunk: string) => void) => { child: (b: Record<string, unknown>) => { info: (obj: Record<string, unknown>, msg: string) => void } };
let LOG_MAX_LINE_BYTES: number;
let prevNodeEnv: string | undefined;

beforeAll(async () => {
  // Force the non-pretty (ACA/stdout) emit path — usePretty is evaluated at module
  // load, so NODE_ENV must be set before the dynamic import below.
  prevNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const mod = await import('../logger.js');
  buildLogger = mod.buildLogger as typeof buildLogger;
  LOG_MAX_LINE_BYTES = mod.LOG_MAX_LINE_BYTES;
});

afterAll(() => {
  // Restore NODE_ENV so we don't leak 'production' into sibling test files sharing this worker.
  if (prevNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prevNodeEnv;
});

/** A logger whose emitted lines are captured (split on newline) instead of going to stdout. */
function capture() {
  const lines: string[] = [];
  const logger = buildLogger((chunk) => {
    for (const l of chunk.split('\n')) if (l.trim().length > 0) lines.push(l);
  });
  return { logger, lines };
}

const BIG = 200_000; // comfortably past the 16 KB ACA line limit

describe('emitted server-log line stays under the cap (t/2860)', () => {
  it('a large object field never emits a line over the cap', () => {
    const { logger, lines } = capture();
    logger.child({ component: 'server' }).info({ requestId: 'req-obj', blob: 'x'.repeat(BIG) }, 'huge object field');
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(Buffer.byteLength(l)).toBeLessThanOrEqual(LOG_MAX_LINE_BYTES);
  });

  it('a large msg string never emits a line over the cap (H2 — msg bypasses capLogObject)', () => {
    const { logger, lines } = capture();
    logger.child({ component: 'server' }).info({ requestId: 'req-msg' }, 'y'.repeat(BIG));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(Buffer.byteLength(l)).toBeLessThanOrEqual(LOG_MAX_LINE_BYTES);
  });

  it('a pathological large URL path on a Request-completed line stays under the cap', () => {
    const { logger, lines } = capture();
    logger.child({ component: 'server' }).info(
      { requestId: 'req-url', method: 'GET', path: '/' + 'p'.repeat(BIG), status: 200, duration_ms: 3 },
      'Request completed',
    );
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(Buffer.byteLength(l)).toBeLessThanOrEqual(LOG_MAX_LINE_BYTES);
  });

  it('a reduced (over-cap) line still carries requestId for correlation', () => {
    const { logger, lines } = capture();
    logger.child({ component: 'server' }).info({ requestId: 'req-keepme' }, 'z'.repeat(BIG));
    expect(lines.some(l => l.includes('req-keepme'))).toBe(true);
  });
});
