// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Coverage for the Search-panel inline clear (✕) button (t/2929). Tests the presentational
// TaxonomyInputArea directly — the clear must route through setFindQuery (the same setter that
// drives wildcard + POV/BDI + results), so clearing == deleting the text (the no-regression AC).

import { describe, it, expect, vi } from 'vitest';
import { createRef } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { TaxonomyInputArea } from './SearchPanel';

// styles.css is not loaded in jsdom; the co-located SearchPanel.css import is a no-op here.
type Props = Parameters<typeof TaxonomyInputArea>[0];

function makeProps(overrides: Partial<Props> = {}): Props {
  return {
    inputRef: createRef<HTMLInputElement>(),
    findQuery: '',
    setFindQuery: vi.fn(),
    isSemantic: false,
    runSemanticSearch: vi.fn().mockResolvedValue(undefined),
    findMode: 'wildcard',
    setFindMode: vi.fn(),
    isOnline: true,
    povFilter: 'all',
    setPovFilter: vi.fn(),
    bdiFilter: 'all',
    setBdiFilter: vi.fn(),
    mode: 'taxonomy',
    ...overrides,
  } as Props;
}

describe('SearchPanel clear button (t/2929)', () => {
  it('hides the ✕ when the field is empty', () => {
    render(<TaxonomyInputArea {...makeProps({ findQuery: '' })} />);
    expect(screen.queryByLabelText('Clear search')).toBeNull();
  });

  it('shows the ✕ when the field has one or more characters', () => {
    render(<TaxonomyInputArea {...makeProps({ findQuery: 'excludes*harmf' })} />);
    expect(screen.getByLabelText('Clear search')).toBeDefined();
  });

  it('clicking ✕ clears via setFindQuery (the same setter that drives results)', () => {
    const setFindQuery = vi.fn();
    render(<TaxonomyInputArea {...makeProps({ findQuery: 'governance', setFindQuery })} />);
    fireEvent.click(screen.getByLabelText('Clear search'));
    expect(setFindQuery).toHaveBeenCalledWith('');
  });

  it('keeps focus on the input after clearing (caret/keyboard stay active)', () => {
    const inputRef = createRef<HTMLInputElement>();
    render(<TaxonomyInputArea {...makeProps({ findQuery: 'governance', inputRef })} />);
    fireEvent.click(screen.getByLabelText('Clear search'));
    expect(document.activeElement).toBe(inputRef.current);
  });

  it('preventDefault on mousedown so the click does not blur the input first', () => {
    render(<TaxonomyInputArea {...makeProps({ findQuery: 'x' })} />);
    const btn = screen.getByLabelText('Clear search');
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    btn.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});
