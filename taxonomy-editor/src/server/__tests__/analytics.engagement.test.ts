// @vitest-environment node
// Unit tests for queryEngagement (t/2467)

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../runtimeConfig.js', () => ({
  getConfig: () => ({ analytics: { retentionDays: 90 } }),
}));

import * as analytics from '../community/analytics.js';
import type { AnalyticsEvent } from '../community/analytics.js';

// ── Helpers ──

function dwell(overrides: Partial<AnalyticsEvent> & { detail: Record<string, unknown> }): AnalyticsEvent {
  return {
    user: 'alice',
    session_id: 's1',
    timestamp: '2026-08-10T10:00:00Z',
    event_type: 'view.dwell',
    category: 'taxonomy',
    duration_ms: 0,
    ...overrides,
  };
}

function nodeEvent(subjectId: string, pov: string, cat: string, opts: {
  user?: string; engaged?: boolean; capped?: boolean; duration_ms?: number;
} = {}): AnalyticsEvent {
  return dwell({
    user: opts.user ?? 'alice',
    duration_ms: opts.duration_ms ?? 5000,
    detail: {
      subject_type: 'node',
      subject_id: subjectId,
      pov,
      cat,
      engaged: opts.engaged ?? true,
      capped: opts.capped ?? false,
    },
  });
}

function tabEvent(tabId: string, opts: {
  user?: string; engaged?: boolean; duration_ms?: number;
} = {}): AnalyticsEvent {
  return dwell({
    user: opts.user ?? 'alice',
    duration_ms: opts.duration_ms ?? 3000,
    detail: {
      subject_type: 'tab',
      subject_id: tabId,
      engaged: opts.engaged ?? true,
      capped: false,
    },
  });
}

