import { createHash } from 'crypto';
import type {
  DebateTestedTier,
  DebateTestedVerdict,
  DebateTestedEntry,
  DebateTestedRevision,
  DebateTestedRecord,
  DebateTestedClaimOutcomes,
  DebateTestedConcession,
  StrongestAttackEncountered,
  PovNode,
  ConcessionRecord,
} from './taxonomyTypes.js';
import type { ArgumentNetworkNode, ArgumentNetworkEdge } from './types.js';
import { classifyOutcome, countReferences } from './claimOutcomes.js';

// ── Constants (all stipulated per metric-provenance-register) ──────────────

export const DEBATE_TESTED_DEFAULTS = {
  SEVERE_ATTACK_THRESHOLD: 0.5,
  WELL_TESTED_MIN_CHALLENGES: 2,
  WELL_TESTED_MIN_DEBATES: 2,
  EVIDENCE_SATURATION: 5,
  COSMETIC_EDIT_SIMILARITY_THRESHOLD: 0.98,
} as const;

export const VERDICT_WEIGHTS: Record<string, number> = {
  held: 1.0,
  refined_held: 1.0,
  refined_pending: 0.6,
  refined_rejected: 0.0,
  open: 0.25,
  weakened: -0.5,
  cited: 0.0,
};

export interface DebateTestedConstants {
  SEVERE_ATTACK_THRESHOLD: number;
  WELL_TESTED_MIN_CHALLENGES: number;
  WELL_TESTED_MIN_DEBATES: number;
  EVIDENCE_SATURATION: number;
}

// ── Pure tier/sort-key computation ─────────────────────────────────────────

export function computeTierAndSortKey(
  record: ReadonlyArray<DebateTestedEntry>,
  revisions: ReadonlyArray<DebateTestedRevision>,
  constants?: Partial<DebateTestedConstants>,
): { tier: DebateTestedTier; sort_key: number } {
  const c = { ...DEBATE_TESTED_DEFAULTS, ...constants };

  if (record.length === 0) return { tier: 'untested', sort_key: 0 };

  let challenges = 0;
  let challengeDebateIds = new Set<string>();
  let held = 0;
  let weakened = 0;
  let evidence = 0;

  for (const entry of record) {
    const isChallenged = entry.strongest_attack_encountered != null &&
      entry.strongest_attack_encountered.strength >= c.SEVERE_ATTACK_THRESHOLD;

    if (isChallenged) {
      challenges++;
      challengeDebateIds.add(entry.debate_id);
    }

    const weight = verdictWeight(entry.verdict, revisions);
    const attackStrength = entry.strongest_attack_encountered?.strength ?? 0;
    evidence += attackStrength * weight;

    if (entry.verdict === 'held') held++;
    if (entry.verdict === 'weakened') weakened++;
  }

  let tier: DebateTestedTier;

  if (challenges === 0) {
    tier = record.some(e => e.verdict !== 'cited') ? 'contested' : 'cited';
    if (record.every(e => e.verdict === 'cited')) tier = 'cited';
  } else if (
    challenges >= c.WELL_TESTED_MIN_CHALLENGES &&
    challengeDebateIds.size >= c.WELL_TESTED_MIN_DEBATES &&
    isWellTestedOutcome(record, revisions)
  ) {
    tier = 'well_tested';
  } else {
    tier = 'contested';
  }

  const tierRank = tierToRank(tier);
  const clampedEvidence = Math.min(Math.max(evidence / c.EVIDENCE_SATURATION, 0), 0.99);
  const sort_key = Math.round((tierRank + clampedEvidence) * 100) / 100;

  return { tier, sort_key };
}

function tierToRank(tier: DebateTestedTier): number {
  switch (tier) {
    case 'untested': return 0;
    case 'cited': return 1;
    case 'contested': return 2;
    case 'well_tested': return 3;
  }
}

function verdictWeight(
  verdict: DebateTestedVerdict,
  revisions: ReadonlyArray<DebateTestedRevision>,
): number {
  if (verdict === 'refined') {
    const latest = revisions[revisions.length - 1];
    if (!latest) return VERDICT_WEIGHTS.refined_pending;
    if (latest.held_since === true) return VERDICT_WEIGHTS.refined_held;
    if (latest.held_since === false) return VERDICT_WEIGHTS.refined_rejected;
    return VERDICT_WEIGHTS.refined_pending;
  }
  return VERDICT_WEIGHTS[verdict] ?? 0;
}

function isWellTestedOutcome(
  record: ReadonlyArray<DebateTestedEntry>,
  revisions: ReadonlyArray<DebateTestedRevision>,
): boolean {
  const lastHeldIdx = findLastIndex(record, e => e.verdict === 'held');
  const lastWeakenedIdx = findLastIndex(record, e => e.verdict === 'weakened');

  if (lastWeakenedIdx > lastHeldIdx) return false;

  const hasRecentHeld = lastHeldIdx >= 0;
  const hasHeldRevision = revisions.some(r => r.held_since === true);

  return hasRecentHeld || hasHeldRevision;
}

