// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LinkedChip } from './LinkedChip';

// Mock the Zustand store hook
const mockGetLabelForId = vi.fn();
const mockLookupPinnedData = vi.fn();
const mockPinAtDepth = vi.fn();

vi.mock('../hooks/useTaxonomyStore', () => ({
  useTaxonomyStore: () => ({
    getLabelForId: mockGetLabelForId,
    lookupPinnedData: mockLookupPinnedData,
    pinAtDepth: mockPinAtDepth,
  }),
}));

describe('LinkedChip', () => {
  beforeEach(() => {
    mockGetLabelForId.mockReset();
    mockLookupPinnedData.mockReset();
    mockPinAtDepth.mockReset();
    mockGetLabelForId.mockReturnValue('');
  });

  it('renders the node id', () => {
    render(<LinkedChip id="acc-B-001" />);
    expect(screen.getByText('acc-B-001')).toBeInTheDocument();
  });

  it('renders the label when available', () => {
    mockGetLabelForId.mockReturnValue('AI Safety');
    render(<LinkedChip id="saf-D-010" />);
    expect(screen.getByText('saf-D-010')).toBeInTheDocument();
    expect(screen.getByText('AI Safety')).toBeInTheDocument();
  });

  it('does not render a label span when label is empty', () => {
    mockGetLabelForId.mockReturnValue('');
    const { container } = render(<LinkedChip id="acc-B-001" />);
    expect(container.querySelector('.chip-label')).not.toBeInTheDocument();
  });

  it('shows a remove button when not readOnly and onRemove is provided', () => {
    const onRemove = vi.fn();
    render(<LinkedChip id="acc-B-001" onRemove={onRemove} />);
    expect(screen.getByRole('button', { name: 'x' })).toBeInTheDocument();
  });

  it('hides the remove button when readOnly is true', () => {
    const onRemove = vi.fn();
    render(<LinkedChip id="acc-B-001" readOnly onRemove={onRemove} />);
    expect(screen.queryByRole('button', { name: 'x' })).not.toBeInTheDocument();
  });

  it('hides the remove button when onRemove is not provided', () => {
    render(<LinkedChip id="acc-B-001" />);
    expect(screen.queryByRole('button', { name: 'x' })).not.toBeInTheDocument();
  });

  it('calls onRemove with the id when remove button is clicked', async () => {
    const onRemove = vi.fn();
    render(<LinkedChip id="acc-B-001" onRemove={onRemove} />);
    await userEvent.click(screen.getByRole('button', { name: 'x' }));
    expect(onRemove).toHaveBeenCalledWith('acc-B-001');
  });

  it('pins data at the correct depth when chip content is clicked', async () => {
    const pinnedData = { id: 'acc-B-001', type: 'pov' };
    mockLookupPinnedData.mockReturnValue(pinnedData);
    render(<LinkedChip id="acc-B-001" depth={2} />);
    await userEvent.click(screen.getByText('acc-B-001'));
    expect(mockLookupPinnedData).toHaveBeenCalledWith('acc-B-001');
    expect(mockPinAtDepth).toHaveBeenCalledWith(2, pinnedData);
  });

  it('does not pin when lookupPinnedData returns null', async () => {
    mockLookupPinnedData.mockReturnValue(null);
    render(<LinkedChip id="acc-B-001" />);
    await userEvent.click(screen.getByText('acc-B-001'));
    expect(mockPinAtDepth).not.toHaveBeenCalled();
  });

  it('defaults depth to 0', async () => {
    const pinnedData = { id: 'acc-B-001', type: 'pov' };
    mockLookupPinnedData.mockReturnValue(pinnedData);
    render(<LinkedChip id="acc-B-001" />);
    await userEvent.click(screen.getByText('acc-B-001'));
    expect(mockPinAtDepth).toHaveBeenCalledWith(0, pinnedData);
  });
});
