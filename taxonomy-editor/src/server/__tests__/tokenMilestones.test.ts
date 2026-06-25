// @vitest-environment node

/**
 * t/967 — daily token-budget milestone logging (50/80/95%), once per threshold
 * per user per day, so consumption rate is visible before the hard limit.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { recordTokenUsage, getUsage } from '../security/rateLimiter.js';
import { log } from '../logger.js';

let n = 0;
const uniqueUser = () => `ms-user-${++n}`;

afterEach(() => { vi.restoreAllMocks(); });

describe('token milestone logging (t/967)', () => {
  it('warns once at 50/80/95% as cumulative usage crosses each threshold', () => {
    const warn = vi.spyOn(log.server, 'warn').mockImplementation(() => { /* swallow */ });
    const user = uniqueUser();
    const limit = 1000;
    recordTokenUsage(user, 400, 0, limit); // 40% — no milestone
    recordTokenUsage(user, 150, 0, limit); // 55% — crosses 50%
    recordTokenUsage(user, 300, 0, limit); // 85% — crosses 80%
    recordTokenUsage(user, 120, 0, limit); // 97% — crosses 95%
    recordTokenUsage(user, 10, 0, limit);  // 98% — already past every threshold, no new log

    const milestones = warn.mock.calls
      .map(c => (c[0] as { type?: string; milestone?: string }))
      .filter(o => o?.type === 'token_milestone')
      .map(o => o.milestone);
    expect(milestones).toEqual(['50%', '80%', '95%']);
    expect(getUsage(user).tokensToday).toBe(980);
  });

  it('does not log milestones when no limit is supplied (backward-compatible)', () => {
    const warn = vi.spyOn(log.server, 'warn').mockImplementation(() => { /* swallow */ });
    const user = uniqueUser();
    recordTokenUsage(user, 999, 0); // no limit arg
    expect(warn.mock.calls.some(c => (c[0] as { type?: string })?.type === 'token_milestone')).toBe(false);
    expect(getUsage(user).tokensToday).toBe(999);
  });

  it('jumping straight past every threshold in one call logs all three', () => {
    const warn = vi.spyOn(log.server, 'warn').mockImplementation(() => { /* swallow */ });
    const user = uniqueUser();
    recordTokenUsage(user, 999, 0, 1000); // 99.9% in one shot
    const milestones = warn.mock.calls
      .map(c => (c[0] as { type?: string; milestone?: string }))
      .filter(o => o?.type === 'token_milestone')
      .map(o => o.milestone);
    expect(milestones).toEqual(['50%', '80%', '95%']);
  });
});
