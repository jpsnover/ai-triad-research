// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuotaBanner } from './QuotaBanner';
import { useQuotaWarning } from '../../hooks/useQuotaWarning';
import { useSettingsDialog } from '../../hooks/useSettingsDialog';

function setWarning(level: 'info' | 'warning' | 'error', message = 'msg') {
  useQuotaWarning.setState({
    warning: { milestone: level === 'error' ? 100 : 80, level, message, dismissedAt: null },
  });
}

describe('QuotaBanner — daily-limit deep-link (t/3190)', () => {
  beforeEach(() => {
    useQuotaWarning.setState({ warning: null });
    useSettingsDialog.setState({ isOpen: false });
  });

  it('renders "Add API key" on the error (daily-cap) banner and opens Settings on click', () => {
    setWarning('error', 'Daily AI quota reached. Resets at midnight UTC.');
    render(<QuotaBanner />);
    const addKey = screen.getByRole('button', { name: 'Add API key' });
    fireEvent.click(addKey);
    expect(useSettingsDialog.getState().isOpen).toBe(true);
  });

  it('does not render "Add API key" on non-error banners', () => {
    setWarning('warning');
    render(<QuotaBanner />);
    expect(screen.queryByRole('button', { name: 'Add API key' })).toBeNull();
    // warning-level keeps its dismiss control
    expect(screen.getByRole('button', { name: 'Dismiss quota warning' })).toBeInTheDocument();
  });
});
