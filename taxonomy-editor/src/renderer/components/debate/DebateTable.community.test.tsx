// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CommunityTableRow } from './DebateTable';
import type { CommunityDebate } from '../../hooks/useCommunityStore';

function makeRow(overrides: Partial<CommunityDebate> = {}): CommunityDebate {
  return {
    id: 'test-id',
    title: 'Test debate',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function renderRow(cd: CommunityDebate) {
  return render(
    <table>
      <tbody>
        <CommunityTableRow
          cd={cd}
          isSelected={false}
          onOpen={vi.fn()}
          onExport={vi.fn()}
          onCopy={vi.fn<() => Promise<void>>().mockResolvedValue(undefined)}
          copyingId={null}
          showCopy={false}
          onPhoneSelect={vi.fn()}
          isPhone={false}
        />
      </tbody>
    </table>,
  );
}

describe('CommunityTableRow — TURNS and MODEL field mapping (t/2362)', () => {
  it('renders turn_count when present', () => {
    renderRow(makeRow({ turn_count: 7 }));
    expect(screen.getByText('7')).toBeTruthy();
  });

  it('renders model when present', () => {
    renderRow(makeRow({ model: 'claude-opus-4-8' }));
    expect(screen.getByText('claude-opus-4-8')).toBeTruthy();
  });

  it('renders — for turn_count when absent', () => {
    const { getAllByText } = renderRow(makeRow());
    // Both turns and model cells fall back to —
    expect(getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('renders both turn_count and model together', () => {
    renderRow(makeRow({ turn_count: 3, model: 'gemini-flash-lite' }));
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('gemini-flash-lite')).toBeTruthy();
  });
});
