// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { LoadingProgress, formatElapsed } from './LoadingProgress';

describe('formatElapsed (t/2498) — M:SS, minutes not zero-padded (t/2214)', () => {
  it.each([
    [0, '0:00'],
    [5_000, '0:05'],
    [65_000, '1:05'],
    [83_000, '1:23'],
    [725_000, '12:05'],
  ])('%ims → %s', (ms, expected) => {
    expect(formatElapsed(ms)).toBe(expected);
  });

  it('never produces a leading-zero minute or a negative time', () => {
    expect(formatElapsed(-1000)).toBe('0:00');
    expect(formatElapsed(600_000)).toBe('10:00');
  });
});

describe('LoadingProgress (t/2498)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

  it('renders the bar + ticking elapsed timer (delayMs=0)', () => {
    render(<LoadingProgress label="Loading debate…" delayMs={0} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-busy', 'true');
    expect(bar).toHaveAttribute('aria-label', 'Loading debate…');
    expect(screen.getByText('0:00')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(2_000); });
    expect(screen.getByText('0:02')).toBeInTheDocument();
  });

  it('delayMs suppresses render for fast loads', () => {
    const { container } = render(<LoadingProgress delayMs={300} />);
    // Before the delay elapses, nothing renders (anti-flash).
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();

    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('elapsed is measured from startedAt, not from first paint (delay does not distort it)', () => {
    const now = Date.now();
    // Load started 5s ago; the bar appears after a 300ms delay but must read ~0:05, not 0:00.
    render(<LoadingProgress startedAt={now - 5_000} delayMs={300} />);
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByText('0:05')).toBeInTheDocument();
  });

  it('clears the interval on unmount (no timer leak)', () => {
    const { unmount } = render(<LoadingProgress delayMs={0} />);
    expect(vi.getTimerCount()).toBeGreaterThan(0); // the 1s tick interval is armed
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a11y: indeterminate (no aria-valuenow), non-chattering counter', () => {
    render(<LoadingProgress label="Loading…" delayMs={0} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(screen.getByText('0:00')).toHaveAttribute('aria-live', 'off');
  });

  it('omitting label falls back to aria-label "Loading"; showElapsed=false hides the counter', () => {
    render(<LoadingProgress delayMs={0} showElapsed={false} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-label', 'Loading');
    expect(screen.queryByText(/\d:\d\d/)).toBeNull();
  });
});
