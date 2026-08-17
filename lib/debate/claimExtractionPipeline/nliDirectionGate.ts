// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// ── V4 NLI direction gate (t/2746, t/2744#10) ────────────

import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import type { ArgumentNetworkNode } from '../types.js';

/**
 * Build the rich node proposition for NLI input (t/2744#7, TL ruling t/2746).
 * Matches V1 (PS2) format exactly: "label — Core" where Core = description with
 * Encompasses:/Excludes: tails stripped (they name sibling topics, not the asserted
 * proposition). Falls back to label-only when description is empty.
 */
export function buildNliNodeProp(label: string, description: string): string {
  const core = (description ?? '').replace(/\s*(Encompasses|Excludes)\s*:[\s\S]*$/, '').trim();
  return core ? `${label} — ${core}` : label;
}

const __filename = fileURLToPath(import.meta.url);
// claimExtractionPipeline -> lib/debate -> lib -> repo root
const REPO_ROOT = path.resolve(path.dirname(__filename), '../../..');
const NLI_SCRIPT = path.join(REPO_ROOT, 'scripts', 'nli_classify.py');

interface NliInput {
  id: string;
  claim_prop: string;
  node_prop: string;
  claim_pov?: string;
  node_pov?: string;
}

interface NliOutput {
  id: string;
  direction: 'agrees' | 'opposes' | 'unrelated' | 'unresolved';
  confidence: number;
  method: string;
}

export interface NliGateCounts {
  opposes: number;
  agrees: number;
  unrelated: number;
  unresolved: number;
}

export interface NliGateResult {
  opposingIds: Set<string>;
  counts: NliGateCounts;
}

const ZERO_COUNTS: NliGateCounts = { opposes: 0, agrees: 0, unrelated: 0, unresolved: 0 };

// Slot suffixes for the three claim-text fields (t/2744#10: run-all, opposes-if-ANY).
// Using short suffix strings that cannot collide with real claim IDs (which never end in __v/__c/__a).
const SLOT_V = '__v';
const SLOT_C = '__c';
const SLOT_A = '__a';
const SLOT_SUFFIXES = [SLOT_V, SLOT_C, SLOT_A] as const;

function baseClaimId(slotId: string): string {
  for (const s of SLOT_SUFFIXES) {
    if (slotId.endsWith(s)) return slotId.slice(0, -s.length);
  }
  return slotId;
}

/**
 * V4 NLI direction gate (t/2746, t/2744#10): subprocess-calls scripts/nli_classify.py with
 * up to THREE slots per claim — verbatim (text), canonical_proposition, attribution_text_genus —
 * and returns IDs of claims where ANY slot direction === 'opposes' (recall-safe OR rule).
 *
 * Rationale (t/2744#10–#11): no single claim field wins across cases. verbatim/canonical
 * catch the origin key-point inversion; attribution catches the #1184 org-stance case.
 * The OR rule never false-demotes under opposes-only + fail-safe: extra neutral/entailment
 * slots don't fire. Counts are claim-level (not slot-level).
 *
 * Opposition-only gate (CL ruling t/2751#3): callers demote 'opposes' claims to
 * direction_mismatch; all other directions keep their attribution unchanged.
 *
 * Fail-safe: any subprocess error or parse failure returns empty set + zero counts —
 * the gate never falsely demotes a claim.
 */
export function runNliDirectionGate(
  nodes: ArgumentNetworkNode[],
  nodeTextById: Map<string, string>,
  speakerPov: string,
): NliGateResult {
  const empty: NliGateResult = { opposingIds: new Set(), counts: { ...ZERO_COUNTS } };
  const attributed = nodes.filter(n => n.claim_taxonomy_attribution?.primary_ref);
  if (attributed.length === 0) return empty;

  // Build up to 3 slots per claim — skip unavailable fields.
  const batch: NliInput[] = [];
  const claimIds = new Set<string>(); // track which claims have at least one slot
  for (const n of attributed) {
    const nodeText = nodeTextById.get(n.claim_taxonomy_attribution!.primary_ref!);
    if (!nodeText) continue;
    const fields: Array<[string, string | undefined]> = [
      [SLOT_V, n.text],
      [SLOT_C, n.canonical_proposition],
      [SLOT_A, n.attribution_text_genus],
    ];
    let added = false;
    for (const [suffix, claimText] of fields) {
      if (!claimText) continue;
      batch.push({ id: `${n.id}${suffix}`, claim_prop: claimText, node_prop: nodeText, claim_pov: speakerPov, node_pov: speakerPov });
      added = true;
    }
    if (added) claimIds.add(n.id);
  }
  if (batch.length === 0) return empty;

  const proc = spawnSync('python', [NLI_SCRIPT], {
    input: JSON.stringify(batch),
    encoding: 'utf8',
    cwd: REPO_ROOT,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (proc.error || proc.status !== 0) {
    console.warn(
      `[nli-direction-gate] subprocess failed (status=${proc.status}): ` +
      (proc.stderr?.slice(0, 300) ?? proc.error?.message ?? 'unknown'),
    );
    return empty;
  }

  let outputs: NliOutput[];
  try {
    outputs = JSON.parse(proc.stdout);
  } catch {
    console.warn('[nli-direction-gate] failed to parse subprocess output');
    return empty;
  }
  if (!Array.isArray(outputs)) return empty;

  // Group slot outputs by claim ID, then apply OR rule at claim level.
  const slotsByClaimId = new Map<string, NliOutput[]>();
  for (const o of outputs) {
    const cid = baseClaimId(o.id);
    const arr = slotsByClaimId.get(cid);
    if (arr) arr.push(o); else slotsByClaimId.set(cid, [o]);
  }

  const counts: NliGateCounts = { ...ZERO_COUNTS };
  const opposingIds = new Set<string>();
  for (const [claimId, slots] of slotsByClaimId) {
    const dirs = slots.map(s => s.direction);
    if (dirs.some(d => d === 'opposes')) {
      counts.opposes++;
      opposingIds.add(claimId);
    } else if (dirs.some(d => d === 'agrees')) {
      counts.agrees++;
    } else if (dirs.every(d => d === 'unresolved')) {
      counts.unresolved++;
    } else {
      counts.unrelated++;
    }
  }
  return { opposingIds, counts };
}
