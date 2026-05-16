// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Source evidence retrieval from the pre-built index.
 * No filesystem access — operates on an in-memory index object.
 *
 * The index is built by scripts/build-evidence-index.py (or the Python equivalent)
 * and stored at ai-triad-data/taxonomy/source_evidence_index.json.
 * Structure: { [nodeId]: { facts: SourceFact[], keyPoints: SourceKeyPoint[] } }
 */

// ── Types ─────────────────────────────────────────────────

export interface SourceFact {
  claim: string;
  label: string;
  doc_id: string;
  specificity: string;
  temporal_bound?: string | null;
}

export interface SourceKeyPoint {
  stance: string;
  pov: string;
  point: string;
  verbatim?: string;
  doc_id: string;
}

export interface SourceEvidenceIndex {
  [nodeId: string]: {
    facts: SourceFact[];
    keyPoints: SourceKeyPoint[];
  };
}

export interface EvidenceBrief {
  facts: SourceFact[];
  keyPoints: SourceKeyPoint[];
  formattedBlock: string;
  nodesCovered: string[];
  totalCandidates: number;
}

/** Map of doc_id → human-readable document title */
export type DocTitleMap = Record<string, string>;

// ── Evidence retrieval ────────────────────────────────────

const SPECIFICITY_RANK: Record<string, number> = {
  precise: 3,
  qualified: 2,
  vague: 1,
  unknown: 0,
};

/**
 * Retrieve evidence for a set of taxonomy node IDs from the pre-built index.
 *
 * @param targetNodeIds - Node IDs from the plan's target_nodes
 * @param debaterPov - The debater's perspective (accelerationist/safetyist/skeptic)
 * @param index - The pre-loaded evidence index
 * @param maxFacts - Maximum factual claims to include (default 3)
 * @param maxKeyPoints - Maximum POV key points to include (default 2)
 */
export function retrieveSourceEvidence(
  targetNodeIds: string[],
  debaterPov: string,
  index: SourceEvidenceIndex,
  maxFacts: number = 3,
  maxKeyPoints: number = 2,
  docTitles?: DocTitleMap,
): EvidenceBrief {
  const nodeSet = new Set(targetNodeIds);

  // Collect candidate facts
  const candidateFacts: SourceFact[] = [];
  for (const nodeId of nodeSet) {
    const entry = index[nodeId];
    if (entry?.facts) candidateFacts.push(...entry.facts);
  }

  // Deduplicate by claim text
  const seenClaims = new Set<string>();
  const uniqueFacts = candidateFacts.filter(f => {
    const key = f.claim.slice(0, 80).toLowerCase();
    if (seenClaims.has(key)) return false;
    seenClaims.add(key);
    return true;
  });

  // Rank: precise > qualified > vague; prefer facts with temporal bounds
  const rankedFacts = uniqueFacts.sort((a, b) => {
    const specDiff = (SPECIFICITY_RANK[b.specificity] ?? 0) - (SPECIFICITY_RANK[a.specificity] ?? 0);
    if (specDiff !== 0) return specDiff;
    return (b.temporal_bound ? 1 : 0) - (a.temporal_bound ? 1 : 0);
  });

  // Collect candidate key points — prefer matching POV
  const candidateKPs: SourceKeyPoint[] = [];
  for (const nodeId of nodeSet) {
    const entry = index[nodeId];
    if (entry?.keyPoints) candidateKPs.push(...entry.keyPoints);
  }

  // Rank: matching POV first, then by stance relevance, prefer items with verbatim
  const rankedKPs = candidateKPs.sort((a, b) => {
    const aPov = a.pov === debaterPov ? 10 : 0;
    const bPov = b.pov === debaterPov ? 10 : 0;
    if (aPov !== bPov) return bPov - aPov;
    const aVerb = a.verbatim ? 2 : 0;
    const bVerb = b.verbatim ? 2 : 0;
    return bVerb - aVerb;
  });

  // Deduplicate key points
  const seenPoints = new Set<string>();
  const uniqueKPs = rankedKPs.filter(kp => {
    const key = kp.point.slice(0, 80).toLowerCase();
    if (seenPoints.has(key)) return false;
    seenPoints.add(key);
    return true;
  });

  const selectedFacts = rankedFacts.slice(0, maxFacts);
  const selectedKPs = uniqueKPs.slice(0, maxKeyPoints);
  const totalCandidates = uniqueFacts.length + uniqueKPs.length;
  const nodesCovered = [...nodeSet].filter(n => index[n]?.facts?.length || index[n]?.keyPoints?.length);

  const formattedBlock = formatEvidenceBrief(selectedFacts, selectedKPs, docTitles);

  return { facts: selectedFacts, keyPoints: selectedKPs, formattedBlock, nodesCovered, totalCandidates };
}

// ── Formatting ────────────────────────────────────────────

function formatEvidenceBrief(facts: SourceFact[], keyPoints: SourceKeyPoint[], docTitles?: DocTitleMap): string {
  if (facts.length === 0 && keyPoints.length === 0) return '';

  const resolveTitle = (docId: string): string => {
    if (docTitles?.[docId]) return docTitles[docId];
    return docId;
  };

  const lines: string[] = ['=== AVAILABLE SOURCE EVIDENCE ==='];
  lines.push('Cite 1-2 of these in your statement. Reference the source by its title. Do NOT list-cite all — weave the strongest into your argument.');
  lines.push('');

  if (facts.length > 0) {
    lines.push('Factual claims from the research corpus:');
    for (let i = 0; i < facts.length; i++) {
      const f = facts[i];
      const temporal = f.temporal_bound ? ` (${f.temporal_bound})` : '';
      const title = resolveTitle(f.doc_id);
      lines.push(`  [${i + 1}] "${f.claim}"`);
      lines.push(`      — "${title}"${temporal}`);
    }
    lines.push('');
  }

  if (keyPoints.length > 0) {
    lines.push('Source document analysis:');
    for (let i = 0; i < keyPoints.length; i++) {
      const kp = keyPoints[i];
      const title = resolveTitle(kp.doc_id);
      lines.push(`  [${facts.length + i + 1}] ${kp.point}`);
      if (kp.verbatim) {
        lines.push(`      Quote: "${kp.verbatim}"`);
      }
      lines.push(`      — "${title}" (${kp.pov}, ${kp.stance})`);
    }
  }

  return lines.join('\n');
}
