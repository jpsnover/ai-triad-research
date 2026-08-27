// @vitest-environment node

/**
 * t/3067 — session-scoped server FR dump filter.
 * Load-bearing test (TL condition #3): two sessionBranches A+B plus global
 * events in the buffer → A's dump has ONLY A's events, zero B, zero
 * always-exclude types (_type:context, null _sessionBranch).
 */

import { describe, it, expect } from 'vitest';
import { filterSessionEvents } from '../routes/sessionScopedDump.js';

const SESSION_A = 'users/alice/session';
const SESSION_B = 'users/bob/session';

function makeNdjson(lines: Record<string, unknown>[]): string {
  return lines.map(l => JSON.stringify(l)).join('\n') + '\n';
}

describe('filterSessionEvents (t/3067)', () => {
  it('keeps only structural lines and session-A events from a mixed buffer', () => {
    const header = { _type: 'header', _version: 1, schema_version: '1.0.0' };
    const dict   = { _type: 'dictionary', entries: [] };
    const ctx    = { _type: 'context', active_branches: 5, github: { rate_limit_remaining: 100 } };
    const evtA1  = { type: 'lifecycle', component: 'server', _sessionBranch: SESSION_A, path: '/api/a' };
    const evtA2  = { type: 'ai.retry', component: 'server', _sessionBranch: SESSION_A, attempt: 1 };
    const evtB   = { type: 'lifecycle', component: 'server', _sessionBranch: SESSION_B, path: '/api/b' };
    const evtGlb = { type: 'system.error', component: 'server', _sessionBranch: null, message: 'startup-err' };
    const trigger = { _type: 'trigger', timestamp: '2026-01-01T00:00:00Z', trigger_type: 'manual' };

    const ndjson = makeNdjson([header, dict, ctx, evtA1, evtB, evtA2, evtGlb, trigger]);
    const result = filterSessionEvents(ndjson, SESSION_A);
    const lines  = result.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));

    // Structural lines retained
    expect(lines.find(l => l._type === 'header')).toBeDefined();
    expect(lines.find(l => l._type === 'dictionary')).toBeDefined();
    expect(lines.find(l => l._type === 'trigger')).toBeDefined();

    // Session-A events retained
    expect(lines.filter(l => l._sessionBranch === SESSION_A)).toHaveLength(2);

    // Context line excluded (always global)
    expect(lines.find(l => l._type === 'context')).toBeUndefined();

    // Session-B events excluded
    expect(lines.find(l => l._sessionBranch === SESSION_B)).toBeUndefined();

    // Global/null-session events excluded
    expect(lines.find(l => l._sessionBranch === null)).toBeUndefined();
  });

  it('returns only structural lines when no events match the session', () => {
    const ndjson = makeNdjson([
      { _type: 'header', _version: 1, schema_version: '1.0.0' },
      { _type: 'dictionary', entries: [] },
      { type: 'lifecycle', _sessionBranch: SESSION_B },
      { _type: 'trigger', trigger_type: 'manual' },
    ]);
    const lines = filterSessionEvents(ndjson, SESSION_A)
      .trim().split('\n').filter(Boolean).map(l => JSON.parse(l));

    expect(lines).toHaveLength(3); // header, dict, trigger
    expect(lines.filter(l => !l._type)).toHaveLength(0); // no event lines
  });

  it('fail-CLOSED: empty ndjson returns only a trailing newline', () => {
    const result = filterSessionEvents('', SESSION_A);
    expect(result.trim()).toBe('');
  });

  it('excludes context lines regardless of session match', () => {
    const ndjson = makeNdjson([
      { _type: 'header', _version: 1, schema_version: '1.0.0' },
      { _type: 'context', _sessionBranch: SESSION_A, active_branches: 3 },
      { _type: 'trigger', trigger_type: 'manual' },
    ]);
    const lines = filterSessionEvents(ndjson, SESSION_A)
      .trim().split('\n').filter(Boolean).map(l => JSON.parse(l));

    expect(lines.find(l => l._type === 'context')).toBeUndefined();
    expect(lines).toHaveLength(2); // header + trigger only
  });

  it('excludes events with no _sessionBranch field (startup/global, exclude-by-default)', () => {
    const ndjson = makeNdjson([
      { _type: 'header', _version: 1, schema_version: '1.0.0' },
      { type: 'storage.mode', accountUrl: 'https://account.blob.core.windows.net' }, // no _sessionBranch
      { _type: 'trigger', trigger_type: 'manual' },
    ]);
    const lines = filterSessionEvents(ndjson, SESSION_A)
      .trim().split('\n').filter(Boolean).map(l => JSON.parse(l));

    expect(lines.find(l => l.type === 'storage.mode')).toBeUndefined();
  });
});
