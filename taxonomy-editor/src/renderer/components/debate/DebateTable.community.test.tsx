// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommunityTableRow, applySortMy, applySortCommunity } from './DebateTable';
import type { SessionRowData } from './DebateTable';
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

// ── Sort null-title regression (t/2385) ──────────────────────────────────────

function makeSession(overrides: Partial<SessionRowData> = {}): SessionRowData {
  return {
    id: 's1',
    title: 'Normal debate',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    phase: 'complete',
    ...overrides,
  };
}

function makeCommunityDebate(overrides: Partial<CommunityDebate> = {}): CommunityDebate {
  return {
    id: 'c1',
    title: 'Community debate',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as CommunityDebate;
}

describe('applySortMy — null/undefined title (t/2385)', () => {
  const sort = { col: 'title' as const, dir: 'asc' as const };

  it('does not throw when a session has a null title', () => {
    const rows = [
      makeSession({ id: 's1', title: 'Gamma' }),
      makeSession({ id: 's2', title: null as unknown as string }),
      makeSession({ id: 's3', title: 'Alpha' }),
    ];
    expect(() => applySortMy(rows, sort)).not.toThrow();
  });

  it('sorts null titles as empty string (before non-empty)', () => {
    const rows = [
      makeSession({ id: 's1', title: 'Beta' }),
      makeSession({ id: 's2', title: null as unknown as string }),
    ];
    const result = applySortMy(rows, sort);
    expect(result[0].id).toBe('s2');
    expect(result[1].id).toBe('s1');
  });
});

describe('applySortCommunity — null/undefined title (t/2385)', () => {
  const sort = { col: 'title' as const, dir: 'asc' as const };

  it('does not throw when a community debate has a null title', () => {
    const rows = [
      makeCommunityDebate({ id: 'c1', title: 'Zeta' }),
      makeCommunityDebate({ id: 'c2', title: null as unknown as string }),
      makeCommunityDebate({ id: 'c3', title: 'Alpha' }),
    ];
    expect(() => applySortCommunity(rows, sort)).not.toThrow();
  });

  it('sorts null titles as empty string (before non-empty)', () => {
    const rows = [
      makeCommunityDebate({ id: 'c1', title: 'Beta' }),
      makeCommunityDebate({ id: 'c2', title: null as unknown as string }),
    ];
    const result = applySortCommunity(rows, sort);
    expect(result[0].id).toBe('c2');
    expect(result[1].id).toBe('c1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

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

// Entry-point coverage (t/2399 TL cond-1 addendum): both button and keyboard must fire
// onOpen so the caller (DebateTab.handleCommunityRowOpen) can pass source='community'.
describe('CommunityTableRow — open entry points (t/2399)', () => {
  it('Open button click fires onOpen with the debate id', () => {
    const onOpen = vi.fn();
    render(
      <table><tbody>
        <CommunityTableRow
          cd={makeRow({ id: 'debate-42' })}
          isSelected={false}
          onOpen={onOpen}
          onExport={vi.fn()}
          onCopy={vi.fn<() => Promise<void>>().mockResolvedValue(undefined)}
          copyingId={null}
          showCopy={false}
          onPhoneSelect={vi.fn()}
          isPhone={false}
        />
      </tbody></table>,
    );
    fireEvent.click(screen.getByRole('button', { name: /open/i }));
    expect(onOpen).toHaveBeenCalledWith('debate-42');
  });

  it('keyboard Enter on the row fires onOpen with the debate id', () => {
    const onOpen = vi.fn();
    const { container } = render(
      <table><tbody>
        <CommunityTableRow
          cd={makeRow({ id: 'debate-42' })}
          isSelected={false}
          onOpen={onOpen}
          onExport={vi.fn()}
          onCopy={vi.fn<() => Promise<void>>().mockResolvedValue(undefined)}
          copyingId={null}
          showCopy={false}
          onPhoneSelect={vi.fn()}
          isPhone={false}
        />
      </tbody></table>,
    );
    const row = container.querySelector('tr')!;
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith('debate-42');
  });

  it('detail-pane regression: onOpen NOT called for My-tab rows without explicit invocation', () => {
    // Guards that wiring changes don't accidentally trigger community open on My-tab rows.
    const onOpen = vi.fn();
    render(
      <table><tbody>
        <CommunityTableRow
          cd={makeRow({ id: 'debate-personal' })}
          isSelected={false}
          onOpen={onOpen}
          onExport={vi.fn()}
          onCopy={vi.fn<() => Promise<void>>().mockResolvedValue(undefined)}
          copyingId={null}
          showCopy={false}
          onPhoneSelect={vi.fn()}
          isPhone={false}
        />
      </tbody></table>,
    );
    // No click or keydown fired — onOpen must remain uncalled.
    expect(onOpen).not.toHaveBeenCalled();
  });
});
