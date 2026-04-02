// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Harvest utilities — extract promotable findings from debate synthesis,
 * validate AI-generated descriptions, and prepare items for user review.
 */

import type { DebateSession, TranscriptEntry, PoverId } from './types';
import { POVER_INFO } from './types';
import { nodePovFromId } from './nodeIdUtils';

// ── Types ─────────────────────────────────────────────────

export interface HarvestConflictItem {
  id: string;
  point: string;
  bdiLayer?: string;
  resolvability?: string;
  positions: { pover: string; stance: string }[];
  generatedLabel?: string;
  generatedDescription?: string;
  linkedNodes: string[];
  checked: boolean;
  warnings: string[];
}

export interface HarvestSteelmanItem {
  id: string;
  targetNodeId: string;
  targetNodeLabel: string;
  attackerPov: string;
  currentSteelman: string;
  proposedSteelman: string;
  sourceEntryId: string;
  sourceExcerpt: string;
  checked: boolean;
  warnings: string[];
}

export interface HarvestDebateRefItem {
  nodeId: string;
  nodeLabel: string;
  refCount: number;
  checked: boolean;
}

export interface HarvestConceptItem {
  id: string;
  text: string;
  speaker: string;
  sourceEntryId: string;
  suggestedLabel: string;
  suggestedDescription: string;
  suggestedPov: string;
  suggestedCategory: string;
  checked: boolean;
  warnings: string[];
}

export interface HarvestVerdictItem {
  id: string;
  conflict: string;
  prevails: string;
  criterion: string;
  rationale: string;
  whatWouldChange?: string;
  claimIds?: string[];
  /** ID of an existing conflict file to attach verdict to, or null to create new */
  targetConflictId: string | null;
  checked: boolean;
  warnings: string[];
}

export interface HarvestManifestItem {
  type: 'conflict' | 'steelman' | 'debate_ref' | 'verdict' | 'concept';
  action: 'created' | 'updated' | 'added' | 'queued';
  id: string;
  status: 'applied' | 'rejected';
}

export interface HarvestManifest {
  debate_id: string;
  debate_title: string;
  harvested_at: string;
  items: HarvestManifestItem[];
}

// ── Conflict extraction ───────────────────────────────────

/** Extract promotable conflicts from synthesis metadata */
export function extractConflictCandidates(debate: DebateSession): HarvestConflictItem[] {
  const synthEntry = debate.transcript.find(e => e.type === 'synthesis');
  if (!synthEntry?.metadata?.synthesis) return [];

  const synthesis = synthEntry.metadata.synthesis as {
    areas_of_disagreement?: {
      point: string;
      bdi_layer?: string;
      resolvability?: string;
      positions?: { pover: string; stance: string }[];
    }[];
  };

  if (!synthesis.areas_of_disagreement) return [];

  return synthesis.areas_of_disagreement.map((d, i) => {
    // Gather taxonomy node IDs from transcript entries by the debaters in this disagreement
    const povIds = (d.positions || []).map(p => p.pover);
    const linkedNodes = new Set<string>();
    for (const entry of debate.transcript) {
      if (povIds.includes(entry.speaker)) {
        for (const ref of entry.taxonomy_refs) {
          linkedNodes.add(ref.node_id);
        }
      }
    }

    return {
      id: `hc-${i}`,
      point: d.point,
      bdiLayer: d.bdi_layer,
      resolvability: d.resolvability,
      positions: d.positions || [],
      linkedNodes: [...linkedNodes].slice(0, 10),
      checked: false,
      warnings: [],
    };
  });
}

// ── Steelman extraction ───────────────────────────────────

const POV_FOR_POVER: Record<string, string> = {
  prometheus: 'accelerationist',
  sentinel: 'safetyist',
  cassandra: 'skeptic',
};

