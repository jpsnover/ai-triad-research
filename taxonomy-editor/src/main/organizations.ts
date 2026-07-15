// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1544: Electron main-process organizations reader. Mirrors the index + query layer
// in src/server/organizations.ts, but reads the local data files directly
// (organizations.json + organization_edges.json under <data-root>/taxonomy/Origin)
// instead of the server storage backend. Degrades to an empty set when the files are
// absent or malformed — queries return [] / null rather than crashing (AC #4).

import fs from 'fs';
import path from 'path';
import { getDataRootPath } from './fileIO.js';
import { getGlobalRecorder } from '../../../lib/flight-recorder/index.js';
import type { Pov, PovAlignmentTier, Organization, OrganizationEdge } from '../../../lib/organizations/types.js';

const POV_CAMPS: readonly Pov[] = ['accelerationist', 'safetyist', 'skeptic'];

const TIER_RANK: Record<PovAlignmentTier, number> = {
  opposes: -2, leans_against: -1, mixed_or_silent: 0, leans_toward: 1, champions: 2,
};
export function isPov(v: string): v is Pov {
  return (POV_CAMPS as readonly string[]).includes(v);
}

interface OrgIndexes {
  all: Organization[];
  byId: Map<string, Organization>;
  byTopic: Map<string, Organization[]>;   // topic_ref → orgs
  byPolicy: Map<string, Organization[]>;  // policy_ref → orgs
  edgesByOrg: Map<string, OrganizationEdge[]>;  // org id → incident edges (source, or org-* target)
}

let cache: OrgIndexes | null = null;

function emptyIndexes(): OrgIndexes {
  return { all: [], byId: new Map(), byTopic: new Map(), byPolicy: new Map(), edgesByOrg: new Map() };
}

/** Read a JSON file from <data-root>/taxonomy/Origin; null if absent. */
function readOriginJson(file: string): unknown {
  const fp = path.join(getDataRootPath(), 'taxonomy', 'Origin', file);
  if (!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, 'utf-8'));
}

/** Append `val` to the array bucket at `key`, creating the bucket if absent. */
function pushToBucket<T>(map: Map<string, T[]>, key: string, val: T): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(val);
  else map.set(key, [val]);
}

function indexOrg(idx: OrgIndexes, org: Organization): void {
  if (typeof org?.id === 'string') idx.byId.set(org.id, org);
  for (const t of org.topic_engagement ?? []) {
    if (t?.topic_ref) pushToBucket(idx.byTopic, t.topic_ref, org);
  }
  for (const p of org.policy_engagement ?? []) {
    if (p?.policy_ref) pushToBucket(idx.byPolicy, p.policy_ref, org);
  }
}

function indexEdge(idx: OrgIndexes, e: OrganizationEdge): void {
  if (!e || typeof e.source !== 'string') return;
  pushToBucket(idx.edgesByOrg, e.source, e);
  // Org-to-org edges (ALLIED_WITH/COMPETES_WITH/FUNDS) are indexed under the target too,
  // so an org sees incoming relationships, not just the ones it's the source of.
  if (typeof e.target === 'string' && e.target.startsWith('org-') && e.target !== e.source) {
    pushToBucket(idx.edgesByOrg, e.target, e);
  }
}

function buildIndexes(orgs: Organization[], edges: OrganizationEdge[]): OrgIndexes {
  const idx = emptyIndexes();
  idx.all = orgs;
  for (const org of orgs) indexOrg(idx, org);
  for (const e of edges) indexEdge(idx, e);
  return idx;
}

function load(): OrgIndexes {
  if (cache) return cache;
  try {
    const orgRaw = readOriginJson('organizations.json') as { organizations?: unknown } | null;
    const list = orgRaw?.organizations;
    const orgs = Array.isArray(list) ? (list as Organization[]).filter(o => o && typeof o.id === 'string') : [];

    // organization_edges.json wraps the array under `.edges` (also tolerate a bare array).
    const edgeRaw = readOriginJson('organization_edges.json') as { edges?: unknown } | unknown[] | null;
    const edgeList = Array.isArray(edgeRaw) ? edgeRaw : (edgeRaw as { edges?: unknown } | null)?.edges;
    const edges = Array.isArray(edgeList) ? (edgeList as OrganizationEdge[]).filter(e => e && typeof e.source === 'string') : [];

    cache = buildIndexes(orgs, edges);
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'organizations', level: 'error',
      message: 'Failed to load organizations.json; serving empty set',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    cache = emptyIndexes();
  }
  return cache;
}

/** Drop the in-memory cache (e.g. after a data-root switch). */
export function resetOrganizationsCache(): void { cache = null; }

// ── Query helpers (1:1 with the bridge methods) ──

/** All orgs, optionally filtered by `type` and/or alignment with a `pov` (leans_toward or champions). */
export function listOrganizations(opts: { type?: string | null; pov?: string | null } = {}): Organization[] {
  const { all } = load();
  let out = all;
  if (opts.type) out = out.filter(o => o.type === opts.type);
  if (opts.pov && isPov(opts.pov)) {
    const pov = opts.pov;
    out = out.filter(o => {
      const tier = o.pov_alignment?.[pov]?.tier;
      return tier === 'leans_toward' || tier === 'champions';
    });
  }
  return out;
}

export function getOrganizationById(id: string): Organization | null {
  return load().byId.get(id) ?? null;
}

/** Orgs aligned with `pov`; `for` → leans_toward/champions, `against` → opposes/leans_against. Sorted by tier strength desc. */
export function organizationsByPov(pov: Pov, direction: 'for' | 'against' = 'for'): Organization[] {
  const { all } = load();
  return all
    .filter(o => {
      const tier = o.pov_alignment?.[pov]?.tier;
      if (!tier) return false;
      const rank = TIER_RANK[tier];
      return direction === 'for' ? rank >= 1 : rank <= -1;
    })
    .sort((a, b) =>
      Math.abs(TIER_RANK[b.pov_alignment?.[pov]?.tier ?? 'mixed_or_silent']) -
      Math.abs(TIER_RANK[a.pov_alignment?.[pov]?.tier ?? 'mixed_or_silent']));
}

/** Orgs engaged with a situation/topic (`sit-*`). Reverse index. */
export function organizationsByTopic(topicRef: string): Organization[] {
  return load().byTopic.get(topicRef) ?? [];
}

/** Orgs supporting/opposing a policy action (`pol-*`). Reverse index. */
export function organizationsByPolicy(policyId: string): Organization[] {
  return load().byPolicy.get(policyId) ?? [];
}

/** All actor-relationship edges incident to `orgId` (as source, or org-* target). `[]` for unknown org. */
export function organizationEdges(orgId: string): OrganizationEdge[] {
  return load().edgesByOrg.get(orgId) ?? [];
}
