// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const openExternal = vi.fn().mockResolvedValue(undefined);
vi.mock('@bridge', () => ({ api: { openExternal: (url: string) => openExternal(url) } }));
vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => ({ record: vi.fn() }) }));

import { TheoryLink } from './TheoryLink';

const URL = 'https://github.com/org/repo/blob/main/docs/theory.md';

describe('TheoryLink', () => {
  beforeEach(() => { openExternal.mockClear(); });

  it('renders a button with the distinct aria-label and default tooltip', () => {
    render(<TheoryLink url={URL} label="Help: debate overview" />);
    const btn = screen.getByRole('button', { name: 'Help: debate overview' });
    expect(btn).toHaveAttribute('title', 'Open theory notes on GitHub');
    expect(btn).toHaveAttribute('data-theory-link');
  });

  it('appends className to the base class (never replaces it)', () => {
    render(<TheoryLink url={URL} label="Help" className="inline-heading" />);
    const btn = screen.getByRole('button', { name: 'Help' });
    expect(btn.className).toContain('theory-link');
    expect(btn.className).toContain('inline-heading');
  });

  it('clamps size to 14–16px', () => {
    const { rerender } = render(<TheoryLink url={URL} label="H" size={40} />);
    expect(screen.getByRole('button').style.fontSize).toBe('16px');
    rerender(<TheoryLink url={URL} label="H" size={2} />);
    expect(screen.getByRole('button').style.fontSize).toBe('14px');
    rerender(<TheoryLink url={URL} label="H" size={15} />);
    expect(screen.getByRole('button').style.fontSize).toBe('15px');
  });

  it('opens the url externally on click (via bridge, not window/shell)', async () => {
    const user = userEvent.setup();
    render(<TheoryLink url={URL} label="Help" />);
    await user.click(screen.getByRole('button', { name: 'Help' }));
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(URL);
  });

  it('activates on Enter and Space (native button keyboard)', async () => {
    const user = userEvent.setup();
    render(<TheoryLink url={URL} label="Help" />);
    const btn = screen.getByRole('button', { name: 'Help' });
    btn.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(openExternal).toHaveBeenCalledTimes(2);
    expect(openExternal).toHaveBeenCalledWith(URL);
  });

  it('uses a custom tooltip when provided', () => {
    render(<TheoryLink url={URL} label="Help" tooltip="Read the spec" />);
    expect(screen.getByRole('button', { name: 'Help' })).toHaveAttribute('title', 'Read the spec');
  });
});
