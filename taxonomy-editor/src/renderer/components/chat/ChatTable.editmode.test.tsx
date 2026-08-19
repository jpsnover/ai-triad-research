// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2790#9 review condition: Edit-mode regression coverage for ChatTable (My variant).
// Locks the edit-mode contract from PR #1239: in edit mode each row swaps its
// actions for a Rename affordance, and row-click no longer opens a popout.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatTable } from './ChatTable';
import type { ChatSessionSummary } from '../../types/chat';

vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => ({ record: vi.fn() }) }));
vi.mock('./ChatExportDropdown', () => ({ ChatExportDropdown: () => <button type="button">Export</button> }));

const session = {
  id: 'chat-1',
  title: 'Alpha',
  created_at: '2026-08-01T10:00:00Z',
  updated_at: '2026-08-02T10:00:00Z',
  mode: 'brainstorm',
  pover: 'accelerationist',
  chat_model: 'model-x',
} as ChatSessionSummary;

function renderMy(editMode: boolean) {
  const onOpen = vi.fn();
  render(
    <ChatTable
      variant="my"
      rows={[session]}
      loading={false}
      searchQuery=""
      renamingId={null}
      setRenamingId={vi.fn()}
      renameValue=""
      setRenameValue={vi.fn()}
      onRename={vi.fn()}
      onOpen={onOpen}
      onExport={vi.fn()}
      onShare={vi.fn()}
      editMode={editMode}
    />,
  );
  return onOpen;
}

describe('ChatTable edit mode (t/2790#9)', () => {
  it('edit mode: Rename shown; Open and Share hidden', () => {
    renderMy(true);
    expect(screen.getByRole('button', { name: /rename "alpha"/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open "alpha"/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /share "alpha"/i })).not.toBeInTheDocument();
  });

  it('edit mode: row-click does not open a popout', () => {
    const onOpen = renderMy(true);
    fireEvent.click(screen.getByText('Alpha').closest('tr')!);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('normal mode: Open shown and row-click opens the chat', () => {
    const onOpen = renderMy(false);
    expect(screen.getByRole('button', { name: /open "alpha"/i })).toBeInTheDocument();
    fireEvent.click(screen.getByText('Alpha').closest('tr')!);
    expect(onOpen).toHaveBeenCalledWith('chat-1');
  });
});
