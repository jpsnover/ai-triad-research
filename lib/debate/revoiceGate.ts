import { cosineSimilarity } from './taxonomyRelevance.js';
import type { ArgumentNetworkNode, RevoiceGateResult } from './types.js';

interface AnchorCheckResult {
  source: 'taxonomy' | 'dynamic_an';
  original_top3: string[];
  revoiced_top3: string[];
  overlap_count: number;
}

function getTop3NodeIds(
  textEmbedding: number[],
  embeddings: Record<string, { vector: number[] }>,
): string[] {
  const scored: { id: string; sim: number }[] = [];
  for (const [id, entry] of Object.entries(embeddings)) {
    if (entry.vector?.length > 0) {
      scored.push({ id, sim: cosineSimilarity(textEmbedding, entry.vector) });
    }
  }
  scored.sort((a, b) => b.sim - a.sim);
  return scored.slice(0, 3).map(s => s.id);
}

/**
 * Layer 1a: Taxonomy anchor check.
 * Compares the top-3 nearest taxonomy nodes for both the original claim
 * and the revoiced text. Passes if ≥2 of 3 overlap.
 */
function checkTaxonomyAnchors(
  originalEmbedding: number[],
  revoicedEmbedding: number[],
  taxonomyEmbeddings: Record<string, { vector: number[] }>,
): AnchorCheckResult {
  const originalTop3 = getTop3NodeIds(originalEmbedding, taxonomyEmbeddings);
  const revoicedTop3 = getTop3NodeIds(revoicedEmbedding, taxonomyEmbeddings);
  const overlap = originalTop3.filter(id => revoicedTop3.includes(id));
  return {
    source: 'taxonomy',
    original_top3: originalTop3,
    revoiced_top3: revoicedTop3,
    overlap_count: overlap.length,
  };
}

/**
 * Layer 1b: Dynamic AN anchor fallback.
 * Uses the top-3 most-cited AN nodes from the last 2 rounds as anchors
 * when the taxonomy check produces zero overlapping nodes.
 */
function checkDynamicANAnchors(
  originalEmbedding: number[],
  revoicedEmbedding: number[],
  anNodes: ArgumentNetworkNode[],
  currentRound: number,
): AnchorCheckResult | null {
  const recentNodes = anNodes.filter(
    n => n.embedding?.length && n.turn_number >= currentRound - 1,
  );
  if (recentNodes.length === 0) return null;

  const citationCount = new Map<string, number>();
  for (const node of recentNodes) {
    for (const ref of node.taxonomy_refs) {
      citationCount.set(ref, (citationCount.get(ref) || 0) + 1);
    }
  }

  const anchorEmbeddings: Record<string, { vector: number[] }> = {};
  const sortedNodeIds = [...new Set(recentNodes.map(n => n.id))];

  const nodeById = new Map(recentNodes.map(n => [n.id, n]));
  const scored = sortedNodeIds
    .map(id => {
      const node = nodeById.get(id);
      if (!node?.embedding) return null;
      const refs = node.taxonomy_refs.length;
      return { id, node, refs };
    })
    .filter(Boolean) as { id: string; node: ArgumentNetworkNode; refs: number }[];

  scored.sort((a, b) => b.refs - a.refs);
  for (const entry of scored.slice(0, 3)) {
    anchorEmbeddings[entry.id] = { vector: entry.node.embedding! };
  }

  if (Object.keys(anchorEmbeddings).length === 0) return null;

  const originalTop3 = getTop3NodeIds(originalEmbedding, anchorEmbeddings);
  const revoicedTop3 = getTop3NodeIds(revoicedEmbedding, anchorEmbeddings);
  const overlap = originalTop3.filter(id => revoicedTop3.includes(id));
  return {
    source: 'dynamic_an',
    original_top3: originalTop3,
    revoiced_top3: revoicedTop3,
    overlap_count: overlap.length,
  };
}

