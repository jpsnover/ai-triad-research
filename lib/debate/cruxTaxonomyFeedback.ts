// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { CruxRegistry, CruxRegistryEntry } from './types.js';
import type { SituationNode, PovNode, WeightHistoryEntry, BdiInterpretation } from './taxonomyTypes.js';
import { nowISO } from './helpers.js';
import { getGlobalRecorder } from '../flight-recorder/index.js';

const PROMOTION_THRESHOLD = 3;
const WEIGHT_ADJUSTMENT_THRESHOLD = 2;
const CONFIDENCE_DELTA = -0.05;
const PRIORITY_DELTA = 1;
const PRIORITY_CAP = 5;

export interface PromotionCandidate {
  entry: CruxRegistryEntry;
  irreducible_count: number;
  total_occurrences: number;
  draft_situation: DraftSituationNode;
}

export interface BdiInterpretations {
  accelerationist: BdiInterpretation;
  safetyist: BdiInterpretation;
  skeptic: BdiInterpretation;
}

export interface DraftSituationNode {
  label: string;
  description: string;
  disagreement_type: CruxRegistryEntry['disagreement_type'];
  related_taxonomy_nodes: string[];
  occurrence_count: number;
  interpretations?: BdiInterpretations;
}

export type BdiEnrichFn = (values: Record<string, string>) => Promise<string>;

export interface WeightAdjustment {
  node_id: string;
  type: 'confidence' | 'priority';
  delta: number;
  reason: string;
  crux_description: string;
  irreducible_count: number;
}

function irreducibleCount(entry: CruxRegistryEntry): number {
  return entry.occurrences.filter(o => o.final_state === 'irreducible').length;
}

export function findPromotionCandidates(registry: CruxRegistry): PromotionCandidate[] {
  return registry.entries
    .filter(e => !e.promoted_to_situation && irreducibleCount(e) >= PROMOTION_THRESHOLD)
    .map(e => ({
      entry: e,
      irreducible_count: irreducibleCount(e),
      total_occurrences: e.occurrences.length,
      draft_situation: buildDraftSituationNode(e),
    }))
    .sort((a, b) => b.irreducible_count - a.irreducible_count);
}

export function buildDraftSituationNode(entry: CruxRegistryEntry): DraftSituationNode {
  return {
    label: `Derived from crux: ${entry.description}`,
    description: `Cross-debate crux identified as irreducible in ${irreducibleCount(entry)} of ${entry.occurrences.length} debates. Disagreement type: ${entry.disagreement_type}. Requires POV interpretation authoring before commit.`,
    disagreement_type: entry.disagreement_type,
    related_taxonomy_nodes: [...entry.related_taxonomy_nodes],
    occurrence_count: entry.occurrences.length,
  };
}

const BDI_FIELDS = ['belief', 'desire', 'intention', 'summary'] as const;
const POV_KEYS_BDI = ['accelerationist', 'safetyist', 'skeptic'] as const;

