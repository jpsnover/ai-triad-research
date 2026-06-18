// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Per-node edit-conflict indicator (Phase 5D, t/655). Marks a node the current
 * user edited that was *also* changed on `main` since divergence. Informational
 * only — it never blocks editing or saving.
 *
 * Distinct from the research-domain conflict UI in this directory: this badge
 * is about git edit/merge collisions between concurrent editors.
 */

import { useMemo } from 'react';
import type { NodeConflict } from './nodeConflictsApi';
import './EditConflictBadge.css';

interface EditConflictBadgeProps {
  /** The conflict for this node, from `useNodeConflicts().conflicts.get(id)`. */
  conflict: NodeConflict | undefined;
  /**
   * GitHub URL for resolving the conflict (the session branch's PR). Pass
   * `syncStatus.pr_url` — the same link SaveBar/UnsyncedChangesDrawer use.
   * Omit to hide the resolve affordance.
   */
  resolveUrl?: string | null;
}

function formatFields(fields: string[]): string {
  return fields.length ? fields.join(', ') : '—';
}

export function EditConflictBadge({ conflict, resolveUrl }: EditConflictBadgeProps) {
  // Fields touched on both sides — the true field-level collision.
  const overlap = useMemo(() => {
    if (!conflict) return [];
    const theirs = new Set(conflict.theirFields);
    return conflict.yourFields.filter((f) => theirs.has(f));
  }, [conflict]);

  if (!conflict) return null;

  const who = conflict.theirUser ?? 'another editor';
  const when = conflict.theirEditedAt ? new Date(conflict.theirEditedAt).toLocaleString() : null;
  const headline = overlap.length
    ? `You and ${who} both changed: ${formatFields(overlap)}`
    : `${who} also changed this node`;

  const title = [
    headline,
    `You changed: ${formatFields(conflict.yourFields)}`,
    `${who} changed: ${formatFields(conflict.theirFields)}`,
    when ? `Their edit: ${when}` : null,
  ].filter(Boolean).join('\n');

  // Only honor an https URL — defends the Electron renderer's external-navigation
  // surface against a javascript:/data: URL slipping through from the server.
  const safeResolveUrl = resolveUrl && /^https:\/\//i.test(resolveUrl) ? resolveUrl : null;

  return (
    <span className="edit-conflict-badge" role="status" title={title}>
      <span className="edit-conflict-badge-dot" aria-hidden="true" />
      <span className="edit-conflict-badge-label">Edited on main</span>
      {safeResolveUrl && (
        <a
          className="edit-conflict-badge-resolve"
          href={safeResolveUrl}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(e) => e.stopPropagation()}
          title="Resolve on GitHub"
        >
          Resolve on GitHub
        </a>
      )}
    </span>
  );
}
