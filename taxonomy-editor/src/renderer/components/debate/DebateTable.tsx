// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// DebateTable — shared semantic table for My and Community debate lists (t/2305).
// Replaces DebateMyList / DebateCommunityList card layouts with full-width tables.

import { useState, useCallback } from 'react';
import type { CommunityDebate } from '../../hooks/useCommunityStore';
import { ExportDropdown } from './ExportDropdown';
import './DebateTable.css';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

/** Shape of a My-debate row — matches DebateSessionSummary from main/debateIO.ts. */
export interface SessionRowData {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  phase: string;
  topic_text?: string;
  model?: string;
  turn_count?: number;
}

export type AuthStatus = { anonymous?: boolean } | null | undefined;

type SortColumn = 'title' | 'status' | 'date' | 'turns' | 'model';
type SortDir = 'asc' | 'desc' | 'none';

interface SortState {
  col: SortColumn | null;
  dir: SortDir;
}

// ──────────────────────────────────────────────
// Props — My variant
// ──────────────────────────────────────────────

export interface DebateTableMyProps {
  variant: 'my';
  rows: SessionRowData[];
  loading: boolean;
  searchQuery: string;
  editMode: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  renamingId: string | null;
  setRenamingId: (id: string | null) => void;
  renameValue: string;
  setRenameValue: (v: string) => void;
  onRename: (id: string, newTitle: string) => Promise<void>;
  onMoveSession: (id: string, dir: 'up' | 'down') => void;
  onOpen: (id: string) => void;
  onExport: (session: SessionRowData, format: string) => void;
  onShare: (session: SessionRowData) => void;
  /** Phone nav: row click pushes mobile navigation (desktop: noop). */
  onPhoneSelect: (session: SessionRowData) => void;
  isPhone: boolean;
  activeDebateId: string | null;
  /** Default = custom order (null). Set to a column to override. */
  totalCount: number; // for aria context
}

// ──────────────────────────────────────────────
// Props — Community variant
// ──────────────────────────────────────────────

export interface DebateTableCommunityProps {
  variant: 'community';
  rows: CommunityDebate[];
  loading: boolean;
  searchQuery: string;
  selectedId: string | null;
  onOpen: (id: string) => void;
  onExport: (cd: CommunityDebate, format: string) => void;
  onCopy: (cd: CommunityDebate) => Promise<void>;
  copyingId: string | null;
  auth: AuthStatus;
  /** Phone nav: row click pushes mobile navigation (desktop: noop). */
  onPhoneSelect: (cd: CommunityDebate) => void;
  isPhone: boolean;
  totalCount: number;
}

export type DebateTableProps = DebateTableMyProps | DebateTableCommunityProps;

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

const PHASE_LABELS: Record<string, string> = {
  setup: 'Setup',
  clarification: 'Refining',
  'edit-claims': 'Editing',
  opening: 'Opening',
  debate: 'Active',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function applySortMy(rows: SessionRowData[], sort: SortState): SessionRowData[] {
  if (!sort.col || sort.dir === 'none') return rows;
  const mul = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    switch (sort.col) {
      case 'title':  return mul * a.title.localeCompare(b.title);
      case 'status': return mul * (a.phase ?? '').localeCompare(b.phase ?? '');
      case 'date':   return mul * (new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime());
      case 'turns':  return mul * ((a.turn_count ?? 0) - (b.turn_count ?? 0));
      case 'model':  return mul * (a.model ?? '').localeCompare(b.model ?? '');
      default:       return 0;
    }
  });
}

function applySortCommunity(rows: CommunityDebate[], sort: SortState): CommunityDebate[] {
  if (!sort.col || sort.dir === 'none') return rows;
  const mul = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    switch (sort.col) {
      case 'title':  return mul * a.title.localeCompare(b.title);
      case 'status': return mul * (a.phase ?? '').localeCompare(b.phase ?? '');
      case 'date':   return mul * (new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime());
      case 'turns':  return mul * ((a.turn_count ?? 0) - (b.turn_count ?? 0));
      case 'model':  return mul * (a.model ?? '').localeCompare(b.model ?? '');
      default:       return 0;
    }
  });
}

// ──────────────────────────────────────────────
// StatusPill
// ──────────────────────────────────────────────

