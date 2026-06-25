// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SituationListItem } from './SituationListItem';

beforeAll(() => {
  // jsdom doesn't implement scrollIntoView; the component calls it when selected.
  Element.prototype.scrollIntoView = vi.fn();
});

describe('SituationListItem', () => {
  it('renders the label and id', () => {
    render(<SituationListItem id="sit-1" label="My Situation" isSelected={false} onSelect={() => {}} />);
    expect(screen.getByText('My Situation')).toBeTruthy();
    expect(screen.getByText('sit-1')).toBeTruthy();
  });

  it('falls back to (untitled) when the label is empty', () => {
    render(<SituationListItem id="sit-2" label="" isSelected={false} onSelect={() => {}} />);
    expect(screen.getByText('(untitled)')).toBeTruthy();
  });

  it('calls onSelect with the id when clicked', () => {
    const onSelect = vi.fn();
    render(<SituationListItem id="sit-3" label="Click me" isSelected={false} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Click me'));
    expect(onSelect).toHaveBeenCalledWith('sit-3');
  });

  it('shows a high-divergence badge for divergence > 0.4', () => {
    const { container } = render(
      <SituationListItem id="sit-4" label="Diverged" isSelected={false} onSelect={() => {}} divergence={0.55} />,
    );
    expect(container.querySelector('.node-item-divergence.high')).toBeTruthy();
    expect(screen.getByText('0.55')).toBeTruthy();
  });
});
