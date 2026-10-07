// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { applyServedTurn, latchUnobservedHistory, type FailoverTrackingState } from './failoverTracking';

// t/4044 (SO e/281#2)
const fresh = (): FailoverTrackingState => ({ failover_tracking: 'unavailable', transcript: [] });
const turn = (s: FailoverTrackingState, served: string | undefined, requested = 'gemini-x') =>
  applyServedTurn(s, 'skeptic', requested, served);

describe('applyServedTurn (t/4044)', () => {
  it('every turn carries servedModel equal to the request: tracked', () => {
    let s = turn(fresh(), 'gemini-x');
    s = turn(s, 'gemini-x');
    expect(s.failover_tracking).toBe('tracked');
    expect(s.failover_untracked).toBeUndefined();
    expect(s.speaker_model_failovers).toBeUndefined();
  });

  it('one turn without servedModel: unavailable, and it stays so when later turns carry it (sticky)', () => {
    let s = turn(fresh(), 'gemini-x');
    expect(s.failover_tracking).toBe('tracked');
    s = turn(s, undefined);
    expect(s).toMatchObject({ failover_tracking: 'unavailable', failover_untracked: true });
    s = turn(turn(s, 'gemini-x'), 'gemini-x');
    expect(s).toMatchObject({ failover_tracking: 'unavailable', failover_untracked: true });
  });

  it('served differs from requested: the failover is recorded for that speaker, the engine way', () => {
    const s = turn(fresh(), 'claude-y', 'gemini-x');
    expect(s.speaker_model_failovers).toEqual({ skeptic: 'claude-y' });
    // Still observed, so tracked; the gate excludes the row because it carries a failover.
    expect(s.failover_tracking).toBe('tracked');
  });

  it('zero turns: the creation stamp stands', () => {
    expect(fresh().failover_tracking).toBe('unavailable');
  });

  it('returns the same object when nothing changes, so the store can skip a write', () => {
    const s = turn(fresh(), 'gemini-x');
    expect(turn(s, 'gemini-x')).toBe(s);
    const u = turn(fresh(), undefined);
    expect(turn(u, undefined)).toBe(u);
  });
});

describe('latchUnobservedHistory (SO e/281#2 condition 1)', () => {
  const legacy = (): FailoverTrackingState => ({
    failover_tracking: 'unavailable',
    transcript: [{ speaker: 'accelerationist' }, { speaker: 'skeptic' }],
  });

  it('a pre-change session with speaker turns, unavailable and no latch, gets the latch and is never promoted', () => {
    let s = latchUnobservedHistory(legacy());
    expect(s).toMatchObject({ failover_untracked: true, failover_tracking: 'unavailable' });
    s = turn(turn(s, 'gemini-x'), 'gemini-x');
    expect(s.failover_tracking).toBe('unavailable');
  });

  it('leaves alone: tracked sessions, latched sessions, and sessions with no speaker turn yet', () => {
    const tracked = { ...legacy(), failover_tracking: 'tracked' as const };
    expect(latchUnobservedHistory(tracked)).toBe(tracked);
    const latched = { ...legacy(), failover_untracked: true };
    expect(latchUnobservedHistory(latched)).toBe(latched);
    const userOnly: FailoverTrackingState = { failover_tracking: 'unavailable', transcript: [{ speaker: 'user' }, { speaker: 'moderator' }] };
    expect(latchUnobservedHistory(userOnly)).toBe(userOnly);
  });
});