function StatusPill({ phase }: { phase: string | undefined }) {
  if (!phase) return <span className="debate-status-pill">—</span>;
  const label = PHASE_LABELS[phase] || phase;
  return (
    <span className="debate-status-pill">
      <span className="debate-status-pill-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

// ──────────────────────────────────────────────
// SortHeader
// ──────────────────────────────────────────────

/** Returns the aria-sort value for a <th> — must be placed on the th, not the button. */
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
  const indicator = active
    ? (sort.dir === 'asc' ? ' ▲' : ' ▼')
    : '';
  return (
    <button
      type="button"
      className="debate-table-sort-btn"
      onClick={() => onSort(col)}
    >
      {label}
      {indicator && <span className="debate-table-sort-indicator" aria-hidden="true">{indicator}</span>}
    </button>
  );
}

// ──────────────────────────────────────────────
// ColGroup
// ──────────────────────────────────────────────

function MyColGroup({ editMode }: { editMode: boolean }) {
  return (
    <colgroup>
      {editMode && <col className="col-cb" />}
      <col className="col-title" />
      <col className="col-status" />
      <col className="col-date" />
      <col className="col-turns" />
      <col className="col-model" />
      <col className="col-actions" />
    </colgroup>
  );
}

function CommunityColGroup() {
  return (
    <colgroup>
      <col className="col-title" />
      <col className="col-status" />
      <col className="col-date" />
      <col className="col-turns" />
      <col className="col-model" />
      <col className="col-actions" />
    </colgroup>
  );
}

// ──────────────────────────────────────────────
// DebateTableRow — My tab
// ──────────────────────────────────────────────

interface DebateTableRowProps {
  s: SessionRowData;
  idx: number;
  totalRows: number;
  isActive: boolean;
  editMode: boolean;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  renamingId: string | null;
  setRenamingId: (id: string | null) => void;
  renameValue: string;
  setRenameValue: (v: string) => void;
  onRename: (id: string, newTitle: string) => Promise<void>;
  onMoveSession: (id: string, dir: 'up' | 'down') => void;
  onOpen: (id: string) => void;
  onExport: (session: SessionRowData, format: string) => void;
  onShare: (session: SessionRowData) => void;
  onPhoneSelect: (session: SessionRowData) => void;
  isPhone: boolean;
}

export function DebateTableRow({
  s, idx, totalRows, isActive, editMode, isSelected,
  onToggleSelect, renamingId, setRenamingId, renameValue, setRenameValue,
  onRename, onMoveSession, onOpen, onExport, onShare, onPhoneSelect, isPhone,
}: DebateTableRowProps) {
  const isRenaming = renamingId === s.id;
  const colSpan = editMode ? 7 : 6;
  // Defensive guard: extractSummary may return title as {final,original} if debateIO.ts is
  // invoked before the t/2334 fix is present on disk. Coerce to string so React never sees
  // an object. The main-process FR log in debateIO.ts captures the corruption event.
  const rawTitle: unknown = s.title;
  const safeTitle = typeof rawTitle === 'string' ? rawTitle
    : (rawTitle as { final?: string; original?: string })?.final
      ?? (rawTitle as { final?: string; original?: string })?.original
      ?? 'Untitled';

  const handleRowClick = useCallback(() => {
    if (editMode) {
      onToggleSelect(s.id);
    } else if (isPhone) {
      onPhoneSelect(s);
    }
    // Desktop non-edit: row click does nothing; Open button launches popout.
  }, [editMode, isPhone, s, onToggleSelect, onPhoneSelect]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key === 'Enter' && !editMode) {
      e.preventDefault();
      if (isPhone) {
        onPhoneSelect(s);
      } else {
        onOpen(s.id);
      }
    }
  }, [editMode, isPhone, s, onPhoneSelect, onOpen]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    // Double-click title cell to rename (only when not in edit-mode bulk flow)
    e.stopPropagation();
    setRenamingId(s.id);
    setRenameValue(safeTitle);
  }, [s, setRenamingId, setRenameValue]);

  const commitRename = useCallback(() => {
    if (renameValue.trim() && renameValue.trim() !== safeTitle) {
      void onRename(s.id, renameValue.trim());
    }
    setRenamingId(null);
  }, [renameValue, s, onRename, setRenamingId]);

  return (
    <tr
      className={[
        isActive ? 'selected' : '',
        editMode && isSelected ? 'bulk-selected' : '',
      ].filter(Boolean).join(' ')}
      aria-current={isActive ? 'true' : undefined}
      tabIndex={0}
      onClick={handleRowClick}
      onKeyDown={handleKeyDown}
    >
      {editMode && (
        <td className="col-cb" onClick={e => e.stopPropagation()}>
          <input
            type="checkbox"
            aria-label={`Select ${safeTitle}`}
            checked={isSelected}
            onChange={() => onToggleSelect(s.id)}
          />
        </td>
      )}

      {/* Title */}
      <td className="col-title">
        {isRenaming ? (
          <input
            className="debate-table-rename-input"
            value={renameValue}
            autoFocus
            onClick={e => e.stopPropagation()}
            onChange={e => setRenameValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && renameValue.trim()) {
                e.stopPropagation();
                commitRename();
              } else if (e.key === 'Escape') {
                setRenamingId(null);
              }
            }}
            onBlur={commitRename}
          />
        ) : (
          <div
            className="debate-table-title-text"
            title={safeTitle}
            onDoubleClick={!editMode ? handleDoubleClick : undefined}
          >
            {safeTitle}
          </div>
        )}
        {/* Model shown as secondary line on tablet (col hidden) */}
        {s.model && (
          <div className="debate-table-title-secondary model-secondary">
            {s.model}
          </div>
        )}
      </td>

      {/* Status */}
      <td className="col-status">
        <StatusPill phase={s.phase} />
      </td>

      {/* Date */}
      <td className="col-date" title={s.updated_at}>
        {formatDate(s.updated_at)}
      </td>

      {/* Turns */}
      <td className="col-turns">
        {s.turn_count != null ? s.turn_count : '—'}
      </td>

      {/* Model */}
      <td className="col-model" title={s.model}>
        {s.model || '—'}
      </td>

      {/* Actions */}
      <td className="col-actions" onClick={e => e.stopPropagation()}>
        {editMode ? (
          <div className="debate-table-actions">
            <button
              type="button"
              className="debate-table-action-btn"
              title="Rename"
              aria-label={`Rename "${safeTitle}"`}
              onClick={() => { setRenamingId(s.id); setRenameValue(safeTitle); }}
            >
              &#9998;
            </button>
            <button
              type="button"
              className="debate-table-action-btn"
              title="Move up"
              aria-label={`Move "${safeTitle}" up`}
              disabled={idx === 0}
              onClick={() => onMoveSession(s.id, 'up')}
            >
              &#9650;
            </button>
            <button
              type="button"
              className="debate-table-action-btn"
              title="Move down"
              aria-label={`Move "${safeTitle}" down`}
              disabled={idx === totalRows - 1}
              onClick={() => onMoveSession(s.id, 'down')}
            >
              &#9660;
            </button>
          </div>
        ) : (
          <div className="debate-table-actions">
            <button
              type="button"
              className="debate-table-action-btn primary"
              title="Open in popout window"
              aria-label={`Open "${safeTitle}" in window`}
              onClick={() => onOpen(s.id)}
            >
              Open
            </button>
            <ExportDropdown onExport={fmt => onExport(s, fmt)} />
            <button
              type="button"
              className="debate-table-action-btn"
              title="Share to community"
              aria-label={`Share "${safeTitle}" to community`}
              onClick={() => onShare(s)}
            >
              Share
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

// ──────────────────────────────────────────────
// CommunityTableRow
// ──────────────────────────────────────────────

interface CommunityTableRowProps {
  cd: CommunityDebate;
  isSelected: boolean;
  onOpen: (id: string) => void;
  onExport: (cd: CommunityDebate, format: string) => void;
  onCopy: (cd: CommunityDebate) => Promise<void>;
  copyingId: string | null;
  showCopy: boolean;
  onPhoneSelect: (cd: CommunityDebate) => void;
  isPhone: boolean;
}

export function CommunityTableRow({
  cd, isSelected, onOpen, onExport, onCopy, copyingId, showCopy,
  onPhoneSelect, isPhone,
}: CommunityTableRowProps) {
  const isCopying = copyingId === cd.id;

  const handleRowClick = useCallback(() => {
    if (isPhone) onPhoneSelect(cd);
    // Desktop: row click selects (for accessibility), Open button launches popout
  }, [isPhone, cd, onPhoneSelect]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (isPhone) {
        onPhoneSelect(cd);
      } else {
        onOpen(cd.id);
      }
    }
  }, [isPhone, cd, onPhoneSelect, onOpen]);

  const submitter = cd.community_metadata?.submitted_by_display;

  return (
    <tr
      className={isSelected ? 'selected' : ''}
      aria-current={isSelected ? 'true' : undefined}
      tabIndex={0}
      onClick={handleRowClick}
      onKeyDown={handleKeyDown}
    >
      {/* Title */}
      <td className="col-title">
        <div className="debate-table-title-text" title={cd.title}>
          {cd.title}
        </div>
        {submitter && (
          <div className="debate-table-title-secondary">
            by {submitter}
          </div>
        )}
      </td>

      {/* Status */}
      <td className="col-status">
        <StatusPill phase={cd.phase} />
      </td>

      {/* Date */}
      <td className="col-date" title={cd.updated_at}>
        {formatDate(cd.updated_at)}
      </td>

      {/* Turns */}
      <td className="col-turns">
        {cd.turn_count != null ? cd.turn_count : '—'}
      </td>

      {/* Model */}
      <td className="col-model">
        {cd.model || '—'}
      </td>

      {/* Actions */}
      <td className="col-actions" onClick={e => e.stopPropagation()}>
        <div className="debate-table-actions">
          <button
            type="button"
            className="debate-table-action-btn primary"
            title="Open in popout window"
            aria-label={`Open "${cd.title}" in window`}
            onClick={() => onOpen(cd.id)}
          >
            Open
          </button>
          <ExportDropdown onExport={fmt => onExport(cd, fmt)} />
          {showCopy && (
            <button
              type="button"
              className="debate-table-action-btn"
              title="Copy to My debates"
              aria-label={`Copy "${cd.title}" to My debates`}
              disabled={isCopying}
              onClick={() => { void onCopy(cd); }}
            >
              {isCopying ? 'Copying…' : 'Copy'}
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ──────────────────────────────────────────────
// DebateTable — main export
// ──────────────────────────────────────────────

export function DebateTable(props: DebateTableProps) {
  const defaultSortDir: SortDir = props.variant === 'community' ? 'desc' : 'none';
  const defaultSortCol: SortColumn | null = props.variant === 'community' ? 'date' : null;

  const [sort, setSort] = useState<SortState>({ col: defaultSortCol, dir: defaultSortDir });

  const handleSort = useCallback((col: SortColumn) => {
    setSort(prev => {
      if (prev.col !== col) return { col, dir: 'asc' };
      if (prev.dir === 'asc') return { col, dir: 'desc' };
      if (prev.dir === 'desc') return { col: null, dir: 'none' }; // clear sort
      return { col, dir: 'asc' };
    });
  }, []);

  if (props.variant === 'my') {
    return <MyTable {...props} sort={sort} onSort={handleSort} />;
  }
  return <CommunityTable {...props} sort={sort} onSort={handleSort} />;
}

// ──────────────────────────────────────────────
// MyTable
// ──────────────────────────────────────────────

function MyTable(props: DebateTableMyProps & { sort: SortState; onSort: (col: SortColumn) => void }) {
  const {
    rows, loading, searchQuery, editMode, selectedIds, onToggleSelect,
    renamingId, setRenamingId, renameValue, setRenameValue, onRename,
    onMoveSession, onOpen, onExport, onShare, onPhoneSelect, isPhone,
    activeDebateId, sort, onSort,
  } = props;

  const sortedRows = applySortMy(rows, sort);
  const colSpanTotal = editMode ? 7 : 6;

  return (
    <div className="debate-table-wrap" role="region" aria-label="My debates table">
      <table className="debate-table" role="grid">
        <caption className="sr-only">My Debates</caption>
        <MyColGroup editMode={editMode} />
        <thead>
          <tr>
            {editMode && <th scope="col" className="col-cb" aria-label="Select row" />}
            <th scope="col" className="col-title" aria-sort={getSortAttr('title', sort)}>
              <SortHeader label="Title" col="title" sort={sort} onSort={onSort} />
            </th>
            <th scope="col" className="col-status" aria-sort={getSortAttr('status', sort)}>
              <SortHeader label="Status" col="status" sort={sort} onSort={onSort} />
            </th>
            <th scope="col" className="col-date" aria-sort={getSortAttr('date', sort)}>
              <SortHeader label="Date" col="date" sort={sort} onSort={onSort} />
            </th>
            <th scope="col" className="col-turns" aria-sort={getSortAttr('turns', sort)}>
              <SortHeader label="Turns" col="turns" sort={sort} onSort={onSort} />
            </th>
            <th scope="col" className="col-model" aria-sort={getSortAttr('model', sort)}>
              <SortHeader label="Model" col="model" sort={sort} onSort={onSort} />
            </th>
            <th scope="col" className="col-actions">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {loading && rows.length === 0 && (
            <tr>
              <td colSpan={colSpanTotal} className="debate-table-empty-cell">
                Loading…
              </td>
            </tr>
          )}
          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={colSpanTotal} className="debate-table-empty-cell">
                No debates yet. Click <strong>+ New</strong> to start one.
              </td>
            </tr>
          )}
          {searchQuery && sortedRows.length === 0 && rows.length > 0 && (
            <tr>
              <td colSpan={colSpanTotal} className="debate-table-empty-cell">
                No debates match &ldquo;{searchQuery}&rdquo;
              </td>
            </tr>
          )}
          {sortedRows.map((s, idx) => (
            <DebateTableRow
              key={s.id}
              s={s}
              idx={idx}
              totalRows={sortedRows.length}
              isActive={s.id === activeDebateId}
              editMode={editMode}
              isSelected={selectedIds.has(s.id)}
              onToggleSelect={onToggleSelect}
              renamingId={renamingId}
              setRenamingId={setRenamingId}
              renameValue={renameValue}
              setRenameValue={setRenameValue}
              onRename={onRename}
              onMoveSession={onMoveSession}
              onOpen={onOpen}
              onExport={onExport}
              onShare={onShare}
              onPhoneSelect={onPhoneSelect}
              isPhone={isPhone}
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
  props: DebateTableCommunityProps & { sort: SortState; onSort: (col: SortColumn) => void },
) {
  const {
    rows, loading, searchQuery, selectedId, onOpen, onExport, onCopy,
    copyingId, auth, onPhoneSelect, isPhone, sort, onSort,
  } = props;

  const sortedRows = applySortCommunity(rows, sort);
  const showCopy = !auth?.anonymous;

  return (
    <div className="debate-table-wrap" role="region" aria-label="Community debates table">
      <table className="debate-table" role="grid">
        <caption className="sr-only">Community Debates</caption>
        <CommunityColGroup />
        <thead>
          <tr>
            <th scope="col" className="col-title" aria-sort={getSortAttr('title', sort)}>
              <SortHeader label="Title" col="title" sort={sort} onSort={onSort} />
            </th>
            <th scope="col" className="col-status" aria-sort={getSortAttr('status', sort)}>
              <SortHeader label="Status" col="status" sort={sort} onSort={onSort} />
            </th>
            <th scope="col" className="col-date" aria-sort={getSortAttr('date', sort)}>
              <SortHeader label="Date" col="date" sort={sort} onSort={onSort} />
            </th>
            <th scope="col" className="col-turns" aria-sort={getSortAttr('turns', sort)}>
              <SortHeader label="Turns" col="turns" sort={sort} onSort={onSort} />
            </th>
            <th scope="col" className="col-model" aria-sort={getSortAttr('model', sort)}>
              <SortHeader label="Model" col="model" sort={sort} onSort={onSort} />
            </th>
            <th scope="col" className="col-actions">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {loading && rows.length === 0 && (
            <tr>
              <td colSpan={6} className="debate-table-empty-cell">
                Loading community debates…
              </td>
            </tr>
          )}
          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={6} className="debate-table-empty-cell">
                No community debates available yet.
              </td>
            </tr>
          )}
          {searchQuery && sortedRows.length === 0 && rows.length > 0 && (
            <tr>
              <td colSpan={6} className="debate-table-empty-cell">
                No community debates match &ldquo;{searchQuery}&rdquo;
              </td>
            </tr>
          )}
          {sortedRows.map(cd => (
            <CommunityTableRow
              key={cd.id}
              cd={cd}
              isSelected={selectedId === cd.id}
              onOpen={onOpen}
              onExport={onExport}
              onCopy={onCopy}
              copyingId={copyingId}
              showCopy={showCopy}
              onPhoneSelect={onPhoneSelect}
              isPhone={isPhone}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
