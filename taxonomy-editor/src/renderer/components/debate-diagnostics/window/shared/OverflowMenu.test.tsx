// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OverflowMenu } from './OverflowMenu';
import type { OverflowItem } from './OverflowMenu';

const makeItems = (overrides: Partial<OverflowItem>[] = []): OverflowItem[] => {
  const defaults: OverflowItem[] = [
    { id: 'a', label: 'Alpha', enabled: true },
    { id: 'b', label: 'Beta', enabled: true },
    { id: 'c', label: 'Gamma', enabled: false, tooltip: 'No data' },
  ];
  return defaults.map((d, i) => ({ ...d, ...overrides[i] }));
};

describe('OverflowMenu', () => {
  it('renders trigger with "More ▾" when no overflow item is active', () => {
    render(<OverflowMenu items={makeItems()} activeId={null} onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: /More ▾/ })).toBeInTheDocument();
  });

  it('shows active overflow item label in trigger when active', () => {
    render(<OverflowMenu items={makeItems()} activeId="b" onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Beta ▾/ })).toBeInTheDocument();
  });

  it('opens dropdown on click and shows all items', async () => {
    render(<OverflowMenu items={makeItems()} activeId={null} onSelect={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /More ▾/ }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Alpha/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Beta/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Gamma/ })).toBeInTheDocument();
  });

  it('disables items that are not enabled', async () => {
    render(<OverflowMenu items={makeItems()} activeId={null} onSelect={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /More ▾/ }));
    expect(screen.getByRole('menuitem', { name: /Gamma/ })).toBeDisabled();
  });

  it('calls onSelect and closes dropdown when an enabled item is clicked', async () => {
    const onSelect = vi.fn();
    render(<OverflowMenu items={makeItems()} activeId={null} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: /More ▾/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Alpha/ }));
    expect(onSelect).toHaveBeenCalledWith('a');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('does not call onSelect for disabled items', async () => {
    const onSelect = vi.fn();
    render(<OverflowMenu items={makeItems()} activeId={null} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: /More ▾/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Gamma/ }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('closes on Escape and returns focus to trigger', async () => {
    render(<OverflowMenu items={makeItems()} activeId={null} onSelect={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: /More ▾/ });
    await userEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it('navigates items with ArrowDown and ArrowUp', async () => {
    render(<OverflowMenu items={makeItems()} activeId={null} onSelect={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /More ▾/ }));
    const menu = screen.getByRole('menu');
    const items = screen.getAllByRole('menuitem');
    // Initial focus on first item
    expect(document.activeElement).toBe(items[0]);
    // ArrowDown to second
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    // ArrowDown to third
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[2]);
    // ArrowDown wraps to first
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[0]);
    // ArrowUp wraps to last
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[2]);
  });

  it('Home jumps to first item, End jumps to last', async () => {
    render(<OverflowMenu items={makeItems()} activeId={null} onSelect={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /More ▾/ }));
    const menu = screen.getByRole('menu');
    const items = screen.getAllByRole('menuitem');
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(document.activeElement).toBe(items[0]);
  });

  it('opens with ArrowDown on trigger and focuses first item', async () => {
    render(<OverflowMenu items={makeItems()} activeId={null} onSelect={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: /More ▾/ });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(screen.getByRole('menu')).toBeInTheDocument();
    const items = screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(items[0]);
  });

  it('dims trigger when all items are disabled', () => {
    const items = makeItems().map(i => ({ ...i, enabled: false }));
    const { container } = render(<OverflowMenu items={items} activeId={null} onSelect={vi.fn()} />);
    const trigger = container.querySelector('.overflow-menu__trigger');
    expect(trigger?.classList.contains('overflow-menu__trigger--dimmed')).toBe(true);
  });

  it('shows count badge and empty marker when present', async () => {
    const items: OverflowItem[] = [
      { id: 'x', label: 'Tax Refs', enabled: true, count: 3 },
      { id: 'y', label: 'Empty Stage', enabled: true, ranEmpty: true },
    ];
    render(<OverflowMenu items={items} activeId={null} onSelect={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /More ▾/ }));
    expect(screen.getByText('(3)')).toBeInTheDocument();
    expect(screen.getByText('∅')).toBeInTheDocument();
  });

  it('sets aria-expanded on trigger', async () => {
    render(<OverflowMenu items={makeItems()} activeId={null} onSelect={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: /More ▾/ });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });
});
