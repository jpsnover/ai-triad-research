// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TabBar } from './TabBar';

// Mock the Zustand store hook
const mockSetActiveTab = vi.fn();
let mockActiveTab = 'accelerationist';

vi.mock('../hooks/useTaxonomyStore', () => ({
  useTaxonomyStore: () => ({
    activeTab: mockActiveTab,
    setActiveTab: mockSetActiveTab,
  }),
}));

describe('TabBar', () => {
  beforeEach(() => {
    mockActiveTab = 'accelerationist';
    mockSetActiveTab.mockClear();
  });

  it('renders all three POV tab buttons', () => {
    render(<TabBar />);
    expect(screen.getByText('Accelerationist')).toBeInTheDocument();
    expect(screen.getByText('Safetyist')).toBeInTheDocument();
    expect(screen.getByText('Skeptic')).toBeInTheDocument();
  });

  it('marks the active tab with the "active" class', () => {
    render(<TabBar />);
    expect(screen.getByText('Accelerationist')).toHaveClass('active');
    expect(screen.getByText('Safetyist')).not.toHaveClass('active');
    expect(screen.getByText('Skeptic')).not.toHaveClass('active');
  });

  it('calls setActiveTab when a tab is clicked', async () => {
    render(<TabBar />);
    await userEvent.click(screen.getByText('Safetyist'));
    expect(mockSetActiveTab).toHaveBeenCalledWith('safetyist');
  });

  it('sets the data-tab attribute on each button', () => {
    render(<TabBar />);
    expect(screen.getByText('Accelerationist')).toHaveAttribute(
      'data-tab',
      'accelerationist',
    );
    expect(screen.getByText('Safetyist')).toHaveAttribute(
      'data-tab',
      'safetyist',
    );
    expect(screen.getByText('Skeptic')).toHaveAttribute(
      'data-tab',
      'skeptic',
    );
  });

  it('reflects a different active tab correctly', () => {
    mockActiveTab = 'skeptic';
    render(<TabBar />);
    expect(screen.getByText('Skeptic')).toHaveClass('active');
    expect(screen.getByText('Accelerationist')).not.toHaveClass('active');
  });
});
