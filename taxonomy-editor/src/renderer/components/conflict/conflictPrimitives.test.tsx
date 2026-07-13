// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EditableField } from './EditableField';
import { InlineConfirm } from './InlineConfirm';

afterEach(() => { vi.clearAllMocks(); });

describe('EditableField', () => {
  it('read mode shows the value and enters edit on Enter', () => {
    render(<EditableField value="hello" onCommit={vi.fn()} ariaLabel="Edit x" />);
    const read = screen.getByRole('button', { name: 'Edit x' });
    expect(read).toHaveTextContent('hello');
    fireEvent.keyDown(read, { key: 'Enter' });
    expect(screen.getByRole('textbox')).toHaveValue('hello');
  });

  it('commits the edited value on Save (buffer-then-commit)', () => {
    const onCommit = vi.fn();
    render(<EditableField value="old" onCommit={onCommit} ariaLabel="f" />);
    fireEvent.click(screen.getByRole('button', { name: 'f' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'new' } });
    fireEvent.click(screen.getByText('Save'));
    expect(onCommit).toHaveBeenCalledWith('new');
  });

  it('Escape cancels without committing and reverts the draft', () => {
    const onCommit = vi.fn();
    render(<EditableField value="old" onCommit={onCommit} ariaLabel="f" />);
    fireEvent.click(screen.getByRole('button', { name: 'f' }));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'scratch' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCommit).not.toHaveBeenCalled();
    // Back in read mode showing the original value.
    expect(screen.getByRole('button', { name: 'f' })).toHaveTextContent('old');
  });

  it('does not commit when the value is unchanged', () => {
    const onCommit = vi.fn();
    render(<EditableField value="same" onCommit={onCommit} ariaLabel="f" />);
    fireEvent.click(screen.getByRole('button', { name: 'f' }));
    fireEvent.click(screen.getByText('Save'));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('readOnly is not editable and has no button role', () => {
    render(<EditableField value="x" onCommit={vi.fn()} readOnly ariaLabel="f" />);
    expect(screen.queryByRole('button', { name: 'f' })).toBeNull();
    expect(screen.getByText('x')).toBeInTheDocument();
  });

  it('shows the placeholder when empty and renders a custom read view', () => {
    const { rerender } = render(<EditableField value="" onCommit={vi.fn()} placeholder="No description" />);
    expect(screen.getByText('No description')).toBeInTheDocument();
    rerender(<EditableField value="Q" onCommit={vi.fn()} renderRead={(v) => <em>“{v}”</em>} />);
    expect(screen.getByText('“Q”')).toBeInTheDocument();
  });

  it('select type commits the chosen option', () => {
    const onCommit = vi.fn();
    render(
      <EditableField
        value="supports"
        onCommit={onCommit}
        type="select"
        ariaLabel="stance"
        options={[{ value: 'supports', label: 'Supports' }, { value: 'disputes', label: 'Disputes' }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'stance' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'disputes' } });
    fireEvent.click(screen.getByText('Save'));
    expect(onCommit).toHaveBeenCalledWith('disputes');
  });
});

describe('InlineConfirm', () => {
  it('shows the confirm choice only after the trigger fires, and confirms', () => {
    const onConfirm = vi.fn();
    render(
      <InlineConfirm onConfirm={onConfirm} label="Delete instance?" confirmLabel="Delete">
        {(start) => <button type="button" onClick={start}>trash</button>}
      </InlineConfirm>,
    );
    expect(screen.queryByText('Delete instance?')).toBeNull();
    fireEvent.click(screen.getByText('trash'));
    expect(screen.getByText('Delete instance?')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Delete'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('Cancel and Escape dismiss without confirming', () => {
    const onConfirm = vi.fn();
    render(
      <InlineConfirm onConfirm={onConfirm}>
        {(start) => <button type="button" onClick={start}>trash</button>}
      </InlineConfirm>,
    );
    // Cancel path
    fireEvent.click(screen.getByText('trash'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Delete?')).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
    // Escape path
    fireEvent.click(screen.getByText('trash'));
    fireEvent.keyDown(screen.getByRole('group'), { key: 'Escape' });
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
