// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useRef, useState } from 'react';
import type { EntityRef, EntityDetail } from '@lib/entities/types';
import type { PolicyAction } from '@lib/policy/types';
import type { Pov } from '../../types/taxonomy';
import { nodePovFromId } from '@lib/debate/nodeIdUtils';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { NodeDetail } from '../taxonomy/NodeDetail';
import { SituationDetail } from '../debate/SituationDetail';
import { OrganizationDetail } from '../organizations/OrganizationDetail';
// Aliased: `EntityDetail` (the resolve-result union type) is already imported above.
import { EntityDetail as EntityDetailView } from './EntityDetail';
import { EmptyState } from './EmptyState';
import { resolveRef } from './resolveRef';
import './DetailPane.css';

export interface DetailPaneProps {
  /** The selected ref to display; `null` renders the idle empty state. */
  selectedRef: EntityRef | null;
  /**
   * Update-on-new-selection callback. Also drives the merge-tombstone REDIRECT:
   * when `getEntity` follows a `merged_into` tombstone it returns the canonical
   * record + `redirected_from`, and the pane re-selects the canonical ref through
   * this callback rather than silently showing a record under an id the caller
   * didn't ask for (t/1775#4). Optional — omit for a read-only, non-navigating pane.
   */
  onSelectRef?: (ref: EntityRef) => void;
  /** Dismiss handler; when provided a close control is shown in the header. */
  onClose?: () => void;
  className?: string;
}

type ResolveState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; detail: EntityDetail }
  | { status: 'error'; message: string };

/**
 * Right-hand detail pane for the ref → detail-pane contract (t/1775). Resolves a
 * {@link EntityRef} via {@link resolveRef} and dispatches on the resulting
 * `EntityDetail.kind`, reusing the existing per-kind detail components. The
 * dispatch `switch` carries a `never` exhaustiveness guard, so adding a kind to the
 * shared contract fails to COMPILE here until it has a render branch.
 *
 * Consumers (t/1766 ID-ref rendering, t/1767 entity mentions) build against this
 * container; t/1767 fills in the richer `entity`/`term` renderers where placeholders
 * sit today.
 */
