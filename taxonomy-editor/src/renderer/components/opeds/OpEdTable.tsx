// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// OpEdTable — full-width semantic table for the My / Community op-ed libraries
// (t/2576 PR#1). Mirrors DebateTable's construction and a11y contract: semantic
// <table> + <th scope> + sr-only caption, a sort state machine, edit-mode
// checkbox column, and full-width colSpan empty/loading rows. One row per SET —
// a single-voice run is a set of 1; a multi-voice set shows N camp chips and a
// "▸ N voices" tag on the headline.

import { useState, useCallback, useEffect, useRef } from 'react';
import type { OpEdSet, OpEdCommunityEntry, PovKey } from '../../../../../lib/oped/types';
import { CampGlyph, povToCamp } from '../shared/CampGlyph';
import { POV_META } from '@lib/electron-shared/povMeta';
import './OpEdTable.css';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export type AuthStatus = { anonymous?: boolean } | null | undefined;

type SortColumn = 'headline' | 'camp' | 'outlet' | 'words' | 'date';
type SortDir = 'asc' | 'desc' | 'none';

interface SortState {
  col: SortColumn | null;
  dir: SortDir;
}

export interface OpEdTableMyProps {
  variant: 'my';
  rows: OpEdSet[];
  loading: boolean;
  searchQuery: string;
  editMode: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  renamingId: string | null;
  setRenamingId: (id: string | null) => void;
  renameValue: string;
  setRenameValue: (v: string) => void;
  onRename: (id: string, topic: string) => void;
  onOpen: (id: string) => void;
  onExport: (set: OpEdSet, format: string) => void;
  onShare: (set: OpEdSet) => void;
  onNew: () => void;
  selectedSetId: string | null;
  totalCount: number;
}

export interface OpEdTableCommunityProps {
  variant: 'community';
  rows: OpEdCommunityEntry[];
  loading: boolean;
  searchQuery: string;
  onOpen: (id: string) => void;
  onExport: (entry: OpEdCommunityEntry, format: string) => void;
  onCopy: (entry: OpEdCommunityEntry) => void;
  copyingId: string | null;
  auth: AuthStatus;
  /** Electron has no community library — render the web-only notice as empty state. */
  isElectron: boolean;
  selectedId: string | null;
  totalCount: number;
}

export type OpEdTableProps = OpEdTableMyProps | OpEdTableCommunityProps;

// ──────────────────────────────────────────────
// Helpers (exported for unit testing)
// ──────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Distinct camps in a set, in first-seen member order. */
export function opEdCamps(set: OpEdSet): PovKey[] {
  const seen = new Set<PovKey>();
  const out: PovKey[] = [];
  for (const m of set.opeds) {
    if (!seen.has(m.pov)) { seen.add(m.pov); out.push(m.pov); }
  }
  return out;
}

/** Total words across a set (single-voice = the one member's count). */
export function opEdWordCount(set: OpEdSet): number {
  return set.opeds.reduce((sum, m) => sum + (m.wordCount ?? 0), 0);
}

export function applySortMy(rows: OpEdSet[], sort: SortState): OpEdSet[] {
  if (!sort.col || sort.dir === 'none') return rows;
  const mul = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    switch (sort.col) {
      case 'headline': return mul * (a.topic ?? '').localeCompare(b.topic ?? '');
      case 'camp':     return mul * opEdCamps(a).join(',').localeCompare(opEdCamps(b).join(','));
      case 'outlet':   return mul * (a.params.outlet ?? '').localeCompare(b.params.outlet ?? '');
      case 'words':    return mul * (opEdWordCount(a) - opEdWordCount(b));
      case 'date':     return mul * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      default:         return 0;
    }
  });
}

export function applySortCommunity(rows: OpEdCommunityEntry[], sort: SortState): OpEdCommunityEntry[] {
  if (!sort.col || sort.dir === 'none') return rows;
  const mul = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    switch (sort.col) {
      case 'headline': return mul * (a.topic ?? '').localeCompare(b.topic ?? '');
      case 'camp':     return mul * (a.camps ?? []).join(',').localeCompare((b.camps ?? []).join(','));
      case 'date':     return mul * (new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime());
      default:         return 0; // outlet/words not carried on the community index entry
    }
  });
}

