import type { PovNode } from './taxonomyTypes.js';
import type { NodeTestingRecord } from './debateTested.js';
import { WELL_TESTED_EXCLUSION } from './debateTested.js';

// ── Importance weights (ticket-spec formula, t/1587) ─────────────────────────

export const IMPORTANCE_WEIGHTS = {
  degree: 0.25,
  crux_density: 0.15,
  policy_linkage: 0.25,
  doctrinal_anchor: 0.20,
  usage: 0.15,
} as const;

export const DEFICIT_SCORES: Record<string, number> = {
  untested: 1.0,
  cited: 0.7,
  stale: 0.6,
  contested: 0.4,
  well_tested: 0.1,
};

// ── Batch config types ───────────────────────────────────────────────────────

export interface DebateBatchEntry {
  name: string;
  topic: string;
  targetNodeId: string;
  targetPov: string;
  testingPriority: number;
}

export interface DebateBatchConfig {
  name: string;
  generated: string;
  debates: DebateBatchEntry[];
}

// ── Importance computation ───────────────────────────────────────────────────

export interface ImportanceInputs {
  degree: number;
  cruxDensity: number;
  policyLinkage: number;
  doctrinalAnchor: number;
  usage: number;
}

export function computeImportance(inputs: ImportanceInputs): number {
  return (
    IMPORTANCE_WEIGHTS.degree * inputs.degree +
    IMPORTANCE_WEIGHTS.crux_density * inputs.cruxDensity +
    IMPORTANCE_WEIGHTS.policy_linkage * inputs.policyLinkage +
    IMPORTANCE_WEIGHTS.doctrinal_anchor * inputs.doctrinalAnchor +
    IMPORTANCE_WEIGHTS.usage * inputs.usage
  );
}

function normalize(values: number[]): Map<number, number> {
  const max = Math.max(...values, 1);
  const result = new Map<number, number>();
  for (let i = 0; i < values.length; i++) {
    result.set(i, values[i] / max);
  }
  return result;
}

export function computeNodeImportance(
  nodes: ReadonlyArray<PovNode>,
  cruxLinks: ReadonlyMap<string, number>,
): Map<string, { importance: number; inputs: ImportanceInputs }> {
  const degrees = nodes.map(n => n.children.length + n.situation_refs.length + (n.conflict_ids?.length ?? 0));
  const cruxes = nodes.map(n => cruxLinks.get(n.id) ?? 0);
  const policies = nodes.map(n => n.graph_attributes?.policy_actions?.length ?? 0);
  const usages = nodes.map(n => n.debate_refs?.length ?? 0);

  const normDegree = normalize(degrees);
  const normCrux = normalize(cruxes);
  const normPolicy = normalize(policies);
  const normUsage = normalize(usages);

  const result = new Map<string, { importance: number; inputs: ImportanceInputs }>();
  for (let i = 0; i < nodes.length; i++) {
    const inputs: ImportanceInputs = {
      degree: normDegree.get(i) ?? 0,
      cruxDensity: normCrux.get(i) ?? 0,
      policyLinkage: normPolicy.get(i) ?? 0,
      doctrinalAnchor: nodes[i].doctrinally_anchored ? 1.0 : 0,
      usage: normUsage.get(i) ?? 0,
    };
    result.set(nodes[i].id, { importance: computeImportance(inputs), inputs });
  }
  return result;
}

// ── Deficit computation ──────────────────────────────────────────────────────

export function computeDeficit(tier: string, stale: boolean): number {
  if (stale && tier !== 'untested') return DEFICIT_SCORES.stale;
  return DEFICIT_SCORES[tier] ?? DEFICIT_SCORES.untested;
}

// ── Scheduler ────────────────────────────────────────────────────────────────

export interface SchedulerInput {
  records: NodeTestingRecord[];
  nodes: ReadonlyArray<PovNode>;
  cruxLinks: ReadonlyMap<string, number>;
  topN?: number;
  batchName?: string;
  generatedDate?: string;
  excludeNodeIds?: Set<string>;
}

export function generateBatchConfig(input: SchedulerInput): DebateBatchConfig {
  const {
    records,
    nodes,
    cruxLinks,
    topN = 10,
    batchName,
    generatedDate,
    excludeNodeIds,
  } = input;

  const importanceMap = computeNodeImportance(nodes, cruxLinks);
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  const scored = records
    .filter(r => !excludeNodeIds?.has(r.nodeId))
    .map(r => {
      const imp = importanceMap.get(r.nodeId);
      const importance = imp?.importance ?? 0;
      const deficit = computeDeficit(r.tier, r.stale);
      return { record: r, importance, deficit, testingPriority: importance * deficit };
    })
    .sort((a, b) => b.testingPriority - a.testingPriority);

  const povBuckets: Record<string, typeof scored> = {};
  for (const s of scored) {
    const pov = s.record.pov;
    (povBuckets[pov] ??= []).push(s);
  }
  const povKeys = Object.keys(povBuckets).sort();
  const povCursors: Record<string, number> = {};
  for (const k of povKeys) povCursors[k] = 0;

  const selected: typeof scored = [];
  const seenNodes = new Set<string>();

  while (selected.length < topN) {
    let added = false;
    for (const pov of povKeys) {
      if (selected.length >= topN) break;
      const bucket = povBuckets[pov];
      if (!bucket) continue;
      while (povCursors[pov] < bucket.length) {
        const candidate = bucket[povCursors[pov]];
        povCursors[pov]++;
        if (!seenNodes.has(candidate.record.nodeId)) {
          seenNodes.add(candidate.record.nodeId);
          selected.push(candidate);
          added = true;
          break;
        }
      }
    }
    if (!added) break;
  }

  const dateStr = generatedDate ?? new Date().toISOString().slice(0, 10);
  const debates: DebateBatchEntry[] = selected.map((s, i) => {
    const node = nodeMap.get(s.record.nodeId);
    const label = node?.label ?? s.record.label;
    return {
      name: `severe-test-${i + 1}-${s.record.nodeId}`,
      topic: `Severe test: ${label}`,
      targetNodeId: s.record.nodeId,
      targetPov: s.record.pov,
      testingPriority: Math.round(s.testingPriority * 1000) / 1000,
    };
  });

  return {
    name: batchName ?? `severe-test-batch-${dateStr}`,
    generated: dateStr,
    debates,
  };
}
