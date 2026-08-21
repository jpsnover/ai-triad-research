// @vitest-environment node

/**
 * t/2725 + t/2892 — the debate-index schema-drift guard. A cached index built before the
 * model/turn_count summary fields existed (or written by the fieldless upsert path) has the
 * right ROW COUNT but rows lacking turn_count, so the count-only staleness check would keep
 * serving them (Turns/Model render "—"). isDebateIndexSchemaStale detects the missing key so
 * listDebateSessionsMeta rebuilds. t/2892: key ONLY on turn_count (always a number after
 * rebuild/upsert, so no false rebuild loop; `model` is legitimately optional), and scan EVERY
 * row (a mixed index can have a fresh row at [0] and stale rows below it).
 */

import { describe, it, expect } from 'vitest';
import { isDebateIndexSchemaStale } from '../storage/debateStore';

describe('isDebateIndexSchemaStale (t/2725, t/2892)', () => {
  it('empty index is not stale (nothing to rebuild)', () => {
    expect(isDebateIndexSchemaStale([])).toBe(false);
  });

  it('STALE: a row missing both model and turn_count', () => {
    expect(isDebateIndexSchemaStale([{ id: 'd1', title: 'T', phase: 'closed' }])).toBe(true);
  });

  it('STALE: a row missing turn_count (even if model is present)', () => {
    expect(isDebateIndexSchemaStale([{ id: 'd1', model: 'gemini-3.5-flash-lite' }])).toBe(true);
  });

  it('FRESH: turn_count present, model absent — model is legitimately optional (t/2892)', () => {
    // A debate with no model set still carries turn_count; keying rebuild on model would loop.
    expect(isDebateIndexSchemaStale([{ id: 'd1', turn_count: 3 }])).toBe(false);
    expect(isDebateIndexSchemaStale([{ id: 'd1', model: undefined, turn_count: 0 }])).toBe(false);
    expect(isDebateIndexSchemaStale([{ id: 'd1', model: 'gemini-3.5-flash-lite', turn_count: 5 }])).toBe(false);
  });

  it('STALE: scans every row — a fieldless row below a fresh [0] is caught (t/2892)', () => {
    expect(isDebateIndexSchemaStale([
      { id: 'fresh', model: 'claude-fable-5', turn_count: 13 }, // new upsert
      { id: 'stale', model: 'gemini', title: 'old' },          // fieldless upsert (no turn_count)
    ])).toBe(true);
  });
});
