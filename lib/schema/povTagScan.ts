// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// POV-tag orphan scan (t/3985; SO e/253#2 + #4). Orphans don't come from the editor: they come from a
// registry change in the code repo (renaming or removing a tag in pov-tags.json). This scan shows what a
// registry orphans BEFORE it merges, by checking every taxonomy node's pov_tags against it.
//
// DIFFERENTIAL when given a base registry (SO e/253#4): only orphans the change INTRODUCES fail. Orphans
// already present under the base, and structural problems (which no registry change can cause), are reported
// as warnings for the data owner. So one bad data commit never turns every code PR red, and a PR that doesn't
// touch the registry passes by construction (its two registries are identical).
//
// Known limit (t/3985#1): the differential varies the REGISTRY, not the validator CODE. A PR that tightens a
// rule in povTags.ts shows its new problems as preexisting/structural (a warning), not introduced.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validatePovTagsDetailed, PovTagRegistrySchema, POV_BY_ID_PREFIX, type PovTagRegistry } from './povTags.js';
import { TAXONOMY_NODE_FILES } from './extractors.js';

export interface TaggedNode {
  id: string;
  pov_tags?: unknown;
}

export interface OrphanScanResult {
  /** 'differential' when a base registry was given; 'plain' otherwise (every orphan counts as introduced). */
  mode: 'plain' | 'differential';
  /** Taxonomy nodes examined. */
  checked: number;
  /** Tag uses orphaned by THIS registry and not by the base: the failing set. Keyed `<pov>.<tag>`. */
  introduced: number;
  introducedByTag: Record<string, number>;
  /** Tag uses already orphaned under the base registry: a warning for the data owner. */
  preexisting: number;
  preexistingByTag: Record<string, number>;
  /** Registry-independent problems (shape, duplicates, malformed ids, tags on non-POV nodes): a warning. */
  structural: number;
  /** One line per problem, for the job log. */
  errors: string[];
}

/**
 * Read every node from the taxonomy node files in `originDir`. STRICT: a missing or malformed file throws,
 * because a wrong data checkout must read as "could not run", never as "0 orphans".
 */
export function readTaxonomyNodes(originDir: string): TaggedNode[] {
  return TAXONOMY_NODE_FILES.flatMap((file) => {
    const path = join(originDir, file);
    let doc: unknown;
    try {
      doc = JSON.parse(readFileSync(path, 'utf-8').replace(/^\uFEFF/, ''));
    } catch (err) {
      throw new Error(`cannot read taxonomy file ${path}: ${(err as Error).message}`);
    }
    const nodes = (doc as { nodes?: unknown }).nodes;
    if (!Array.isArray(nodes)) throw new Error(`taxonomy file ${path} has no "nodes" array`);
    return nodes as TaggedNode[];
  });
}

/** Parse a registry file, e.g. the base branch's pov-tags.json. Throws if it isn't a valid registry. */
export function readRegistryFile(path: string): PovTagRegistry {
  return PovTagRegistrySchema.parse(JSON.parse(readFileSync(path, 'utf-8')));
}

/** True when this one tag on this node is a registry-membership problem under `registry`. */
function isOrphan(nodeId: string, tag: string, registry: PovTagRegistry): boolean {
  return validatePovTagsDetailed(nodeId, [tag], registry).some((p) => p.kind === 'unregistered');
}

function bump(into: Record<string, number>, key: string): void {
  into[key] = (into[key] ?? 0) + 1;
}

/** Classify one node's tags into the result: structural problems, then each distinct string tag's orphan state. */
function scanNode(node: TaggedNode, registry: PovTagRegistry, base: PovTagRegistry | undefined, out: OrphanScanResult): void {
  const structural = validatePovTagsDetailed(node.id, node.pov_tags, registry).filter((p) => p.kind === 'structural');
  out.structural += structural.length;
  out.errors.push(...structural.map((p) => `structural: ${p.message}`));

  const pov = POV_BY_ID_PREFIX[/^([a-z]+)-/.exec(node.id)?.[1] ?? ''];
  if (!pov || !Array.isArray(node.pov_tags)) return;
  const tags = new Set(node.pov_tags.filter((t): t is string => typeof t === 'string'));
  for (const tag of tags) {
    if (!isOrphan(node.id, tag, registry)) continue;
    const key = `${pov}.${tag}`;
    if (base && isOrphan(node.id, tag, base)) {
      out.preexisting++;
      bump(out.preexistingByTag, key);
      out.errors.push(`preexisting orphan: ${node.id} carries "${tag}", which the base registry already lacks`);
    } else {
      out.introduced++;
      bump(out.introducedByTag, key);
      out.errors.push(`introduced orphan: ${node.id} carries "${tag}", which this registry does not list for ${pov}`);
    }
  }
}

/** Scan nodes against `registry`, differentially against `base` when given. Pure. */
export function scanPovTagOrphans(nodes: readonly TaggedNode[], registry: PovTagRegistry, base?: PovTagRegistry): OrphanScanResult {
  const out: OrphanScanResult = {
    mode: base ? 'differential' : 'plain',
    checked: 0, introduced: 0, introducedByTag: {}, preexisting: 0, preexistingByTag: {}, structural: 0, errors: [],
  };
  for (const node of nodes) {
    if (!node || typeof node !== 'object' || typeof node.id !== 'string') {
      throw new Error(`taxonomy node without a string "id": ${JSON.stringify(node)}`);
    }
    out.checked++;
    scanNode(node, registry, base, out);
  }
  return out;
}

/**
 * The scan's verdict as an exit code. Differential: only introduced orphans fail (warnings allowed). Plain:
 * any orphan or structural problem fails, as the manual interim check (spec §2.1) expects.
 */
export function orphanScanExitCode(result: OrphanScanResult): 0 | 1 {
  if (result.introduced > 0) return 1;
  return result.mode === 'plain' && result.structural > 0 ? 1 : 0;
}
