// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Mock-driven tests for useAnalytics (t/2560) — one per new surface from spec §7:
// session scope (§7.1), sessions list riding the response (§7.2), subject WHO
// breakdown (§7.3), plus loading/empty/error and the stale-response guard.
//
// Fixtures use the REAL server wire shapes (t/2559/t/2562), NOT the hook's public
// contract — live-verify (t/2560#6) found the wire diverges (sessions field
// `session`≠`id`; subject `{rows:[{user|session,…}]}`≠bare `[{key,…}]`), and the
// original mocks were blind to it because they asserted the hook's own contract.
// The hook now adapts wire→contract at the boundary; these tests pin that mapping.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useAnalytics } from './useAnalytics';
import type { EngagementResult, SubjectBreakdownRow, SessionRow, DateRange } from './useAnalytics';

vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: vi.fn() }),
}));

vi.mock('../bridge/web-bridge', () => ({ bridgeGet: vi.fn() }));

import { bridgeGet } from '../bridge/web-bridge';
const mockGet = vi.mocked(bridgeGet);

const RANGE: DateRange = { from: '2026-08-06', to: '2026-08-13' };

function leaf(visits: number, engagedMs = 1000): import('../components/analysis/engagementTree').TreeNode {
  return { id: 'root', visits, engagedVisits: visits, engagedMs };
}

// Public contract shape (id) — what the hook must EXPOSE to consumers.
const SESSIONS: SessionRow[] = [
  { id: 's1', startTime: '2026-08-13T09:00:00.000Z', engagedMs: 4000, nodeCount: 3 },
  { id: 's2', startTime: '2026-08-13T10:00:00.000Z', engagedMs: 1500, nodeCount: 1 },
];

// Real server wire shape (t/2559): rows carry `session`, not `id` (t/2560#6). The
// hook adapts these into SESSIONS above; a mock returning SESSIONS would be blind
// to the drift (the original bug), so fixtures must be the wire shape.
const WIRE_SESSIONS = [
  { session: 's1', startTime: '2026-08-13T09:00:00.000Z', engagedMs: 4000, nodeCount: 3 },
  { session: 's2', startTime: '2026-08-13T10:00:00.000Z', engagedMs: 1500, nodeCount: 1 },
];

afterEach(() => { vi.restoreAllMocks(); mockGet.mockReset(); });

describe('useAnalytics — engagement scope (§7.1)', () => {
  it('fetches the whole-population aggregate for scope "all" and reports non-empty', async () => {
    const result: EngagementResult = { aggregate: leaf(42), daily: [] };
    mockGet.mockResolvedValue(result);

    const { result: hook } = renderHook(() => useAnalytics({ range: RANGE }));
    await waitFor(() => expect(hook.current.engagement.loading).toBe(false));

    expect(mockGet).toHaveBeenCalledWith('/api/analytics/engagement?from=2026-08-06&to=2026-08-13');
    expect(hook.current.engagement.data).toEqual(result);
    expect(hook.current.engagement.isEmpty).toBe(false);
  });

  it('threads &user= for user scope', async () => {
    mockGet.mockResolvedValue({ aggregate: leaf(5), daily: [] });
    const { result: hook } = renderHook(() => useAnalytics({ range: RANGE, scope: { kind: 'user', user: 'alice@x.com' } }));
    await waitFor(() => expect(hook.current.engagement.loading).toBe(false));
    expect(mockGet).toHaveBeenCalledWith('/api/analytics/engagement?from=2026-08-06&to=2026-08-13&user=alice%40x.com');
  });

  it('threads &session= for session scope and returns the recomputed aggregate', async () => {
    const scoped: EngagementResult = { aggregate: leaf(9, 7777), daily: [] };
    mockGet.mockResolvedValue(scoped);
    const { result: hook } = renderHook(() => useAnalytics({ range: RANGE, scope: { kind: 'session', session: 's1' } }));
    await waitFor(() => expect(hook.current.engagement.loading).toBe(false));
    expect(mockGet).toHaveBeenCalledWith('/api/analytics/engagement?from=2026-08-06&to=2026-08-13&session=s1');
    expect(hook.current.engagement.data?.aggregate.engagedMs).toBe(7777);
  });

  it('reports isEmpty when the aggregate has zero visits', async () => {
    mockGet.mockResolvedValue({ aggregate: leaf(0), daily: [] });
    const { result: hook } = renderHook(() => useAnalytics({ range: RANGE }));
    await waitFor(() => expect(hook.current.engagement.loading).toBe(false));
    expect(hook.current.engagement.isEmpty).toBe(true);
  });

  it('surfaces an error and leaves data null', async () => {
    mockGet.mockRejectedValue(new Error('boom'));
    const { result: hook } = renderHook(() => useAnalytics({ range: RANGE }));
    await waitFor(() => expect(hook.current.engagement.loading).toBe(false));
    expect(hook.current.engagement.error).toContain('boom');
    expect(hook.current.engagement.data).toBeNull();
  });
});

