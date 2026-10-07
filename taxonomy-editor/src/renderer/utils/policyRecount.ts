// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/4034: which policy ids a save must recount in policy_actions.json. The editor never wrote that
// registry, so adding or removing a node's policy action left member_count / source_povs stale. The
// recount itself runs server- or main-side (lib/policy/registryRecount.ts, the TS mirror of PowerShell
// Update-PolicyMemberCounts); this module only decides WHICH ids, so unrelated policies are never touched.

import { getGlobalRecorder } from '@lib/flight-recorder/index';

/** The node fields this reads. Structural, so POV and situation nodes both fit. */
export interface PolicyBearingNode {
  id: string;
  graph_attributes?: { policy_actions?: Array<{ policy_id?: string | null }> | null } | null;
}

/** A node's policy ids as a stable fingerprint. Counted per entry (a repeated id counts twice, as
 *  member_count does) and order-insensitive, so reordering actions is not a change. */
function policyIdsKey(node: PolicyBearingNode): string {
  const ids = (node.graph_attributes?.policy_actions ?? []).map(a => a?.policy_id).filter((id): id is string => !!id);
  return JSON.stringify(ids.sort());
}

/** node id → its policy ids, as last loaded or saved. */
export function buildPolicyIdBaseline(nodes: readonly PolicyBearingNode[]): Record<string, string> {
  return Object.fromEntries(nodes.map(n => [n.id, policyIdsKey(n)]));
}

/**
 * The ids to recount after a save: for every node whose policy ids changed since the baseline, the
 * union of its ids before and after (so a removed id is recounted down). A node in the baseline that no
 * longer exists anywhere (deleted, or moved to a new id) contributes its prior ids. Sorted, unique.
 *
 * `savedNodes`: nodes in the files this save wrote. `allNodes`: every currently loaded node, used only
 * to tell a deleted node from one that simply lives in a file this save did not touch.
 */
export function affectedPolicyIds(
  savedNodes: readonly PolicyBearingNode[],
  allNodes: readonly PolicyBearingNode[],
  baseline: Record<string, string>,
): string[] {
  const ids = new Set<string>();
  const add = (key: string | undefined) => { if (key) for (const id of JSON.parse(key) as string[]) ids.add(id); };
  for (const node of savedNodes) {
    const now = policyIdsKey(node);
    const before = baseline[node.id];
    if (before === now) continue;
    add(before);
    add(now);
  }
  const live = new Set(allNodes.map(n => n.id));
  for (const [nodeId, before] of Object.entries(baseline)) {
    if (!live.has(nodeId)) add(before);
  }
  return [...ids].sort();
}

/** A non-blocking notice after the post-save recount. */
export interface PolicyRecountNotice {
  /** 'not-updated': the counts are still stale. 'needs-commit': they were written but policy_actions.json
   *  is left uncommitted (desktop), and PowerShell registry writers refuse a dirty registry (e/264#26). */
  kind: 'not-updated' | 'needs-commit';
  ids: string[];
  /** 'locked': another writer held policy_actions.lock; 'failed': the call errored; 'uncommitted':
   *  needs-commit; otherwise the backend's reason. */
  reason: string;
}

/** The registry entries a recount wrote, keyed for merging into the loaded registry. */
export type PolicyCountUpdates = Array<{ id: string; member_count: number; source_povs: string[] }>;

/**
 * Run the recount for `ids` and say what to do with the result. Never throws: the POV save already
 * succeeded, so a recount problem is a WARN plus a notice, not a failed save (Fallback-Path Logging).
 * `recount` is the bridge call, injected for tests. `leavesRegistryUncommitted` is true on desktop, where
 * the editor never commits: a write there also gets a notice, because until someone commits the registry
 * the next pipeline run leaves new policy actions unregistered. The web backend commits every write.
 */
export async function runPolicyRecount(
  ids: string[],
  recount: (ids: string[]) => Promise<{ status: string; reason?: string; updated: PolicyCountUpdates }>,
  opts: { leavesRegistryUncommitted?: boolean } = {},
): Promise<{ updates: PolicyCountUpdates; notice: PolicyRecountNotice | null }> {
  if (ids.length === 0) return { updates: [], notice: null };
  try {
    const result = await recount(ids);
    if (result.status === 'written') {
      const notice: PolicyRecountNotice | null = opts.leavesRegistryUncommitted && result.updated.length > 0
        ? { kind: 'needs-commit', ids: result.updated.map(u => u.id), reason: 'uncommitted' }
        : null;
      return { updates: result.updated, notice };
    }
    if (result.status === 'unchanged') return { updates: [], notice: null };
    getGlobalRecorder()?.record({ type: 'state.change', component: 'taxonomy-store', level: 'warn', message: `Policy registry recount refused (${result.reason ?? 'unknown'}); counts for ${ids.length} policies not updated`, data: { ids, reason: result.reason } });
    return { updates: [], notice: { kind: 'not-updated', ids, reason: result.reason ?? 'refused' } };
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Policy registry recount failed after save; counts not updated', data: { ids }, error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    return { updates: [], notice: { kind: 'not-updated', ids, reason: 'failed' } };
  }
}

/** The loaded registry with recounted entries merged in; other entries and fields untouched. */
export function mergePolicyCounts<T extends { id: string }>(registry: T[] | null, updates: PolicyCountUpdates): T[] | null {
  if (!registry || updates.length === 0) return registry;
  const byId = new Map(updates.map(u => [u.id, u]));
  return registry.map(p => {
    const u = byId.get(p.id);
    return u ? { ...p, member_count: u.member_count, source_povs: u.source_povs } : p;
  });
}
