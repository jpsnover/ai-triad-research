// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1908 — HighlightedTextarea's read-only render composes search-highlight (`mark`) and
// bold-keyword (`strong`) ranges, and now interleaves stored entity-mention `.ref-link`
// buttons when `mentionSegments` is supplied. These tests guard both the new mention path
// AND the unchanged no-mention path (a regression guard for every existing consumer).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MentionSegment } from './mentionText';

// HighlightedTextarea reads find state from the taxonomy store; RefLinkButton (pulled in
// via HighlightedField -> MentionField) transitively imports the bridge/debate-store/
// flight-recorder — mocked so the module graph resolves without real side effects.
const taxStore = vi.hoisted(() => ({ current: { findQuery: '', findMode: 'raw', findCaseSensitive: false } }));
vi.mock('../../hooks/useTaxonomyStore', () => ({ useTaxonomyStore: () => taxStore.current }));
vi.mock('../../hooks/useDebateStore', () => ({ useDebateStore: { getState: () => ({ setSelectedRef: vi.fn() }) } }));
vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => ({ record: vi.fn() }) }));
vi.mock('@bridge', () => ({ api: { getContainerMentions: vi.fn() } }));

import { HighlightedTextarea } from './HighlightedField';

const orgRef = { kind: 'organization', id: 'org-001' } as const;

beforeEach(() => {
  taxStore.current = { findQuery: '', findMode: 'raw', findCaseSensitive: false };
});

describe('HighlightedTextarea — read-only mention interleaving (t/1908)', () => {
  it('interleaves a .ref-link button with plain text and keeps bold keywords bold', () => {
    const onSelectRef = vi.fn();
    const segments: MentionSegment[] = [
      { text: 'OpenAI', ref: orgRef },
      { text: ' builds models.\nExcludes: hardware.' },
    ];
    const { container } = render(
      <HighlightedTextarea
        value={'OpenAI builds models.\nExcludes: hardware.'}
        readOnly
        mentionSegments={segments}
        onSelectRef={onSelectRef}
      />,
    );
    const btn = screen.getByRole('button', { name: 'Organization: OpenAI — open details' });
    expect(btn).toHaveClass('ref-link');
    // The bold keyword in the plain segment is still rendered <strong> (mention path preserves it).
    expect(container.querySelector('strong')?.textContent).toBe('Excludes:');
    // No search query -> no <mark>; full text is present.
    expect(container.querySelector('mark')).toBeNull();
    expect(container.textContent).toContain('OpenAI');
    expect(container.textContent).toContain('builds models.');
  });

  it('routes a mention click to onSelectRef with the segment ref', async () => {
    const onSelectRef = vi.fn();
    const user = userEvent.setup();
    render(
      <HighlightedTextarea
        value="OpenAI builds AI"
        readOnly
        mentionSegments={[{ text: 'OpenAI', ref: orgRef }, { text: ' builds AI' }]}
        onSelectRef={onSelectRef}
      />,
    );
    await user.click(screen.getByRole('button', { name: /OpenAI/ }));
    expect(onSelectRef).toHaveBeenCalledWith(orgRef);
  });

  it('applies search-highlight marks inside a plain segment (search still works with mentions)', () => {
    taxStore.current = { findQuery: 'builds', findMode: 'raw', findCaseSensitive: false };
    const { container } = render(
      <HighlightedTextarea
        value="OpenAI builds AI"
        readOnly
        mentionSegments={[{ text: 'OpenAI' , ref: orgRef }, { text: ' builds AI' }]}
        onSelectRef={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /OpenAI/ })).toBeInTheDocument();
    expect(container.querySelector('mark')?.textContent).toBe('builds');
  });
});

describe('HighlightedTextarea — unchanged paths (regression guard)', () => {
  it('read-only without mentions renders search-highlight marks and no buttons', () => {
    taxStore.current = { findQuery: 'builds', findMode: 'raw', findCaseSensitive: false };
    const { container } = render(<HighlightedTextarea value="OpenAI builds AI" readOnly />);
    expect(container.querySelector('mark')?.textContent).toBe('builds');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('edit mode ignores mentionSegments (renders a textarea, no ref-links)', () => {
    const { container } = render(
      <HighlightedTextarea
        value="OpenAI builds AI"
        onChange={() => {}}
        mentionSegments={[{ text: 'OpenAI', ref: orgRef }, { text: ' builds AI' }]}
        onSelectRef={vi.fn()}
      />,
    );
    expect(container.querySelector('textarea')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
