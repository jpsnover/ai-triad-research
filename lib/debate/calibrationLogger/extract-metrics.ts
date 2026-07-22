// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Calibration metric-block computations (ADR-007 file-size split, t/1686).
 *
 * Pure helper functions extracted from `extractCalibrationData` so extract.ts
 * stays under the ADR-007 budget. Each helper is a pure function of its explicit
 * inputs — it reads exactly the session/argument-network state it needs and
 * returns exactly the metric values it contributes, with no shared closure
 * state. Behavior (computation, order of operations, null handling, rounding)
 * is byte-for-byte identical to the pre-split inline blocks.
 */

import { getDebatePhase } from '../types.js';
import type { DebateSession, ArgumentNetworkNode, TrackedCrux } from '../types.js';
import type { NeutralEvaluation } from '../neutralEvaluator.js';
import { meanSentenceLength, lexicalDiversity, jargonDensity } from '../clarityMetrics.js';
import { computeAffectIntensity, computeAffectProfile, computeAffectAppropriateness } from '../affectSignals.js';
import { computeCampInsularityRate } from '../schemeStagnation.js';

type ArgNetwork = DebateSession['argument_network'];

/**
 * Utilization rates from context injection manifests.
 * Manifest stores povNodeIds (injected) and povPrimaryIds (primary).
 * Cross-reference with entry's taxonomy_refs to compute what was actually referenced.
 */
export function computeUtilizationRates(
  session: DebateSession,
): { totalUtil: number; totalPrimaryUtil: number; utilCount: number } {
  let totalUtil = 0, totalPrimaryUtil = 0, utilCount = 0;
  for (const entry of session.transcript) {
    if (entry.type !== 'opening' && entry.type !== 'statement') continue;
    const manifest = (entry.metadata as Record<string, unknown>)?.injection_manifest as {
      // New format (actual session structure)
      povNodeIds?: string[];
      povPrimaryIds?: string[];
      // Legacy format (pre-existing code)
      injected_count?: number;
      referenced_count?: number;
      primary_injected?: number;
      primary_referenced?: number;
    } | undefined;
    if (!manifest) continue;

    const referencedIds = new Set((entry.taxonomy_refs ?? []).map((r: { node_id: string }) => r.node_id));

    if (manifest.povNodeIds && manifest.povNodeIds.length > 0) {
      // New format: count array intersection
      const injected = manifest.povNodeIds.length;
      const referenced = manifest.povNodeIds.filter((id: string) => referencedIds.has(id)).length;
      totalUtil += referenced / injected;

      if (manifest.povPrimaryIds && manifest.povPrimaryIds.length > 0) {
        const primaryInjected = manifest.povPrimaryIds.length;
        const primaryReferenced = manifest.povPrimaryIds.filter((id: string) => referencedIds.has(id)).length;
        totalPrimaryUtil += primaryReferenced / primaryInjected;
      }
      utilCount++;
    } else if (manifest.injected_count && manifest.injected_count > 0) {
      // Legacy format
      totalUtil += (manifest.referenced_count ?? 0) / manifest.injected_count;
      if (manifest.primary_injected && manifest.primary_injected > 0) {
        totalPrimaryUtil += (manifest.primary_referenced ?? 0) / manifest.primary_injected;
      }
      utilCount++;
    }
  }
  return { totalUtil, totalPrimaryUtil, utilCount };
}

/** Validation error/warning rates — structural error and repetition counts over speaker turns. */
export function computeValidationRates(
  session: DebateSession,
): { totalTurns: number; structuralErrors: number; repetitionWarnings: number } {
  const validations = session.turn_validations ?? {};
  const validationEntries = Object.values(validations) as { final?: { issues?: string[] } }[];
  const totalTurns = session.transcript.filter((e: { type: string }) =>
    e.type === 'opening' || e.type === 'statement',
  ).length;
  let structuralErrors = 0, repetitionWarnings = 0;
  for (const v of validationEntries) {
    const issues = (v as any)?.final?.issues ?? (v as any)?.attempts?.flatMap((a: any) => a.issues ?? []) ?? [];
    for (const issue of issues) {
      const text = typeof issue === 'string' ? issue : (issue as any)?.message ?? '';
      if (/unknown move|schema|missing|move_types/i.test(text)) structuralErrors++;
      if (/repeat|repetition|same moves/i.test(text)) repetitionWarnings++;
    }
  }
  return { totalTurns, structuralErrors, repetitionWarnings };
}

