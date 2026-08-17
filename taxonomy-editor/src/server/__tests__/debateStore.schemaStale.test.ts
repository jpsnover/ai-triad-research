// @vitest-environment node

/**
 * t/2725 — the debate-index schema-drift guard. A cached index built before the
 * model/turn_count summary fields existed has the right ROW COUNT but fieldless rows,
 * so the count-only staleness check would keep serving them (Turns/Model render empty).
 * isDebateIndexSchemaStale detects the missing key so listDebateSessionsMeta rebuilds.
 */

import { describe, it, expect } from 'vitest';
import { isDebateIndexSchemaStale } from '../storage/debateStore';

describe('isDebateIndexSchemaStale (t/2725)', () => {
  it('empty index is not stale (nothing to rebuild)', () => {
    expect(isDebateIndexSchemaStale([])).toBe(false);
  });

  it('STALE: a row missing both model and turn_count', () => {
    expect(isDebateIndexSchemaStale([{ id: 'd1', title: 'T', phase: 'closed' }])).toBe(true);
  });

  it('STALE: a row missing only model', () => {
    expect(isDebateIndexSchemaStale([{ id: 'd1', turn_count: 3 }])).toBe(true);
  });

  it('STALE: a row missing only turn_count', () => {
    expect(isDebateIndexSchemaStale([{ id: 'd1', model: 'gemini-3.5-flash-lite' }])).toBe(true);
  });

  it('FRESH: a row carrying both keys is not stale — even when their values are undefined', () => {
    // Key presence (not value) signals the new schema: a debate with no model set still
    // carries the key, so it must NOT force a perpetual rebuild.
    expect(isDebateIndexSchemaStale([{ id: 'd1', model: undefined, turn_count: 0 }])).toBe(false);
    expect(isDebateIndexSchemaStale([{ id: 'd1', model: 'gemini-3.5-flash-lite', turn_count: 5 }])).toBe(false);
  });
});