// ──────────────────────────────────────────────
// Camp chips
// ──────────────────────────────────────────────

function CampChips({ camps }: { camps: PovKey[] }) {
  return (
    <span className="oped-camp-chips">
      {camps.map(pov => {
        const camp = povToCamp(pov);
        return (
          <span
            key={pov}
            className="oped-camp-chip"
            title={POV_META[pov].label}
            // eslint-disable-next-line local/no-inline-style -- dynamic: camp accent color from POV_META cssVar (theme-aware)
            style={{ color: `var(${POV_META[pov].cssVar})` }}
          >
            {camp && <CampGlyph camp={camp} size={13} />}
            <span className="oped-camp-chip-label">{POV_META[pov].shortLabel}</span>
          </span>
        );
      })}
    </span>
  );
}

// ──────────────────────────────────────────────
// Sort header
// ──────────────────────────────────────────────

function getSortAttr(col: SortColumn, sort: SortState): 'ascending' | 'descending' | 'none' {
  if (sort.col !== col) return 'none';
  return sort.dir === 'asc' ? 'ascending' : 'descending';
}

function SortHeader({ label, col, sort, onSort }: {
  label: string; col: SortColumn; sort: SortState; onSort: (col: SortColumn) => void;
}) {
  const active = sort.col === col;
  const indicator = active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
  return (
    <button type="button" className="oped-table-sort-btn" onClick={() => onSort(col)}>
      {label}
      {indicator && <span className="oped-table-sort-indicator" aria-hidden="true">{indicator}</span>}
    </button>
  );
}

// ──────────────────────────────────────────────
// Export menu (Markdown / Plain text — client-side, no bridge in PR#1)
// ──────────────────────────────────────────────

function OpEdExportMenu({ onExport }: { onExport: (format: string) => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const pick = (format: string) => { setOpen(false); onExport(format); };

  // Escape + click-outside dismiss (t/2576#6 polish).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDocClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDocClick);
    };
  }, [open]);

  return (
    <span className="oped-export-menu" ref={wrapRef}>
      <button
        type="button"
        className="oped-table-action-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Export"
        onClick={() => setOpen(o => !o)}
      >
        Export ▾
      </button>
      {open && (
        <span role="menu" className="oped-export-menu-list">
          <button type="button" role="menuitem" className="oped-export-menu-item" onClick={() => pick('markdown')}>Markdown</button>
          <button type="button" role="menuitem" className="oped-export-menu-item" onClick={() => pick('text')}>Plain text</button>
        </span>
      )}
    </span>
  );
}

// ──────────────────────────────────────────────
// My row
// ──────────────────────────────────────────────

/** Headline cell — rename input while renaming, else clamped text + a secondary line. */
function OpEdHeadlineCell({
  headline, subtitle, voiceCount, isRenaming, editMode,
  renameValue, setRenameValue, onCommit, onCancel, onStartRename,
}: {
  headline: string;
  subtitle: string;
  voiceCount: number;
  isRenaming: boolean;
  editMode: boolean;
  renameValue: string;
  setRenameValue: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  onStartRename: () => void;
}) {
  if (isRenaming) {
    return (
      <input
        className="oped-table-rename-input"
        value={renameValue}
        autoFocus
        onClick={e => e.stopPropagation()}
        onChange={e => setRenameValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && renameValue.trim()) { e.stopPropagation(); onCommit(); }
          else if (e.key === 'Escape') onCancel();
        }}
        onBlur={onCommit}
      />
    );
  }
  const secondary = voiceCount > 1 ? `▸ ${voiceCount} voices` : subtitle;
  return (
    <>
      <div
        className="oped-table-headline-text"
        title={headline}
        onDoubleClick={!editMode ? (e) => { e.stopPropagation(); onStartRename(); } : undefined}
      >
        {headline}
      </div>
      {secondary && <div className="oped-table-headline-secondary">{secondary}</div>}
    </>
  );
}

