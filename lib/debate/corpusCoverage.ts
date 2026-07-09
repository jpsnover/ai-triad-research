// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
import path from 'path';
import { ActionableError } from './errors.js';

// ── Types ──────────────────────────────────────────────────────

export interface NodeCoverageStats {
  debate_count: number;
  crux_link_count: number;
  retread_flag: boolean;
}

export interface CorpusCoverageMap {
  version: 1;
  last_updated: string;
  debate_count_threshold: number;
  node_stats: Record<string, NodeCoverageStats>;
}

export interface CorpusCoverageResult {
  coverageMap: CorpusCoverageMap;
  debates_scanned: number;
  unique_nodes: number;
  retread_count: number;
  fault_line_count: number;
}

// ── Defaults ───────────────────────────────────────────────────

const COVERAGE_FILE = 'corpus-coverage.json';
const DEFAULT_DEBATE_COUNT_THRESHOLD = 20;
const FAULT_LINE_CRUX_MIN = 2;

// ── Precompute ─────────────────────────────────────────────────

export function computeCorpusCoverage(
  debatesDir: string,
  dataRoot: string,
  debateCountThreshold: number = DEFAULT_DEBATE_COUNT_THRESHOLD,
): CorpusCoverageResult {
  const nodeDebates = new Map<string, Set<string>>();

  if (fs.existsSync(debatesDir)) {
    const scanDirs = [debatesDir];
    const cliRunsDir = path.join(debatesDir, 'cli-runs');
    if (fs.existsSync(cliRunsDir)) scanDirs.push(cliRunsDir);

    for (const dir of scanDirs) {
      const files = fs.readdirSync(dir).filter((f: string) =>
        f.endsWith('.json') && f !== 'debates-index.json' &&
        (f.startsWith('debate-') || f.endsWith('-debate.json')),
      );

      for (const file of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
          const debateId = data.id ?? file;
          collectNodeRefs(data, debateId, nodeDebates);
        } catch { /* skip corrupt files */ }
      }
    }
  }

  const nodeCruxLinks = loadCruxLinksFromAggregated(dataRoot);
  if (nodeCruxLinks.size === 0) {
    throw new ActionableError({
      goal: 'Compute corpus coverage map with crux linkage data',
      problem: 'Crux linkage resolved to zero linked nodes — retread classification requires crux data to distinguish retreads from fault-lines',
      location: 'computeCorpusCoverage',
      nextSteps: [
        `Verify aggregated-cruxes.json exists at ${path.join(dataRoot, 'taxonomy', 'Origin', 'aggregated-cruxes.json')}`,
        'Check that cruxes[].linked_node_ids arrays are populated (498 of 586 expected)',
        'If file is missing, regenerate via the CL aggregation pipeline',
      ],
    });
  }

  const nodeStats: Record<string, NodeCoverageStats> = {};
  const allNodeIds = new Set([...nodeDebates.keys(), ...nodeCruxLinks.keys()]);

  let retreadCount = 0;
  let faultLineCount = 0;

  for (const nodeId of allNodeIds) {
    const debateCount = nodeDebates.get(nodeId)?.size ?? 0;
    const cruxLinkCount = nodeCruxLinks.get(nodeId) ?? 0;
    const isFaultLine = cruxLinkCount >= FAULT_LINE_CRUX_MIN;
    const retread = debateCount >= debateCountThreshold && cruxLinkCount <= 1 && !isFaultLine;

    nodeStats[nodeId] = { debate_count: debateCount, crux_link_count: cruxLinkCount, retread_flag: retread };

    if (retread) retreadCount++;
    if (isFaultLine) faultLineCount++;
  }

  const coverageMap: CorpusCoverageMap = {
    version: 1,
    last_updated: new Date().toISOString(),
    debate_count_threshold: debateCountThreshold,
    node_stats: nodeStats,
  };

  return {
    coverageMap,
    debates_scanned: new Set(
      [...nodeDebates.values()].flatMap(s => [...s]),
    ).size,
    unique_nodes: allNodeIds.size,
    retread_count: retreadCount,
    fault_line_count: faultLineCount,
  };
}

// ── Persistence ────────────────────────────────────────────────

export function coveragePath(dataRoot: string): string {
  return path.join(dataRoot, 'calibration', COVERAGE_FILE);
}

export function saveCoverageMap(map: CorpusCoverageMap, dataRoot: string): void {
  const dir = path.join(dataRoot, 'calibration');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(coveragePath(dataRoot), JSON.stringify(map, null, 2) + '\n', 'utf-8');
}

export function loadCoverageMap(dataRoot: string): CorpusCoverageMap | null {
  const p = coveragePath(dataRoot);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
    if (raw && raw.version === 1 && raw.node_stats) return raw as CorpusCoverageMap;
    return null;
  } catch {
    return null;
  }
}

// ── Helpers ────────────────────────────────────────────────────

function collectNodeRefs(
  debate: Record<string, unknown>,
  debateId: string,
  nodeDebates: Map<string, Set<string>>,
): void {
  const transcript = debate.transcript as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(transcript)) {
    for (const entry of transcript) {
      if (entry.type !== 'opening' && entry.type !== 'statement') continue;
      const refs = entry.taxonomy_refs as Array<{ node_id?: string } | string> | undefined;
      if (!Array.isArray(refs)) continue;
      for (const ref of refs) {
        const nodeId = typeof ref === 'string' ? ref : ref.node_id;
        if (nodeId) {
          if (!nodeDebates.has(nodeId)) nodeDebates.set(nodeId, new Set());
          nodeDebates.get(nodeId)!.add(debateId);
        }
      }
    }
  }

  const an = debate.argument_network as { nodes?: Array<{ taxonomy_refs?: string[] }> } | undefined;
  if (an?.nodes) {
    for (const node of an.nodes) {
      if (!Array.isArray(node.taxonomy_refs)) continue;
      for (const ref of node.taxonomy_refs) {
        if (typeof ref === 'string') {
          if (!nodeDebates.has(ref)) nodeDebates.set(ref, new Set());
          nodeDebates.get(ref)!.add(debateId);
        }
      }
    }
  }
}

const AGGREGATED_CRUXES_PATH = path.join('taxonomy', 'Origin', 'aggregated-cruxes.json');

interface AggregatedCruxEntry {
  linked_node_ids?: string[];
}

function loadCruxLinksFromAggregated(dataRoot: string): Map<string, number> {
  const filePath = path.join(dataRoot, AGGREGATED_CRUXES_PATH);
  if (!fs.existsSync(filePath)) {
    return new Map();
  }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const cruxes: AggregatedCruxEntry[] = raw?.cruxes;
    if (!Array.isArray(cruxes)) return new Map();

    const counts = new Map<string, number>();
    for (const entry of cruxes) {
      for (const nodeId of entry.linked_node_ids ?? []) {
        counts.set(nodeId, (counts.get(nodeId) ?? 0) + 1);
      }
    }
    return counts;
  } catch {
    return new Map();
  }
}
