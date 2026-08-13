// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { OpEdTable, OpEdMyRow, OpEdCommunityRow, opEdCamps, applySortMy, applySortCommunity } from './OpEdTable';
import type { OpEdSetSummary, OpEdCommunityEntry, PovKey } from '../../../../../lib/oped/types';

// The My list renders OpEdSetSummary index rows (no `opeds`/`params` body) — the
// t/2605 crash was code that assumed the full OpEdSet here (`set.opeds` iteration).
function makeSummary(overrides: Partial<OpEdSetSummary> = {}): OpEdSetSummary {
  return {
    set_id: 'set-1',
    topic: 'Mandatory pre-deployment audits',
    created_at: '2026-08-08T12:00:00Z',
    camps: ['safetyist'],
    voice_count: 1,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<OpEdCommunityEntry> = {}): OpEdCommunityEntry {
  return {
    id: 'c-1',
    topic: 'Open-weight models',
    created_at: '2026-08-07T12:00:00Z',
    updated_at: '2026-08-07T12:00:00Z',
    camps: ['skeptic'],
    voice_count: 1,
    community_metadata: null,
    ...overrides,
  };
}

const noopMyProps = {
  variant: 'my' as const,
  loading: false,
  searchQuery: '',
  editMode: false,
  selectedIds: new Set<string>(),
  onToggleSelect: vi.fn(),
  renamingId: null,
  setRenamingId: vi.fn(),
  renameValue: '',
  setRenameValue: vi.fn(),
  onRename: vi.fn(),
  onOpen: vi.fn(),
  onExport: vi.fn(),
  onShare: vi.fn(),
  onNew: vi.fn(),
  selectedSetId: null,
  totalCount: 0,
};

describe('opEdCamps helper', () => {
  it('returns the summary camps directly (no opeds iteration)', () => {
    const set = makeSummary({ camps: ['skeptic', 'safetyist'] });
    expect(opEdCamps(set)).toEqual<PovKey[]>(['skeptic', 'safetyist']);
  });
});

describe('applySort — My / Community', () => {
  it('sorts My rows by date descending', () => {
    const rows = [
      makeSummary({ set_id: 'a', created_at: '2026-08-01T00:00:00Z' }),
      makeSummary({ set_id: 'b', created_at: '2026-08-09T00:00:00Z' }),
    ];
    const sorted = applySortMy(rows, { col: 'date', dir: 'desc' });
    expect(sorted[0].set_id).toBe('b');
  });

  it('sorts My rows by camp ascending', () => {
    const rows = [
      makeSummary({ set_id: 'skp', camps: ['skeptic'] }),
      makeSummary({ set_id: 'acc', camps: ['accelerationist'] }),
    ];
    const sorted = applySortMy(rows, { col: 'camp', dir: 'asc' });
    expect(sorted[0].set_id).toBe('acc');
  });

  it('returns rows unchanged when sort is none', () => {
    const rows = [makeSummary({ set_id: 'a' }), makeSummary({ set_id: 'b' })];
    expect(applySortMy(rows, { col: null, dir: 'none' })).toBe(rows);
  });

  it('sorts Community rows by date descending', () => {
    const rows = [
      makeEntry({ id: 'a', updated_at: '2026-08-01T00:00:00Z' }),
      makeEntry({ id: 'b', updated_at: '2026-08-09T00:00:00Z' }),
    ];
    const sorted = applySortCommunity(rows, { col: 'date', dir: 'desc' });
    expect(sorted[0].id).toBe('b');
  });
});

describe('OpEdMyRow', () => {
  function renderRow(set: OpEdSetSummary, extra: Record<string, unknown> = {}) {
    return render(
      <table><tbody>
        <OpEdMyRow
          set={set}
          isActive={false}
          editMode={false}
          isSelected={false}
          onToggleSelect={vi.fn()}
          renamingId={null}
          setRenamingId={vi.fn()}
          renameValue=""
          setRenameValue={vi.fn()}
          onRename={vi.fn()}
          onOpen={vi.fn()}
          onExport={vi.fn()}
          onShare={vi.fn()}
          {...extra}
        />
      </tbody></table>,
    );
  }

  it('renders the topic as the headline and the camp chip', () => {
    const { container } = renderRow(makeSummary());
    expect(screen.getByText('Mandatory pre-deployment audits')).toBeTruthy();
    // Camp chip renders the short label for safetyist.
    expect(within(container.querySelector('.col-camp')!).getByText('Saf')).toBeTruthy();
  });

  it('shows a "▸ N voices" tag for multi-voice sets', () => {
    renderRow(makeSummary({ camps: ['skeptic', 'safetyist'], voice_count: 2 }));
    expect(screen.getByText('▸ 2 voices')).toBeTruthy();
  });

  it('Open button fires onOpen with the set id', () => {
    const onOpen = vi.fn();
    renderRow(makeSummary(), { onOpen });
    fireEvent.click(screen.getByRole('button', { name: /open/i }));
    expect(onOpen).toHaveBeenCalledWith('set-1');
  });

  it('Share button fires onShare with the summary', () => {
    const onShare = vi.fn();
    const set = makeSummary();
    renderRow(set, { onShare });
    fireEvent.click(screen.getByRole('button', { name: /share/i }));
    expect(onShare).toHaveBeenCalledWith(set);
  });

  it('renders a select checkbox in edit mode', () => {
    renderRow(makeSummary(), { editMode: true });
    expect(screen.getByRole('checkbox', { name: /select/i })).toBeTruthy();
  });
});

describe('OpEdCommunityRow', () => {
  function renderRow(entry: OpEdCommunityEntry, extra: Record<string, unknown> = {}) {
    return render(
      <table><tbody>
        <OpEdCommunityRow
          entry={entry}
          isSelected={false}
          onOpen={vi.fn()}
          onExport={vi.fn()}
          onCopy={vi.fn()}
          copyingId={null}
          showCopy
          {...extra}
        />
      </tbody></table>,
    );
  }

  it('renders topic and camp chip', () => {
    renderRow(makeEntry());
    expect(screen.getByText('Open-weight models')).toBeTruthy();
    expect(screen.getByText('Skp')).toBeTruthy();
  });

  it('shows Copy when showCopy is true and hides it when false', () => {
    const { rerender } = renderRow(makeEntry());
    expect(screen.queryByRole('button', { name: /copy/i })).toBeTruthy();
    rerender(
      <table><tbody>
        <OpEdCommunityRow
          entry={makeEntry()}
          isSelected={false}
          onOpen={vi.fn()}
          onExport={vi.fn()}
          onCopy={vi.fn()}
          copyingId={null}
          showCopy={false}
        />
      </tbody></table>,
    );
    expect(screen.queryByRole('button', { name: /copy/i })).toBeNull();
  });

  it('Enter on the row fires onOpen', () => {
    const onOpen = vi.fn();
    const { container } = renderRow(makeEntry({ id: 'c-42' }), { onOpen });
    fireEvent.keyDown(container.querySelector('tr')!, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith('c-42');
  });
});

describe('OpEdTable — My variant', () => {
  it('renders the empty state with a + New Op-Ed action', () => {
    render(<OpEdTable {...noopMyProps} rows={[]} />);
    expect(screen.getByText(/No op-eds yet/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /New Op-Ed/i })).toBeTruthy();
  });

  it('renders a semantic table with an sr-only caption and sortable headers', () => {
    render(<OpEdTable {...noopMyProps} rows={[makeSummary()]} />);
    const table = screen.getByRole('table');
    expect(within(table).getByText('My Op-Eds')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: /headline/i })).toBeTruthy();
  });

  // t/2605 regression: the full My table over a NON-EMPTY OpEdSetSummary[] must render
  // camp chips + voice counts for every row without throwing. A prior version iterated
  // `set.opeds` on the summary and crashed on the first non-empty list; an empty-rows
  // test never exercised the row-render path and gave false confidence.
  //
  // t/2605 follow-up: camps here carry the SHORT camp codes ('acc'/'saf'/'skp') that the
  // create flow actually persists in OpEdMember.pov — NOT the full-name PovKeys POV_META
  // is keyed by. Using full names before hid a second crash (POV_META['acc'].label =
  // undefined.label), caught only by a live smoke on real data. `as unknown as PovKey[]`
  // documents that these values violate the nominal PovKey type — that drift is the bug.
  const short = (...c: string[]) => c as unknown as PovKey[];
  it('renders a non-empty My list with SHORT-code camp chips + voice tags (no crash)', () => {
    const rows = [
      makeSummary({ set_id: 'multi', topic: 'Frontier model licensing', camps: short('saf', 'skp'), voice_count: 2 }),
      makeSummary({ set_id: 'single', topic: 'Compute governance', camps: short('acc'), voice_count: 1 }),
    ];
    render(<OpEdTable {...noopMyProps} rows={rows} totalCount={rows.length} />);

    // Both topics render as headlines.
    expect(screen.getByText('Frontier model licensing')).toBeTruthy();
    expect(screen.getByText('Compute governance')).toBeTruthy();

    // Short codes normalize to their POV_META short labels — proving the resolver ran.
    const multiRow = screen.getByText('Frontier model licensing').closest('tr')!;
    expect(within(multiRow).getByText('Saf')).toBeTruthy();
    expect(within(multiRow).getByText('Skp')).toBeTruthy();
    expect(within(multiRow).getByText('▸ 2 voices')).toBeTruthy();
    const singleRow = screen.getByText('Compute governance').closest('tr')!;
    expect(within(singleRow).getByText('Acc')).toBeTruthy();

    // Every row exposes an Open action — proves the full row body rendered.
    expect(screen.getAllByRole('button', { name: /open/i })).toHaveLength(2);
  });

  it('renders a neutral chip for an unknown/legacy camp code instead of crashing', () => {
    const rows = [makeSummary({ set_id: 'x', topic: 'Legacy voice', camps: short('bogus'), voice_count: 1 })];
    render(<OpEdTable {...noopMyProps} rows={rows} totalCount={1} />);
    const row = screen.getByText('Legacy voice').closest('tr')!;
    // Fallback short label is an em dash — the row still renders, no error boundary.
    expect(within(row).getByText('—')).toBeTruthy();
    expect(within(row).getByRole('button', { name: /open/i })).toBeTruthy();
  });
});

describe('OpEdTable — Community variant', () => {
  const base = {
    variant: 'community' as const,
    loading: false,
    searchQuery: '',
    onOpen: vi.fn(),
    onExport: vi.fn(),
    onCopy: vi.fn(),
    copyingId: null,
    auth: null,
    selectedId: null,
    totalCount: 0,
  };

  it('shows the web-only notice in Electron with no rows', () => {
    render(<OpEdTable {...base} rows={[]} isElectron />);
    expect(screen.getByText(/only available in the web app/i)).toBeTruthy();
  });

  it('hides Copy for anonymous users', () => {
    render(<OpEdTable {...base} rows={[makeEntry()]} isElectron={false} auth={{ anonymous: true }} />);
    expect(screen.queryByRole('button', { name: /copy/i })).toBeNull();
  });
});