export function OpEdMyRow({
  set, isActive, editMode, isSelected, onToggleSelect,
  renamingId, setRenamingId, renameValue, setRenameValue, onRename,
  onOpen, onExport, onShare,
}: {
  set: OpEdSet;
  isActive: boolean;
  editMode: boolean;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  renamingId: string | null;
  setRenamingId: (id: string | null) => void;
  renameValue: string;
  setRenameValue: (v: string) => void;
  onRename: (id: string, topic: string) => void;
  onOpen: (id: string) => void;
  onExport: (set: OpEdSet, format: string) => void;
  onShare: (set: OpEdSet) => void;
}) {
  const camps = opEdCamps(set);
  const words = opEdWordCount(set);
  const voiceCount = set.opeds.length;
  const isRenaming = renamingId === set.set_id;
  const headline = set.topic || 'Untitled op-ed';
  const subtitle = voiceCount === 1 ? (set.opeds[0]?.subtitle ?? '') : '';

  const handleRowClick = useCallback(() => {
    if (editMode) onToggleSelect(set.set_id);
    // Desktop non-edit: row click is inert; the Open button drives the reader.
  }, [editMode, onToggleSelect, set.set_id]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key === 'Enter' && !editMode) {
      e.preventDefault();
      onOpen(set.set_id);
    }
  }, [editMode, onOpen, set.set_id]);

  const commitRename = useCallback(() => {
    const v = renameValue.trim();
    if (v && v !== headline) onRename(set.set_id, v);
    setRenamingId(null);
  }, [renameValue, headline, onRename, set.set_id, setRenamingId]);

  return (
    <tr
      className={[isActive ? 'selected' : '', editMode && isSelected ? 'bulk-selected' : ''].filter(Boolean).join(' ')}
      aria-current={isActive ? 'true' : undefined}
      tabIndex={0}
      onClick={handleRowClick}
      onKeyDown={handleKeyDown}
    >
      {editMode && (
        <td className="col-cb" onClick={e => e.stopPropagation()}>
          <input
            type="checkbox"
            aria-label={`Select ${headline}`}
            checked={isSelected}
            onChange={() => onToggleSelect(set.set_id)}
          />
        </td>
      )}

      {/* Headline — flexible column, wraps then clamps */}
      <td className="col-headline">
        <OpEdHeadlineCell
          headline={headline}
          subtitle={subtitle}
          voiceCount={voiceCount}
          isRenaming={isRenaming}
          editMode={editMode}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          onCommit={commitRename}
          onCancel={() => setRenamingId(null)}
          onStartRename={() => { setRenamingId(set.set_id); setRenameValue(headline); }}
        />
      </td>

      {/* Camp */}
      <td className="col-camp"><CampChips camps={camps} /></td>

      {/* Outlet */}
      <td className="col-outlet" title={set.params.outlet ?? undefined}>{set.params.outlet || '—'}</td>

      {/* Words */}
      <td className="col-words">{words > 0 ? words : '—'}</td>

      {/* Date */}
      <td className="col-date" title={set.created_at}>{formatDate(set.created_at)}</td>

      {/* Actions */}
      <td className="col-actions" onClick={e => e.stopPropagation()}>
        <div className="oped-table-actions">
          <button
            type="button"
            className="oped-table-action-btn primary"
            title="Open op-ed"
            aria-label={`Open "${headline}"`}
            onClick={() => onOpen(set.set_id)}
          >
            Open
          </button>
          <OpEdExportMenu onExport={fmt => onExport(set, fmt)} />
          <button
            type="button"
            className="oped-table-action-btn"
            title="Share to community"
            aria-label={`Share "${headline}" to community`}
            onClick={() => onShare(set)}
          >
            Share
          </button>
        </div>
      </td>
    </tr>
  );
}

// ──────────────────────────────────────────────
// Community row
// ──────────────────────────────────────────────

