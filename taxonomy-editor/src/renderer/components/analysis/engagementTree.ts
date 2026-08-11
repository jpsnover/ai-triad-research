// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Shared tree-traversal utilities for engagement analytics panels.
 * Consumed by EngagementDashboard (admin) and YourActivityPanel (self-view).
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TreeNode {
  id: string;
  visits: number;
  engagedVisits: number;
  engagedMs: number;
  cappedRate?: number;
  uniqueUsers?: number;
  children?: Record<string, TreeNode>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const CAMP_COLORS: Record<string, string> = {
  acc: 'var(--color-acc, #b84e13)',
  saf: 'var(--color-saf, #2b5fad)',
  skp: 'var(--color-skp, #7b4fa6)',
  cc:  '#6b7280',
};

export const CAMP_LABELS: Record<string, string> = {
  acc: 'Accelerationist', saf: 'Safetyist', skp: 'Skeptic', cc: 'Cross-Cutting',
};

export const CATEGORY_LABEL_MAP: Record<string, string> = {
  bel: 'Beliefs', des: 'Desires', int: 'Intentions',
};

// ── Formatters ────────────────────────────────────────────────────────────────

export function fmtDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export function fmtNumber(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/** Returns the human-readable category label for a key like "acc-bel". */
export function categoryLabel(catKey: string): string {
  const suffix = catKey.split('-')[1];
  return CATEGORY_LABEL_MAP[suffix] ?? catKey;
}

// ── Tree traversal ────────────────────────────────────────────────────────────

/** Accumulate engagedMs + visits per camp across all tools in the tree. */
export function sumByCamp(root: TreeNode): Array<{ key: string; engagedMs: number; visits: number }> {
  const acc: Record<string, { engagedMs: number; visits: number }> = {};
  for (const tool of Object.values(root.children ?? {})) {
    for (const [campKey, camp] of Object.entries(tool.children ?? {})) {
      if (!acc[campKey]) acc[campKey] = { engagedMs: 0, visits: 0 };
      acc[campKey].engagedMs += (camp as TreeNode).engagedMs;
      acc[campKey].visits += (camp as TreeNode).visits;
    }
  }
  return Object.entries(acc)
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.engagedMs - a.engagedMs);
}

/** Accumulate engagedMs + visits per category for a given camp across all tools. */
export function sumByCategoryForCamp(root: TreeNode, camp: string): Array<{ key: string; engagedMs: number; visits: number }> {
  const acc: Record<string, { engagedMs: number; visits: number }> = {};
  for (const tool of Object.values(root.children ?? {})) {
    const campNode = (tool as TreeNode).children?.[camp] as TreeNode | undefined;
    if (!campNode) continue;
    for (const [catKey, cat] of Object.entries(campNode.children ?? {})) {
      if (!acc[catKey]) acc[catKey] = { engagedMs: 0, visits: 0 };
      acc[catKey].engagedMs += (cat as TreeNode).engagedMs;
      acc[catKey].visits += (cat as TreeNode).visits;
    }
  }
  return Object.entries(acc)
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.engagedMs - a.engagedMs);
}

/** Flatten all leaf nodes (actual taxonomy nodes, depth ≥ 3) for leaderboards. */
export function collectLeafNodes(
  node: TreeNode,
  depth: number,
  results: Array<{ id: string; engagedMs: number; visits: number }>,
): void {
  const kids = node.children;
  if (!kids || Object.keys(kids).length === 0) {
    if (depth >= 3) results.push({ id: node.id, engagedMs: node.engagedMs, visits: node.visits });
    return;
  }
  for (const child of Object.values(kids)) {
    collectLeafNodes(child as TreeNode, depth + 1, results);
  }
}