/**
 * AN-structural metrics (Parameters 11-14): taxonomy mapping ratio, near-miss
 * duplicate count, borderline FIRE claim survival, and average branch cohesion.
 * All derived from the argument network + transcript taxonomy refs.
 */
export function computeAnStructuralMetrics(
  session: DebateSession,
  an: ArgNetwork,
): {
  taxonomyMappedRatio: number | null;
  nearMissDups: number | null;
  borderlineSurvival: number | null;
  avgBranchCohesion: number | null;
} {
  // ── Parameter 11: Cluster quality — taxonomy mapping ratio ──
  // What fraction of AN nodes have taxonomy_refs (mapped to existing taxonomy nodes)?
  let taxonomyMappedRatio: number | null = null;
  if (an && an.nodes.length > 0) {
    const allRefIds = new Set<string>();
    for (const entry of session.transcript) {
      for (const ref of entry.taxonomy_refs ?? []) allRefIds.add(ref.node_id);
    }
    // Nodes whose speaker references match taxonomy = mapped
    const mapped = an.nodes.filter((n: ArgumentNetworkNode) => {
      const entryRefs = session.transcript
        .filter((e: { id: string }) => e.id === n.source_entry_id)
        .flatMap((e: { taxonomy_refs?: { node_id: string }[] }) => e.taxonomy_refs ?? []);
      return entryRefs.length > 0;
    }).length;
    taxonomyMappedRatio = mapped / an.nodes.length;
  }

  // ── Parameter 12: Near-miss duplicates ──
  // Count AN node pairs with high text similarity that weren't merged
  let nearMissDups: number | null = null;
  if (an && an.nodes.length >= 2 && an.nodes.length <= 100) {
    let count = 0;
    for (let i = 0; i < an.nodes.length; i++) {
      for (let j = i + 1; j < an.nodes.length; j++) {
        const a = an.nodes[i].text.toLowerCase().split(/\s+/);
        const b = an.nodes[j].text.toLowerCase().split(/\s+/);
        const shared = a.filter((w: string) => b.includes(w)).length;
        const overlap = shared / Math.max(a.length, b.length);
        if (overlap >= 0.7 && overlap < 0.85) count++; // Near-miss range
      }
    }
    nearMissDups = count;
  }

  // ── Parameter 13: Borderline FIRE claim survival ──
  // Claims with extraction_confidence near the acceptance threshold — did they survive debate?
  let borderlineSurvival: number | null = null;
  if (an && an.nodes.length > 0) {
    const borderline = an.nodes.filter((n: ArgumentNetworkNode) =>
      n.extraction_confidence != null &&
      n.extraction_confidence >= 0.5 && n.extraction_confidence <= 0.7,
    );
    if (borderline.length >= 2) {
      const refuted = borderline.filter((n: ArgumentNetworkNode) =>
        (n.computed_strength ?? n.base_strength ?? 0.5) < 0.25,
      ).length;
      borderlineSurvival = 1 - refuted / borderline.length;
    }
  }

  // ── Parameter 14: Branch cohesion — avg base_strength of taxonomy-grounded nodes ──
  let avgBranchCohesion: number | null = null;
  if (an && an.nodes.length > 0) {
    const grounded = an.nodes.filter((n: ArgumentNetworkNode) => n.base_strength != null);
    if (grounded.length >= 3) {
      avgBranchCohesion = grounded.reduce((s: number, n: ArgumentNetworkNode) => s + (n.base_strength ?? 0.5), 0) / grounded.length;
    }
  }

  return { taxonomyMappedRatio, nearMissDups, borderlineSurvival, avgBranchCohesion };
}

