// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3852: exhaustive (not sampled) count of references that will dangle if a node is deleted.
// Works for both POV nodes and situation nodes without needing to know which kind nodeId is —
// each direction of cross-reference is only ever non-zero for the type it actually applies to.

import type { PovTaxonomyFile, SituationsFile, EdgesFile } from '../types/taxonomy';

export interface DanglingReferenceCounts {
  /** Edges (either direction) whose source or target is the node being deleted. */
  edges: number;
  /** Cross-references between POV and situation space: situations whose `linked_nodes`
   *  includes this node (POV-node deletion) plus POV nodes whose `situation_refs` includes
   *  this node (situation-node deletion). */
  situationRefs: number;
  /** POV/situation nodes whose `parent_id` is this node (they lose their parent), plus the
   *  parent's own `children` array entry for this node (becomes a stale id) if it has one. */
  children: number;
}

export function countDanglingReferences(
  nodeId: string,
  povFiles: (PovTaxonomyFile | null)[],
  situations: SituationsFile | null,
  edgesFile: EdgesFile | null,
): DanglingReferenceCounts {
  const edges = edgesFile
    ? edgesFile.edges.filter(e => e.source === nodeId || e.target === nodeId).length
    : 0;

  const situationRefs =
    (situations?.nodes.filter(s => s.linked_nodes.includes(nodeId)).length ?? 0) +
    povFiles.reduce((sum, file) =>
      sum + (file ? file.nodes.filter(n => n.situation_refs.includes(nodeId)).length : 0), 0);

  let children = 0;
  for (const file of povFiles) {
    if (!file) continue;
    for (const n of file.nodes) {
      if (n.id === nodeId) continue;
      if (n.parent_id === nodeId) children++;
      if (n.children.includes(nodeId)) children++;
    }
  }
  // t/3852#3: SituationNode has parent_id (situation-to-situation hierarchy) but no `children`
  // array — only the parent_id side can dangle here, unlike the POV loop above.
  if (situations) {
    for (const s of situations.nodes) {
      if (s.id === nodeId) continue;
      if (s.parent_id === nodeId) children++;
    }
  }

  return { edges, situationRefs, children };
}

/** Pre-formatted text for DeleteConfirmDialog's `danglingWarning` prop — undefined when
 *  there's nothing to warn about (a delete with zero references needs no warning banner,
 *  but the log entry still records the zero per t/3852's "0 is a fact too" rule). */
export function formatDanglingWarning(counts: DanglingReferenceCounts): string | undefined {
  const parts: string[] = [];
  if (counts.edges > 0) parts.push(`${counts.edges} edge${counts.edges === 1 ? '' : 's'}`);
  if (counts.situationRefs > 0) parts.push(`${counts.situationRefs} situation reference${counts.situationRefs === 1 ? '' : 's'}`);
  if (counts.children > 0) parts.push(`${counts.children} child/parent link${counts.children === 1 ? '' : 's'}`);
  if (parts.length === 0) return undefined;
  return `This will orphan ${parts.join(', ')}.`;
}