/** Extract steelman refinement candidates from transcript */
export function extractSteelmanCandidates(
  debate: DebateSession,
  getNodeLabel: (id: string) => string | null,
): HarvestSteelmanItem[] {
  const candidates: HarvestSteelmanItem[] = [];
  let idx = 0;

  for (const entry of debate.transcript) {
    if (entry.speaker === 'system' || entry.speaker === 'user') continue;
    if (!entry.taxonomy_refs || entry.taxonomy_refs.length === 0) continue;

    const speakerPov = POV_FOR_POVER[entry.speaker];
    if (!speakerPov) continue;

    // Check for move_types that indicate a strong attack
    const meta = entry.metadata as { move_types?: string[] } | undefined;
    const moves = meta?.move_types || [];
    const isAttack = moves.some(m => ['COUNTEREXAMPLE', 'REDUCE', 'DISTINGUISH', 'REFRAME'].includes(m));
    if (!isAttack && entry.content.length < 100) continue; // Skip short non-attack entries

    // Find taxonomy refs from OTHER POVs
    for (const ref of entry.taxonomy_refs) {
      const nodeId = ref.node_id;
      // Determine the node's POV from its prefix
      const nodeIdPov = nodePovFromId(nodeId);
      if (!nodeIdPov || nodeIdPov === 'situations') continue; // Skip situation nodes for steelman purposes

      if (nodeIdPov === speakerPov) continue; // Same POV, not a cross-POV attack

      const label = getNodeLabel(nodeId);
      if (!label) continue;

      candidates.push({
        id: `hs-${idx++}`,
        targetNodeId: nodeId,
        targetNodeLabel: label,
        attackerPov: speakerPov,
        currentSteelman: '', // Filled by the dialog from store data
        proposedSteelman: '', // Filled by AI condensation
        sourceEntryId: entry.id,
        sourceExcerpt: entry.content.slice(0, 300),
        checked: false,
        warnings: [],
      });
    }
  }

  // Deduplicate by targetNodeId + attackerPov (keep the one with the longest excerpt)
  const seen = new Map<string, HarvestSteelmanItem>();
  for (const c of candidates) {
    const key = `${c.targetNodeId}:${c.attackerPov}`;
    const existing = seen.get(key);
    if (!existing || c.sourceExcerpt.length > existing.sourceExcerpt.length) {
      seen.set(key, c);
    }
  }

  return [...seen.values()];
}

// ── Debate ref extraction ─────────────────────────────────

/** Extract all taxonomy nodes referenced in this debate */
export function extractDebateRefCandidates(
  debate: DebateSession,
  getNodeLabel: (id: string) => string | null,
): HarvestDebateRefItem[] {
  const refCounts = new Map<string, number>();

  for (const entry of debate.transcript) {
    for (const ref of entry.taxonomy_refs) {
      refCounts.set(ref.node_id, (refCounts.get(ref.node_id) || 0) + 1);
    }
  }

  return [...refCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([nodeId, count]) => ({
      nodeId,
      nodeLabel: getNodeLabel(nodeId) || nodeId,
      refCount: count,
      checked: count >= 2, // Default-check nodes referenced 2+ times
    }));
}

// ── Validation ────────────────────────────────────────────

/** Validate AI-generated conflict description (V-H1.5) */
export function validateConflictDescription(
  generated: { claim_label: string; description: string; linked_taxonomy_nodes: string[] },
  allNodeIds: Set<string>,
): string[] {
  const warnings: string[] = [];

  const wordCount = generated.claim_label.split(/\s+/).length;
  if (wordCount < 3) warnings.push(`Label too short (${wordCount} words, need 3+)`);
  if (wordCount > 12) warnings.push(`Label too long (${wordCount} words, max 12)`);

  if (!generated.description || generated.description.length < 20) {
    warnings.push('Description too short');
  }
  if (generated.description === generated.claim_label) {
    warnings.push('Description is identical to label');
  }

  for (const nodeId of generated.linked_taxonomy_nodes) {
    if (!allNodeIds.has(nodeId)) {
      warnings.push(`Linked node ${nodeId} does not exist`);
    }
  }

  if (generated.linked_taxonomy_nodes.length < 2) {
    warnings.push('Conflict should link at least 2 taxonomy nodes');
  }

  return warnings;
}

/** Validate condensed steelman (V-H2.2) */
export function validateCondensedSteelman(
  condensed: string,
  originalStatement: string,
  attackerPov: string,
): string[] {
  const warnings: string[] = [];

  if (condensed.length < 50) warnings.push(`Too short (${condensed.length} chars, min 50)`);
  if (condensed.length > 200) warnings.push(`Too long (${condensed.length} chars, max 200)`);

  const povVocab: Record<string, string[]> = {
    accelerationist: ['progress', 'innovation', 'speed', 'scaling', 'open-source', 'abundance', 'growth', 'develop'],
    safetyist: ['risk', 'alignment', 'control', 'oversight', 'catastroph', 'irreversibl', 'caution', 'safeguard'],
    skeptic: ['bias', 'displac', 'accountab', 'harm', 'evidence', 'power', 'concentrat', 'inequal'],
  };
  const vocab = povVocab[attackerPov] || [];
  const matches = vocab.filter(v => condensed.toLowerCase().includes(v));
  if (matches.length === 0) {
    warnings.push(`No ${attackerPov} vocabulary found — may be too generic`);
  }

  const origWords = new Set(originalStatement.toLowerCase().split(/\s+/).filter(w => w.length > 4));
  const condWords = condensed.toLowerCase().split(/\s+/).filter(w => w.length > 4);
  const overlap = condWords.filter(w => origWords.has(w)).length / Math.max(condWords.length, 1);
  if (overlap < 0.15) {
    warnings.push(`Low overlap with original (${(overlap * 100).toFixed(0)}%) — may have drifted`);
  }

  return warnings;
}

