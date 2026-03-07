// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { Point, Source } from '../types/types';
import type { AnnotationAction, Annotation } from '../types/annotations';
import MappingBlock from './MappingBlock';
import CollisionAlert from './CollisionAlert';
import AnnotationToolbar from './AnnotationToolbar';
import AnnotationBadge from './AnnotationBadge';

interface Props {
  point: Point;
  source: Source;
  annotations?: Annotation[];
  onAnnotate?: (action: AnnotationAction, value: unknown, mappingIndex?: number) => void;
}

export default function PointDetailCard({ point, source, annotations = [], onAnnotate }: Props) {
  const navigatePoint = useAppStore(s => s.navigatePoint);
  const povFilters = useAppStore(s => s.povFilters);

  const visiblePoints = useMemo(() => {
    return source.points.filter(p => {
      if (p.mappings.length === 0) return true;
      return p.mappings.some(m => povFilters[m.camp]);
    });
  }, [source, povFilters]);

  const currentIdx = visiblePoints.findIndex(p => p.id === point.id);
  const isFirst = currentIdx <= 0;
  const isLast = currentIdx >= visiblePoints.length - 1;

  // Check if point is dismissed
  const isDismissed = annotations.some(a => a.action === 'dismiss_point');

  // Build effective mappings (applying annotation overrides)
  const effectiveMappings = point.mappings.map((m, i) => {
    const mappingAnnotations = annotations.filter(a => a.mappingIndex === i);
    let effective = { ...m };

    for (const ann of mappingAnnotations) {
      if (ann.action === 'change_alignment' && (ann.value === 'agrees' || ann.value === 'contradicts')) {
        effective = { ...effective, alignment: ann.value };
      }
      if (ann.action === 'change_strength' && (ann.value === 'strong' || ann.value === 'moderate' || ann.value === 'weak')) {
        effective = { ...effective, strength: ann.value };
      }
    }

    return { mapping: effective, dismissed: mappingAnnotations.some(a => a.action === 'dismiss_mapping') };
  });

  // Notes
  const notes = annotations.filter(a => a.action === 'add_note');

  return (
    <div className={`point-detail-card fade-in ${isDismissed ? 'dismissed' : ''}`}>
      <div className="point-detail-header">
        <span className="point-id">
          {point.id} ({currentIdx + 1} of {visiblePoints.length})
          <AnnotationBadge annotations={annotations} />
        </span>
        <div className="point-nav">
          <button onClick={() => navigatePoint('prev')} disabled={isFirst}>&larr;</button>
          <button onClick={() => navigatePoint('next')} disabled={isLast}>&rarr;</button>
        </div>
      </div>

      <div className="point-text">{point.text}</div>

      {point.verbatim && (
        <div className="point-verbatim">
          <div className="point-verbatim-label">From the document:</div>
          <blockquote className="point-verbatim-quote">{point.verbatim}</blockquote>
        </div>
      )}

      {point.isCollision && point.collisionNote && (
        <CollisionAlert note={point.collisionNote} />
      )}

      {notes.length > 0 && (
        <div className="point-notes">
          {notes.map(n => (
            <div key={n.id} className="point-note">
              <span className="point-note-icon">&#128221;</span>
              <span>{n.value as string}</span>
            </div>
          ))}
        </div>
      )}

      {point.mappings.length === 0 ? (
        <>
          <div className="unmapped-badge">UNMAPPED</div>
          <div className="unmapped-hint">
            This passage was identified as noteworthy but does not map to any current taxonomy node.
            Consider adding a new node or refining existing categories.
          </div>
        </>
      ) : (
        effectiveMappings.map(({ mapping, dismissed }, i) => (
          <div key={i} className={dismissed ? 'mapping-dismissed' : ''}>
            <MappingBlock mapping={mapping} />
            {dismissed && <div className="mapping-dismissed-label">Dismissed</div>}
          </div>
        ))
      )}

      {onAnnotate && (
        <AnnotationToolbar point={point} onAnnotate={onAnnotate} />
      )}
    </div>
  );
}
