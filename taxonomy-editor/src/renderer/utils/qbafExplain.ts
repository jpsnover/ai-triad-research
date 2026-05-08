// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { computeEdgeAttribution } from '@lib/debate/qbaf';
import type { QbafNode, QbafEdge } from '@lib/debate/qbaf';
import type { ArgumentNetworkNode, ArgumentNetworkEdge } from '../types/debate';

export interface EdgeAttribution {
  sourceId: string;
  targetId: string;
  sourceText: string;
  edgeType: 'supports' | 'attacks';
  attackType?: 'rebut' | 'undercut' | 'undermine';
  scheme?: string;
  influence: number; // positive = helped, negative = hurt
}

export interface StrengthExplanation {
  nodeId: string;
  strength: number;
  baseStrength: number;
  verdict: 'accepted' | 'contested' | 'weakened';
  summary: string;
  attributions: EdgeAttribution[];
}

function toQbafNodes(nodes: ArgumentNetworkNode[]): QbafNode[] {
  return nodes.map(n => ({
    id: n.id,
    base_strength: n.base_strength ?? 0.5,
  }));
}

function toQbafEdges(edges: ArgumentNetworkEdge[]): QbafEdge[] {
  return edges.map(e => ({
    source: e.source,
    target: e.target,
    type: e.type,
    weight: e.weight ?? 1.0,
    attack_type: e.attack_type,
  }));
}

export function explainNodeStrength(
  nodes: ArgumentNetworkNode[],
  edges: ArgumentNetworkEdge[],
  targetNodeId: string,
): StrengthExplanation | null {
  const node = nodes.find(n => n.id === targetNodeId);
  if (!node) return null;

  const qNodes = toQbafNodes(nodes);
  const qEdges = toQbafEdges(edges);
  const rawAttributions = computeEdgeAttribution(qNodes, qEdges, targetNodeId);

  const strength = node.computed_strength ?? node.base_strength ?? 0.5;
  const baseStrength = node.base_strength ?? 0.5;
  const verdict = strength >= 0.6 ? 'accepted' as const
    : strength >= 0.4 ? 'contested' as const
    : 'weakened' as const;

  const attributions: EdgeAttribution[] = [];
  for (const [key, influence] of rawAttributions) {
    const [sourceId] = key.split('→');
    const edge = edges.find(e => e.source === sourceId && e.target === targetNodeId);
    const sourceNode = nodes.find(n => n.id === sourceId);
    attributions.push({
      sourceId,
      targetId: targetNodeId,
      sourceText: sourceNode?.text?.slice(0, 120) ?? sourceId,
      edgeType: edge?.type ?? (influence >= 0 ? 'supports' : 'attacks'),
      attackType: edge?.attack_type,
      scheme: edge?.scheme,
      influence,
    });
  }

  attributions.sort((a, b) => Math.abs(b.influence) - Math.abs(a.influence));

  const supporters = attributions.filter(a => a.influence > 0);
  const attackers = attributions.filter(a => a.influence < 0);

  const truncate = (text: string, len = 60) => text.length > len ? text.slice(0, len) + '…' : text;

  let summary = `This claim is ${verdict} (strength: ${strength.toFixed(2)})`;
  if (supporters.length > 0) {
    summary += ` because "${truncate(supporters[0].sourceText)}" supports it (+${supporters[0].influence.toFixed(2)})`;
  }
  if (attackers.length > 0) {
    const atkLabel = attackers[0].attackType ? ` (${attackers[0].attackType})` : '';
    summary += ` even though "${truncate(attackers[0].sourceText)}" attacks${atkLabel} it (${attackers[0].influence.toFixed(2)})`;
  }

  return { nodeId: targetNodeId, strength, baseStrength, verdict, summary, attributions };
}
