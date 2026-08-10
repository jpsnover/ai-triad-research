// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const openExternal = vi.fn().mockResolvedValue(undefined);
vi.mock('@bridge', () => ({ api: { openExternal: (url: string) => openExternal(url) } }));
vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => ({ record: vi.fn() }) }));

import { BookmarkLink } from './BookmarkLink';
import { buildDocUrl } from './TheoryLink';

const BASE = 'https://github.com/jpsnover/ai-triad-research/blob/main';

describe('buildDocUrl', () => {
  it('constructs a GitHub blob URL from a repo-relative path', () => {
    expect(buildDocUrl('docs/reading-the-argument-network.md')).toBe(
      `${BASE}/docs/reading-the-argument-network.md`,
    );
  });

  it('appends the anchor with a # when provided', () => {
    expect(buildDocUrl('docs/x.md', 'computed-strength-vs-base-strength')).toBe(
      `${BASE}/docs/x.md#computed-strength-vs-base-strength`,
    );
  });

  it('omits the anchor when not provided', () => {
    expect(buildDocUrl('docs/x.md')).not.toContain('#');
  });
});

describe('BookmarkLink', () => {
  beforeEach(() => { openExternal.mockClear(); });

  it('renders a link-role control with the label as aria-label and tooltip', () => {
    render(<BookmarkLink docPath="docs/x.md" label="Reading the argument network" />);
    const el = screen.getByRole('link', { name: 'Reading the argument network' });
    expect(el).toHaveAttribute('title', 'Reading the argument network');
  });

  it('defaults the label to "Learn more"', () => {
    render(<BookmarkLink docPath="docs/x.md" />);
    expect(screen.getByRole('link', { name: 'Learn more' })).toHaveAttribute('title', 'Learn more');
  });

  it('defaults to the sm size variant and applies xs/md when requested', () => {
    const { rerender } = render(<BookmarkLink docPath="docs/x.md" label="H" />);
    expect(screen.getByRole('link', { name: 'H' }).className).toContain('bookmark-link--sm');
    rerender(<BookmarkLink docPath="docs/x.md" label="H" size="xs" />);
    expect(screen.getByRole('link', { name: 'H' }).className).toContain('bookmark-link--xs');
    rerender(<BookmarkLink docPath="docs/x.md" label="H" size="md" />);
    expect(screen.getByRole('link', { name: 'H' }).className).toContain('bookmark-link--md');
  });

  it('appends className to the base classes (never replaces them)', () => {
    render(<BookmarkLink docPath="docs/x.md" label="H" className="inline-heading" />);
    const el = screen.getByRole('link', { name: 'H' });
    expect(el.className).toContain('bookmark-link');
    expect(el.className).toContain('inline-heading');
  });

  it('opens the constructed GitHub URL externally on click (via bridge, not window/shell)', async () => {
    const user = userEvent.setup();
    render(<BookmarkLink docPath="docs/reading-the-argument-network.md" anchor="strength" label="H" />);
    await user.click(screen.getByRole('link', { name: 'H' }));
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(
      `${BASE}/docs/reading-the-argument-network.md#strength`,
    );
  });
});
