// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { ATTRIBUTION_THRESHOLD, ATTACK_STRENGTH_THRESHOLD } from './confidenceEvolution.js';
import { interpretationText } from './taxonomyTypes.js';
import type { SituationNode } from './taxonomyTypes.js';
import type {
  ArgumentNetworkNode,
  ArgumentNetworkEdge,
  InterpretationRevisionProposal,
} from './types.js';

type Camp = 'accelerationist' | 'safetyist' | 'skeptic';

const CAMP_SPEAKERS = new Set<string>(['accelerationist', 'safetyist', 'skeptic']);

function isSituationId(id: string): boolean {
  return id.startsWith('sit-') || id.startsWith('cc-');
}

function speakerToCamp(speaker: string): Camp | null {
  return CAMP_SPEAKERS.has(speaker) ? speaker as Camp : null;
}

interface AttackingClaim {
  claim_id: string;
  speaker: string;
  strength: number;
}

interface ProposalKey {
  sit_id: string;
  camp: Camp;
}

export function computeInterpretationRevisionProposals(opts: {
  nodes: ArgumentNetworkNode[];
  edges: ArgumentNetworkEdge[];
  situations: SituationNode[];
  debateId: string;
}): InterpretationRevisionProposal[] {
  const { nodes, edges, situations, debateId } = opts;

  const nodeById = new Map<string, ArgumentNetworkNode>();
  for (const n of nodes) nodeById.set(n.id, n);

  // Build target→attack edges index (edges where type === 'attacks')
  const attacksByTarget = new Map<string, ArgumentNetworkEdge[]>();
  for (const e of edges) {
    if (e.type === 'attacks') {
      const list = attacksByTarget.get(e.target) ?? [];
      list.push(e);
      attacksByTarget.set(e.target, list);
    }
  }

  // Index situations by ID for interpretation lookup
  const sitById = new Map<string, SituationNode>();
  for (const s of situations) sitById.set(s.id, s);

  // Collect qualifying (sit, camp) → attacking claims
  const proposalMap = new Map<string, { key: ProposalKey; claims: AttackingClaim[] }>();

  for (const node of nodes) {
    const camp = speakerToCamp(node.speaker);
    if (!camp) continue;

    // Find situation references via claim_taxonomy_attribution
    const attr = node.claim_taxonomy_attribution;
    if (!attr) continue;

    const sitRefs: Array<{ sit_id: string; confidence: number }> = [];

    if (isSituationId(attr.primary_ref) && attr.attribution_confidence >= ATTRIBUTION_THRESHOLD) {
      sitRefs.push({ sit_id: attr.primary_ref, confidence: attr.attribution_confidence });
    }
    for (const sec of attr.secondary_refs ?? []) {
      if (isSituationId(sec.node_id) && sec.similarity >= ATTRIBUTION_THRESHOLD) {
        sitRefs.push({ sit_id: sec.node_id, confidence: sec.similarity });
      }
    }

    if (sitRefs.length === 0) continue;

    // Check for qualifying attacks on this node
    const attacks = attacksByTarget.get(node.id) ?? [];
    for (const attackEdge of attacks) {
      const attacker = nodeById.get(attackEdge.source);
      if (!attacker) continue;
      const strength = attacker.computed_strength ?? 0;
      if (strength < ATTACK_STRENGTH_THRESHOLD) continue;

      // This node was materially attacked — emit proposals for each sit ref
      for (const ref of sitRefs) {
        const sit = sitById.get(ref.sit_id);
        if (!sit) continue;
        const interp = sit.interpretations?.[camp];
        if (!interp) continue;

        const mapKey = `${ref.sit_id}:${camp}`;
        let entry = proposalMap.get(mapKey);
        if (!entry) {
          entry = {
            key: { sit_id: ref.sit_id, camp },
            claims: [],
          };
          proposalMap.set(mapKey, entry);
        }

        // Deduplicate by claim_id
        if (!entry.claims.some(c => c.claim_id === attacker.id)) {
          entry.claims.push({
            claim_id: attacker.id,
            speaker: attacker.speaker,
            strength,
          });
        }
      }
    }
  }

  // Convert collected entries to proposals
  const proposals: InterpretationRevisionProposal[] = [];
  for (const { key, claims } of proposalMap.values()) {
    const sit = sitById.get(key.sit_id)!;
    const interp = sit.interpretations[key.camp];
    proposals.push({
      source: 'situation_interpretation',
      node_id: key.sit_id,
      camp: key.camp,
      current_interpretation: interpretationText(interp),
      attacking_claims: claims,
      reason: `${claims.length} material attack(s) on claims attributed to ${key.camp}'s interpretation of ${sit.label || key.sit_id}`,
      debate_id: debateId,
      requires_human_review: true,
      post_approval_action: 'regenerate_debate_register',
    });
  }

  return proposals;
}
