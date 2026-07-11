// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Node-scoped conflict list for POV taxonomy node detail pages (t/1505).
 * Shows every conflict that references a given node (label + description) and
 * lets the user jump to that conflict's detail view via `navigateToConflict`.
 *
 * These are research-domain conflicts (POV-camp disagreements), NOT the git
 * edit-conflict detection in `edit-conflicts/`.
 */

import { useMemo } from 'react';
import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import type { ConflictFile } from '../../types/taxonomy';
import './ConflictsPanel.css';

/**
 * Normalize `linked_taxonomy_nodes` across the legacy single-string shape and
 * the current `string[]` shape (production data has both — see conflict.schema.json).
 */
export function linkedNodeIds(conflict: ConflictFile): string[] {
  const raw = conflict.linked_taxonomy_nodes as unknown as string | string[] | null | undefined;
  return Array.isArray(raw) ? raw : raw ? [raw] : [];
}

/** Conflicts that reference `nodeId`, handling both `linked_taxonomy_nodes` shapes. */
export function conflictsForNode(conflicts: ConflictFile[], nodeId: string): ConflictFile[] {
  return conflicts.filter((c) => linkedNodeIds(c).includes(nodeId));
}

export function ConflictsPanel({ nodeId, onSelectConflict }: {
  nodeId: string;
  /** Optional parent notification when a conflict is chosen (before navigation). */
  onSelectConflict?: (claimId: string | null) => void;
}) {
  const conflicts = useTaxonomyStore((s) => s.conflicts);
  const navigateToConflict = useTaxonomyStore((s) => s.navigateToConflict);

  const matching = useMemo(() => conflictsForNode(conflicts, nodeId), [conflicts, nodeId]);

  if (matching.length === 0) {
    return <div className="conflicts-panel-empty">No conflicts reference this node.</div>;
  }

  return (
    <div className="conflicts-panel">
      <div className="conflicts-panel-count">
        {matching.length} conflict{matching.length !== 1 ? 's' : ''} reference this node
      </div>
      {matching.map((c) => (
        <button
          key={c.claim_id}
          type="button"
          className="conflicts-panel-item"
          onClick={() => { onSelectConflict?.(c.claim_id); navigateToConflict(c.claim_id); }}
          title={`Go to conflict: ${c.claim_label}`}
        >
          <span className="conflicts-panel-item-label">{c.claim_label}</span>
          {c.description && <span className="conflicts-panel-item-desc">{c.description}</span>}
          <span className="conflicts-panel-item-go" aria-hidden="true">{'→'}</span>
        </button>
      ))}
    </div>
  );
}
