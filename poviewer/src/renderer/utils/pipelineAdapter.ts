// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { Source, Point, Mapping, PovCamp, Alignment, SourceType } from '../types/types';

// === Pipeline Summary Types (mirroring the JSON schema from Invoke-POVSummary.ps1) ===

interface PipelineKeyPoint {
  taxonomy_node_id: string | null;
  category: string;
  point: string;
  verbatim?: string;
  excerpt_context: string;
  stance?: string;
}

interface PipelinePovSummary {
  stance?: string;
  key_points: PipelineKeyPoint[];
}

interface PipelineFactualClaim {
  claim: string;
  doc_position: string;
  potential_conflict_id: string | null;
}

interface PipelineUnmappedConcept {
  concept: string;
  suggested_pov: string;
  suggested_category: string;
  reason: string;
}

interface PipelineSummary {
  doc_id: string;
  taxonomy_version: string;
  generated_at: string;
  ai_model: string;
  temperature: number;
  pov_summaries: Record<string, PipelinePovSummary>;
  factual_claims: PipelineFactualClaim[];
  unmapped_concepts: PipelineUnmappedConcept[];
}

interface DiscoveredSource {
  id: string;
  title: string;
  sourceType: string;
  url: string | null;
  authors: string[];
  dateIngested: string;
  povTags: string[];
  topicTags: string[];
  oneLiner: string;
  summaryStatus: string;
  snapshotText: string;
  hasSummary: boolean;
}

// === Stance → Alignment Mapping ===

function stanceToAlignment(stance: string): Alignment {
  switch (stance) {
    case 'strongly_aligned':
    case 'aligned':
      return 'agrees';
    case 'strongly_opposed':
    case 'opposed':
      return 'contradicts';
    default:
      return 'agrees'; // neutral → agrees (document doesn't contradict)
  }
}

function stanceToStrength(stance: string): 'strong' | 'moderate' | 'weak' {
  switch (stance) {
    case 'strongly_aligned':
    case 'strongly_opposed':
      return 'strong';
    case 'aligned':
    case 'opposed':
      return 'moderate';
    default:
      return 'weak';
  }
}

// === Find excerpt in snapshot text ===

function findExcerptOffset(
  snapshotText: string,
  point: string,
  excerptContext: string,
  verbatim?: string,
): { start: number; end: number } {
  // Try verbatim text first — it's copied word-for-word from the document
  if (verbatim) {
    // Try exact match of the first sentence
    const firstSentence = verbatim.split(/(?<=[.!?])\s+/)[0];
    if (firstSentence && firstSentence.length > 20) {
      const idx = snapshotText.indexOf(firstSentence);
      if (idx >= 0) {
        // Try to find the full verbatim span
        const fullIdx = snapshotText.indexOf(verbatim, Math.max(0, idx - 10));
        if (fullIdx >= 0) {
          return { start: fullIdx, end: fullIdx + verbatim.length };
        }
        return { start: idx, end: idx + firstSentence.length };
      }
    }
    // Fallback: search for first 10 words of verbatim
    const verbatimWords = verbatim.split(/\s+/).slice(0, 10).join(' ');
    const escaped = verbatimWords.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      const regex = new RegExp(escaped.split(/\s+/).join('\\s+'), 'i');
      const match = regex.exec(snapshotText);
      if (match) {
        return { start: match.index, end: Math.min(match.index + verbatim.length, snapshotText.length) };
      }
    } catch { /* fall through */ }
  }

  // Try to find the key_point text in the snapshot
  const pointWords = point.split(/\s+/).slice(0, 8).join(' ');

  // Try exact excerpt match first (extract quoted text from excerpt_context)
  const quotedMatch = excerptContext.match(/\(([^)]+)\)/);
  if (quotedMatch) {
    const quoted = quotedMatch[1];
    // Try to find the first few words of the quoted text
    const searchTerms = quoted.split(/\s+/).slice(0, 6).join('\\s+');
    try {
      const regex = new RegExp(searchTerms, 'i');
      const match = regex.exec(snapshotText);
      if (match) {
        // Expand to capture a reasonable sentence/paragraph span
        const start = match.index;
        const end = Math.min(start + Math.max(quoted.length, 200), snapshotText.length);
        return { start, end };
      }
    } catch { /* regex failed, fall through */ }
  }

  // Try section reference (e.g., "Section II, paragraph 1")
  const sectionMatch = excerptContext.match(/Section\s+(\S+)/i);
  if (sectionMatch) {
    const sectionHeader = `## ${sectionMatch[1]}`;
    const idx = snapshotText.indexOf(sectionHeader);
    if (idx >= 0) {
      // Find a reasonable span after the section header
      const start = idx;
      const end = Math.min(start + 300, snapshotText.length);
      return { start, end };
    }
  }

  // Fallback: search for key words from the point
  const words = pointWords.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    const regex = new RegExp(words.split(/\s+/).join('\\s+'), 'i');
    const match = regex.exec(snapshotText);
    if (match) {
      return { start: match.index, end: Math.min(match.index + 200, snapshotText.length) };
    }
  } catch { /* fall through */ }

  // Last resort: no offset
  return { start: 0, end: 0 };
}

