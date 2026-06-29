// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, beforeEach } from 'vitest';
import { useQuotaWarning, onQuotaMilestone } from './useQuotaWarning';

describe('useQuotaWarning', () => {
  beforeEach(() => {
    useQuotaWarning.setState({ warning: null });
  });

  it('starts with no warning', () => {
    expect(useQuotaWarning.getState().warning).toBeNull();
  });

  it('sets info-level warning at 50% milestone', () => {
    onQuotaMilestone(50);
    const w = useQuotaWarning.getState().warning;
    expect(w).not.toBeNull();
    expect(w!.milestone).toBe(50);
    expect(w!.level).toBe('info');
    expect(w!.message).toContain('50%');
    expect(w!.dismissedAt).toBeNull();
  });

  it('sets warning-level at 80% milestone', () => {
    onQuotaMilestone(80);
    const w = useQuotaWarning.getState().warning;
    expect(w!.level).toBe('warning');
    expect(w!.message).toContain('80%');
  });

  it('sets warning-level at 95% milestone', () => {
    onQuotaMilestone(95);
    const w = useQuotaWarning.getState().warning;
    expect(w!.level).toBe('warning');
    expect(w!.message).toContain('almost exhausted');
  });

  it('sets error-level at 100% (quota reached)', () => {
    onQuotaMilestone(100);
    const w = useQuotaWarning.getState().warning;
    expect(w!.level).toBe('error');
    expect(w!.message).toContain('quota reached');
  });

  it('includes reset time when provided', () => {
    onQuotaMilestone(100, '2026-06-30T00:00:00.000Z');
    const w = useQuotaWarning.getState().warning;
    expect(w!.message).toContain('Resets at');
  });

  it('escalates from lower to higher milestone', () => {
    onQuotaMilestone(50);
    expect(useQuotaWarning.getState().warning!.milestone).toBe(50);
    onQuotaMilestone(80);
    expect(useQuotaWarning.getState().warning!.milestone).toBe(80);
    expect(useQuotaWarning.getState().warning!.level).toBe('warning');
  });

  it('does not downgrade from higher to lower milestone', () => {
    onQuotaMilestone(95);
    onQuotaMilestone(50);
    expect(useQuotaWarning.getState().warning!.milestone).toBe(95);
  });

  it('dismiss sets dismissedAt timestamp', () => {
    onQuotaMilestone(80);
    expect(useQuotaWarning.getState().warning!.dismissedAt).toBeNull();
    useQuotaWarning.getState().dismiss();
    expect(useQuotaWarning.getState().warning!.dismissedAt).toBeGreaterThan(0);
  });

  it('escalation clears a previous dismissal', () => {
    onQuotaMilestone(50);
    useQuotaWarning.getState().dismiss();
    expect(useQuotaWarning.getState().warning!.dismissedAt).not.toBeNull();
    onQuotaMilestone(80);
    expect(useQuotaWarning.getState().warning!.dismissedAt).toBeNull();
  });

  it('dismissed warning is not re-shown at the same milestone', () => {
    onQuotaMilestone(80);
    useQuotaWarning.getState().dismiss();
    onQuotaMilestone(80);
    expect(useQuotaWarning.getState().warning!.dismissedAt).not.toBeNull();
  });

  it('dismiss with no warning is a no-op', () => {
    useQuotaWarning.getState().dismiss();
    expect(useQuotaWarning.getState().warning).toBeNull();
  });
});
