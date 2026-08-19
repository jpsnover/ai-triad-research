// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// ChatTable — sortable My/Community table for the chat tool (t/2783).
// Mirrors DebateTable.tsx structure; columns differ (Created/Updated/Mode/POV/Model/Actions/Title).

import { useState, useCallback, useEffect } from 'react';
import type { CommunityChat } from '../../hooks/useCommunityStore';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { POVER_INFO } from '../../types/debate';
import type { ChatSessionSummary } from '../../types/chat';
import { ChatExportDropdown } from './ChatExportDropdown';
import './ChatTable.css';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type SortColumn = 'created' | 'updated' | 'mode' | 'pov' | 'model' | 'title';
type SortDir = 'asc' | 'desc' | 'none';

interface SortState {
  col: SortColumn | null;
  dir: SortDir;
}

export interface ChatTableMyProps {
  variant: 'my';
  rows: ChatSessionSummary[];
  loading: boolean;
  searchQuery: string;
  renamingId: string | null;
  setRenamingId: (id: string | null) => void;
  renameValue: string;
  setRenameValue: (v: string) => void;
  onRename: (id: string, newTitle: string) => Promise<void>;
  onOpen: (id: string) => void;
  onExport: (id: string, format: string) => void;
  onShare: (session: ChatSessionSummary) => void;
}

export interface ChatTableCommunityProps {
  variant: 'community';
  rows: CommunityChat[];
  loading: boolean;
  searchQuery: string;
  onOpen: (id: string) => void;
  onExport: (id: string, format: string) => void;
  onCopy: (cc: CommunityChat) => Promise<void>;
  copyingId: string | null;
}

export type ChatTableProps = ChatTableMyProps | ChatTableCommunityProps;

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function applySortMy(rows: ChatSessionSummary[], sort: SortState): ChatSessionSummary[] {
  if (!sort.col || sort.dir === 'none') return rows;
  const mul = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    switch (sort.col) {
      case 'created': return mul * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      case 'updated': return mul * (new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime());
      case 'mode':    return mul * (a.mode ?? '').localeCompare(b.mode ?? '');
      case 'pov':     return mul * (a.pover ?? '').localeCompare(b.pover ?? '');
      case 'model':   return mul * (a.chat_model ?? '').localeCompare(b.chat_model ?? '');
      case 'title':   return mul * (a.title ?? '').localeCompare(b.title ?? '');
      default:        return 0;
    }
  });
}

function applySortCommunity(rows: CommunityChat[], sort: SortState): CommunityChat[] {
  if (!sort.col || sort.dir === 'none') return rows;
  const mul = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    switch (sort.col) {
      case 'created': return mul * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      case 'updated': return mul * (new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime());
      case 'mode':    return mul * (a.mode ?? '').localeCompare(b.mode ?? '');
      case 'model':   return mul * (a.model ?? '').localeCompare(b.model ?? '');
      case 'title':   return mul * (a.title ?? '').localeCompare(b.title ?? '');
      default:        return 0;
    }
  });
}

// ──────────────────────────────────────────────
// SortHeader
// ──────────────────────────────────────────────

function getSortAttr(col: SortColumn, sort: SortState): 'ascending' | 'descending' | 'none' {
  if (sort.col !== col) return 'none';
  return sort.dir === 'asc' ? 'ascending' : 'descending';
}

function SortHeader({
  label, col, sort, onSort,
}: {
  label: string;
  col: SortColumn;
  sort: SortState;
  onSort: (col: SortColumn) => void;
}) {
  const active = sort.col === col;
  const indicator = active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
  return (
    <button type="button" className="chat-table-sort-btn" onClick={() => onSort(col)}>
      {label}
      {indicator && <span className="chat-table-sort-indicator" aria-hidden="true">{indicator}</span>}
    </button>
  );
}

// ──────────────────────────────────────────────
// ChatTableRow — My variant
// ──────────────────────────────────────────────