describe('useAnalytics — sessions list (§7.2)', () => {
  it('exposes sessions riding the user-scope response, with no second round-trip', async () => {
    mockGet.mockResolvedValue({ aggregate: leaf(5), daily: [], sessions: WIRE_SESSIONS });
    const { result: hook } = renderHook(() => useAnalytics({ range: RANGE, scope: { kind: 'user', user: 'alice' } }));
    await waitFor(() => expect(hook.current.engagement.loading).toBe(false));

    expect(mockGet).toHaveBeenCalledTimes(1); // no separate sessions fetch
    // Wire `session` is adapted to the contract `id` before exposure.
    expect(hook.current.sessions.data).toEqual(SESSIONS);
    expect(hook.current.sessions.isEmpty).toBe(false);
  });

  it('is empty under non-user scope even if the payload carried sessions', async () => {
    mockGet.mockResolvedValue({ aggregate: leaf(5), daily: [], sessions: WIRE_SESSIONS });
    const { result: hook } = renderHook(() => useAnalytics({ range: RANGE, scope: { kind: 'all' } }));
    await waitFor(() => expect(hook.current.engagement.loading).toBe(false));
    expect(hook.current.sessions.isEmpty).toBe(true);
  });
});

describe('useAnalytics — subject WHO breakdown (§7.3)', () => {
  it('fetches ?subject=&groupBy=user on demand', async () => {
    mockGet.mockResolvedValueOnce({ aggregate: leaf(5), daily: [] }); // initial engagement
    // Wire: {rows:[{user,…}]} envelope (groupBy=user). Hook unwraps + maps user→key.
    const wire = { rows: [
      { user: 'alice', engagedMs: 3000, visits: 4 },
      { user: 'bob', engagedMs: 1000, visits: 1 },
    ] };
    const expected: SubjectBreakdownRow[] = [
      { key: 'alice', engagedMs: 3000, visits: 4 },
      { key: 'bob', engagedMs: 1000, visits: 1 },
    ];
    const { result: hook } = renderHook(() => useAnalytics({ range: RANGE }));
    await waitFor(() => expect(hook.current.engagement.loading).toBe(false));

    mockGet.mockResolvedValueOnce(wire);
    act(() => { hook.current.loadSubjectBreakdown('src-l02', 'user'); });
    await waitFor(() => expect(hook.current.subject.loading).toBe(false));

    expect(mockGet).toHaveBeenLastCalledWith('/api/analytics/engagement?subject=src-l02&groupBy=user');
    expect(hook.current.subject.data).toEqual(expected);
    expect(hook.current.subject.isEmpty).toBe(false);
  });

  it('reports isEmpty for a subject with no rows, and groupBy=session in the query', async () => {
    mockGet.mockResolvedValueOnce({ aggregate: leaf(5), daily: [] });
    const { result: hook } = renderHook(() => useAnalytics({ range: RANGE }));
    await waitFor(() => expect(hook.current.engagement.loading).toBe(false));

    mockGet.mockResolvedValueOnce({ rows: [] });
    act(() => { hook.current.loadSubjectBreakdown('sit-01b', 'session'); });
    await waitFor(() => expect(hook.current.subject.loading).toBe(false));

    expect(mockGet).toHaveBeenLastCalledWith('/api/analytics/engagement?subject=sit-01b&groupBy=session');
    expect(hook.current.subject.isEmpty).toBe(true);
  });

  // Contract v2 (t/2560#2, t/2562#2): under user scope the WHO query threads &user=
  // so the user-scoped leaf panel gets by-session rows for that user only.
  it('threads &user= when the active scope is a user (v2)', async () => {
    mockGet.mockResolvedValueOnce({ aggregate: leaf(5), daily: [] });
    const { result: hook } = renderHook(() => useAnalytics({ range: RANGE, scope: { kind: 'user', user: 'alice@x.com' } }));
    await waitFor(() => expect(hook.current.engagement.loading).toBe(false));

    mockGet.mockResolvedValueOnce({ rows: [{ session: 's1', engagedMs: 500, visits: 2 }] });
    act(() => { hook.current.loadSubjectBreakdown('src-l02', 'session'); });
    await waitFor(() => expect(hook.current.subject.loading).toBe(false));

    expect(mockGet).toHaveBeenLastCalledWith('/api/analytics/engagement?subject=src-l02&groupBy=session&user=alice%40x.com');
  });

  it('omits &user= under non-user scope (all / session)', async () => {
    mockGet.mockResolvedValueOnce({ aggregate: leaf(5), daily: [] });
    const { result: hook } = renderHook(() => useAnalytics({ range: RANGE, scope: { kind: 'session', session: 's9' } }));
    await waitFor(() => expect(hook.current.engagement.loading).toBe(false));

    mockGet.mockResolvedValueOnce({ rows: [] });
    act(() => { hook.current.loadSubjectBreakdown('src-l02', 'user'); });
    await waitFor(() => expect(hook.current.subject.loading).toBe(false));

    expect(mockGet).toHaveBeenLastCalledWith('/api/analytics/engagement?subject=src-l02&groupBy=user');
  });
});

