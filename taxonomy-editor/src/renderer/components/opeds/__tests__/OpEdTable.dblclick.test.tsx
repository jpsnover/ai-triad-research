// @vitest-environment jsdom
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2991 — double-click a row in the op-ed My table should open that op-ed.
// Prior: double-click had no handler, so no effect. Fix: handleRowDoubleClick
// mirrors the Enter handler (open in non-edit mode, no-op in edit mode).

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { OpEdSetSummary } from '../../../../../../lib/oped/types';

vi.mock('@bridge', () => ({ api: {}, isElectronMode: () => false }));

import { OpEdMyRow } from '../OpEdTable';

const noop = vi.fn();
const set = { set_id: 's1', topic: 'Test Op-Ed', voice_count: 1, camps: [], created_at: '' } as unknown as OpEdSetSummary;

function renderRow(editMode: boolean, onOpen = noop) {
  return render(
    <table><tbody>
      <OpEdMyRow
        set={set} idx={0} totalRows={1} isActive={false}
        editMode={editMode} isSelected={false}
        onToggleSelect={noop} renamingId={null} setRenamingId={noop}
        renameValue="" setRenameValue={noop}
        onRename={noop} onMoveSet={noop}
        onOpen={onOpen} onExport={noop} onShare={noop}
      />
    </tbody></table>,
  );
}

describe('OpEdMyRow double-click (t/2991)', () => {
  it('double-clicking a row in non-edit mode calls onOpen', () => {
    const onOpen = vi.fn();
    renderRow(false, onOpen);
    fireEvent.dblClick(screen.getByRole('row'));
    expect(onOpen).toHaveBeenCalledWith('s1');
  });

  it('single-click does NOT call onOpen', () => {
    const onOpen = vi.fn();
    renderRow(false, onOpen);
    fireEvent.click(screen.getByRole('row'));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('double-click in editMode does NOT call onOpen', () => {
    const onOpen = vi.fn();
    renderRow(true, onOpen);
    fireEvent.dblClick(screen.getByRole('row'));
    expect(onOpen).not.toHaveBeenCalled();
  });
});
