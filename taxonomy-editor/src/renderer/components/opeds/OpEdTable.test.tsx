// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { OpEdTable, OpEdMyRow, OpEdCommunityRow, opEdCamps, opEdWordCount, applySortMy, applySortCommunity } from './OpEdTable';
import type { OpEdSet, OpEdMember, OpEdCommunityEntry, PovKey } from '../../../../../lib/oped/types';

function member(overrides: Partial<OpEdMember> = {}): OpEdMember {
  return {
    pov: 'safetyist',
    status: 'complete',
    headline: 'A headline',
    subtitle: 'A subtitle',
    body: 'Body text.',
    wordCount: 800,
    grounding: [],
    ...overrides,
  };
}

function makeSet(overrides: Partial<OpEdSet> = {}): OpEdSet {
  return {
    schema_version: 1,
    set_id: 'set-1',
    topic: 'Mandatory pre-deployment audits',
    params: { wordCount: 800, model: 'gemini-3.6-flash', outlet: 'The Washington Post' },
    created_at: '2026-08-08T12:00:00Z',
    opeds: [member()],
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

describe('opEdCamps / opEdWordCount helpers', () => {
  it('returns distinct camps in member order', () => {
    const set = makeSet({ opeds: [member({ pov: 'skeptic' }), member({ pov: 'safetyist' }), member({ pov: 'skeptic' })] });
    expect(opEdCamps(set)).toEqual<PovKey[]>(['skeptic', 'safetyist']);
  });

  it('sums word counts across members', () => {
    const set = makeSet({ opeds: [member({ wordCount: 800 }), member({ pov: 'skeptic', wordCount: 655 })] });
    expect(opEdWordCount(set)).toBe(1455);
  });
});

describe('applySort — My / Community', () => {
  it('sorts My rows by date descending', () => {
    const rows = [
      makeSet({ set_id: 'a', created_at: '2026-08-01T00:00:00Z' }),
      makeSet({ set_id: 'b', created_at: '2026-08-09T00:00:00Z' }),
    ];
    const sorted = applySortMy(rows, { col: 'date', dir: 'desc' });
    expect(sorted[0].set_id).toBe('b');
  });

  it('sorts My rows by words ascending', () => {
    const rows = [
      makeSet({ set_id: 'big', opeds: [member({ wordCount: 900 })] }),
      makeSet({ set_id: 'small', opeds: [member({ wordCount: 300 })] }),
    ];
    const sorted = applySortMy(rows, { col: 'words', dir: 'asc' });
    expect(sorted[0].set_id).toBe('small');
  });

  it('returns rows unchanged when sort is none', () => {
    const rows = [makeSet({ set_id: 'a' }), makeSet({ set_id: 'b' })];
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
  function renderRow(set: OpEdSet, extra: Record<string, unknown> = {}) {
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

  it('renders topic as the headline and the outlet + word count', () => {
    renderRow(makeSet());
    expect(screen.getByText('Mandatory pre-deployment audits')).toBeTruthy();
    expect(screen.getByText('The Washington Post')).toBeTruthy();
    expect(screen.getByText('800')).toBeTruthy();
  });

  it('shows "— " for a missing outlet', () => {
    renderRow(makeSet({ params: { wordCount: 800, model: 'm' } }));
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('shows a "▸ N voices" tag for multi-voice sets', () => {
    renderRow(makeSet({ opeds: [member({ pov: 'skeptic' }), member({ pov: 'safetyist' })] }));
    expect(screen.getByText('▸ 2 voices')).toBeTruthy();
  });

  it('Open button fires onOpen with the set id', () => {
    const onOpen = vi.fn();
    renderRow(makeSet(), { onOpen });
    fireEvent.click(screen.getByRole('button', { name: /open/i }));
    expect(onOpen).toHaveBeenCalledWith('set-1');
  });

  it('Share button fires onShare', () => {
    const onShare = vi.fn();
    renderRow(makeSet(), { onShare });
    fireEvent.click(screen.getByRole('button', { name: /share/i }));
    expect(onShare).toHaveBeenCalled();
  });

  it('renders a select checkbox in edit mode', () => {
    renderRow(makeSet(), { editMode: true });
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
    render(<OpEdTable {...noopMyProps} rows={[makeSet()]} />);
    const table = screen.getByRole('table');
    expect(within(table).getByText('My Op-Eds')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: /headline/i })).toBeTruthy();
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
