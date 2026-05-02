// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';

describe('DeleteConfirmDialog', () => {
  const defaultProps = {
    itemLabel: 'Test Node',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  it('renders the item label in the confirmation message', () => {
    render(<DeleteConfirmDialog {...defaultProps} />);
    expect(screen.getByText('Test Node')).toBeInTheDocument();
  });

  it('shows "(untitled)" when itemLabel is empty', () => {
    render(<DeleteConfirmDialog {...defaultProps} itemLabel="" />);
    expect(screen.getByText('(untitled)')).toBeInTheDocument();
  });

  it('renders Delete and Cancel buttons', () => {
    render(<DeleteConfirmDialog {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('calls onConfirm when Delete button is clicked', async () => {
    const onConfirm = vi.fn();
    render(<DeleteConfirmDialog {...defaultProps} onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('calls onCancel when Cancel button is clicked', async () => {
    const onCancel = vi.fn();
    render(<DeleteConfirmDialog {...defaultProps} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('calls onCancel when clicking the overlay', async () => {
    const onCancel = vi.fn();
    const { container } = render(
      <DeleteConfirmDialog {...defaultProps} onCancel={onCancel} />,
    );
    // The overlay is the outermost div with class "dialog-overlay"
    const overlay = container.querySelector('.dialog-overlay')!;
    await userEvent.click(overlay);
    expect(onCancel).toHaveBeenCalled();
  });

  it('does not call onCancel when clicking inside the dialog', async () => {
    const onCancel = vi.fn();
    render(<DeleteConfirmDialog {...defaultProps} onCancel={onCancel} />);
    // Click the heading inside the dialog
    await userEvent.click(screen.getByText('Delete Node'));
    expect(onCancel).not.toHaveBeenCalled();
  });
});
