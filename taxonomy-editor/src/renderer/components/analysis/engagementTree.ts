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

// ── Server wire shape → TreeNode adapter (t/2709) ─────────────────────────────
//
// GET /api/analytics/engagement returns an *EngagementTree*, NOT a TreeNode:
//   { tool, camps: { campId: { …metrics, categories: { catKey: { …metrics,
//     nodes: { nodeId: …metrics } } } } }, tabs: { tabId: …metrics } }   (analytics.ts)
// Every panel here instead consumes the hierarchical `TreeNode` ({id,…metrics,children})
// via sumByCamp / sumByCategoryForCamp / collectLeafNodes. The renderer's frozen
// contract types the field as TreeNode, but `bridgeGet<T>` is an unchecked cast over
// JSON — so the shape mismatch compiled and shipped an empty dashboard (t/2709). This
// is the single conversion point; every fetch boundary (useAnalytics,
// EngagementDashboard, YourActivityPanel) runs its aggregate/user tree through it.
//
// Structure mapping — the traversal expects root → tool → camps → categories → nodes:
//   root            = tool metrics, one child keyed 'tool'  (HealthStrip/isEmpty read root.visits)
//   tool.children   = camps      (keyed acc|saf|skp|cc)
//   camp.children   = categories (keyed `${camp}-${cat}`)
//   category.children = taxonomy nodes (leaves, depth 4 → collectLeafNodes' depth≥3)
// `tabs` are non-taxonomy views (Summaries, Lineage, …) whose ids are not camps; the
// camp-based dashboard (CampBars is keyed to the 4 camps) has no place for them, so
// they are intentionally excluded from the camp hierarchy. root.visits still counts
// them — the server's `tool` rollup aggregates every view — so the totals stay
// complete while the camp breakdown stays taxonomy-only. (Surfacing tabs is a separate
// feature, not a silent loss.)

export interface WireEngagementNode {
  visits: number;
  engagedVisits: number;
  engagedMs: number;
  cappedRate: number;
  uniqueUsers?: number;
}
export interface WireEngagementCategory extends WireEngagementNode {
  nodes: Record<string, WireEngagementNode>;
}
export interface WireEngagementCamp extends WireEngagementNode {
  categories: Record<string, WireEngagementCategory>;
}
export interface WireEngagementTree {
  tool: WireEngagementNode;
  camps: Record<string, WireEngagementCamp>;
  tabs: Record<string, WireEngagementNode>;
}

function wireToNode(id: string, n: WireEngagementNode, children?: Record<string, TreeNode>): TreeNode {
  const node: TreeNode = {
    id,
    visits: n.visits,
    engagedVisits: n.engagedVisits,
    engagedMs: n.engagedMs,
    cappedRate: n.cappedRate,
  };
  if (n.uniqueUsers !== undefined) node.uniqueUsers = n.uniqueUsers;
  if (children) node.children = children;
  return node;
}

/**
 * Convert a server EngagementTree into the hierarchical TreeNode the panels traverse.
 * A missing tree (the server omits `.user` when a caller has no events) maps to null,
 * so callers keep their existing `?? null` / `=== null` empty-state handling.
 */
export function engagementTreeToTreeNode(tree: WireEngagementTree): TreeNode;
export function engagementTreeToTreeNode(tree: WireEngagementTree | null | undefined): TreeNode | null;
export function engagementTreeToTreeNode(tree: WireEngagementTree | null | undefined): TreeNode | null {
  if (!tree) return null;
  const camps: Record<string, TreeNode> = {};
  // Maps default to {} — the server may omit an empty camps/categories/nodes level,
  // and a defensive walk keeps a partial tree from throwing (returns a valid subtree).
  for (const [campId, camp] of Object.entries(tree.camps ?? {})) {
    const categories: Record<string, TreeNode> = {};
    for (const [catKey, cat] of Object.entries(camp.categories ?? {})) {
      const nodes: Record<string, TreeNode> = {};
      for (const [nodeId, node] of Object.entries(cat.nodes ?? {})) {
        nodes[nodeId] = wireToNode(nodeId, node);
      }
      categories[catKey] = wireToNode(catKey, cat, nodes);
    }
    camps[campId] = wireToNode(campId, camp, categories);
  }
  const toolNode = wireToNode('tool', tree.tool, camps);
  // root carries tool metrics (HealthStrip/isEmpty read root.visits) and wraps the
  // single tool node whose children are the camps — the two levels sumByCamp expects.
  return wireToNode('root', tree.tool, { tool: toolNode });
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