// === Taxonomy Node Lookup (id → {label, description}) ===

export type TaxNodeLookup = Record<string, { label: string; description: string }>;

// === Convert Pipeline Summary → POViewer Points/Mappings ===

export function summaryToPoints(
  summary: PipelineSummary,
  snapshotText: string,
  sourceId: string,
  taxNodes?: TaxNodeLookup,
): Point[] {
  const points: Point[] = [];
  let pointIndex = 0;

  const povCamps: PovCamp[] = ['accelerationist', 'safetyist', 'skeptic', 'situations'];

  for (const camp of povCamps) {
    const povSummary = summary.pov_summaries[camp];
    if (!povSummary || !povSummary.key_points) continue;

    for (const kp of povSummary.key_points) {
      pointIndex++;
      const kpStance = kp.stance || povSummary.stance || 'neutral';
      const { start, end } = findExcerptOffset(snapshotText, kp.point, kp.excerpt_context, kp.verbatim);

      const resolvedId = kp.taxonomy_node_id || `${camp.slice(0, 3)}-unmapped`;
      const taxNode = taxNodes?.[resolvedId];

      const mapping: Mapping = {
        camp,
        nodeId: resolvedId,
        nodeLabel: taxNode?.label ?? kp.point.slice(0, 60) + (kp.point.length > 60 ? '...' : ''),
        nodeDescription: taxNode?.description,
        category: kp.category,
        alignment: stanceToAlignment(kpStance),
        strength: stanceToStrength(kpStance),
        explanation: kp.point,
      };

      // Check if there's already a point at this offset (multi-camp mapping)
      const existing = points.find(
        p => p.startOffset === start && p.endOffset === end && start > 0,
      );

      if (existing) {
        existing.mappings.push(mapping);
        // Prefer the longer verbatim if both exist
        if (kp.verbatim && (!existing.verbatim || kp.verbatim.length > existing.verbatim.length)) {
          existing.verbatim = kp.verbatim;
        }
        // Update collision detection
        const camps = new Set(existing.mappings.map(m => m.camp));
        existing.isCollision = camps.size > 1 && existing.mappings.some(m => m.alignment === 'contradicts');
      } else {
        const id = `p-${String(pointIndex).padStart(3, '0')}`;
        points.push({
          id,
          sourceId,
          startOffset: start,
          endOffset: end,
          text: kp.point,
          verbatim: kp.verbatim,
          mappings: [mapping],
          isCollision: false,
        });
      }
    }
  }

  // Add unmapped concepts as unmapped points
  for (const concept of summary.unmapped_concepts) {
    pointIndex++;
    points.push({
      id: `p-${String(pointIndex).padStart(3, '0')}`,
      sourceId,
      startOffset: 0,
      endOffset: 0,
      text: concept.concept,
      mappings: [],
      isCollision: false,
      collisionNote: `Suggested for ${concept.suggested_pov} / ${concept.suggested_category}: ${concept.reason}`,
    });
  }

  return points;
}

// === Convert Discovered Source + Summary → POViewer Source ===

export function discoveredToSource(
  discovered: DiscoveredSource,
  summary: PipelineSummary | null,
  taxNodes?: TaxNodeLookup,
): Source {
  const sourceType = (
    discovered.sourceType === 'pdf' ? 'pdf' :
    discovered.sourceType === 'docx' ? 'docx' :
    discovered.sourceType === 'web_article' ? 'url' :
    'markdown'
  ) as SourceType;

  const points = summary
    ? summaryToPoints(summary, discovered.snapshotText, discovered.id, taxNodes)
    : [];

  return {
    id: discovered.id,
    title: discovered.title,
    url: discovered.url,
    sourceType,
    status: summary ? 'analyzed' : 'pending',
    snapshotText: discovered.snapshotText,
    points,
  };
}
