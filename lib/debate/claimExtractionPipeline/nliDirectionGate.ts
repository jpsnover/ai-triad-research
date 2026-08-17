// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// ── V4 NLI direction gate (t/2746) ───────────────────────

import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import type { ArgumentNetworkNode } from '../types.js';

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

/**
 * V4 NLI direction gate (t/2746): subprocess-calls scripts/nli_classify.py for
 * each attributed claim and returns the IDs of claims where direction === 'opposes'.
 *
 * Opposition-only gate (CL ruling t/2751#3): callers demote 'opposes' claims to
 * direction_mismatch; all other directions keep their attribution unchanged.
 *
 * Fail-safe: any subprocess error or parse failure returns an empty set — the
 * gate never falsely demotes a claim. 'unresolved' is the engine's fail-safe
 * output and is treated identically to 'unrelated' here (keep attribution).
 */
export function runNliDirectionGate(
  nodes: ArgumentNetworkNode[],
  nodeTextById: Map<string, string>,
  speakerPov: string,
): Set<string> {
  const attributed = nodes.filter(n => n.claim_taxonomy_attribution?.primary_ref);
  if (attributed.length === 0) return new Set();

  const batch: NliInput[] = [];
  for (const n of attributed) {
    const nodeText = nodeTextById.get(n.claim_taxonomy_attribution!.primary_ref!);
    if (!nodeText) continue;
    batch.push({
      id: n.id,
      claim_prop: n.canonical_proposition ?? n.text,
      node_prop: nodeText,
      claim_pov: speakerPov,
      node_pov: speakerPov,
    });
  }
  if (batch.length === 0) return new Set();

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
    return new Set();
  }

  let outputs: NliOutput[];
  try {
    outputs = JSON.parse(proc.stdout);
  } catch {
    console.warn('[nli-direction-gate] failed to parse subprocess output');
    return new Set();
  }
  if (!Array.isArray(outputs)) return new Set();

  return new Set(outputs.filter(o => o.direction === 'opposes').map(o => o.id));
}