export async function enrichDraftWithBDI(
  draft: DraftSituationNode,
  cruxId: string,
  enrichFn: BdiEnrichFn,
): Promise<boolean> {
  try {
    const text = await enrichFn({
      situation_id: `pending-from-crux-${cruxId}`,
      label: draft.label,
      description: draft.description,
      existing_interpretations: '',
    });
    const parsed = JSON.parse(text) as BdiInterpretations;
    for (const pov of POV_KEYS_BDI) {
      const interp = parsed[pov];
      if (!interp || BDI_FIELDS.some(f => typeof interp[f] !== 'string' || !interp[f])) {
        throw new Error(`Missing or empty BDI field(s) for ${pov}`);
      }
    }
    draft.interpretations = parsed;
    return true;
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'cruxTaxonomyFeedback',
      level: 'warn',
      data: {
        event: 'bdi_enrichment_failed',
        cruxId,
        label: draft.label,
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return false;
  }
}

export async function findAndEnrichPromotionCandidates(
  registry: CruxRegistry,
  enrichFn: BdiEnrichFn,
): Promise<PromotionCandidate[]> {
  const candidates = findPromotionCandidates(registry);
  for (const c of candidates) {
    await enrichDraftWithBDI(c.draft_situation, c.entry.id, enrichFn);
  }
  return candidates;
}

export function computeWeightAdjustments(registry: CruxRegistry): WeightAdjustment[] {
  const adjustments: WeightAdjustment[] = [];

  for (const entry of registry.entries) {
    const count = irreducibleCount(entry);
    if (count < WEIGHT_ADJUSTMENT_THRESHOLD) continue;

    if (entry.disagreement_type === 'empirical') {
      for (const nodeId of entry.related_taxonomy_nodes) {
        if (nodeId.includes('-beliefs-') || nodeId.includes('-belief-')) {
          adjustments.push({
            node_id: nodeId,
            type: 'confidence',
            delta: CONFIDENCE_DELTA,
            reason: `Cross-debate empirical crux '${entry.description}' irreducible in ${count} debates`,
            crux_description: entry.description,
            irreducible_count: count,
          });
        }
      }
    }

    if (entry.disagreement_type === 'values') {
      for (const nodeId of entry.related_taxonomy_nodes) {
        if (nodeId.includes('-desires-') || nodeId.includes('-desire-')) {
          adjustments.push({
            node_id: nodeId,
            type: 'priority',
            delta: PRIORITY_DELTA,
            reason: `Cross-debate values crux '${entry.description}' — this value is repeatedly at the center of irreducible disagreements`,
            crux_description: entry.description,
            irreducible_count: count,
          });
        }
      }
    }
  }

  return adjustments;
}

export function applyConfidenceAdjustment(
  node: PovNode,
  adjustment: WeightAdjustment,
): { applied: boolean; new_value: number } {
  if (adjustment.type !== 'confidence' || node.confidence == null) {
    return { applied: false, new_value: node.confidence ?? 0 };
  }
  const newVal = Math.max(0, Math.min(1, node.confidence + adjustment.delta));
  const entry: WeightHistoryEntry = {
    date: nowISO(),
    value: newVal,
    delta: adjustment.delta,
    reason: adjustment.reason,
  };
  node.confidence = Math.round(newVal * 100) / 100;
  node.confidence_history = node.confidence_history ?? [];
  node.confidence_history.push(entry);
  return { applied: true, new_value: node.confidence };
}

export function applyPriorityAdjustment(
  node: PovNode,
  adjustment: WeightAdjustment,
): { applied: boolean; new_value: number } {
  if (adjustment.type !== 'priority' || node.priority == null) {
    return { applied: false, new_value: node.priority ?? 0 };
  }
  const newVal = Math.min(PRIORITY_CAP, node.priority + adjustment.delta);
  const entry: WeightHistoryEntry = {
    date: nowISO(),
    value: newVal,
    delta: adjustment.delta,
    reason: adjustment.reason,
  };
  node.priority = newVal;
  node.priority_history = node.priority_history ?? [];
  node.priority_history.push(entry);
  return { applied: true, new_value: node.priority };
}

export function formatPromotionReport(candidates: PromotionCandidate[]): string {
  if (candidates.length === 0) return 'No cruxes meet the promotion threshold (3+ irreducible occurrences).';

  const lines = [`=== CRUX-TO-SITUATION PROMOTION CANDIDATES (${candidates.length}) ===\n`];
  for (const c of candidates) {
    lines.push(`[${c.entry.disagreement_type.toUpperCase()}] "${c.entry.description}"`);
    lines.push(`  Irreducible: ${c.irreducible_count}/${c.total_occurrences} occurrences`);
    lines.push(`  Related nodes: ${c.entry.related_taxonomy_nodes.join(', ') || 'none'}`);
    lines.push(`  Draft label: "${c.draft_situation.label}"`);
    lines.push('');
  }
  lines.push('These candidates require human review before promotion to situation nodes.');
  return lines.join('\n');
}

export function formatWeightAdjustmentReport(adjustments: WeightAdjustment[]): string {
  if (adjustments.length === 0) return 'No weight adjustments needed (no cruxes meet the 2+ irreducible threshold).';

  const lines = [`=== CRUX-DRIVEN WEIGHT ADJUSTMENTS (${adjustments.length}) ===\n`];
  for (const a of adjustments) {
    const sign = a.delta > 0 ? '+' : '';
    lines.push(`${a.node_id}: ${a.type} ${sign}${a.delta} — ${a.reason}`);
  }
  return lines.join('\n');
}