/**
 * QBAF concordance with synthesis preferences.
 * Synthesis preferences use internal claim IDs (C1, C2...) not AN IDs (AN-1, AN-2...).
 * The argument_map maps C-IDs to claim text. We match claim text to AN nodes by word overlap.
 */
export function computeQbafConcordance(session: DebateSession, an: ArgNetwork): number | null {
  let concordance: number | null = null;
  const synthEntry = session.transcript.find((e: { type: string }) => e.type === 'concluding');
  const synthMeta = (synthEntry?.metadata as Record<string, unknown>)?.synthesis as {
    preferences?: { prevails?: string; claim_ids?: string[]; conflict?: string }[];
    argument_map?: { claim_id?: string; claim?: string; claimant?: string }[];
  } | undefined;
  if (synthMeta?.preferences && synthMeta.argument_map && an && an.nodes.length > 0) {
    // Build C-ID → claim text lookup from argument_map (which is an array)
    const argMapEntries = Array.isArray(synthMeta.argument_map) ? synthMeta.argument_map : [];
    const claimTextById = new Map<string, string>();
    for (const entry of argMapEntries) {
      if (entry.claim_id && entry.claim) claimTextById.set(entry.claim_id, entry.claim);
    }

    // For each preference with 2+ claim_ids, find the best AN node match for each claim
    let matches = 0, total = 0;
    for (const pref of synthMeta.preferences) {
      if (!pref.claim_ids || pref.claim_ids.length < 2 || pref.prevails === 'undecidable') continue;
      // Find AN nodes matching each claim by text word overlap
      const claimStrengths: number[] = [];
      for (const cid of pref.claim_ids) {
        const claimText = claimTextById.get(cid);
        if (!claimText) continue;
        const claimWords = new Set(claimText.toLowerCase().split(/\s+/).filter(w => w.length > 3));
        let bestScore = 0, bestStrength = 0.5;
        for (const node of an.nodes) {
          const nodeWords = node.text.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
          const overlap = nodeWords.filter((w: string) => claimWords.has(w)).length / Math.max(claimWords.size, 1);
          if (overlap > bestScore) {
            bestScore = overlap;
            bestStrength = node.computed_strength ?? node.base_strength ?? 0.5;
          }
        }
        if (bestScore > 0.2) claimStrengths.push(bestStrength); // Only count if reasonable text match
      }
      if (claimStrengths.length >= 2) {
        total++;
        // Does the QBAF strength ordering match the preference verdict?
        const maxStr = Math.max(...claimStrengths);
        const prevailsIdx = pref.prevails ? pref.claim_ids.indexOf(pref.prevails) : -1;
        if (prevailsIdx >= 0 && prevailsIdx < claimStrengths.length && claimStrengths[prevailsIdx] === maxStr) matches++;
      }
    }
    concordance = total > 0 ? matches / total : null;
  }
  return concordance;
}

/**
 * Situation effectiveness — injected/referenced counts + crux alignment.
 * How many injected situation nodes align with the debate's actual cruxes?
 */