export function DetailPane({ selectedRef, onSelectRef, onClose, className }: DetailPaneProps) {
  const [state, setState] = useState<ResolveState>({ status: 'idle' });

  // Keep the latest onSelectRef without making it an effect dependency (parents
  // rarely memoize it; re-running resolution on its identity would thrash).
  const onSelectRefRef = useRef(onSelectRef);
  onSelectRefRef.current = onSelectRef;

  const refKind = selectedRef?.kind ?? null;
  const refId = selectedRef?.id ?? null;

  useEffect(() => {
    if (!selectedRef) {
      setState({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    void (async () => {
      try {
        const detail = await resolveRef(selectedRef);
        if (cancelled) return;
        setState({ status: 'ready', detail });
        // Merge-tombstone redirect: re-drive selection to the canonical ref.
        if (
          detail.kind !== 'not_found' &&
          detail.redirected_from &&
          detail.ref.id !== selectedRef.id
        ) {
          onSelectRefRef.current?.(detail.ref);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'DetailPane',
          level: 'error',
          message: `Failed to resolve ref "${selectedRef.id}"`,
          error: { name: err instanceof Error ? err.name : 'Error', message, stack: err instanceof Error ? err.stack : undefined },
        });
        setState({ status: 'error', message });
      }
    })();
    return () => { cancelled = true; };
    // Re-resolve only when the selection IDENTITY changes (kind+id) — not on every
    // new selectedRef object reference; onSelectRef is read via onSelectRefRef, not a dep.
  }, [refKind, refId]);

  // A11y focus + Escape lifecycle (t/1925): a shared-pane keyboard gate for EVERY
  // EntityDetail consumer. On open, capture the invoking element and move focus into the
  // pane; on close — selectedRef→null OR unmount, covering Escape / the ✕ button /
  // programmatic close — restore focus to the invoker. Keyed on `isOpen` so it fires
  // once per open/close, not on every ref-to-ref navigation within the pane.
  const paneRef = useRef<HTMLDivElement>(null);
  const invokerRef = useRef<HTMLElement | null>(null);
  const isOpen = selectedRef !== null;

  useEffect(() => {
    if (!isOpen) return;
    invokerRef.current = (document.activeElement as HTMLElement | null) ?? null;
    paneRef.current?.focus({ preventScroll: true });
    return () => {
      const invoker = invokerRef.current;
      invokerRef.current = null;
      if (invoker && document.contains(invoker) && typeof invoker.focus === 'function') {
        invoker.focus({ preventScroll: true });
      }
    };
  }, [isOpen]);

  return (
    <div
      ref={paneRef}
      className={`detail-pane${className ? ` ${className}` : ''}`}
      role="region"
      aria-label={titleFor(state)}
      tabIndex={-1}
      onKeyDown={onClose ? (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } } : undefined}
    >
      <div className="detail-pane-header">
        <span className="detail-pane-title">{titleFor(state)}</span>
        {onClose && (
          <button type="button" className="detail-pane-close" onClick={onClose} title="Close detail">
            ✕
          </button>
        )}
      </div>
      {/* aria-live: loading / error / not_found state changes are announced (§8, AC #2). */}
      <div className="detail-pane-body" aria-live="polite">{renderBody(state, onSelectRef)}</div>
    </div>
  );
}

function titleFor(state: ResolveState): string {
  if (state.status === 'ready') {
    const d = state.detail;
    switch (d.kind) {
      case 'node':
      case 'situation':
        return d.record.label;
      case 'policy':
        return d.record.action;
      case 'organization':
        return d.record.name;
      case 'entity':
        return d.record.name;
      case 'term':
        return d.ref.id.replace(/^term:/, '');
      case 'not_found':
        return d.ref.id;
    }
  }
  return 'Detail';
}

function renderBody(state: ResolveState, onSelectRef?: (ref: EntityRef) => void) {
  switch (state.status) {
    case 'idle':
      return <EmptyState headline="Select a reference" direction="Choose a linked reference to see its details here." />;
    case 'loading':
      return <div className="detail-pane-loading">Loading…</div>;
    case 'error':
      return <EmptyState headline="Detail unavailable" direction={state.message} />;
    case 'ready':
      return renderDetail(state.detail, onSelectRef);
  }
}

function renderDetail(detail: EntityDetail, onSelectRef?: (ref: EntityRef) => void) {
  switch (detail.kind) {
    case 'node': {
      const pov = nodePovFromId(detail.ref.id) as Pov | null;
      if (!pov) return <EmptyState headline="Unknown perspective" direction={detail.ref.id} />;
      return <NodeDetail pov={pov} node={detail.record} readOnly />;
    }
    case 'situation':
      return <SituationDetail node={detail.record} readOnly />;
    case 'policy':
      return <PolicyDetailView record={detail.record} />;
    case 'organization':
      return (
        <OrganizationDetail
          org={detail.record}
          onSelectOrg={onSelectRef ? id => onSelectRef({ kind: 'organization', id }) : undefined}
        />
      );
    case 'entity':
      return <EntityDetailView entity={detail.record} redirectedFrom={detail.redirected_from} />;
    case 'term':
      // Deliberate Phase-1.5 fallback (t/1882): the term ID-token linkifies (§4.1) but the
      // rich vocabulary renderer is deferred (PM p/21#63) — build §6 in the follow-up ticket.
      return <EmptyState headline={detail.ref.id.replace(/^term:/, '')} direction="Detailed term view coming soon." />;
    case 'not_found':
      return <EmptyState headline="Not found" direction={`No ${detail.ref.kind} matches "${detail.ref.id}".`} />;
    default: {
      // Exhaustiveness guard over EntityDetail.kind — a new kind fails to COMPILE
      // here until it gets a render branch (TL must-address, t/1775#4).
      const _exhaustive: never = detail;
      throw new Error(`Unhandled entity detail kind: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/** Lightweight read-only policy view; no dedicated component exists yet. */
function PolicyDetailView({ record }: { record: PolicyAction }) {
  return (
    <div className="detail-pane-policy">
      <div className="detail-pane-policy-action">{record.action}</div>
      <div className="detail-pane-policy-id">{record.id}</div>
      {record.source_povs && record.source_povs.length > 0 && (
        <div className="detail-pane-policy-povs">
          {record.source_povs.map(p => (
            <span key={p} className="detail-pane-chip">{p}</span>
          ))}
        </div>
      )}
      {typeof record.member_count === 'number' && (
        <div className="detail-pane-policy-members">{record.member_count} member node{record.member_count === 1 ? '' : 's'}</div>
      )}
    </div>
  );
}