function findLastIndex<T>(arr: ReadonlyArray<T>, pred: (v: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) return i;
  }
  return -1;
}

// ── Description hash ───────────────────────────────────────────────────────

export function computeDescriptionHash(description: string): string {
  return 'sha256:' + createHash('sha256').update(description).digest('hex');
}

// ── Falsifiability ordering (content-increase gate) ────────────────────────

const FALSIFIABILITY_RANK: Record<string, number> = { low: 1, medium: 2, high: 3 };

function falsifiabilityRank(level: string | undefined): number {
  return FALSIFIABILITY_RANK[level ?? ''] ?? 0;
}

// ── Harvest writer ─────────────────────────────────────────────────────────

export interface InjectionManifest {
  povNodeIds?: string[];
  povPrimaryIds?: string[];
}

export interface HarvestParams {
  debateId: string;
  date: string;
  pipelineVersion: string;
  anNodes: ReadonlyArray<ArgumentNetworkNode>;
  anEdges: ReadonlyArray<ArgumentNetworkEdge>;
  injectionManifest: InjectionManifest | null;
  taxonomyNodes: ReadonlyMap<string, PovNode>;
  concessions?: ReadonlyArray<ConcessionRecord>;
  refinedNodeIds?: ReadonlySet<string>;
  constants?: Partial<DebateTestedConstants>;
}

export interface HarvestResult {
  nodeId: string;
  entry: DebateTestedEntry;
  updatedRecord: DebateTestedRecord;
}

export function harvestDebateTested(params: HarvestParams): HarvestResult[] {
  const {
    debateId, date, pipelineVersion,
    anNodes, anEdges,
    injectionManifest, taxonomyNodes,
    concessions = [], refinedNodeIds = new Set(),
  } = params;
  const c = { ...DEBATE_TESTED_DEFAULTS, ...params.constants };

  const injectedNodeIds = new Set<string>(injectionManifest?.povNodeIds ?? []);

  const claimsByNode = buildClaimsByNode(anNodes);

  const engagedNodeIds = new Set<string>();
  for (const nodeId of injectedNodeIds) {
    if (claimsByNode.has(nodeId)) engagedNodeIds.add(nodeId);
  }
  for (const [nodeId] of claimsByNode) {
    if (injectedNodeIds.has(nodeId)) engagedNodeIds.add(nodeId);
  }

  const results: HarvestResult[] = [];

  for (const nodeId of engagedNodeIds) {
    const povNode = taxonomyNodes.get(nodeId);
    if (!povNode) continue;
    if (povNode.category !== 'Beliefs') continue;

    const claims = claimsByNode.get(nodeId) ?? [];
    const strongest = findStrongestAttack(claims, anNodes, anEdges);
    const isChallenged = strongest != null && strongest.strength >= c.SEVERE_ATTACK_THRESHOLD;
    const outcomes = classifyNodeClaims(claims, anNodes, anEdges);
    const concession = findNodeConcession(nodeId, povNode, concessions);
    const isRefined = refinedNodeIds.has(nodeId);

    const verdict = determineVerdict(isChallenged, isRefined, outcomes, concession, povNode);

    const entry: DebateTestedEntry = {
      debate_id: debateId,
      date,
      pipeline_version: pipelineVersion,
      verdict,
      strongest_attack_encountered: strongest,
      claim_outcomes: outcomes,
      concession: concession
        ? { type: concession.concession_type, turn: String(concession.turn) }
        : null,
    };

    const existing = povNode.graph_attributes?.debate_tested;
    const updatedRecord = mergeEntry(entry, existing, povNode, isRefined, c);
    results.push({ nodeId, entry, updatedRecord });
  }

  return results;
}

// ── Internal helpers ───────────────────────────────────────────────────────

function buildClaimsByNode(
  anNodes: ReadonlyArray<ArgumentNetworkNode>,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const claim of anNodes) {
    if (claim.speaker === 'system' || claim.speaker === 'document') continue;
    if (!claim.taxonomy_refs?.length) continue;
    for (const ref of claim.taxonomy_refs) {
      const nodeId = typeof ref === 'string' ? ref : (ref as { node_id: string }).node_id;
      let list = map.get(nodeId);
      if (!list) { list = []; map.set(nodeId, list); }
      list.push(claim.id);
    }
  }
  return map;
}

function findStrongestAttack(
  claimIds: string[],
  anNodes: ReadonlyArray<ArgumentNetworkNode>,
  anEdges: ReadonlyArray<ArgumentNetworkEdge>,
): StrongestAttackEncountered | null {
  const claimSet = new Set(claimIds);
  let strongest: StrongestAttackEncountered | null = null;

  for (const edge of anEdges) {
    if (edge.type !== 'attacks') continue;
    if (!claimSet.has(edge.target)) continue;

    const attacker = anNodes.find(n => n.id === edge.source);
    if (!attacker) continue;

    const strength = attacker.computed_strength ?? 0;
    if (!strongest || strength > strongest.strength) {
      strongest = {
        claim_id: attacker.id,
        strength,
        scheme: edge.attack_type ?? 'unknown',
        challenger_camp: typeof attacker.speaker === 'string' ? attacker.speaker : 'unknown',
      };
    }
  }

  return strongest;
}

