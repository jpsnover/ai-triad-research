// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import type { GraphAttributes } from '../../types/taxonomy';
import { useDescriptionMode, resolveDescription } from './DescriptionToggle';

const POV_LABELS: Record<string, string> = {
  accelerationist: 'Accelerationist',
  safetyist: 'Safetyist',
  skeptic: 'Skeptic',
};

const CONFLICT_STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  resolved: 'Resolved',
  'wont-fix': "Won't Fix",
};

/**
 * Enriched fields that may live under `graph_attributes` at runtime but are not
 * part of the declared {@link GraphAttributes} shape (per the project data
 * convention — enriched fields vary per node). Accessed defensively.
 */
interface EnrichedAttrs {
  interpretation?: string | { summary?: string };
  key_points?: string[];
}

/**
 * Read-only inline preview of a linked taxonomy node, situation, or conflict,
 * resolved from the taxonomy store by id. Renders nothing for unknown ids.
 *
 * Shared by ConflictDetail (Conflicts tab) and CruxDetail (Cruxes tab) so both
 * present linked entities identically without navigating away.
 */
export function LinkedNodePreview({ nodeId }: { nodeId: string }) {
  const lookupPinnedData = useTaxonomyStore(s => s.lookupPinnedData);
  const [descMode] = useDescriptionMode();
  const data = lookupPinnedData(nodeId);
  if (!data) return null;

  if (data.type === 'conflict') {
    const c = data.conflict;
    return (
      <div className="linked-node-preview">
        <div className="linked-node-preview-header">
          <span className="linked-node-preview-pov">Conflict</span>
          <span className="linked-node-preview-category">{CONFLICT_STATUS_LABELS[c.status] ?? c.status}</span>
          <span className="linked-node-preview-id">{nodeId}</span>
        </div>
        <div className="linked-node-preview-label">{c.claim_label}</div>
        <div className="linked-node-preview-description">{c.description}</div>
        {c.instances.length > 0 && (
          <div className="linked-node-preview-attrs">
            <span className="linked-node-preview-attr-label">Instances:</span>
            <span>{c.instances.length}</span>
          </div>
        )}
      </div>
    );
  }

  const node = data.node;
  const povLabel = data.type === 'pov' ? POV_LABELS[data.pov] ?? data.pov : 'Situation';
  const category = data.type === 'pov' ? data.node.category : null;
  const enriched = node.graph_attributes as (GraphAttributes & EnrichedAttrs) | undefined;
  const interpretation = enriched?.interpretation;
  const keyPoints = enriched?.key_points ?? [];

  return (
    <div className="linked-node-preview">
      <div className="linked-node-preview-header">
        <span className="linked-node-preview-pov">{povLabel}</span>
        {category && <span className="linked-node-preview-category">{category}</span>}
        <span className="linked-node-preview-id">{nodeId}</span>
      </div>
      <div className="linked-node-preview-label">{node.label}</div>
      <div className="linked-node-preview-description">{resolveDescription(node, descMode).text}</div>
      {interpretation && (
        <div className="linked-node-preview-attrs">
          <span className="linked-node-preview-attr-label">Interpretation:</span>
          <span>{typeof interpretation === 'string' ? interpretation : interpretation.summary}</span>
        </div>
      )}
      {keyPoints.length > 0 && (
        <div className="linked-node-preview-attrs">
          <span className="linked-node-preview-attr-label">Key points:</span>
          <ul className="linked-node-preview-keypoints">
            {keyPoints.slice(0, 3).map((kp, i) => <li key={i}>{kp}</li>)}
            {keyPoints.length > 3 && <li className="linked-node-preview-more">+{keyPoints.length - 3} more</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
