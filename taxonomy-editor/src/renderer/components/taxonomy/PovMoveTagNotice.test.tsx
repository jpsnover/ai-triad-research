// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { PovMoveTagNotice } from './PovMoveTagNotice';
import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';

// t/3972: the cross-POV move's stripped tags must be visible, not only logged.
describe('PovMoveTagNotice', () => {
  const report = { fromId: 'acc-beliefs-001', toId: 'saf-beliefs-009', sourcePov: 'accelerationist' as const, targetPov: 'safetyist' as const, strippedTags: ['critical', 'institutional'] };

  afterEach(() => {
    cleanup();
    useTaxonomyStore.setState({ lastPovMoveReport: null });
  });

  it('names the removed tags and both POVs on the moved node', () => {
    useTaxonomyStore.setState({ lastPovMoveReport: report });
    render(<PovMoveTagNotice nodeId="saf-beliefs-009" />);
    const text = screen.getByRole('status').textContent ?? '';
    expect(text).toContain('Accelerationist');
    expect(text).toContain('Safetyist');
    expect(text).toContain('critical, institutional');
  });

  it('renders nothing on any other node, or when nothing was stripped', () => {
    useTaxonomyStore.setState({ lastPovMoveReport: report });
    const { container, rerender } = render(<PovMoveTagNotice nodeId="saf-beliefs-001" />);
    expect(container.firstChild).toBeNull();
    useTaxonomyStore.setState({ lastPovMoveReport: { ...report, strippedTags: [] } });
    rerender(<PovMoveTagNotice nodeId="saf-beliefs-009" />);
    expect(container.firstChild).toBeNull();
  });

  it('dismiss clears the report', () => {
    useTaxonomyStore.setState({ lastPovMoveReport: report });
    render(<PovMoveTagNotice nodeId="saf-beliefs-009" />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(useTaxonomyStore.getState().lastPovMoveReport).toBeNull();
  });
});
