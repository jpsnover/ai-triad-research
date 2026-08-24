// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExportDropdown } from './ExportDropdown';

describe('ExportDropdown', () => {
  it('renders a single Export trigger with no menu open by default', () => {
    render(<ExportDropdown onExport={() => {}} />);
    expect(screen.getByRole('button', { name: /export/i })).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens a PDF / JSON / Markdown menu on click', () => {
    render(<ExportDropdown onExport={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'PDF' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'JSON' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Markdown' })).toBeTruthy();
  });

  it('calls onExport with the chosen format and closes the menu', () => {
    const onExport = vi.fn();
    render(<ExportDropdown onExport={onExport} />);
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Markdown' }));
    expect(onExport).toHaveBeenCalledWith('markdown');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  // Brief… item — shared by the My and Community debate rows (t/2805 follow-up). No onBrief
  // ⇒ no item; provided ⇒ enabled and fires; briefWebOnly ⇒ disabled dead-end on desktop.
  it('omits the Brief… item when onBrief is not provided', () => {
    render(<ExportDropdown onExport={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    expect(screen.queryByRole('menuitem', { name: /brief/i })).toBeNull();
  });

  it('renders an enabled Brief… item that fires onBrief and closes the menu', () => {
    const onBrief = vi.fn();
    render(<ExportDropdown onExport={() => {}} onBrief={onBrief} />);
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    const item = screen.getByRole('menuitem', { name: 'Brief…' });
    expect((item as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(item);
    expect(onBrief).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('disables the Brief… item (web-app only) and does not fire onBrief when briefWebOnly', () => {
    const onBrief = vi.fn();
    render(<ExportDropdown onExport={() => {}} onBrief={onBrief} briefWebOnly />);
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    const item = screen.getByRole('menuitem', { name: /brief.*web app/i });
    expect((item as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(item);
    expect(onBrief).not.toHaveBeenCalled();
  });
});
