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

/** Map of doc_id → human-readable document title (legacy, still accepted) */
export type DocTitleMap = Record<string, string>;

/** Map of doc_id → source metadata with title, URL, and provenance label */
export interface DocMeta {
  title: string;
  resolved_url?: string | null;
  provenance_label?: string;
}
export type DocMetaMap = Record<string, DocMeta>;

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
  docTitles?: DocTitleMap | DocMetaMap,
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

/** Resolve doc_id to metadata. Handles both legacy DocTitleMap (string values) and DocMetaMap (object values). */
function resolveMeta(docId: string, docTitles?: DocTitleMap | DocMetaMap): DocMeta {
  const entry = docTitles?.[docId];
  if (!entry) return { title: docId };
  if (typeof entry === 'string') return { title: entry };
  return entry;
}

/** Format a source attribution line for the evidence block (plain text — LLM-friendly).
 *  Provenance labels (arXiv IDs, DOIs) are deliberately omitted here — showing them
 *  teaches the LLM the ID pattern, which it then fabricates for other citations.
 *  Links are added post-draft by linkifyEvidenceCitations(). */
function formatSourceAttribution(meta: DocMeta): string {
  return `"${meta.title}"`;
}

function formatEvidenceBrief(facts: SourceFact[], keyPoints: SourceKeyPoint[], docTitles?: DocTitleMap | DocMetaMap): string {
  if (facts.length === 0 && keyPoints.length === 0) return '';

  const lines: string[] = ['=== AVAILABLE SOURCE EVIDENCE ==='];
  lines.push('Cite 1-2 of these in your statement. Reference the source by its title. Do NOT list-cite all — weave the strongest into your argument.');
  lines.push('');

  if (facts.length > 0) {
    lines.push('Factual claims from the research corpus:');
    for (let i = 0; i < facts.length; i++) {
      const f = facts[i];
      const temporal = f.temporal_bound ? ` (${f.temporal_bound})` : '';
      const meta = resolveMeta(f.doc_id, docTitles);
      lines.push(`  [${i + 1}] "${f.claim}"`);
      lines.push(`      — ${formatSourceAttribution(meta)}${temporal}`);
      if (meta.resolved_url) {
        lines.push(`      Source URL: ${meta.resolved_url}`);
      }
    }
    lines.push('');
  }

  if (keyPoints.length > 0) {
    lines.push('Source document analysis:');
    for (let i = 0; i < keyPoints.length; i++) {
      const kp = keyPoints[i];
      const meta = resolveMeta(kp.doc_id, docTitles);
      lines.push(`  [${facts.length + i + 1}] ${kp.point}`);
      if (kp.verbatim) {
        lines.push(`      Quote: "${kp.verbatim}"`);
      }
      lines.push(`      — ${formatSourceAttribution(meta)} (${kp.pov}, ${kp.stance})`);
      if (meta.resolved_url) {
        lines.push(`      Source URL: ${meta.resolved_url}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Post-process a debater's statement to replace title mentions with clickable markdown links.
 * Called AFTER the draft is produced — does not require the LLM to generate link syntax.
 */
export function linkifyEvidenceCitations(
  statement: string,
  docTitles?: DocTitleMap | DocMetaMap,
): string {
  if (!docTitles || !statement) return statement;

  let result = statement;
  for (const [docId, entry] of Object.entries(docTitles)) {
    const meta = typeof entry === 'string' ? { title: entry } as DocMeta : entry;
    if (!meta.resolved_url) continue;

    const title = meta.title;
    if (!title || title.length < 5) continue;

    // Match the title in the statement (case-insensitive, not already inside a markdown link)
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?<!\\[)("?)(${escaped})("?)(?!\\])(?!\\()`, 'i');
    const match = result.match(pattern);
    if (match) {
      const linkText = meta.provenance_label
        ? `${title} (${meta.provenance_label})`
        : title;
      result = result.replace(pattern, `[${linkText}](${meta.resolved_url})`);
    }
  }
  return result;
}
