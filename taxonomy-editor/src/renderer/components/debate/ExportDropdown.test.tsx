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
});
