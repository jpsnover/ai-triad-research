// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useMemo } from 'react';
import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import type { PovNode } from '../../types/taxonomy';
import type { ConceptLinkRef, EntityLinkRef } from '@lib/entities/types';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import './BdiGroundingPanel.css';

function findNodeInFiles(
  id: string,
  files: (({ nodes: PovNode[] } | null) | undefined)[],
): PovNode | null {
  for (const file of files) {
    if (!file) continue;
    const node = file.nodes.find(n => n.id === id);
    if (node) return node;
  }
  return null;
}

function confidencePct(v: number): string {
  return v >= 1 ? '100%' : `${Math.round(v * 100)}%`;
}

interface ConceptRowProps {
  linkRef: ConceptLinkRef;
  onClick: () => void;
}

function ConceptRow({ linkRef, onClick }: ConceptRowProps) {
  const isProposed = linkRef.status === 'proposed';
  return (
    <button
      className={`bdi-gr-row${isProposed ? ' bdi-gr-row--proposed' : ''}`}
      onClick={onClick}
      title={`${linkRef.ref} — open Vocabulary panel`}
    >
      <span className="bdi-gr-surface">{linkRef.surface}</span>
      <span className={`bdi-gr-method bdi-gr-method--${linkRef.method}`}>{linkRef.method}</span>
      <span className={`bdi-gr-status bdi-gr-status--${linkRef.status}`}>{linkRef.status}</span>
      <span className="bdi-gr-conf">{confidencePct(linkRef.link_confidence)}</span>
    </button>
  );
}

interface EntityRowProps {
  linkRef: EntityLinkRef;
  onClick: () => void;
}

function EntityRow({ linkRef, onClick }: EntityRowProps) {
  const isProposed = linkRef.status === 'proposed';
  return (
    <button
      className={`bdi-gr-row${isProposed ? ' bdi-gr-row--proposed' : ''}`}
      onClick={onClick}
      title={`${linkRef.ref} — open entity record`}
    >
      <span className="bdi-gr-surface">{linkRef.surface}</span>
      <span className="bdi-gr-ref">{linkRef.ref}</span>
      <span className={`bdi-gr-method bdi-gr-method--${linkRef.method}`}>{linkRef.method}</span>
      <span className={`bdi-gr-status bdi-gr-status--${linkRef.status}`}>{linkRef.status}</span>
      <span className="bdi-gr-conf">{confidencePct(linkRef.link_confidence)}</span>
    </button>
  );
}

export function BdiGroundingPanel() {
  const { selectedNodeId, accelerationist, safetyist, skeptic, setToolbarPanel } = useTaxonomyStore();

  const node = useMemo(() => {
    if (!selectedNodeId) return null;
    const found = findNodeInFiles(selectedNodeId, [accelerationist, safetyist, skeptic]);
    if (!found && selectedNodeId) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'BdiGroundingPanel',
        level: 'warn',
        message: `Selected node not found in any POV file: ${selectedNodeId}`,
        error: { name: 'NotFound', message: `Node ${selectedNodeId} not in acc/saf/skp`, stack: '' },
      });
    }
    return found;
  }, [selectedNodeId, accelerationist, safetyist, skeptic]);

  if (!selectedNodeId || !node) {
    return <div className="bdi-gr-empty">Select a BDI node to view its concept and entity links.</div>;
  }

  const conceptRefs = node.concept_refs ?? [];
  const entityRefs = node.entity_refs ?? [];

  return (
    <div className="bdi-gr-root">
      <section className="bdi-gr-section">
        <div className="bdi-gr-section-header">
          <span className="bdi-gr-section-title">Concepts</span>
          <span className="bdi-gr-dolce bdi-gr-dolce--kind" title="DOLCE: universal · kind">universal · kind</span>
          <span className="bdi-gr-section-count">{conceptRefs.length}</span>
        </div>
        {conceptRefs.length === 0
          ? <p className="bdi-gr-section-empty">No concept links on this node.</p>
          : conceptRefs.map(r => (
            <ConceptRow key={r.ref} linkRef={r} onClick={() => setToolbarPanel('vocabulary')} />
          ))}
      </section>

      <section className="bdi-gr-section">
        <div className="bdi-gr-section-header">
          <span className="bdi-gr-section-title">Entities</span>
          <span className="bdi-gr-dolce bdi-gr-dolce--particular" title="DOLCE: particular">particular</span>
          <span className="bdi-gr-section-count">{entityRefs.length}</span>
        </div>
        {entityRefs.length === 0
          ? <p className="bdi-gr-section-empty">No entity links — this is normal for most nodes.</p>
          : entityRefs.map(r => (
            <EntityRow key={r.ref} linkRef={r} onClick={() => setToolbarPanel('entities')} />
          ))}
      </section>
    </div>
  );
}
