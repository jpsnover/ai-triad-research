// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// OpEdTab — Op-Ed Studio shell (t/2576 PR#1). Mirrors DebateTab's two-column →
// table-mode information architecture: a My / Community split, a full-width table,
// and per-row Open / Export / Share (My) or Open / Export / Copy (Community). An
// op-ed is static text, so "Open" reads it inline (no popout) — selecting a set
// swaps the workspace to OpEdReader with a back control.
//
// Create is PR#2 — the "+ New Op-Ed" button is present but DISABLED here (t/2570#3).

import { useEffect, useState, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { api, isElectronMode } from '@bridge';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { useAuthStatus } from '../../hooks/useAuthStatus';
import { useOpEdStore } from '../../hooks/useOpEdStore';
import { useCommunityStore } from '../../hooks/useCommunityStore';
import type { OpEdSet, OpEdCommunityEntry } from '../../../../../lib/oped/types';
import { OpEdTable } from './OpEdTable';
import { OpEdReader } from './OpEdReader';
import { NewOpEdDialog } from './NewOpEdDialog';
import './OpEdTab.css';

function recordError(component: string, message: string, err: unknown): void {
  getGlobalRecorder()?.record({
    type: 'system.error',
    component,
    level: 'error',
    message,
    error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
  });
}

// ── Client-side export (PR#1 has no export bridge — assemble the set as text) ──

function buildOpEdMarkdown(set: OpEdSet): string {
  const lines: string[] = [];
  set.opeds.forEach((m, i) => {
    if (i > 0) lines.push('\n---\n');
    lines.push(`# ${m.headline}`);
    if (m.subtitle) lines.push(`\n*${m.subtitle}*`);
    lines.push('');
    if (m.status !== 'complete') {
      lines.push(`_(This voice ${m.status === 'failed' ? 'failed to generate' : 'was cancelled'}.)_`);
      return;
    }
    lines.push(m.body);
    if (m.pitch) { lines.push('\n---\n\n## Pitch cover email\n'); lines.push(m.pitch); }
    if (m.grounding.length > 0) {
      lines.push('\n---\n\n## Taxonomy grounding\n');
      lines.push('| Element | Type | Relevance | Reflected in the op-ed |');
      lines.push('|---|---|---|---|');
      for (const g of m.grounding) {
        const type = g.node_id.startsWith('sit-') ? 'Situation' : 'BDI';
        lines.push(`| ${g.node_id} | ${type} | ${g.relevance || '—'} | ${g.how_reflected || '(not reported)'} |`);
      }
    }
  });
  return lines.join('\n');
}

function buildOpEdText(set: OpEdSet): string {
  // Strip the lightest Markdown syntax for a plain-text rendering.
  return buildOpEdMarkdown(set).replace(/^#+\s*/gm, '').replace(/[*_`]/g, '');
}

function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function slugify(s: string): string {
  return (s || 'op-ed').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'op-ed';
}

function exportOpEdSet(set: OpEdSet, format: string): void {
  if (format === 'text') downloadFile(`${slugify(set.topic)}.txt`, buildOpEdText(set), 'text/plain');
  else downloadFile(`${slugify(set.topic)}.md`, buildOpEdMarkdown(set), 'text/markdown');
}

function filterSets(sets: OpEdSet[], q: string): OpEdSet[] {
  if (!q) return sets;
  return sets.filter(s => s.topic.toLowerCase().includes(q) || s.opeds.some(m => m.headline.toLowerCase().includes(q)));
}

function filterCommunity(entries: OpEdCommunityEntry[], q: string): OpEdCommunityEntry[] {
  if (!q) return entries;
  return entries.filter(c => c.topic.toLowerCase().includes(q));
}

// ── Header actions (Edit / bulk-delete / disabled + New) ──────────────────────

function OpEdHeaderActions({
  listView, editMode, hasSets, selectedCount, isElectron,
  onBulkDelete, onClearSelected, onExitEdit, onEnterEdit, onNew,
}: {
  listView: 'my' | 'community';
  editMode: boolean;
  hasSets: boolean;
  selectedCount: number;
  isElectron: boolean;
  onBulkDelete: () => void;
  onClearSelected: () => void;
  onExitEdit: () => void;
  onEnterEdit: () => void;
  onNew: () => void;
}) {
  if (listView !== 'my') return null;
  if (editMode) {
    return (
      <div className="list-panel-header-actions">
        {selectedCount > 0 && (
          <button className="btn btn-sm btn-danger" onClick={onBulkDelete}>Delete {selectedCount}</button>
        )}
        <button className="btn btn-sm btn-ghost" onClick={onClearSelected}>None</button>
        <button className="btn btn-sm btn-ghost" onClick={onExitEdit}>Done</button>
      </div>
    );
  }
  return (
    <div className="list-panel-header-actions">
      {hasSets && (
        <button className="btn btn-sm btn-ghost" onClick={onEnterEdit} title="Rename or delete op-eds">Edit</button>
      )}
      {/* Create (PR#2) — Electron only; web keeps the disabled desktop-app affordance. */}
      {isElectron ? (
        <button className="btn btn-sm" onClick={onNew} aria-label="New op-ed">
          + New Op-Ed
        </button>
      ) : (
        <button
          className="btn btn-sm"
          disabled
          title="Available in the desktop app"
          aria-label="New op-ed (available in the desktop app)"
        >
          + New Op-Ed
        </button>
      )}
    </div>
  );
}

// ── Reader view (back bar + article/loading/error) ────────────────────────────

function OpEdReaderView({
  readerSet, readerLoading, readerError, status, onBack,
}: {
  readerSet: OpEdSet | null;
  readerLoading: boolean;
  readerError: string | null;
  status: string | null;
  onBack: () => void;
}) {
  return (
    <div className="two-column oped-tab-table-mode">
      <div className="oped-reader-shell">
        <div className="oped-reader-bar">
          <button type="button" className="oped-reader-back" onClick={onBack}>‹ Op-Eds</button>
          {status && <span className="oped-status">{status}</span>}
        </div>
        {readerLoading && <p className="oped-reader-loading">Loading op-ed…</p>}
        {readerError && <p className="oped-reader-error">{readerError}</p>}
        {readerSet && !readerLoading && <OpEdReader set={readerSet} />}
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function OpEdTab() {
  const {
    sets, loading, editMode, selectedIds, selectedSetId,
    loadSets, selectSet, renameSet, setEditMode, toggleSelected, clearSelected, deleteSelected,
  } = useOpEdStore(useShallow(s => ({
    sets: s.sets, loading: s.loading, editMode: s.editMode, selectedIds: s.selectedIds, selectedSetId: s.selectedSetId,
    loadSets: s.loadSets, selectSet: s.selectSet, renameSet: s.renameSet, setEditMode: s.setEditMode,
    toggleSelected: s.toggleSelected, clearSelected: s.clearSelected, deleteSelected: s.deleteSelected,
  })));
  const { opeds: communityOpeds, communityLoading, fetchOpeds, submitItem, copyItem } = useCommunityStore(useShallow(s => ({
    opeds: s.opeds, communityLoading: s.loading, fetchOpeds: s.fetchOpeds, submitItem: s.submitItem, copyItem: s.copyItem,
  })));

  const auth = useAuthStatus();
  const breakpoint = useBreakpoint();
  const isPhone = breakpoint === 'phone' || breakpoint === 'phone-lg';
  const isElectron = isElectronMode();

  const [listView, setListView] = useState<'my' | 'community'>('my');
  const [searchQuery, setSearchQuery] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);

  // The set currently open in the reader — may come from the personal store (My)
  // or a community load (Community). null = table view.
  const [readerSet, setReaderSet] = useState<OpEdSet | null>(null);
  const [readerLoading, setReaderLoading] = useState(false);
  const [readerError, setReaderError] = useState<string | null>(null);

  useEffect(() => {
    void loadSets();
    void fetchOpeds();
  }, [loadSets, fetchOpeds]);

  const flash = useCallback((msg: string) => {
    setStatus(msg);
    setTimeout(() => setStatus(null), 4000);
  }, []);

  const exitEditMode = useCallback(() => { setEditMode(false); setRenamingId(null); }, [setEditMode]);

  // ── Reader open/close ──

  const openMy = useCallback((id: string) => {
    const found = sets.find(s => s.set_id === id) ?? null;
    if (!found) return;
    selectSet(id);
    setReaderError(null);
    setReaderSet(found);
  }, [sets, selectSet]);

  const openCommunity = useCallback((id: string) => {
    selectSet(id);
    setReaderError(null);
    setReaderLoading(true);
    api.loadCommunityOpEd(id).then(set => {
      setReaderSet(set);
    }).catch(err => {
      recordError('oped-tab', 'Failed to load community op-ed', err);
      setReaderError('Could not load this op-ed — it may have been removed.');
    }).finally(() => setReaderLoading(false));
  }, [selectSet]);

  const closeReader = useCallback(() => {
    selectSet(null);
    setReaderSet(null);
    setReaderError(null);
  }, [selectSet]);

  // A fresh create (PR#2) — reload the library, then open the new set in the reader.
  const handleCreated = useCallback(async (setId: string) => {
    setListView('my');
    await loadSets();
    const found = useOpEdStore.getState().sets.find(s => s.set_id === setId) ?? null;
    selectSet(setId);
    setReaderError(null);
    setReaderSet(found);
  }, [loadSets, selectSet]);

  // ── Row actions ──

  const handleRename = useCallback((id: string, topic: string) => {
    renameSet(id, topic).catch(err => {
      recordError('oped-tab', 'Failed to rename op-ed', err);
      flash(`Rename failed: ${err}`);
    });
  }, [renameSet, flash]);

  const handleShare = useCallback((set: OpEdSet) => {
    submitItem('oped', set).then(() => flash('Shared to community.')).catch(err => {
      recordError('oped-tab', 'Failed to share op-ed to community', err);
      flash(`Share failed: ${err}`);
    });
  }, [submitItem, flash]);

  const handleExportMy = useCallback((set: OpEdSet, format: string) => {
    try {
      exportOpEdSet(set, format);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'oped-tab', level: 'error', message: 'Failed to export op-ed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      flash(`Export failed: ${err}`);
    }
  }, [flash]);

  const handleExportCommunity = useCallback((entry: OpEdCommunityEntry, format: string) => {
    // The community index entry lacks the full body — load, then export.
    api.loadCommunityOpEd(entry.id).then(set => exportOpEdSet(set, format)).catch(err => {
      recordError('oped-tab', 'Failed to export community op-ed', err);
      flash(`Export failed: ${err}`);
    });
  }, [flash]);

  const handleCopy = useCallback((entry: OpEdCommunityEntry) => {
    setCopyingId(entry.id);
    copyItem('opeds', entry.id).then(() => { void loadSets(); flash('Copied to My op-eds.'); }).catch(err => {
      recordError('oped-tab', 'Failed to copy community op-ed', err);
      flash(`Copy failed: ${err}`);
    }).finally(() => setCopyingId(null));
  }, [copyItem, loadSets, flash]);

  const handleBulkDelete = useCallback(() => {
    deleteSelected().catch(err => {
      recordError('oped-tab', 'Failed to delete selected op-eds', err);
      flash(`Delete failed: ${err}`);
    });
  }, [deleteSelected, flash]);

  // ── Filtering ──

  const q = searchQuery.trim().toLowerCase();
  const filteredSets = filterSets(sets, q);
  const filteredCommunity = filterCommunity(communityOpeds, q);

  const isTableMode = !isPhone;

  // ── Reader view ──

  if (selectedSetId && (readerSet || readerLoading || readerError)) {
    return (
      <OpEdReaderView
        readerSet={readerSet}
        readerLoading={readerLoading}
        readerError={readerError}
        status={status}
        onBack={closeReader}
      />
    );
  }

  // ── Table view ──

  return (
    <div className={['two-column', isTableMode ? 'oped-tab-table-mode' : ''].filter(Boolean).join(' ')}>
      <div className="list-panel oped-list-panel">
        <div className="list-panel-header">
          <h2>Op-Eds</h2>
          <OpEdHeaderActions
            listView={listView}
            editMode={editMode}
            hasSets={sets.length > 0}
            selectedCount={selectedIds.size}
            isElectron={isElectron}
            onBulkDelete={handleBulkDelete}
            onClearSelected={clearSelected}
            onExitEdit={exitEditMode}
            onEnterEdit={() => setEditMode(true)}
            onNew={() => setShowNewDialog(true)}
          />
        </div>

        <div className="list-view-tabs">
          <button
            className={`list-view-tab${listView === 'my' ? ' active' : ''}`}
            onClick={() => { setListView('my'); exitEditMode(); }}
          >
            My ({sets.length})
          </button>
          <button
            className={`list-view-tab${listView === 'community' ? ' active' : ''}`}
            onClick={() => { setListView('community'); exitEditMode(); }}
          >
            Community ({communityOpeds.length})
          </button>
        </div>

        <div className="oped-search-wrap">
          <input
            type="text"
            className="oped-search-input"
            placeholder={listView === 'my' ? 'Search op-eds…' : 'Search community op-eds…'}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>

        {status && listView && <div className="oped-status oped-status-inline">{status}</div>}

        {listView === 'my' ? (
          <OpEdTable
            variant="my"
            rows={filteredSets}
            loading={loading}
            searchQuery={searchQuery}
            editMode={editMode}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelected}
            renamingId={renamingId}
            setRenamingId={setRenamingId}
            renameValue={renameValue}
            setRenameValue={setRenameValue}
            onRename={handleRename}
            onOpen={openMy}
            onExport={handleExportMy}
            onShare={handleShare}
            onNew={() => setShowNewDialog(true)}
            selectedSetId={selectedSetId}
            totalCount={sets.length}
          />
        ) : (
          <OpEdTable
            variant="community"
            rows={filteredCommunity}
            loading={communityLoading}
            searchQuery={searchQuery}
            onOpen={openCommunity}
            onExport={handleExportCommunity}
            onCopy={handleCopy}
            copyingId={copyingId}
            auth={auth}
            isElectron={isElectron}
            selectedId={selectedSetId}
            totalCount={communityOpeds.length}
          />
        )}
      </div>

      {isElectron && (
        <NewOpEdDialog
          open={showNewDialog}
          onClose={() => setShowNewDialog(false)}
          onCreated={setId => { void handleCreated(setId); }}
        />
      )}
    </div>
  );
}
