// @vitest-environment jsdom
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2991 — double-click a row in the debate My table should open that debate.
// Prior: double-click had no row handler (only the title-cell rename handler).
// Fix: handleRowDoubleClick mirrors the Enter handler — desktop non-edit → onOpen,
// phone non-edit → onPhoneSelect, editMode → no-op.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { SessionRowData } from '../DebateTable';

vi.mock('@bridge', () => ({ api: {}, isElectronMode: () => false }));

import { DebateTableRow } from '../DebateTable';

const noop = vi.fn();
const s = { id: 'd1', title: 'Test Debate', created_at: '' } as unknown as SessionRowData;

function renderRow(opts: { editMode?: boolean; isPhone?: boolean; onOpen?: ReturnType<typeof vi.fn>; onPhoneSelect?: ReturnType<typeof vi.fn> } = {}) {
  const { editMode = false, isPhone = false, onOpen = noop, onPhoneSelect = noop } = opts;
  return render(
    <table><tbody>
      <DebateTableRow
        s={s} idx={0} totalRows={1} isActive={false}
        editMode={editMode} isSelected={false}
        onToggleSelect={noop} renamingId={null} setRenamingId={noop}
        renameValue="" setRenameValue={noop}
        onRename={async () => {}} onMoveSession={noop}
        onOpen={onOpen} onExport={noop} onShare={noop}
        onPhoneSelect={onPhoneSelect} isPhone={isPhone}
      />
    </tbody></table>,
  );
}

describe('DebateTableRow double-click (t/2991)', () => {
  it('double-clicking a row on desktop non-edit calls onOpen', () => {
    const onOpen = vi.fn();
    renderRow({ onOpen });
    fireEvent.dblClick(screen.getByRole('row'));
    expect(onOpen).toHaveBeenCalledWith('d1');
  });

  it('double-clicking a row on phone calls onPhoneSelect, not onOpen', () => {
    const onOpen = vi.fn();
    const onPhoneSelect = vi.fn();
    renderRow({ isPhone: true, onOpen, onPhoneSelect });
    fireEvent.dblClick(screen.getByRole('row'));
    expect(onPhoneSelect).toHaveBeenCalledWith(s);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('double-click in editMode does NOT call onOpen', () => {
    const onOpen = vi.fn();
    renderRow({ editMode: true, onOpen });
    fireEvent.dblClick(screen.getByRole('row'));
    expect(onOpen).not.toHaveBeenCalled();
  });
});