// ── Preference/verdict extraction ─────────────────────────

/** Extract preference verdicts from synthesis */
export function extractVerdictCandidates(debate: DebateSession): HarvestVerdictItem[] {
  const synthEntry = debate.transcript.find(e => e.type === 'synthesis');
  if (!synthEntry?.metadata?.synthesis) return [];

  const synthesis = synthEntry.metadata.synthesis as {
    preferences?: {
      conflict: string;
      claim_ids?: string[];
      prevails: string;
      criterion: string;
      rationale: string;
      what_would_change_this?: string;
    }[];
  };

  if (!synthesis.preferences) return [];

  return synthesis.preferences.map((p, i) => ({
    id: `hv-${i}`,
    conflict: p.conflict,
    prevails: p.prevails,
    criterion: p.criterion,
    rationale: p.rationale,
    whatWouldChange: p.what_would_change_this,
    claimIds: p.claim_ids,
    targetConflictId: null, // User selects or creates during harvest
    checked: false,
    warnings: validateVerdict(p),
  }));
}

/** Validate verdict quality (V-H5.2) */
export function validateVerdict(
  verdict: { prevails: string; criterion: string; rationale: string },
): string[] {
  const warnings: string[] = [];
  const validCriteria = new Set(['empirical_evidence', 'logical_validity', 'source_authority', 'specificity', 'scope', 'undecidable']);
  if (!validCriteria.has(verdict.criterion)) {
    warnings.push(`Unknown criterion: ${verdict.criterion}`);
  }
  if (!verdict.rationale || verdict.rationale.length < 30) {
    warnings.push('Rationale too short');
  }
  if (!verdict.prevails || (verdict.prevails.length < 5 && !/^C\d+$/.test(verdict.prevails))) {
    warnings.push('Prevails field too vague');
  }
  return warnings;
}

// ── New concept extraction ────────────────────────────────

/** Extract claims from the AN that don't map to existing taxonomy nodes */
export function extractConceptCandidates(
  debate: DebateSession,
  allNodeIds: Set<string>,
): HarvestConceptItem[] {
  const an = debate.argument_network;
  if (!an || an.nodes.length === 0) return [];

  const candidates: HarvestConceptItem[] = [];
  let idx = 0;

  for (const node of an.nodes) {
    // A concept candidate is an AN node with no taxonomy refs
    if (node.taxonomy_refs.length > 0) continue;
    // Skip very short claims
    if (node.text.length < 30) continue;

    const speakerLabel = POVER_INFO[node.speaker as Exclude<PoverId, 'user'>]?.label || node.speaker;
    const speakerPov = POV_FOR_POVER[node.speaker] || 'situations';

    candidates.push({
      id: `hn-${idx++}`,
      text: node.text,
      speaker: speakerLabel,
      sourceEntryId: node.source_entry_id,
      suggestedLabel: '',
      suggestedDescription: '',
      suggestedPov: speakerPov,
      suggestedCategory: 'Intentions',
      checked: false,
      warnings: [],
    });
  }

  return candidates;
}

/** Validate a proposed new concept (V-H4.2) */
export function validateProposedConcept(
  concept: { label: string; description: string; pov: string; category: string },
  existingLabels: Set<string>,
): string[] {
  const warnings: string[] = [];

  if (existingLabels.has(concept.label.toLowerCase())) {
    warnings.push(`Label "${concept.label}" already exists in taxonomy`);
  }

  const words = concept.label.split(/\s+/).length;
  if (words < 3) warnings.push(`Label too short (${words} words, need 3+)`);
  if (words > 8) warnings.push(`Label too long (${words} words, max 8)`);

  const gdPov = /^A\s+(Desires|Beliefs|Intentions)\s+within\s+(accelerationist|safetyist|skeptic)\s+discourse\s+that\s+/i;
  const gdSit = /^A\s+situation\s+that\s+/i;
  const isSit = concept.pov === 'situations';
  if (isSit ? !gdSit.test(concept.description) : !gdPov.test(concept.description)) {
    warnings.push('Description does not follow genus-differentia pattern');
  }

  if (!['accelerationist', 'safetyist', 'skeptic', 'situations'].includes(concept.pov)) {
    warnings.push(`Invalid POV: ${concept.pov}`);
  }

  if (!isSit && !['Desires', 'Beliefs', 'Intentions'].includes(concept.category)) {
    warnings.push(`Invalid category: ${concept.category}`);
  }

  return warnings;
}

/** Generate a conflict ID slug from a label */
export function generateConflictSlug(label: string, debateId: string): string {
  const slug = label.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 40)
    .replace(/-$/, '');
  return `conflict-${slug}-${debateId.slice(0, 8)}`;
}
