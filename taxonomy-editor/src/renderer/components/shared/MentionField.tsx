// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Render layer for stored entity-name mentions (t/1898 §4.2). `useContainerMentions`
// fetches a container's mentions via the bridge (t/1901); `MentionField` renders one
// field's NFC text with `.ref-link` buttons over the mention spans — reusing the exact
// ref-link click pattern (parseEntityRef → setSelectedRef → DetailPane) and the single
// `.ref-link` treatment (no per-kind color; kind via data-ref-kind + aria-label).

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '@bridge';
import type { EntityRef } from '@lib/entities/types';
import type { Mention } from '@lib/entities/mentionTypes';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { useDebateStore } from '../../hooks/useDebateStore';
import { buildFieldSegments, type ContainerField, type ReconstructedContainer } from './mentionText';

/**
 * Fetch a container's stored mentions. Absence, an unwired desktop transport, or any
 * network error all degrade to `[]` (the reading flow renders as plain text — never a
 * broken link or a spinner) while recording a `system.error` (ADR-003). `null` container
 * id (nothing to fetch) short-circuits to `[]`.
 */
export function useContainerMentions(containerId: string | null): Mention[] {
  const [mentions, setMentions] = useState<Mention[]>([]);
  useEffect(() => {
    if (!containerId) { setMentions([]); return; }
    let cancelled = false;
    void api.getContainerMentions(containerId)
      .then(cm => { if (!cancelled) setMentions(cm?.mentions ?? []); })
      .catch((err: unknown) => {
        if (cancelled) return;
        getGlobalRecorder()?.record({
          type: 'system.error', component: 'useContainerMentions', level: 'error',
          message: `Failed to load mentions for "${containerId}"`,
          error: { name: err instanceof Error ? err.name : 'Error', message: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined },
        });
        setMentions([]); // plain text, no links — safe degrade
      });
    return () => { cancelled = true; };
  }, [containerId]);
  return mentions;
}

function kindLabel(kind: EntityRef['kind']): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/**
 * Render one reconstructed field's text with its mentions linkified. Renders the field's
 * **NFC** text (`field.text`) so offsets stay valid; visually identical to the raw field
 * by canonical equivalence. A field with no mentions is a single plain text node.
 */
export function MentionField({ field, mentions, onSelectRef }: {
  field: ContainerField;
  mentions: Mention[];
  onSelectRef: (ref: EntityRef) => void;
}) {
  const segments = useMemo(() => buildFieldSegments(field, mentions), [field, mentions]);
  return (
    <>
      {segments.map((seg, i) => seg.ref
        ? (
          <button
            key={i}
            type="button"
            className="ref-link"
            data-ref-kind={seg.ref.kind}
            aria-label={`${kindLabel(seg.ref.kind)}: ${seg.text} — open details`}
            onClick={e => { e.stopPropagation(); onSelectRef(seg.ref!); }}
          >
            {seg.text}
          </button>
        )
        : <span key={i}>{seg.text}</span>)}
    </>
  );
}

/**
 * Ergonomic kit entry point for a reading surface: fetches the container's mentions and
 * returns a `renderField(fieldName, fallback)` that linkifies that reconstructed field
 * (or renders `fallback` when the field is absent). Clicks open the shared DetailPane via
 * the debate store's `setSelectedRef` — the same routing as inline ref-links. This is the
 * frozen kit API the per-owner surface integrations (SituationDetail, FactsPanel) reuse.
 */
export function useMentionRenderer(
  containerId: string | null,
  container: ReconstructedContainer,
): (fieldName: string, fallback: string) => ReactNode {
  const mentions = useContainerMentions(containerId);
  const onSelectRef = useCallback((ref: EntityRef) => useDebateStore.getState().setSelectedRef(ref), []);
  return useCallback((fieldName: string, fallback: string): ReactNode => {
    const field = container.fields.find(f => f.name === fieldName);
    return field
      ? <MentionField field={field} mentions={mentions} onSelectRef={onSelectRef} />
      : fallback;
  }, [container, mentions, onSelectRef]);
}