interface ChatTableRowMyProps {
  s: ChatSessionSummary;
  renamingId: string | null;
  setRenamingId: (id: string | null) => void;
  renameValue: string;
  setRenameValue: (v: string) => void;
  onRename: (id: string, newTitle: string) => Promise<void>;
  onOpen: (id: string) => void;
  onExport: (id: string, format: string) => void;
  onShare: (session: ChatSessionSummary) => void;
}

function ChatTableRowMy({
  s, renamingId, setRenamingId, renameValue, setRenameValue,
  onRename, onOpen, onExport, onShare,
}: ChatTableRowMyProps) {
  const isRenaming = renamingId === s.id;
  const safeTitle = s.title || 'Untitled';
  const poverLabel = POVER_INFO[s.pover as keyof typeof POVER_INFO]?.label || s.pover || '—';

  const commitRename = useCallback(() => {
    if (renameValue.trim() && renameValue.trim() !== safeTitle) {
      void onRename(s.id, renameValue.trim());
    }
    setRenamingId(null);
  }, [renameValue, s, onRename, setRenamingId, safeTitle]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingId(s.id);
    setRenameValue(safeTitle);
  }, [s, setRenamingId, setRenameValue, safeTitle]);

  return (
    <tr>
      <td className="col-created" title={s.created_at}>{formatDate(s.created_at)}</td>
      <td className="col-updated" title={s.updated_at}>{formatDate(s.updated_at)}</td>
      <td className="col-mode">{s.mode || '—'}</td>
      <td className="col-pov">{poverLabel}</td>
      <td className="col-model" title={s.chat_model}>{s.chat_model || '—'}</td>
      <td className="col-actions" onClick={e => e.stopPropagation()}>
        <div className="chat-table-actions">
          <button
            type="button"
            className="chat-table-action-btn primary"
            title="Open in popout window"
            aria-label={`Open "${safeTitle}" in window`}
            onClick={() => onOpen(s.id)}
          >
            Open
          </button>
          <ChatExportDropdown onExport={fmt => onExport(s.id, fmt)} />
          <button
            type="button"
            className="chat-table-action-btn"
            title="Share to community"
            aria-label={`Share "${safeTitle}" to community`}
            onClick={() => onShare(s)}
          >
            Share
          </button>
        </div>
      </td>
      <td className="col-title">
        {isRenaming ? (
          <input
            className="chat-table-rename-input"
            value={renameValue}
            autoFocus
            onClick={e => e.stopPropagation()}
            onChange={e => setRenameValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && renameValue.trim()) { e.stopPropagation(); commitRename(); }
              else if (e.key === 'Escape') setRenamingId(null);
            }}
            onBlur={commitRename}
          />
        ) : (
          <div
            className="chat-table-title-text"
            title={safeTitle}
            onDoubleClick={handleDoubleClick}
          >
            {safeTitle}
          </div>
        )}
      </td>
    </tr>
  );
}

// ──────────────────────────────────────────────
// CommunityTableRow
// ──────────────────────────────────────────────

function ChatTableRowCommunity({
  cc, onOpen, onExport, onCopy, copyingId,
}: {
  cc: CommunityChat;
  onOpen: (id: string) => void;
  onExport: (id: string, format: string) => void;
  onCopy: (cc: CommunityChat) => Promise<void>;
  copyingId: string | null;
}) {
  const isCopying = copyingId === cc.id;
  return (
    <tr>
      <td className="col-created" title={cc.created_at}>{formatDate(cc.created_at)}</td>
      <td className="col-updated" title={cc.updated_at}>{formatDate(cc.updated_at)}</td>
      <td className="col-mode">{cc.mode || '—'}</td>
      <td className="col-pov">—</td>
      <td className="col-model">{cc.model || '—'}</td>
      <td className="col-actions" onClick={e => e.stopPropagation()}>
        <div className="chat-table-actions">
          <button
            type="button"
            className="chat-table-action-btn primary"
            title="Open in popout window"
            aria-label={`Open "${cc.title}" in window`}
            onClick={() => onOpen(cc.id)}
          >
            Open
          </button>
          <ChatExportDropdown onExport={fmt => onExport(cc.id, fmt)} />
          <button
            type="button"
            className="chat-table-action-btn"
            title="Copy to My chats"
            aria-label={`Copy "${cc.title}" to My chats`}
            disabled={isCopying}
            onClick={() => { void onCopy(cc); }}
          >
            {isCopying ? 'Copying…' : 'Copy'}
          </button>
        </div>
      </td>
      <td className="col-title">
        <div className="chat-table-title-text" title={cc.title}>{cc.title}</div>
        {cc.community_metadata?.submitted_by_display && (
          <div className="chat-table-title-secondary">
            by {cc.community_metadata.submitted_by_display}
          </div>
        )}
      </td>
    </tr>
  );
}