export function computeSituationAlignment(
  session: DebateSession,
  finalEval: NeutralEvaluation | undefined,
): { sitNodesInjected: number; sitNodesReferenced: number; sitCruxAlignment: number | null } {
  let sitNodesInjected = 0;
  let sitNodesReferenced = 0;
  const injectedSitIds = new Set<string>();
  for (const entry of session.transcript) {
    const manifest = (entry.metadata as Record<string, unknown>)?.injection_manifest as {
      situationNodeIds?: string[];
    } | undefined;
    if (manifest?.situationNodeIds) {
      for (const id of manifest.situationNodeIds) injectedSitIds.add(id);
    }
    for (const ref of entry.taxonomy_refs ?? []) {
      if (typeof ref.node_id === 'string' && ref.node_id.startsWith('sit-')) {
        sitNodesReferenced++;
      }
    }
  }
  sitNodesInjected = injectedSitIds.size;

  // Situation-crux alignment: do the neutral evaluator's cruxes match injected situation nodes?
  // Uses word overlap between crux descriptions and situation node labels/descriptions.
  let sitCruxAlignment: number | null = null;
  if (finalEval && finalEval.cruxes.length > 0 && injectedSitIds.size > 0) {
    // We don't have situation node text here, but we can check if crux descriptions
    // mention situation-related terms by matching against taxonomy_refs that are sit- IDs.
    // Better approach: check if sit- refs appear in entries that address each crux's topic.
    // Simplest viable: for each crux, check if any sit- ID was referenced in the same
    // round(s) where that crux's speakers are active.
    const cruxSpeakers = finalEval.cruxes.map((c: { speakers_involved: string[] }) =>
      new Set(c.speakers_involved.map((s: string) => s.toLowerCase())),
    );

    // Map speaker labels (A/B/C) back to POV names via neutral_speaker_mapping
    const reverseMap = (session as any).neutral_speaker_mapping?.reverse as Record<string, string> | undefined;

    let alignedCruxes = 0;
    for (const crux of finalEval.cruxes) {
      // Get the POV names for speakers involved in this crux
      const cruxPovs = new Set<string>();
      for (const s of crux.speakers_involved) {
        const label = `Speaker ${s}`;
        const poverId = reverseMap?.[label];
        if (poverId) cruxPovs.add(poverId);
      }

      // Check if any entry by these speakers referenced a sit- node
      let hasSitRef = false;
      for (const entry of session.transcript) {
        if (entry.type !== 'statement' && entry.type !== 'opening') continue;
        if (!cruxPovs.has(entry.speaker)) continue;
        const sitRef = (entry.taxonomy_refs ?? []).some(
          (r: { node_id: string }) => r.node_id.startsWith('sit-') && injectedSitIds.has(r.node_id),
        );
        if (sitRef) { hasSitRef = true; break; }
      }
      if (hasSitRef) alignedCruxes++;
    }
    sitCruxAlignment = alignedCruxes / finalEval.cruxes.length;
  }

  return { sitNodesInjected, sitNodesReferenced, sitCruxAlignment };
}

/**
 * Topic coherence per speaker: mean embedding similarity of each speaker's claims
 * to the crux centroid (1.0 = perfectly on-topic).
 */
export function computeTopicCoherence(session: DebateSession, an: ArgNetwork): Record<string, number> | null {
  let topicCoherencePerSpeaker: Record<string, number> | null = null;
  if (an && an.nodes.length > 0) {
    const cruxes = (session as any).crux_tracker as TrackedCrux[] | undefined;
    if (cruxes && cruxes.length > 0) {
      const cruxEmbeddings = cruxes
        .map(c => an.nodes.find((n: ArgumentNetworkNode) => n.id === c.id)?.embedding)
        .filter((e): e is number[] => !!e);
      if (cruxEmbeddings.length > 0) {
        const dim = cruxEmbeddings[0].length;
        const centroid = new Array(dim).fill(0) as number[];
        for (const emb of cruxEmbeddings) {
          for (let i = 0; i < dim; i++) centroid[i] += emb[i];
        }
        for (let i = 0; i < dim; i++) centroid[i] /= cruxEmbeddings.length;

        topicCoherencePerSpeaker = {};
        const speakers = [...new Set(an.nodes.map((n: ArgumentNetworkNode) => n.speaker).filter(s => s !== 'system' && s !== 'document'))];
        for (const sp of speakers) {
          const spNodes = an.nodes.filter((n: ArgumentNetworkNode) => n.speaker === sp && n.embedding);
          if (spNodes.length === 0) continue;
          let simSum = 0;
          for (const n of spNodes) {
            let dot = 0, normA = 0, normB = 0;
            for (let i = 0; i < dim; i++) {
              dot += n.embedding![i] * centroid[i];
              normA += n.embedding![i] * n.embedding![i];
              normB += centroid[i] * centroid[i];
            }
            const denom = Math.sqrt(normA) * Math.sqrt(normB);
            simSum += denom > 0 ? dot / denom : 0;
          }
          topicCoherencePerSpeaker[sp] = simSum / spNodes.length;
        }
      }
    }
  }
  return topicCoherencePerSpeaker;
}