export function OpEdCommunityRow({
  entry, isSelected, onOpen, onExport, onCopy, copyingId, showCopy,
}: {
  entry: OpEdCommunityEntry;
  isSelected: boolean;
  onOpen: (id: string) => void;
  onExport: (entry: OpEdCommunityEntry, format: string) => void;
  onCopy: (entry: OpEdCommunityEntry) => void;
  copyingId: string | null;
  showCopy: boolean;
}) {
  const isCopying = copyingId === entry.id;
  const headline = entry.topic || 'Untitled op-ed';
  const voiceCount = entry.voice_count ?? entry.camps.length;

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); onOpen(entry.id); }
  }, [onOpen, entry.id]);

  return (
    <tr
      className={isSelected ? 'selected' : ''}
      aria-current={isSelected ? 'true' : undefined}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <td className="col-headline">
        <div className="oped-table-headline-text" title={headline}>{headline}</div>
        {voiceCount > 1 && <div className="oped-table-headline-secondary">▸ {voiceCount} voices</div>}
      </td>
      <td className="col-camp"><CampChips camps={entry.camps} /></td>
      <td className="col-outlet">—</td>
      <td className="col-words">—</td>
      <td className="col-date" title={entry.updated_at}>{formatDate(entry.updated_at)}</td>
      <td className="col-actions" onClick={e => e.stopPropagation()}>
        <div className="oped-table-actions">
          <button
            type="button"
            className="oped-table-action-btn primary"
            title="Open op-ed"
            aria-label={`Open "${headline}"`}
            onClick={() => onOpen(entry.id)}
          >
            Open
          </button>
          <OpEdExportMenu onExport={fmt => onExport(entry, fmt)} />
          {showCopy && (
            <button
              type="button"
              className="oped-table-action-btn"
              title="Copy to My op-eds"
              aria-label={`Copy "${headline}" to My op-eds`}
              disabled={isCopying}
              onClick={() => onCopy(entry)}
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
// Table shell
// ──────────────────────────────────────────────

function useSort(): [SortState, (col: SortColumn) => void] {
  const [sort, setSort] = useState<SortState>({ col: 'date', dir: 'desc' });
  const onSort = useCallback((col: SortColumn) => {
    setSort(prev => {
      if (prev.col !== col) return { col, dir: 'asc' };
      if (prev.dir === 'asc') return { col, dir: 'desc' };
      if (prev.dir === 'desc') return { col: null, dir: 'none' };
      return { col, dir: 'asc' };
    });
  }, []);
  return [sort, onSort];
}

export function OpEdTable(props: OpEdTableProps) {
  if (props.variant === 'my') return <MyTable {...props} />;
  return <CommunityTable {...props} />;
}

function MyTable(props: OpEdTableMyProps) {
  const {
    rows, loading, searchQuery, editMode, selectedIds, onToggleSelect,
    renamingId, setRenamingId, renameValue, setRenameValue, onRename,
    onOpen, onExport, onShare, onNew, selectedSetId,
  } = props;
  const [sort, onSort] = useSort();
  const sortedRows = applySortMy(rows, sort);
  const colSpan = editMode ? 7 : 6;

  return (
    <div className="oped-table-wrap" role="region" aria-label="My op-eds table">
      <table className="oped-table">
        <caption className="sr-only">My Op-Eds</caption>
        <colgroup>
          {editMode && <col className="col-cb" />}
          <col className="col-headline" />
          <col className="col-camp" />
          <col className="col-outlet" />
          <col className="col-words" />
          <col className="col-date" />
          <col className="col-actions" />
        </colgroup>
        <thead>
          <tr>
            {editMode && <th scope="col" className="col-cb" aria-label="Select row" />}
            <th scope="col" className="col-headline" aria-sort={getSortAttr('headline', sort)}>
              <SortHeader label="Headline" col="headline" sort={sort} onSort={onSort} />
            </th>
            <th scope="col" className="col-camp" aria-sort={getSortAttr('camp', sort)}>
              <SortHeader label="Camp" col="camp" sort={sort} onSort={onSort} />
            </th>
            <th scope="col" className="col-outlet" aria-sort={getSortAttr('outlet', sort)}>
              <SortHeader label="Outlet" col="outlet" sort={sort} onSort={onSort} />
            </th>
            <th scope="col" className="col-words" aria-sort={getSortAttr('words', sort)}>
              <SortHeader label="Words" col="words" sort={sort} onSort={onSort} />
            </th>
            <th scope="col" className="col-date" aria-sort={getSortAttr('date', sort)}>
              <SortHeader label="Date" col="date" sort={sort} onSort={onSort} />
            </th>
            <th scope="col" className="col-actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          {loading && rows.length === 0 && (
            <tr><td colSpan={colSpan} className="oped-table-empty-cell">Loading…</td></tr>
          )}
          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={colSpan} className="oped-table-empty-cell">
                No op-eds yet. Create one to draft a guest essay in a camp voice.
                <div className="oped-table-empty-action">
                  <button type="button" className="btn btn-sm" onClick={onNew}>+ New Op-Ed</button>
                </div>
              </td>
            </tr>
          )}
          {searchQuery && sortedRows.length === 0 && rows.length > 0 && (
            <tr><td colSpan={colSpan} className="oped-table-empty-cell">No op-eds match &ldquo;{searchQuery}&rdquo;</td></tr>
          )}
          {sortedRows.map(set => (
            <OpEdMyRow
              key={set.set_id}
              set={set}
              isActive={set.set_id === selectedSetId}
              editMode={editMode}
              isSelected={selectedIds.has(set.set_id)}
              onToggleSelect={onToggleSelect}
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

function CommunityTable(props: OpEdTableCommunityProps) {
  const { rows, loading, searchQuery, onOpen, onExport, onCopy, copyingId, auth, isElectron, selectedId } = props;
  const [sort, onSort] = useSort();
  const showCopy = !auth?.anonymous;

  // Electron has no community library — show the web-only notice as the empty state.
  if (!loading && rows.length === 0 && isElectron) {
    return (
      <div className="oped-session-empty">
        Community op-eds are only available in the web app — open it in your browser to browse and search shared op-eds.
      </div>
    );
  }

  const sortedRows = applySortCommunity(rows, sort);

  return (
    <div className="oped-table-wrap" role="region" aria-label="Community op-eds table">
      <table className="oped-table">
        <caption className="sr-only">Community Op-Eds</caption>
        <colgroup>
          <col className="col-headline" />
          <col className="col-camp" />
          <col className="col-outlet" />
          <col className="col-words" />
          <col className="col-date" />
          <col className="col-actions" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="col-headline" aria-sort={getSortAttr('headline', sort)}>
              <SortHeader label="Headline" col="headline" sort={sort} onSort={onSort} />
            </th>
            <th scope="col" className="col-camp" aria-sort={getSortAttr('camp', sort)}>
              <SortHeader label="Camp" col="camp" sort={sort} onSort={onSort} />
            </th>
            <th scope="col" className="col-outlet">Outlet</th>
            <th scope="col" className="col-words">Words</th>
            <th scope="col" className="col-date" aria-sort={getSortAttr('date', sort)}>
              <SortHeader label="Date" col="date" sort={sort} onSort={onSort} />
            </th>
            <th scope="col" className="col-actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          {loading && rows.length === 0 && (
            <tr><td colSpan={6} className="oped-table-empty-cell">Loading community op-eds…</td></tr>
          )}
          {!loading && rows.length === 0 && (
            <tr><td colSpan={6} className="oped-table-empty-cell">No community op-eds available yet.</td></tr>
          )}
          {searchQuery && sortedRows.length === 0 && rows.length > 0 && (
            <tr><td colSpan={6} className="oped-table-empty-cell">No community op-eds match &ldquo;{searchQuery}&rdquo;</td></tr>
          )}
          {sortedRows.map(entry => (
            <OpEdCommunityRow
              key={entry.id}
              entry={entry}
              isSelected={selectedId === entry.id}
              onOpen={onOpen}
              onExport={onExport}
              onCopy={onCopy}
              copyingId={copyingId}
              showCopy={showCopy}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