// ──────────────────────────────────────────────
// ChatTable — main export
// ──────────────────────────────────────────────

export function ChatTable(props: ChatTableProps) {
  const defaultDir: SortDir = props.variant === 'community' ? 'desc' : 'none';
  const defaultCol: SortColumn | null = props.variant === 'community' ? 'updated' : null;
  const [sort, setSort] = useState<SortState>({ col: defaultCol, dir: defaultDir });

  useEffect(() => {
    if (defaultCol) {
      getGlobalRecorder()?.record({
        type: 'user.action',
        component: 'ChatTable',
        level: 'info',
        message: 'sort-default',
        data: { col: defaultCol, dir: defaultDir, variant: props.variant },
      });
    }
  }, []); // mount-only

  const handleSort = useCallback((col: SortColumn) => {
    setSort(prev => {
      let next: SortState;
      if (prev.col !== col) next = { col, dir: 'asc' };
      else if (prev.dir === 'asc') next = { col, dir: 'desc' };
      else if (prev.dir === 'desc') next = { col: null, dir: 'none' };
      else next = { col, dir: 'asc' };
      getGlobalRecorder()?.record({
        type: 'user.action',
        component: 'ChatTable',
        level: 'info',
        message: 'sort-click',
        data: { col: next.col, dir: next.dir, variant: props.variant },
      });
      return next;
    });
  }, [props.variant]);

  if (props.variant === 'my') {
    return <MyTable {...props} sort={sort} onSort={handleSort} />;
  }
  return <CommunityTable {...props} sort={sort} onSort={handleSort} />;
}

// ──────────────────────────────────────────────
// MyTable
// ──────────────────────────────────────────────