// TL must-add (t/2560#7): pin the REAL server wire shape → hook public contract, so
// the mock-blindness that hid the t/2560#6 drift cannot recur. Field-level assertions.
describe('useAnalytics — server wire shape → frozen contract (regression, t/2560#6/#7)', () => {
  it('maps the sessions wire field `session` → contract `id` (never undefined)', async () => {
    mockGet.mockResolvedValue({ aggregate: leaf(3), daily: [], sessions: WIRE_SESSIONS });
    const { result: hook } = renderHook(() => useAnalytics({ range: RANGE, scope: { kind: 'user', user: 'alice' } }));
    await waitFor(() => expect(hook.current.engagement.loading).toBe(false));
    // The wire carries no `id`; the adapter must supply it from `session`.
    expect(hook.current.sessions.data?.[0]).toEqual({ id: 's1', startTime: '2026-08-13T09:00:00.000Z', engagedMs: 4000, nodeCount: 3 });
    expect(hook.current.sessions.data?.every(s => typeof s.id === 'string')).toBe(true);
  });

  it('unwraps the subject `{rows}` envelope and maps `user`/`session` → `key`', async () => {
    mockGet.mockResolvedValueOnce({ aggregate: leaf(3), daily: [] });
    const { result: hook } = renderHook(() => useAnalytics({ range: RANGE }));
    await waitFor(() => expect(hook.current.engagement.loading).toBe(false));

    mockGet.mockResolvedValueOnce({ rows: [{ session: 'sess-9', engagedMs: 800, visits: 3 }] });
    act(() => { hook.current.loadSubjectBreakdown('src-l02', 'session'); });
    await waitFor(() => expect(hook.current.subject.loading).toBe(false));

    // `data` must be a bare array (not the {rows} object), `key` populated from `session`.
    expect(Array.isArray(hook.current.subject.data)).toBe(true);
    expect(hook.current.subject.data?.[0]).toEqual({ key: 'sess-9', engagedMs: 800, visits: 3 });
  });
});

describe('useAnalytics — refetch + stale-response guard', () => {
  it('re-runs the engagement fetch on refetch()', async () => {
    mockGet.mockResolvedValue({ aggregate: leaf(1), daily: [] });
    const { result: hook } = renderHook(() => useAnalytics({ range: RANGE }));
    await waitFor(() => expect(hook.current.engagement.loading).toBe(false));
    expect(mockGet).toHaveBeenCalledTimes(1);

    act(() => { hook.current.refetch(); });
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
  });

  it('applies only the latest scope response when scope changes mid-flight', async () => {
    // First (user=alice) resolves slowly; the rerender to session=s1 resolves first.
    let resolveAlice!: (v: EngagementResult) => void;
    mockGet.mockImplementationOnce(() => new Promise<EngagementResult>(r => { resolveAlice = r; }));
    mockGet.mockResolvedValueOnce({ aggregate: leaf(2, 222), daily: [] }); // session=s1

    const { result: hook, rerender } = renderHook(
      (props: { scope: import('./useAnalytics').AnalyticsScope }) => useAnalytics({ range: RANGE, scope: props.scope }),
      { initialProps: { scope: { kind: 'user', user: 'alice' } as import('./useAnalytics').AnalyticsScope } },
    );

    rerender({ scope: { kind: 'session', session: 's1' } });
    await waitFor(() => expect(hook.current.engagement.data?.aggregate.engagedMs).toBe(222));

    // The late alice response must be ignored (stale request id).
    act(() => { resolveAlice({ aggregate: leaf(999, 999), daily: [] }); });
    await Promise.resolve();
    expect(hook.current.engagement.data?.aggregate.engagedMs).toBe(222);
  });
});
