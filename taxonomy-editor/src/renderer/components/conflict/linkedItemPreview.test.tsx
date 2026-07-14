// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// LinkedNodePreview pulls from the store; stub it so the node branch is testable.
vi.mock('../shared/LinkedNodePreview', () => ({
  LinkedNodePreview: ({ nodeId }: { nodeId: string }) => <div data-testid="node-preview">{nodeId}</div>,
}));

import { LinkedItemPreview, toggleLinkedSelection, type SelectedLinkedItem } from './linkedItemPreview';

afterEach(() => { vi.clearAllMocks(); });

describe('toggleLinkedSelection', () => {
  const node: SelectedLinkedItem = { kind: 'node', id: 'acc-intentions-052' };
  const policy: SelectedLinkedItem = { kind: 'policy', id: 'pol-1030', action: 'Establish partnerships' };

  it('selects a node from nothing, and a policy from nothing', () => {
    expect(toggleLinkedSelection(null, node)).toEqual(node);
    expect(toggleLinkedSelection(null, policy)).toEqual(policy);
  });

  it('clicking the already-selected item clears it (toggle off) — for both kinds', () => {
    expect(toggleLinkedSelection(node, { kind: 'node', id: 'acc-intentions-052' })).toBeNull();
    expect(toggleLinkedSelection(policy, { kind: 'policy', id: 'pol-1030', action: 'Establish partnerships' })).toBeNull();
  });

  it('clicking a different item switches selection (single-item)', () => {
    expect(toggleLinkedSelection(node, policy)).toEqual(policy);
    expect(toggleLinkedSelection(policy, node)).toEqual(node);
    // Same kind, different id → switch, not clear.
    expect(toggleLinkedSelection(node, { kind: 'node', id: 'saf-belief-001' })).toEqual({ kind: 'node', id: 'saf-belief-001' });
  });
});

describe('LinkedItemPreview', () => {
  it('renders a node preview (reusing LinkedNodePreview) with Open-in-tab + close', () => {
    const onClose = vi.fn();
    const onOpenInTab = vi.fn();
    render(<LinkedItemPreview item={{ kind: 'node', id: 'acc-intentions-052' }} onClose={onClose} onOpenInTab={onOpenInTab} />);
    expect(screen.getByTestId('node-preview')).toHaveTextContent('acc-intentions-052');
    fireEvent.click(screen.getByText('Open in tab ↗'));
    expect(onOpenInTab).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText('Close preview'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders a policy preview (id + action text, no Open-in-tab)', () => {
    render(<LinkedItemPreview item={{ kind: 'policy', id: 'pol-1030', action: 'Establish public-private partnerships' }} onClose={vi.fn()} />);
    expect(screen.getByText('pol-1030')).toBeInTheDocument();
    expect(screen.getByText('Establish public-private partnerships')).toBeInTheDocument();
    expect(screen.queryByText('Open in tab ↗')).toBeNull();
    expect(screen.queryByTestId('node-preview')).toBeNull();
  });
});
