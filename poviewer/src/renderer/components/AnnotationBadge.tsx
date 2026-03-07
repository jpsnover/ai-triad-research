// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { Annotation } from '../types/annotations';

interface Props {
  annotations: Annotation[];
}

export default function AnnotationBadge({ annotations }: Props) {
  if (annotations.length === 0) return null;

  const hasNote = annotations.some(a => a.action === 'add_note');
  const hasDismissal = annotations.some(
    a => a.action === 'dismiss_point' || a.action === 'dismiss_mapping',
  );
  const hasOverride = annotations.some(
    a => a.action === 'change_alignment' || a.action === 'change_strength',
  );
  const hasCollision = annotations.some(a => a.action === 'flag_collision');

  const labels: string[] = [];
  if (hasOverride) labels.push('Modified');
  if (hasDismissal) labels.push('Dismissed');
  if (hasCollision) labels.push('Flagged');
  if (hasNote) labels.push('Note');

  return (
    <span
      className={`annotation-badge ${hasDismissal ? 'dismissed' : ''}`}
      title={`${annotations.length} annotation(s): ${labels.join(', ')}`}
    >
      {hasNote && <span className="annotation-badge-icon">&#128221;</span>}
      {hasOverride && <span className="annotation-badge-icon">&#9998;</span>}
      {hasDismissal && <span className="annotation-badge-icon">&#10005;</span>}
      {hasCollision && <span className="annotation-badge-icon">&#9888;</span>}
    </span>
  );
}
