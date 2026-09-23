// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// AIF graph factory — builds and validates AIF v1 graphs (t/3590).
// All construction functions enforce referential integrity and the CA cross-agent invariant.

import type { SpeakerId } from '../types/phase.js';
import { ActionableError } from '../errors.js';
import type { INode, CaNode, RaNode, AifGraph } from './types.js';

export type { INode, CaNode, RaNode, AifGraph };

// ── ID helpers ────────────────────────────────────────────────────────────────

export function iNodeId(n: number): string { return `i-${n}`; }
export function caNodeId(n: number): string { return `ca-${n}`; }
export function raNodeId(n: number): string { return `ra-${n}`; }

// ── Lookup helpers ────────────────────────────────────────────────────────────

function requireINode(nodes: INode[], id: string, role: string): INode {
  const node = nodes.find(n => n.id === id);
  if (!node) {
    throw new ActionableError({
      goal: 'Build AIF graph',
      problem: `Referential integrity violation: ${role} I-node id "${id}" does not exist in nodes`,
      location: 'lib/debate/aif/graph.ts',
      nextSteps: ['Ensure all I-nodes are added before edges that reference them.'],
    });
  }
  return node;
}

// ── Node factories ────────────────────────────────────────────────────────────

export function makeINode(
  id: string,
  speaker: SpeakerId,
  turn: number,
  round: number,
  text: string,
  held: boolean,
): INode {
  return { id, type: 'claim', speaker, turn, round, text, held };
}

/**
 * Construct a CA-node (conflict / attack).
 *
 * Enforces the cross-agent invariant: `speaker(attacker) ≠ speaker(target)`.
 * Same-speaker conflict is not representable in v1 — throws if violated.
 * Also enforces referential integrity on both endpoints.
 */
export function makeCaNode(
  id: string,
  nodes: INode[],
  attacker: string,
  target: string,
): CaNode {
  const attackerNode = requireINode(nodes, attacker, 'attacker');
  const targetNode = requireINode(nodes, target, 'target');

  if (attackerNode.speaker === targetNode.speaker) {
    throw new ActionableError({
      goal: 'Build AIF CA-node (conflict/attack)',
      problem: `Cross-agent invariant violated: attacker "${attacker}" and target "${target}" have the same speaker ("${attackerNode.speaker}"). Same-speaker conflict is not representable in v1.`,
      location: 'lib/debate/aif/graph.ts',
      nextSteps: ['CA-nodes must connect claims from different speakers. Check the debate turn attribution before constructing this edge.'],
    });
  }

  return { id, type: 'conflict', attacker, target };
}

/**
 * Construct an RA-node (support / inference).
 * Enforces referential integrity on both endpoints.
 */
export function makeRaNode(
  id: string,
  nodes: INode[],
  from: string,
  to: string,
  concession: boolean,
): RaNode {
  requireINode(nodes, from, 'from');
  requireINode(nodes, to, 'to');
  return { id, type: 'support', from, to, concession };
}

// ── Graph factory ─────────────────────────────────────────────────────────────

/**
 * Assemble an AIF graph from pre-validated nodes and edges.
 *
 * Re-validates all edge referential integrity. Callers that built edges via
 * `makeCaNode`/`makeRaNode` get this check for free; callers supplying raw
 * objects get a safety net.
 */
export function makeAifGraph(
  debateId: string,
  nodes: INode[],
  conflicts: CaNode[],
  supports: RaNode[],
): AifGraph {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  for (const ca of conflicts) {
    if (!nodeMap.has(ca.attacker)) {
      throw new ActionableError({
        goal: 'Assemble AIF graph',
        problem: `Referential integrity violation on CA-node "${ca.id}": attacker id "${ca.attacker}" not in nodes`,
        location: 'lib/debate/aif/graph.ts',
        nextSteps: ['Ensure the I-node for the attacker exists before assembling the graph.'],
      });
    }
    if (!nodeMap.has(ca.target)) {
      throw new ActionableError({
        goal: 'Assemble AIF graph',
        problem: `Referential integrity violation on CA-node "${ca.id}": target id "${ca.target}" not in nodes`,
        location: 'lib/debate/aif/graph.ts',
        nextSteps: ['Ensure the I-node for the target exists before assembling the graph.'],
      });
    }
    const attackerNode = nodeMap.get(ca.attacker)!;
    const targetNode = nodeMap.get(ca.target)!;
    if (attackerNode.speaker === targetNode.speaker) {
      throw new ActionableError({
        goal: 'Assemble AIF graph',
        problem: `Cross-agent invariant violated on CA-node "${ca.id}": attacker "${ca.attacker}" and target "${ca.target}" have the same speaker ("${attackerNode.speaker}").`,
        location: 'lib/debate/aif/graph.ts',
        nextSteps: ['CA-nodes must connect claims from different speakers. Check the raw CA-nodes before assembling the graph.'],
      });
    }
  }

  for (const ra of supports) {
    if (!nodeMap.has(ra.from)) {
      throw new ActionableError({
        goal: 'Assemble AIF graph',
        problem: `Referential integrity violation on RA-node "${ra.id}": from id "${ra.from}" not in nodes`,
        location: 'lib/debate/aif/graph.ts',
        nextSteps: ['Ensure the I-node for the from endpoint exists before assembling the graph.'],
      });
    }
    if (!nodeMap.has(ra.to)) {
      throw new ActionableError({
        goal: 'Assemble AIF graph',
        problem: `Referential integrity violation on RA-node "${ra.id}": to id "${ra.to}" not in nodes`,
        location: 'lib/debate/aif/graph.ts',
        nextSteps: ['Ensure the I-node for the to endpoint exists before assembling the graph.'],
      });
    }
  }

  return { debateId, nodes, conflicts, supports };
}
