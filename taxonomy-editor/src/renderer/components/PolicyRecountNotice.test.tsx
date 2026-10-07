// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { PolicyRecountNotice as Notice } from '../utils/policyRecount';

const state: { policyRecountNotice: Notice | null; dismissPolicyRecountNotice: () => void } = {
  policyRecountNotice: null,
  dismissPolicyRecountNotice: vi.fn(),
};
vi.mock('../hooks/useTaxonomyStore', () => ({
  useTaxonomyStore: (sel: (s: typeof state) => unknown) => sel(state),
}));

const { PolicyRecountNotice, policyRecountNoticeText } = await import('./PolicyRecountNotice');

describe('PolicyRecountNotice (t/4034)', () => {
  beforeEach(() => { state.policyRecountNotice = null; state.dismissPolicyRecountNotice = vi.fn(); });

  it('renders nothing without a notice', () => {
    const { container } = render(<PolicyRecountNotice />);
    expect(container.firstChild).toBeNull();
  });

  it('needs-commit tells the user to commit the registry before the next pipeline run (e/264#26)', () => {
    state.policyRecountNotice = { kind: 'needs-commit', ids: ['pol-001'], reason: 'uncommitted' };
    render(<PolicyRecountNotice />);
    expect(screen.getByRole('status').textContent).toMatch(/Commit policy_actions\.json before the next pipeline run/);
  });

  it('not-updated names the stale ids and the reason; dismiss clears it', () => {
    state.policyRecountNotice = { kind: 'not-updated', ids: ['pol-001', 'pol-002'], reason: 'locked' };
    render(<PolicyRecountNotice />);
    expect(screen.getByRole('status').textContent).toMatch(/not updated for pol-001, pol-002: another writer held the registry lock/);
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(state.dismissPolicyRecountNotice).toHaveBeenCalled();
  });

  it('long id lists are truncated', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    expect(policyRecountNoticeText({ kind: 'not-updated', ids, reason: 'failed' })).toContain('a, b, c, d, e (+2 more)');
  });
});
