// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import { POV_META } from '@lib/electron-shared/povMeta';
import './PovMoveTagNotice.css';

/**
 * t/3972: after a cross-POV move, tell the editor which POV tags were removed. Tags are POV-scoped,
 * so the move strips them; this makes that visible instead of silent (TL t/3955#4 condition 3).
 * Shown only on the node that was moved, and only when something was stripped.
 */
export function PovMoveTagNotice({ nodeId }: { nodeId: string }) {
  const report = useTaxonomyStore(s => s.lastPovMoveReport);
  const clear = useTaxonomyStore(s => s.clearPovMoveReport);
  if (!report || report.toId !== nodeId || report.strippedTags.length === 0) return null;
  const tags = report.strippedTags.join(', ');
  return (
    <div className="pov-move-tag-notice" role="status">
      <span>
        Moved from {POV_META[report.sourcePov].label} to {POV_META[report.targetPov].label}.
        {' '}Removed POV tag{report.strippedTags.length === 1 ? '' : 's'} <strong>{tags}</strong>: tags belong to one POV and don&apos;t carry across.
      </span>
      <button type="button" className="pov-move-tag-notice-dismiss" onClick={clear} aria-label="Dismiss">×</button>
    </div>
  );
}