// Inject events by replacing the backend with an in-memory store
async function withEvents(events: AnalyticsEvent[], fn: () => Promise<void>): Promise<void> {
  const lines = events.map(e => JSON.stringify(e));
  // Patch backend via initAnalytics with a fake fs backend
  // Simpler: directly call the internal by seeding via initAnalytics with a temp dir
  // Instead, we spy on the module-level backend via appendEvents + queryEngagement
  // using a temp in-memory backend injected through the exported init.
  const os = await import('os');
  const fs = await import('fs');
  const path = await import('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eng-test-'));
  try {
    await analytics.initAnalytics(dir);
    await analytics.appendEvents(events);
    await fn();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ── Tests ──

describe('queryEngagement — rollup math', () => {
  it('aggregates node events into camp/category/node hierarchy', async () => {
    await withEvents([
      nodeEvent('skp-bel-002', 'skp', 'bel', { duration_ms: 42000, engaged: true }),
      nodeEvent('skp-bel-005', 'skp', 'bel', { duration_ms: 3000, engaged: false }),
      nodeEvent('acc-des-001', 'acc', 'des', { duration_ms: 10000, engaged: true }),
    ], async () => {
      const result = await analytics.queryEngagement('2026-08-10', '2026-08-10');
      const agg = result.aggregate;

      // Tool-level totals
      expect(agg.tool.visits).toBe(3);
      expect(agg.tool.engagedVisits).toBe(2);
      expect(agg.tool.engagedMs).toBe(55000);

      // Camp: skp
      expect(agg.camps['skp'].visits).toBe(2);
      expect(agg.camps['skp'].engagedVisits).toBe(1);
      expect(agg.camps['skp'].engagedMs).toBe(45000);
      expect(agg.camps['skp'].uniqueUsers).toBe(1);

      // Category: skp-bel
      expect(agg.camps['skp'].categories['skp-bel'].visits).toBe(2);
      expect(agg.camps['skp'].categories['skp-bel'].nodes['skp-bel-002'].visits).toBe(1);
      expect(agg.camps['skp'].categories['skp-bel'].nodes['skp-bel-005'].engagedVisits).toBe(0);

      // Camp: acc
      expect(agg.camps['acc'].visits).toBe(1);
      expect(agg.camps['acc'].engagedMs).toBe(10000);
    });
  });

  it('rolls non-taxonomy tab events under tabs', async () => {
    await withEvents([
      tabEvent('debate', { duration_ms: 20000 }),
      tabEvent('situations', { duration_ms: 5000, engaged: false }),
    ], async () => {
      const agg = (await analytics.queryEngagement('2026-08-10', '2026-08-10')).aggregate;
      expect(agg.tabs['debate'].visits).toBe(1);
      expect(agg.tabs['debate'].engagedMs).toBe(20000);
      expect(agg.tabs['situations'].engagedVisits).toBe(0);
      expect(agg.tool.visits).toBe(2);
    });
  });

  it('computes cappedRate correctly', async () => {
    await withEvents([
      nodeEvent('acc-bel-001', 'acc', 'bel', { capped: true }),
      nodeEvent('acc-bel-002', 'acc', 'bel', { capped: false }),
      nodeEvent('acc-bel-003', 'acc', 'bel', { capped: true }),
    ], async () => {
      const agg = (await analytics.queryEngagement('2026-08-10', '2026-08-10')).aggregate;
      expect(agg.camps['acc'].cappedRate).toBeCloseTo(2 / 3, 4);
      expect(agg.tool.cappedRate).toBeCloseTo(2 / 3, 4);
    });
  });

  it('includes uniqueUsers on aggregate, omits on per-user tree', async () => {
    await withEvents([
      nodeEvent('saf-bel-001', 'saf', 'bel', { user: 'alice' }),
      nodeEvent('saf-bel-001', 'saf', 'bel', { user: 'bob' }),
    ], async () => {
      const result = await analytics.queryEngagement('2026-08-10', '2026-08-10', 'alice');
      expect(result.aggregate.tool.uniqueUsers).toBe(2);
      expect(result.user!.tool.uniqueUsers).toBeUndefined();
    });
  });

  it('returns only the requested user subtree', async () => {
    await withEvents([
      nodeEvent('skp-bel-001', 'skp', 'bel', { user: 'alice', duration_ms: 10000 }),
      nodeEvent('skp-bel-002', 'skp', 'bel', { user: 'bob', duration_ms: 5000 }),
    ], async () => {
      const result = await analytics.queryEngagement('2026-08-10', '2026-08-10', 'alice');
      // aggregate sees both
      expect(result.aggregate.tool.visits).toBe(2);
      // user subtree sees only alice
      expect(result.user!.tool.visits).toBe(1);
      expect(result.user!.tool.engagedMs).toBe(10000);
    });
  });

  it('returns no user subtree when user param is omitted', async () => {
    await withEvents([nodeEvent('skp-bel-001', 'skp', 'bel')], async () => {
      const result = await analytics.queryEngagement('2026-08-10', '2026-08-10');
      expect(result.user).toBeUndefined();
    });
  });

  it('ignores non-view.dwell events', async () => {
    await withEvents([
      { ...nodeEvent('skp-bel-001', 'skp', 'bel'), event_type: 'node.select' },
      nodeEvent('skp-bel-001', 'skp', 'bel'),
    ], async () => {
      const agg = (await analytics.queryEngagement('2026-08-10', '2026-08-10')).aggregate;
      expect(agg.tool.visits).toBe(1);
    });
  });

  it('skips events with unknown subject_type without crashing', async () => {
    await withEvents([
      dwell({ detail: { subject_type: 'unknown_future', subject_id: 'x' } }),
      nodeEvent('skp-bel-001', 'skp', 'bel'),
    ], async () => {
      const agg = (await analytics.queryEngagement('2026-08-10', '2026-08-10')).aggregate;
      expect(agg.tool.visits).toBe(1);
    });
  });

  it('places nodes with unknown pov into tabs["other"]', async () => {
    await withEvents([
      dwell({ detail: { subject_type: 'node', subject_id: 'xyz-foo-001', pov: 'xyz', cat: 'foo', engaged: false, capped: false } }),
    ], async () => {
      const agg = (await analytics.queryEngagement('2026-08-10', '2026-08-10')).aggregate;
      expect(agg.camps).toEqual({});
      expect(agg.tabs['other'].visits).toBe(1);
    });
  });

  it('returns empty tree when no view.dwell events exist', async () => {
    await withEvents([], async () => {
      const agg = (await analytics.queryEngagement('2026-08-10', '2026-08-10')).aggregate;
      expect(agg.tool.visits).toBe(0);
      expect(agg.camps).toEqual({});
      expect(agg.tabs).toEqual({});
    });
  });

  it('handles all four camps (acc/saf/skp/cc)', async () => {
    await withEvents([
      nodeEvent('acc-bel-001', 'acc', 'bel'),
      nodeEvent('saf-des-001', 'saf', 'des'),
      nodeEvent('skp-int-001', 'skp', 'int'),
      nodeEvent('cc-bel-001', 'cc', 'bel'),
    ], async () => {
      const agg = (await analytics.queryEngagement('2026-08-10', '2026-08-10')).aggregate;
      expect(Object.keys(agg.camps).sort()).toEqual(['acc', 'cc', 'saf', 'skp']);
    });
  });
});
