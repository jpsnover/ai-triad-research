// @vitest-environment node

/**
 * t/803 — correlation IDs are UUID-based (req-<uuid>), never email/PII.
 * (The middleware wiring, X-Request-Id header, log mixin, and FR stamping live
 * in server.ts, which isn't import-safe; this covers the id-format contract.)
 */

import { describe, it, expect } from 'vitest';
import { generateRequestId } from '../logger.js';

describe('generateRequestId (t/803)', () => {
  it('returns a req-<uuid> id with no embedded PII', () => {
    const id = generateRequestId();
    expect(id).toMatch(/^req-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(id).not.toContain('@'); // no email
  });

  it('generates a fresh id each call', () => {
    expect(generateRequestId()).not.toBe(generateRequestId());
  });
});
