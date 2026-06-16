// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FieldHelp } from './FieldHelp';

describe('FieldHelp', () => {
  const helpText = 'This field controls the node category.';

  it('renders the help button with "?" text', () => {
    render(<FieldHelp text={helpText} />);
    expect(screen.getByRole('button', { name: '?' })).toBeInTheDocument();
  });

  it('does not show the tooltip by default', () => {
    render(<FieldHelp text={helpText} />);
    expect(screen.queryByText(helpText)).not.toBeInTheDocument();
  });

  it('shows the tooltip on mouse enter', async () => {
    render(<FieldHelp text={helpText} />);
    await userEvent.hover(screen.getByRole('button', { name: '?' }));
    expect(screen.getByText(helpText)).toBeInTheDocument();
  });

  it('hides the tooltip on mouse leave', async () => {
    render(<FieldHelp text={helpText} />);
    const btn = screen.getByRole('button', { name: '?' });
    await userEvent.hover(btn);
    expect(screen.getByText(helpText)).toBeInTheDocument();
    await userEvent.unhover(btn);
    expect(screen.queryByText(helpText)).not.toBeInTheDocument();
  });

  it('sets the title attribute for native tooltip fallback', () => {
    render(<FieldHelp text={helpText} />);
    expect(screen.getByRole('button', { name: '?' })).toHaveAttribute(
      'title',
      helpText,
    );
  });
});
