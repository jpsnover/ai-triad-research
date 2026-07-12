// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1225 (org as a top-level taxonomy concept — per t/1217 HLD): index + query
// layer over organizations.json. The raw file read lives in storage/fileIO.ts
// (Server Storage, t/1229); this module owns typed parsing, the in-memory cache,
// the topic/policy reverse indexes, and the query helpers the REST routes call.

import { readOrganizations } from './storage/fileIO.js';
import { getGlobalRecorder } from '../../../lib/flight-recorder/index.js';

export type { Pov, PovStance, TopicEngagement, PolicyEngagement, Organization, OrganizationEdgeType, OrganizationEdge } from '../../../lib/organizations/types.js';
import type { Pov, Organization } from '../../../lib/organizations/types.js';

export const POV_CAMPS: readonly Pov[] = ['accelerationist', 'safetyist', 'skeptic'];
export function isPov(v: string): v is Pov {
  return (POV_CAMPS as readonly string[]).includes(v);
}

interface OrgIndexes {
  all: Organization[];
  byId: Map<string, Organization>;
  byTopic: Map<string, Organization[]>;   // topic_ref → orgs
  byPolicy: Map<string, Organization[]>;  // policy_ref → orgs
}

let cache: OrgIndexes | null = null;

function emptyIndexes(): OrgIndexes {
  return { all: [], byId: new Map(), byTopic: new Map(), byPolicy: new Map() };
}

function buildIndexes(orgs: Organization[]): OrgIndexes {
  const idx = emptyIndexes();
  idx.all = orgs;
  for (const org of orgs) {
    if (typeof org?.id === 'string') idx.byId.set(org.id, org);
    for (const t of org.topic_engagement ?? []) {
      if (!t?.topic_ref) continue;
      (idx.byTopic.get(t.topic_ref) ?? idx.byTopic.set(t.topic_ref, []).get(t.topic_ref)!).push(org);
    }
    for (const p of org.policy_engagement ?? []) {
      if (!p?.policy_ref) continue;
      (idx.byPolicy.get(p.policy_ref) ?? idx.byPolicy.set(p.policy_ref, []).get(p.policy_ref)!).push(org);
    }
  }
  return idx;
}

/**
 * Load organizations.json once and cache the parsed records + reverse indexes.
 * Degrades to an empty set when the file is absent (seeded later by t/1224) or
 * malformed — endpoints return [] rather than erroring. (t/1225)
 */
async function load(): Promise<OrgIndexes> {
  if (cache) return cache;
  try {
    const raw = await readOrganizations();
    const list = (raw as { organizations?: unknown })?.organizations;
    const orgs = Array.isArray(list) ? (list as Organization[]).filter(o => o && typeof o.id === 'string') : [];
    cache = buildIndexes(orgs);
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

/** Drop the in-memory cache (tests / hot-reload). */
export function resetOrganizationsCache(): void { cache = null; }

// ── Query helpers (1:1 with the REST routes) ──

/** All orgs, optionally filtered by `type` and/or alignment with a `pov` (score > 0.3). */
export async function listOrganizations(opts: { type?: string | null; pov?: string | null } = {}): Promise<Organization[]> {
  const { all } = await load();
  let out = all;
  if (opts.type) out = out.filter(o => o.type === opts.type);
  if (opts.pov && isPov(opts.pov)) {
    const pov = opts.pov;
    out = out.filter(o => (o.pov_alignment?.[pov]?.score ?? 0) > 0.3);
  }
  return out;
}

export async function getOrganizationById(id: string): Promise<Organization | null> {
  const { byId } = await load();
  return byId.get(id) ?? null;
}

/**
 * Orgs aligned with `pov`. `direction='for'` → score >= threshold; `'against'` →
 * score <= -threshold. Sorted by |score| descending (HLD scenario #1). (t/1225 Q2)
 */
export async function organizationsByPov(
  pov: Pov, direction: 'for' | 'against' = 'for', threshold = 0.3,
): Promise<Organization[]> {
  const { all } = await load();
  const t = Math.abs(threshold);
  return all
    .filter(o => {
      const score = o.pov_alignment?.[pov]?.score;
      if (typeof score !== 'number') return false;
      return direction === 'for' ? score >= t : score <= -t;
    })
    .sort((a, b) =>
      Math.abs(b.pov_alignment?.[pov]?.score ?? 0) - Math.abs(a.pov_alignment?.[pov]?.score ?? 0));
}

/** Orgs engaged with a situation/topic (`sit-*`). Reverse index. (HLD scenario #4) */
export async function organizationsByTopic(topicRef: string): Promise<Organization[]> {
  const { byTopic } = await load();
  return byTopic.get(topicRef) ?? [];
}

/** Orgs supporting/opposing a policy action (`pol-*`). Reverse index. (HLD scenario #6) */
export async function organizationsByPolicy(policyId: string): Promise<Organization[]> {
  const { byPolicy } = await load();
  return byPolicy.get(policyId) ?? [];
}