/** Clarity metrics (Wachsmuth: Clarity, t/1120) — mean sentence length, lexical diversity, jargon density. */
export function computeClarityMetrics(
  session: DebateSession,
  an: ArgNetwork,
): { clarityMSL: number | null; clarityLD: number | null; clarityJD: number | null } {
  const speakerTexts = (session.transcript ?? [])
    .filter(e => (e.type === 'opening' || e.type === 'statement') && e.content)
    .map(e => e.content);
  const clarityMSL = speakerTexts.length > 0
    ? speakerTexts.reduce((sum, t) => sum + meanSentenceLength(t), 0) / speakerTexts.length
    : null;
  const clarityLD = speakerTexts.length > 0
    ? speakerTexts.reduce((sum, t) => sum + lexicalDiversity(t), 0) / speakerTexts.length
    : null;
  const domainTerms = new Set<string>();
  for (const entry of an?.nodes ?? []) {
    for (const w of entry.text.toLowerCase().match(/[a-z'-]+/g) ?? []) {
      if (w.length >= 6) domainTerms.add(w);
    }
  }
  const clarityJD = speakerTexts.length > 0 && domainTerms.size > 0
    ? speakerTexts.reduce((sum, t) => sum + jargonDensity(t, domainTerms), 0) / speakerTexts.length
    : null;
  return { clarityMSL, clarityLD, clarityJD };
}

/** Affect signals (Wachsmuth: Emotional Appeal, t/1121) — intensity mean/variance and appropriateness. */
export function computeAffectSignals(
  session: DebateSession,
  rounds: number,
): { affectIntensityMean: number | null; affectIntensityVariance: number | null; affectAppropMean: number | null } {
  const affectIntensities: number[] = [];
  const affectAppropScores: number[] = [];
  for (const entry of session.transcript ?? []) {
    if (entry.type !== 'opening' && entry.type !== 'statement') continue;
    if (entry.speaker === 'system' || entry.speaker === 'moderator') continue;
    if (!entry.content) continue;
    const intensity = computeAffectIntensity(entry.content);
    if (intensity != null) affectIntensities.push(intensity);
    const profile = computeAffectProfile(entry.content);
    if (profile) {
      const entryRound = (entry.metadata as Record<string, unknown>)?.round as number ?? 1;
      const phase = getDebatePhase(entryRound, rounds);
      const approp = computeAffectAppropriateness(profile, phase);
      if (approp != null) affectAppropScores.push(approp);
      if (phase === 'concluding' && approp != null && approp < 0.40 && profile.outrage > 0.50) {
        console.warn(`[calibration] concluding-phase turn has low affect_appropriateness (${approp.toFixed(3)}) with high outrage (${profile.outrage.toFixed(3)}) — debate ${session.id}`);
      }
    }
  }
  const affectIntensityMean = affectIntensities.length > 0
    ? affectIntensities.reduce((a, b) => a + b, 0) / affectIntensities.length
    : null;
  const affectIntensityVariance = affectIntensities.length > 0
    ? affectIntensities.reduce((sum, v) => sum + (v - affectIntensityMean!) ** 2, 0) / affectIntensities.length
    : null;
  const affectAppropMean = affectAppropScores.length > 0
    ? affectAppropScores.reduce((a, b) => a + b, 0) / affectAppropScores.length
    : null;
  return { affectIntensityMean, affectIntensityVariance, affectAppropMean };
}

/** Camp insularity (BEA: Reflective User Engagement, t/1117) — mean and max same-camp citation rate. */
export function computeCampInsularity(
  session: DebateSession,
  speakers: Set<string>,
): { campInsularityRate: number | null; campInsularityMax: number | null } {
  const speakerInsularityRates: number[] = [];
  for (const speaker of speakers) {
    if (speaker === 'system' || speaker === 'moderator' || speaker === 'user') continue;
    const nodeIds = (session.transcript ?? [])
      .filter((e: { type: string; speaker: string }) =>
        (e.type === 'opening' || e.type === 'statement') && e.speaker === speaker)
      .flatMap((e: { taxonomy_refs?: { node_id: string }[] }) =>
        (e.taxonomy_refs ?? []).map(r => r.node_id));
    if (nodeIds.length > 0) {
      const rate = computeCampInsularityRate(nodeIds, speaker);
      if (rate != null) speakerInsularityRates.push(rate);
    }
  }
  const campInsularityRate = speakerInsularityRates.length > 0
    ? speakerInsularityRates.reduce((a, b) => a + b, 0) / speakerInsularityRates.length
    : null;
  const campInsularityMax = speakerInsularityRates.length > 0
    ? Math.max(...speakerInsularityRates)
    : null;
  return { campInsularityRate, campInsularityMax };
}

/**
 * Peer referencing rate (Marandi: peer-referencing ↔ diversity, t/1279).
 * Fraction of speaker turns with ≥1 cross-POV dialectical edge in the AN.
 */
export function computePeerReferencing(
  session: DebateSession,
  speakers: Set<string>,
): { peerRefPerSpeaker: Record<string, number>; peerRefValues: number[]; peerReferencingRate: number | null } {
  const anNodes = session.argument_network?.nodes ?? [];
  const anEdges = session.argument_network?.edges ?? [];
  const nodeSpeaker = new Map<string, string>();
  for (const n of anNodes) {
    if (typeof n.speaker === 'string') nodeSpeaker.set(n.id, n.speaker);
  }
  // Collect source_entry_ids of turns that have cross-POV engagement
  const engagedEntryIds = new Set<string>();
  for (const edge of anEdges) {
    if (edge.type === 'revoice_of') continue;
    const srcSpeaker = nodeSpeaker.get(edge.source);
    const tgtSpeaker = nodeSpeaker.get(edge.target);
    if (srcSpeaker && tgtSpeaker && srcSpeaker !== tgtSpeaker) {
      const srcNode = anNodes.find(n => n.id === edge.source);
      if (srcNode?.source_entry_id) engagedEntryIds.add(srcNode.source_entry_id);
    }
  }
  // Per-speaker: engaged turns / total turns
  const peerRefPerSpeaker: Record<string, number> = {};
  const debaterSpeakers = [...speakers].filter(s => s !== 'system' && s !== 'moderator' && s !== 'user');
  for (const speaker of debaterSpeakers) {
    const speakerEntries = (session.transcript ?? [])
      .filter((e: { type: string; speaker: string; id?: string }) =>
        (e.type === 'opening' || e.type === 'statement') && e.speaker === speaker);
    const totalTurnsSpeaker = speakerEntries.length;
    if (totalTurnsSpeaker === 0) continue;
    const engagedTurns = speakerEntries.filter((e: { id?: string }) =>
      e.id != null && engagedEntryIds.has(e.id)).length;
    peerRefPerSpeaker[speaker] = engagedTurns / totalTurnsSpeaker;
  }
  const peerRefValues = Object.values(peerRefPerSpeaker);
  const peerReferencingRate = anNodes.length > 0 && peerRefValues.length > 0
    ? peerRefValues.reduce((a, b) => a + b, 0) / peerRefValues.length
    : null;
  return { peerRefPerSpeaker, peerRefValues, peerReferencingRate };
}

/**
 * Local sufficiency (Wachsmuth: Local Sufficiency, t/1341).
 * Mean per-claim sufficiency over eligible claims, bare-assertion rate, and
 * per-speaker means. Excludes final-round claims (maturity window).
 */
export function computeLocalSufficiency(
  session: DebateSession,
  an: ArgNetwork,
  anEdges: NonNullable<ArgNetwork>['edges'],
): {
  localSufficiencyMean: number | null;
  unsupportedClaimRate: number | null;
  localSufficiencyBySpeaker: Record<string, number> | null;
} {
  let localSufficiencyMean: number | null = null;
  let unsupportedClaimRate: number | null = null;
  let localSufficiencyBySpeaker: Record<string, number> | null = null;
  if (an && an.nodes.length > 0) {
    const entryRoundMap = new Map<string, number>();
    let maxRound = 0;
    for (const entry of session.transcript ?? []) {
      const round = (entry.metadata as Record<string, unknown>)?.round as number ?? 0;
      if (entry.id) entryRoundMap.set(entry.id, round);
      if (round > maxRound) maxRound = round;
    }

    // Weight-derived fallback since 2026-07-09 (t/1434); pre-change values used constant 0.7.
    const WEIGHT_TO_STRENGTH: Record<number, 'decisive' | 'substantial' | 'tangential'> = {
      1.0: 'decisive', 0.7: 'substantial', 0.3: 'tangential',
    };
    const strengthMult = (s?: 'decisive' | 'substantial' | 'tangential', w?: number): number => {
      const category = s ?? (w !== undefined ? WEIGHT_TO_STRENGTH[w] : undefined);
      if (category === 'decisive') return 1.0;
      if (category === 'substantial') return 0.7;
      if (category === 'tangential') return 0.3;
      return 0.7;
    };

    const eligibleClaims = an.nodes.filter(n => {
      if (n.speaker === 'system' || n.speaker === 'document') return false;
      if (maxRound > 1) {
        const round = entryRoundMap.get(n.source_entry_id) ?? 0;
        if (round >= maxRound) return false;
      }
      return true;
    });

    if (eligibleClaims.length > 0) {
      const incomingSupports = new Map<string, typeof anEdges>();
      for (const edge of anEdges) {
        if (edge.type !== 'supports') continue;
        const existing = incomingSupports.get(edge.target) ?? [];
        existing.push(edge);
        incomingSupports.set(edge.target, existing);
      }

      const perSpeakerScores: Record<string, number[]> = {};
      let unsupportedCount = 0;
      const scores: number[] = [];

      for (const claim of eligibleClaims) {
        const supports = incomingSupports.get(claim.id) ?? [];
        if (supports.length === 0) {
          unsupportedCount++;
          scores.push(0);
          (perSpeakerScores[claim.speaker] ??= []).push(0);
          continue;
        }
        const weightedSupport = supports.reduce((sum, e) => {
          const w = e.weight ?? 0.5;
          const sm = strengthMult(e.strength, e.weight);
          const warrantBonus = e.warrant?.trim() ? 1.25 : 1.0;
          return sum + w * sm * warrantBonus;
        }, 0);
        const s = Math.min(1, weightedSupport / 1.0);
        scores.push(s);
        (perSpeakerScores[claim.speaker] ??= []).push(s);
      }

      localSufficiencyMean = scores.reduce((a, b) => a + b, 0) / scores.length;
      unsupportedClaimRate = unsupportedCount / eligibleClaims.length;
      const bySpeaker: Record<string, number> = {};
      for (const [speaker, vals] of Object.entries(perSpeakerScores)) {
        bySpeaker[speaker] = vals.reduce((a, b) => a + b, 0) / vals.length;
      }
      if (Object.keys(bySpeaker).length > 0) localSufficiencyBySpeaker = bySpeaker;
    }
  }
  return { localSufficiencyMean, unsupportedClaimRate, localSufficiencyBySpeaker };
}
