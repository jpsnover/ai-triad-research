import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type http from 'http';
import { runWithUser } from '../userContext';
import {
  registerReviewHandler,
  getReviewHandler,
  listReviewHandlers,
  clearReviewHandlers,
  requireAdmin,
  getReviewQueue,
  getReviewStats,
  executeReviewAction,
} from '../admin/reviewRegistry';
import type { ReviewAction, ReviewDomainHandler, ReviewItem } from '../admin/types';

// ── Test helpers ──

function makeItem(over: Partial<ReviewItem> & { id: string; domain: string }): ReviewItem {
  return {
    submitter: 'u1',
    submitterDisplay: 'User One',
    submittedAt: '2026-06-01T00:00:00.000Z',
    summary: '1 item',
    itemCount: 1,
    status: 'pending',
    ...over,
  };
}

/** Minimal handler whose behavior is driven by the provided callbacks. */
function makeHandler(domain: string, opts: {
  items?: ReviewItem[];
  throwOnPending?: boolean;
  onAction?: (a: ReviewAction) => void;
} = {}): ReviewDomainHandler {
  return {
    domain,
    async getPendingItems(userId?: string) {
      if (opts.throwOnPending) throw new Error(`boom:${domain}`);
      const items = opts.items ?? [];
      return userId ? items.filter(i => i.submitter === userId) : items;
    },
    async getDetailForViewer(groupId: string) {
      return { domain, groupId };
    },
    async executeAction(action: ReviewAction) {
      opts.onAction?.(action);
    },
  };
}

/** Capture a 403 (or any) response from requireAdmin without a real socket. */
function mockRes(): { res: http.ServerResponse; status?: number; body?: string } {
  const captured: { res: http.ServerResponse; status?: number; body?: string } = {
    res: undefined as unknown as http.ServerResponse,
  };
  captured.res = {
    writeHead(status: number) { captured.status = status; return captured.res; },
    end(chunk?: string) { captured.body = chunk; return captured.res; },
  } as unknown as http.ServerResponse;
  return captured;
}

const ADMIN_ID = 'test-admin';
function asAdmin<T>(fn: () => T): T {
  return runWithUser(
    { principalName: ADMIN_ID, idp: 'github', storageUserId: ADMIN_ID, isAnonymous: false },
    fn,
  );
}

describe('admin review registry', () => {
  let prevAdminUsers: string | undefined;

  beforeEach(() => {
    clearReviewHandlers();
    prevAdminUsers = process.env.ADMIN_USERS;
    process.env.ADMIN_USERS = ADMIN_ID;
  });

  afterEach(() => {
    clearReviewHandlers();
    if (prevAdminUsers === undefined) delete process.env.ADMIN_USERS;
    else process.env.ADMIN_USERS = prevAdminUsers;
  });

  // AC#2 — registry register/lookup by domain
  it('registers and looks up handlers by domain', () => {
    const cal = makeHandler('calibration');
    registerReviewHandler(cal);
    expect(getReviewHandler('calibration')).toBe(cal);
    expect(getReviewHandler('nope')).toBeUndefined();
    expect(listReviewHandlers()).toHaveLength(1);
  });

  it('replaces a handler when the same domain registers again', () => {
    registerReviewHandler(makeHandler('calibration'));
    const replacement = makeHandler('calibration');
    registerReviewHandler(replacement);
    expect(getReviewHandler('calibration')).toBe(replacement);
    expect(listReviewHandlers()).toHaveLength(1);
  });

  // AC#4 — empty queue when no handlers registered
  it('returns an empty queue and zero stats when no handlers are registered', async () => {
    expect(await getReviewQueue()).toEqual([]);
    expect(await getReviewStats()).toEqual({ total: 0, byDomain: {} });
  });

  // AC#4 — queue aggregates across handlers, newest first
  it('aggregates pending items across handlers, sorted newest first', async () => {
    registerReviewHandler(makeHandler('calibration', {
      items: [makeItem({ id: 'calibration:u1', domain: 'calibration', submittedAt: '2026-06-01T00:00:00.000Z' })],
    }));
    registerReviewHandler(makeHandler('community', {
      items: [makeItem({ id: 'community:u2', domain: 'community', submittedAt: '2026-06-10T00:00:00.000Z' })],
    }));
    const queue = await getReviewQueue();
    expect(queue.map(i => i.id)).toEqual(['community:u2', 'calibration:u1']);
  });

  it('skips a handler that throws and still returns the others', async () => {
    registerReviewHandler(makeHandler('calibration', { throwOnPending: true }));
    registerReviewHandler(makeHandler('community', {
      items: [makeItem({ id: 'community:u2', domain: 'community' })],
    }));
    const queue = await getReviewQueue();
    expect(queue.map(i => i.id)).toEqual(['community:u2']);
  });

  it('passes the submitter filter through to handlers', async () => {
    registerReviewHandler(makeHandler('calibration', {
      items: [
        makeItem({ id: 'a', domain: 'calibration', submitter: 'u1' }),
        makeItem({ id: 'b', domain: 'calibration', submitter: 'u2' }),
      ],
    }));
    const queue = await getReviewQueue('u2');
    expect(queue.map(i => i.id)).toEqual(['b']);
  });

  // AC#4 — stats per domain + total
  it('computes per-domain badge counts and total', async () => {
    registerReviewHandler(makeHandler('calibration', {
      items: [
        makeItem({ id: 'a', domain: 'calibration' }),
        makeItem({ id: 'b', domain: 'calibration' }),
      ],
    }));
    registerReviewHandler(makeHandler('community', {
      items: [makeItem({ id: 'c', domain: 'community' })],
    }));
    expect(await getReviewStats()).toEqual({ total: 3, byDomain: { calibration: 2, community: 1 } });
  });

  it('reports zero for a domain whose handler throws, without failing stats', async () => {
    registerReviewHandler(makeHandler('calibration', { throwOnPending: true }));
    registerReviewHandler(makeHandler('community', {
      items: [makeItem({ id: 'c', domain: 'community' })],
    }));
    expect(await getReviewStats()).toEqual({ total: 1, byDomain: { calibration: 0, community: 1 } });
  });

  // AC#4 — action routing by domain
  it('routes an action to the owning domain handler', async () => {
    let calReceived: ReviewAction | undefined;
    let comReceived: ReviewAction | undefined;
    registerReviewHandler(makeHandler('calibration', { onAction: a => { calReceived = a; } }));
    registerReviewHandler(makeHandler('community', { onAction: a => { comReceived = a; } }));

    const action: ReviewAction = { domain: 'community', action: 'promote', itemIds: ['x'] };
    await executeReviewAction(action);
    expect(comReceived).toEqual(action);
    expect(calReceived).toBeUndefined();
  });

  it('throws an actionable error when routing to an unregistered domain', async () => {
    await expect(executeReviewAction({ domain: 'ghost', action: 'promote', itemIds: ['x'] }))
      .rejects.toThrow(/ghost/);
  });

  // AC#3 — admin middleware
  it('rejects non-admin callers with 403', () => {
    const m = mockRes();
    const allowed = requireAdmin(m.res); // no user context → '_local' → not admin
    expect(allowed).toBe(false);
    expect(m.status).toBe(403);
    expect(JSON.parse(m.body!)).toEqual({ error: 'Forbidden' });
  });

  it('allows admin callers without writing a response', () => {
    asAdmin(() => {
      const m = mockRes();
      const allowed = requireAdmin(m.res);
      expect(allowed).toBe(true);
      expect(m.status).toBeUndefined();
      expect(m.body).toBeUndefined();
    });
  });
});
