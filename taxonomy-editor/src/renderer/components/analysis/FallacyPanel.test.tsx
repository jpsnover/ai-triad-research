// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@bridge', () => ({ api: { openExternal: vi.fn() } }));
vi.mock('../../hooks/useTaxonomyStore', () => {
  const hook = () => ({ setToolbarPanel: vi.fn() });
  // getState() drives the fallacy counts; empty store = all counts 0.
  hook.getState = () => ({ accelerationist: undefined, safetyist: undefined, skeptic: undefined, situations: undefined });
  return { useTaxonomyStore: hook };
});

const { FallacyPanel } = await import('./FallacyPanel');

describe('FallacyPanel (t/1025)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('renders the fallacy catalog with a non-zero count', () => {
    render(<FallacyPanel />);
    expect(screen.getByText('Possible Fallacies')).toBeInTheDocument();
    expect(screen.getByText(/^\d+ fallac(y|ies)$/)).toBeInTheDocument();
    expect(screen.queryByText('0 fallacies')).toBeNull();
  });

  it('filters to nothing for a non-matching query', () => {
    render(<FallacyPanel />);
    fireEvent.change(screen.getByPlaceholderText(/Search fallacies/), { target: { value: 'zzzzzqqqq' } });
    expect(screen.getByText('0 fallacies')).toBeInTheDocument();
  });

  it('fires onSelectFallacy when an item is clicked', () => {
    const onSelectFallacy = vi.fn();
    const { container } = render(<FallacyPanel onSelectFallacy={onSelectFallacy} />);
    const firstItem = container.querySelector('.fallacy-panel-item');
    expect(firstItem).toBeTruthy();
    fireEvent.click(firstItem!);
    expect(onSelectFallacy).toHaveBeenCalledTimes(1);
    expect(typeof onSelectFallacy.mock.calls[0][0]).toBe('string');
  });
});
