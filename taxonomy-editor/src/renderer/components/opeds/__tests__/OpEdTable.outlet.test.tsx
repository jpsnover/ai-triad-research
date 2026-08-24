// @vitest-environment jsdom
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2993 — Outlet column was missing from op-ed My and Community tables.
// Fix: OpEdSetSummary + OpEdCommunityEntry gain outlet?; forwarded from params.outlet
// at finalize/index-build time; applySortMy + applySortCommunity handle 'outlet';
// both rows render outlet value, not hardcoded '—'.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { applySortMy, applySortCommunity } from '../OpEdTable';
import type { OpEdSetSummary, OpEdCommunityEntry } from '../../../../../../lib/oped/types';

vi.mock('@bridge', () => ({ api: {}, isElectronMode: () => false }));

import { OpEdMyRow, OpEdCommunityRow } from '../OpEdTable';

const noop = vi.fn();

function makeSet(overrides: Partial<OpEdSetSummary> = {}): OpEdSetSummary {
  return {
    set_id: 's1',
    topic: 'Test',
    voice_count: 1,
    camps: [],
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ── applySortMy outlet sort ───────────────────────────────────────────────────

describe('applySortMy outlet sort (t/2993)', () => {
  const rows = [
    makeSet({ set_id: 'a', outlet: 'NYT' }),
    makeSet({ set_id: 'b', outlet: 'Atlantic' }),
    makeSet({ set_id: 'c', outlet: undefined }),
  ];

  it('sorts by outlet asc (missing outlet sorts first as empty string)', () => {
    const sorted = applySortMy(rows, { col: 'outlet', dir: 'asc' });
    expect(sorted.map(r => r.set_id)).toEqual(['c', 'b', 'a']);
  });

  it('sorts by outlet desc', () => {
    const sorted = applySortMy(rows, { col: 'outlet', dir: 'desc' });
    expect(sorted.map(r => r.set_id)).toEqual(['a', 'b', 'c']);
  });
});

// ── OpEdMyRow outlet rendering ────────────────────────────────────────────────

function renderRow(set: OpEdSetSummary) {
  return render(
    <table><tbody>
      <OpEdMyRow
        set={set} idx={0} totalRows={1} isActive={false}
        editMode={false} isSelected={false}
        onToggleSelect={noop} renamingId={null} setRenamingId={noop}
        renameValue="" setRenameValue={noop}
        onRename={noop} onMoveSet={noop}
        onOpen={noop} onExport={noop} onShare={noop}
      />
    </tbody></table>,
  );
}

describe('OpEdMyRow outlet cell (t/2993)', () => {
  it('renders the outlet value when present', () => {
    renderRow(makeSet({ outlet: 'The Atlantic' }));
    expect(screen.getByRole('row').textContent).toContain('The Atlantic');
  });

  it('renders — when outlet is absent', () => {
    renderRow(makeSet({ outlet: undefined }));
    expect(screen.getByRole('row').textContent).toContain('—');
  });
});

// ── Community view ────────────────────────────────────────────────────────────

function makeCommunityEntry(overrides: Partial<OpEdCommunityEntry> = {}): OpEdCommunityEntry {
  return {
    id: 'c1',
    topic: 'Test',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    camps: [],
    voice_count: 1,
    community_metadata: null,
    ...overrides,
  };
}

describe('applySortCommunity outlet sort (t/2993)', () => {
  const rows = [
    makeCommunityEntry({ id: 'a', outlet: 'NYT' }),
    makeCommunityEntry({ id: 'b', outlet: 'Atlantic' }),
    makeCommunityEntry({ id: 'c', outlet: undefined }),
  ];

  it('sorts by outlet asc', () => {
    const sorted = applySortCommunity(rows, { col: 'outlet', dir: 'asc' });
    expect(sorted.map(r => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('sorts by outlet desc', () => {
    const sorted = applySortCommunity(rows, { col: 'outlet', dir: 'desc' });
    expect(sorted.map(r => r.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('OpEdCommunityRow outlet cell (t/2993)', () => {
  function renderCommunityRow(entry: OpEdCommunityEntry) {
    return render(
      <table><tbody>
        <OpEdCommunityRow
          entry={entry} isSelected={false}
          onOpen={noop} onExport={noop} onCopy={noop}
          copyingId={null} showCopy={false}
        />
      </tbody></table>,
    );
  }

  it('renders the outlet value when present', () => {
    renderCommunityRow(makeCommunityEntry({ outlet: 'The Atlantic' }));
    expect(screen.getByRole('row').textContent).toContain('The Atlantic');
  });

  it('renders — when outlet is absent', () => {
    renderCommunityRow(makeCommunityEntry({ outlet: undefined }));
    expect(screen.getByRole('row').textContent).toContain('—');
  });
});
