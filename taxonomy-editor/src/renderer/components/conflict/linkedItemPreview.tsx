// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Bottom "selected item" preview for ConflictDetail (t/1568). Clicking a linked
 * taxonomy-node row or a related-policy row selects it and reveals its detail in
 * a single shared region at the bottom of the panel — an in-place preview so the
 * user can inspect the referenced item without leaving the conflict.
 *
 * Nodes reuse the shared `LinkedNodePreview`; policies get a lightweight id +
 * action view (supporters/opposers deferred — not cheaply available client-side).
 */

import { LinkedNodePreview } from '../shared/LinkedNodePreview';

export type SelectedLinkedItem =
  | { kind: 'node'; id: string }
  | { kind: 'policy'; id: string; action: string };

/** Toggle single-item selection: clicking the already-selected item clears it. */
export function toggleLinkedSelection(
  current: SelectedLinkedItem | null,
  clicked: SelectedLinkedItem,
): SelectedLinkedItem | null {
  if (current && current.kind === clicked.kind && current.id === clicked.id) return null;
  return clicked;
}

export interface LinkedItemPreviewProps {
  item: SelectedLinkedItem;
  onClose: () => void;
  /** For nodes: jump to the node's full tab (preserves the navigate feature). */
  onOpenInTab?: () => void;
}

export function LinkedItemPreview({ item, onClose, onOpenInTab }: LinkedItemPreviewProps) {
  return (
    <section className="cd-preview" aria-label="Selected item detail">
      <div className="cd-preview-head">
        <span className="cd-preview-kind">{item.kind === 'node' ? 'NODE' : 'POLICY'}</span>
        <span className="cd-preview-id">{item.id}</span>
        <div className="cd-preview-actions">
          {item.kind === 'node' && onOpenInTab && (
            <button type="button" className="cd-preview-open" onClick={onOpenInTab}>Open in tab ↗</button>
          )}
          <button type="button" className="cd-preview-close" onClick={onClose} aria-label="Close preview" title="Close preview">✕</button>
        </div>
      </div>
      {item.kind === 'node'
        ? <LinkedNodePreview nodeId={item.id} />
        : <p className="cd-preview-policy">{item.action}</p>}
    </section>
  );
}
