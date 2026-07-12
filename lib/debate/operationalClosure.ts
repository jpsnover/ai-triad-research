import type { ArgumentNetworkNode, ArgumentNetworkEdge } from './types.js';

export interface SpeakerClosureStats {
  closure_rate: number;
  closure_edges: number;
  coupling_edges: number;
  standalone_rate: number;
}

export interface OperationalClosureResult {
  perSpeaker: Record<string, SpeakerClosureStats>;
  debateMean: number | null;
}

export function computeOperationalClosure(
  nodes: ReadonlyArray<ArgumentNetworkNode>,
  edges: ReadonlyArray<ArgumentNetworkEdge>,
): OperationalClosureResult {
  const speakerNodes = new Map<string, Set<string>>();
  for (const node of nodes) {
    if (node.speaker === 'system' || node.speaker === 'document') continue;
    if (!speakerNodes.has(node.speaker)) speakerNodes.set(node.speaker, new Set());
    speakerNodes.get(node.speaker)!.add(node.id);
  }

  const nodeById = new Map<string, ArgumentNetworkNode>();
  for (const node of nodes) nodeById.set(node.id, node);

  const sourceEdges = new Map<string, { closure: number; coupling: number; total: number }>();
  for (const speaker of speakerNodes.keys()) {
    sourceEdges.set(speaker, { closure: 0, coupling: 0, total: 0 });
  }

  for (const edge of edges) {
    if (edge.type === 'revoice_of') continue;
    const srcNode = nodeById.get(edge.source);
    const tgtNode = nodeById.get(edge.target);
    if (!srcNode || !tgtNode) continue;
    if (srcNode.speaker === 'system' || srcNode.speaker === 'document') continue;

    const stats = sourceEdges.get(srcNode.speaker);
    if (!stats) continue;

    if (srcNode.speaker === tgtNode.speaker) {
      stats.closure++;
    } else {
      stats.coupling++;
    }
    stats.total++;
  }

  const totalNodesBySpeaker = new Map<string, number>();
  for (const [speaker, nodeIds] of speakerNodes) {
    totalNodesBySpeaker.set(speaker, nodeIds.size);
  }

  const sourcedNodes = new Set<string>();
  for (const edge of edges) {
    if (edge.type === 'revoice_of') continue;
    sourcedNodes.add(edge.source);
  }

  const perSpeaker: Record<string, SpeakerClosureStats> = {};
  const rates: number[] = [];

  for (const [speaker, stats] of sourceEdges) {
    const denominator = stats.closure + stats.coupling;
    const totalNodes = totalNodesBySpeaker.get(speaker) ?? 0;
    const standaloneCount = totalNodes - [...(speakerNodes.get(speaker) ?? [])].filter(id => sourcedNodes.has(id)).length;

    if (denominator === 0) continue;

    const closureRate = stats.closure / denominator;
    const standaloneRate = totalNodes > 0 ? standaloneCount / totalNodes : 0;

    perSpeaker[speaker] = {
      closure_rate: Math.round(closureRate * 1000) / 1000,
      closure_edges: stats.closure,
      coupling_edges: stats.coupling,
      standalone_rate: Math.round(standaloneRate * 1000) / 1000,
    };
    rates.push(closureRate);
  }

  const debateMean = rates.length > 0
    ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 1000) / 1000
    : null;

  return { perSpeaker, debateMean };
}