const ENTITY_PATTERNS = [
  /\b\d+(?:\.\d+)?(?:\s*(?:×|x)\s*10\^?\d+)?\s*(?:FLOP|flop|FLOPs|parameter|param|%|percent|billion|million|trillion|year|month|day)\b/gi,
  /\b(?:GPT|BERT|LLaMA|Claude|Gemini|PaLM|Chinchilla|DALL-E|Midjourney|Stable Diffusion|AlphaFold|DeepMind|OpenAI|Anthropic|Google|Meta|Microsoft)\b/g,
  /\b(?:EU AI Act|NIST|IEEE|ISO|GDPR|EO \d+|PL \d+-\d+)\b/gi,
  /\$\s*\d+(?:\.\d+)?\s*(?:billion|million|trillion|B|M|T)\b/gi,
];

const THRESHOLD_PATTERNS = [
  /(?:above|below|exceeds?|at least|more than|less than|greater than|fewer than|≥|≤|>|<)\s*\d+/gi,
  /\d+(?:\.\d+)?\s*(?:×|x)\s*10\^\d+/g,
];

/**
 * Layer 2: Entity and relation preservation.
 * Extracts named entities, numeric thresholds, and checks that
 * the revoiced text preserves them.
 */
function checkEntityPreservation(
  originalText: string,
  revoicedText: string,
): { preserved: boolean; missing_entities: string[]; missing_thresholds: string[] } {
  const extractMatches = (text: string, patterns: RegExp[]): string[] => {
    const matches = new Set<string>();
    for (const pattern of patterns) {
      const re = new RegExp(pattern.source, pattern.flags);
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        matches.add(m[0].trim().toLowerCase());
      }
    }
    return [...matches];
  };

  const originalEntities = extractMatches(originalText, ENTITY_PATTERNS);
  const revoicedLower = revoicedText.toLowerCase();
  const missingEntities = originalEntities.filter(e => !revoicedLower.includes(e));

  const originalThresholds = extractMatches(originalText, THRESHOLD_PATTERNS);
  const missingThresholds = originalThresholds.filter(t => !revoicedLower.includes(t));

  return {
    preserved: missingEntities.length === 0 && missingThresholds.length === 0,
    missing_entities: missingEntities,
    missing_thresholds: missingThresholds,
  };
}

export interface RevoiceGateInput {
  originalText: string;
  revoicedText: string;
  originalEmbedding: number[];
  revoicedEmbedding: number[];
  taxonomyEmbeddings: Record<string, { vector: number[] }>;
  anNodes: ArgumentNetworkNode[];
  currentRound: number;
}

/**
 * Run the full propositional gate: Layer 1 (anchor check with dynamic fallback)
 * then Layer 2 (entity preservation). Returns diagnostics and pass/fail.
 */
export function runPropositionalGate(input: RevoiceGateInput): RevoiceGateResult {
  const taxonomyResult = checkTaxonomyAnchors(
    input.originalEmbedding,
    input.revoicedEmbedding,
    input.taxonomyEmbeddings,
  );

  let anchorResult = taxonomyResult;

  if (taxonomyResult.overlap_count === 0) {
    const dynamicResult = checkDynamicANAnchors(
      input.originalEmbedding,
      input.revoicedEmbedding,
      input.anNodes,
      input.currentRound,
    );
    if (dynamicResult) {
      anchorResult = dynamicResult;
    }
  }

  const anchorPassed = anchorResult.overlap_count >= 2;

  const entityResult = checkEntityPreservation(input.originalText, input.revoicedText);

  const passed = anchorPassed && entityResult.preserved;

  return {
    passed,
    anchor_source: anchorResult.overlap_count > 0 ? anchorResult.source : null,
    taxonomy_overlap: {
      original_top3: anchorResult.original_top3,
      revoiced_top3: anchorResult.revoiced_top3,
      overlap_count: anchorResult.overlap_count,
    },
    entity_preservation: entityResult,
    downgraded_to_check: !passed,
  };
}