function MyTable(props: ChatTableMyProps & { sort: SortState; onSort: (col: SortColumn) => void }) {
  const {
    rows, loading, searchQuery, renamingId, setRenamingId, renameValue, setRenameValue,
    onRename, onOpen, onExport, onShare, sort, onSort,
  } = props;
  const sorted = applySortMy(rows, sort);

  return (
    <div className="chat-table-wrap" role="region" aria-label="My chats table">
      <table className="chat-table" role="grid">
        <caption className="sr-only">My Chats</caption>
        <colgroup>
          <col className="col-created" />
          <col className="col-updated" />
          <col className="col-mode" />
          <col className="col-pov" />
          <col className="col-model" />
          <col className="col-actions" />
          <col className="col-title" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="col-created" aria-sort={getSortAttr('created', sort)}>
              <SortHeader label="Created" col="created" sort={sort} onSort={onSort} />
            </th>
            <th scope="col" className="col-updated" aria-sort={getSortAttr('updated', sort)}>
              <SortHeader label="Updated" col="updated" sort={sort} onSort={onSort} />
            </th>
            <th scope="col" className="col-mode" aria-sort={getSortAttr('mode', sort)}>
              <SortHeader label="Mode" col="mode" sort={sort} onSort={onSort} />
            </th>
            <th scope="col" className="col-pov" aria-sort={getSortAttr('pov', sort)}>
              <SortHeader label="POV" col="pov" sort={sort} onSort={onSort} />
            </th>
            <th scope="col" className="col-model" aria-sort={getSortAttr('model', sort)}>
              <SortHeader label="Model" col="model" sort={sort} onSort={onSort} />
            </th>
            <th scope="col" className="col-actions">Actions</th>
            <th scope="col" className="col-title" aria-sort={getSortAttr('title', sort)}>
              <SortHeader label="Title" col="title" sort={sort} onSort={onSort} />
            </th>
          </tr>
        </thead>
        <tbody>
          {loading && rows.length === 0 && (
            <tr><td colSpan={7} className="chat-table-empty-cell">Loading…</td></tr>
          )}
          {!loading && rows.length === 0 && (
            <tr><td colSpan={7} className="chat-table-empty-cell">No chats yet. Click <strong>+ New</strong> to start one.</td></tr>
          )}
          {searchQuery && sorted.length === 0 && rows.length > 0 && (
            <tr><td colSpan={7} className="chat-table-empty-cell">No chats match &ldquo;{searchQuery}&rdquo;</td></tr>
          )}
          {sorted.map(s => (
            <ChatTableRowMy
              key={s.id}
              s={s}
              renamingId={renamingId}
              setRenamingId={setRenamingId}
              renameValue={renameValue}
              setRenameValue={setRenameValue}
              onRename={onRename}
              onOpen={onOpen}
              onExport={onExport}
              onShare={onShare}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ──────────────────────────────────────────────
// CommunityTable
// ──────────────────────────────────────────────

function CommunityTable(
  props: ChatTableCommunityProps & { sort: SortState; onSort: (col: SortColumn) => void },
) {
  const { rows, loading, searchQuery, onOpen, onExport, onCopy, copyingId, sort, onSort } = props;
  const sorted = applySortCommunity(rows, sort);

  return (
    <div className="chat-table-wrap" role="region" aria-label="Community chats table">
      <table className="chat-table" role="grid">
        <caption className="sr-only">Community Chats</caption>
        <colgroup>
          <col className="col-created" />
          <col className="col-updated" />
          <col className="col-mode" />
          <col className="col-pov" />
          <col className="col-model" />
          <col className="col-actions" />
          <col className="col-title" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="col-created" aria-sort={getSortAttr('created', sort)}>
              <SortHeader label="Created" col="created" sort={sort} onSort={onSort} />
            </th>
            <th scope="col" className="col-updated" aria-sort={getSortAttr('updated', sort)}>
              <SortHeader label="Updated" col="updated" sort={sort} onSort={onSort} />
            </th>
            <th scope="col" className="col-mode" aria-sort={getSortAttr('mode', sort)}>
              <SortHeader label="Mode" col="mode" sort={sort} onSort={onSort} />
            </th>
            <th scope="col" className="col-pov">POV</th>
            <th scope="col" className="col-model" aria-sort={getSortAttr('model', sort)}>
              <SortHeader label="Model" col="model" sort={sort} onSort={onSort} />
            </th>
            <th scope="col" className="col-actions">Actions</th>
            <th scope="col" className="col-title" aria-sort={getSortAttr('title', sort)}>
              <SortHeader label="Title" col="title" sort={sort} onSort={onSort} />
            </th>
          </tr>
        </thead>
        <tbody>
          {loading && rows.length === 0 && (
            <tr><td colSpan={7} className="chat-table-empty-cell">Loading community chats…</td></tr>
          )}
          {!loading && rows.length === 0 && (
            <tr><td colSpan={7} className="chat-table-empty-cell">No community chats available yet.</td></tr>
          )}
          {searchQuery && sorted.length === 0 && rows.length > 0 && (
            <tr><td colSpan={7} className="chat-table-empty-cell">No community chats match &ldquo;{searchQuery}&rdquo;</td></tr>
          )}
          {sorted.map(cc => (
            <ChatTableRowCommunity
              key={cc.id}
              cc={cc}
              onOpen={onOpen}
              onExport={onExport}
              onCopy={onCopy}
              copyingId={copyingId}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