function classifyNodeClaims(
  claimIds: string[],
  anNodes: ReadonlyArray<ArgumentNetworkNode>,
  anEdges: ReadonlyArray<ArgumentNetworkEdge>,
): DebateTestedClaimOutcomes {
  const result: DebateTestedClaimOutcomes = { thrived: 0, survived: 0, died: 0 };
  const claimSet = new Set(claimIds);

  for (const node of anNodes) {
    if (!claimSet.has(node.id)) continue;
    const refCount = countReferences(node.id, anEdges);
    const outcome = classifyOutcome(node, refCount);
    result[outcome]++;
  }

  return result;
}

function findNodeConcession(
  nodeId: string,
  povNode: PovNode,
  concessions: ReadonlyArray<ConcessionRecord>,
): ConcessionRecord | null {
  if (povNode.concession_history?.length) {
    const full = povNode.concession_history.find(c => c.concession_type === 'full' && c.bdi_impact === 'belief');
    if (full) return full;
  }
  // conceded_to holds speaker names in production (not node IDs), so this match is structurally
  // inert today — kept as a conservative no-op guard (CL review t/1575#2).
  const nodeScoped = concessions.find(
    c => c.concession_type === 'full' && c.bdi_impact === 'belief' && c.conceded_to === nodeId,
  );
  return nodeScoped ?? null;
}

function determineVerdict(
  isChallenged: boolean,
  isRefined: boolean,
  outcomes: DebateTestedClaimOutcomes,
  concession: ConcessionRecord | null,
  _povNode: PovNode,
): DebateTestedVerdict {
  if (!isChallenged && !isRefined) return 'cited';

  if (isRefined) return 'refined';

  if (concession?.concession_type === 'full' && concession.bdi_impact === 'belief') {
    return 'weakened';
  }

  const total = outcomes.thrived + outcomes.survived + outcomes.died;
  if (total > 0 && outcomes.died >= Math.max(1, Math.ceil(total / 2))) {
    return 'weakened';
  }

  if (total > 0 && outcomes.died === 0) return 'held';

  if (total === 0 || (outcomes.thrived + outcomes.survived > 0 && outcomes.died > 0)) {
    return 'open';
  }

  return 'open';
}

function mergeEntry(
  entry: DebateTestedEntry,
  existing: DebateTestedRecord | undefined,
  povNode: PovNode,
  isRefined: boolean,
  constants: DebateTestedConstants,
): DebateTestedRecord {
  const record = [...(existing?.record ?? []), entry];
  const revisions = [...(existing?.revisions ?? [])];

  if (isRefined) {
    revisions.push({
      date: entry.date,
      debate_id: entry.debate_id,
      held_since: null,
      prior_falsifiability: povNode.graph_attributes?.falsifiability,
    });
  }

  if (entry.verdict === 'held' && revisions.length > 0) {
    const currentHash = computeDescriptionHash(povNode.description);
    const storedHash = existing?.description_hash;
    for (const rev of revisions) {
      if (rev.held_since !== null) continue;
      if (storedHash && storedHash !== currentHash) continue;
      const currentFalsifiability = povNode.graph_attributes?.falsifiability;
      if (rev.prior_falsifiability &&
          falsifiabilityRank(currentFalsifiability) < falsifiabilityRank(rev.prior_falsifiability)) {
        continue;
      }
      rev.held_since = true;
    }
  }

  if (entry.verdict === 'weakened' && revisions.length > 0) {
    for (const rev of revisions) {
      if (rev.held_since === null) rev.held_since = false;
    }
  }

  let engagements = (existing?.engagements ?? 0) + 1;
  let challenges = existing?.challenges ?? 0;
  let held = existing?.held ?? 0;
  let weakened = existing?.weakened ?? 0;

  const isChallenged = entry.strongest_attack_encountered != null &&
    entry.strongest_attack_encountered.strength >= constants.SEVERE_ATTACK_THRESHOLD;
  if (isChallenged) challenges++;
  if (entry.verdict === 'held') held++;
  if (entry.verdict === 'weakened') weakened++;

  const { tier, sort_key } = computeTierAndSortKey(record, revisions, constants);

  const descriptionHash = isRefined
    ? computeDescriptionHash(povNode.description)
    : (existing?.description_hash ?? computeDescriptionHash(povNode.description));

  return {
    tier,
    sort_key,
    engagements,
    challenges,
    held,
    weakened,
    revisions,
    last_tested: entry.date,
    description_hash: descriptionHash,
    record,
  };
}
