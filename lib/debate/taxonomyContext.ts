// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Pure functions for formatting taxonomy data into BDI-structured context
 * for debate agent prompts. Extracted from useDebateStore for testability.
 */

import type { PovNode, SituationNode, GraphAttributes } from './taxonomyTypes.js';
import { interpretationText, isBdiInterpretation } from './taxonomyTypes.js';
import { POV_KEYS } from './types.js';

export interface PolicyRef {
  id: string;
  action: string;
  source_povs?: string[];
}

export interface TaxonomyContext {
  povNodes: PovNode[];
  situationNodes: SituationNode[];
  policyRegistry?: PolicyRef[];
  /** Positional vulnerability entries extracted from steelman_vulnerability attributes. */
  vulnerabilities?: { nodeId: string; label: string; text: string; score: number }[];
  /** Relevance scores by node ID. When present, enables primary/supporting tiering. */
  nodeScores?: Map<string, number>;
}

/** Map taxonomy categories to BDI sections */
export const CATEGORY_TO_BDI: Record<string, { header: string; framing: string }> = {
  'Beliefs': {
    header: '=== YOUR EMPIRICAL GROUNDING (what you take as true) ===',
    framing: 'These are the factual claims and empirical observations that ground your worldview.',
  },
  'Desires': {
    header: '=== YOUR NORMATIVE COMMITMENTS (what you argue should happen) ===',
    framing: 'These are the goals and principles you argue from. They are normative commitments, not empirical claims.',
  },
  'Intentions': {
    header: '=== YOUR REASONING APPROACH (how you construct arguments) ===',
    framing: 'These are the methods, frameworks, and argumentative strategies you use to connect beliefs to desires.',
  },
};

/** Format a single node's graph attributes as compact context lines */
export function formatNodeAttributes(attrs: GraphAttributes | undefined): string[] {
  if (!attrs) return [];
  const lines: string[] = [];
  if (attrs.assumes && attrs.assumes.length > 0) {
    lines.push(`  Assumes: ${attrs.assumes.join('; ')}`);
  }
  if (attrs.steelman_vulnerability) {
    const sv = attrs.steelman_vulnerability;
    lines.push(`  Key vulnerability: ${typeof sv === 'string' ? sv : Object.values(sv).filter(Boolean).join(' | ')}`);
  }
  if (attrs.possible_fallacies && attrs.possible_fallacies.length > 0) {
    const fallacyList = attrs.possible_fallacies
      .filter(f => f.confidence !== 'borderline')
      .map(f => `${f.fallacy.replace(/_/g, ' ')} (${f.confidence})`)
      .join(', ');
    if (fallacyList) lines.push(`  Watch for: ${fallacyList}`);
  }
  if (attrs.epistemic_type) {
    lines.push(`  Epistemic type: ${attrs.epistemic_type}`);
  }
  return lines;
}

/** Configurable limits for formatTaxonomyContext. All optional — defaults match prior hardcoded values. */
export interface FormatContextConfig {
  maxNodes?: number;
  primaryCount?: number;
  vulnMax?: number;
  vulnEnabled?: boolean;
  fallacyConfidence?: 'likely' | 'all';
  fallacyEnabled?: boolean;
  policyMax?: number;
  policyEnabled?: boolean;
  sitPrimary?: number;
  /**
   * CHESS: IDs of branch root nodes to inject deeply. When set, only nodes
   * within these branches get full injection; other branches inject top-level
   * nodes only (safety margin). When absent, all nodes injected (existing behavior).
   */
  relevantBranches?: Set<string>;
}

/** Format taxonomy nodes into a BDI-structured context block for the LLM prompt */
export function formatTaxonomyContext(ctx: TaxonomyContext, pov: string, maxNodes?: number, config?: FormatContextConfig): string {
  const cfg = config ?? {};
  const limit = cfg.maxNodes ?? maxNodes ?? 50;

  // CHESS: filter to relevant branches + top-level safety margin
  let filteredNodes = ctx.povNodes;
  if (cfg.relevantBranches && cfg.relevantBranches.size > 0) {
    // Build parent→root lookup for branch membership
    const nodeMap = new Map(ctx.povNodes.map(n => [n.id, n]));
    const rootCache = new Map<string, string>();

    function findRoot(id: string): string {
      if (rootCache.has(id)) return rootCache.get(id)!;
      const node = nodeMap.get(id);
      if (!node || !node.parent_id) { rootCache.set(id, id); return id; }
      const root = findRoot(node.parent_id);
      rootCache.set(id, root);
      return root;
    }

    filteredNodes = ctx.povNodes.filter(n => {
      const root = findRoot(n.id);
      // Include if: in a relevant branch, or is a top-level node (safety margin)
      return cfg.relevantBranches!.has(root) || n.parent_id === null;
    });
  }

  const povSlice = filteredNodes.slice(0, limit);

  // Group POV nodes by category → BDI section
  const groups: Record<string, PovNode[]> = {
    'Beliefs': [],
    'Desires': [],
    'Intentions': [],
  };
  for (const n of povSlice) {
    const cat = n.category || 'Intentions';
    (groups[cat] ?? groups['Intentions']).push(n);
  }

  const lines: string[] = [];

  const hasScores = ctx.nodeScores && ctx.nodeScores.size > 0;
  const PRIMARY_COUNT = cfg.primaryCount ?? 5;

  if (hasScores) {
    lines.push('(★ = most relevant to current topic)');
    lines.push('');
  }

  // Emit BDI sections in Beliefs → Desires → Intentions order
  for (const cat of ['Beliefs', 'Desires', 'Intentions'] as const) {
    const nodes = groups[cat];
    if (nodes.length === 0) continue;
    const bdi = CATEGORY_TO_BDI[cat];
    lines.push(bdi.header);
    lines.push(bdi.framing);

    // Sort by score if available, then split into primary/supporting
    let sorted = nodes;
    if (hasScores) {
      sorted = [...nodes].sort((a, b) => (ctx.nodeScores!.get(b.id) ?? 0) - (ctx.nodeScores!.get(a.id) ?? 0) || a.id.localeCompare(b.id));
    }

    for (let i = 0; i < sorted.length; i++) {
      const n = sorted[i];
      const isPrimary = hasScores && i < PRIMARY_COUNT;
      const prefix = isPrimary ? '★ ' : '  ';
      lines.push(`${prefix}[${n.id}] ${n.label}: ${n.description}`);
      if (n.graph_attributes?.epistemic_type) {
        lines.push(`    Epistemic type: ${n.graph_attributes.epistemic_type}`);
      }
      if (n.graph_attributes?.rhetorical_strategy) {
        lines.push(`    Rhetorical strategy: ${n.graph_attributes.rhetorical_strategy}`);
      }
      if (n.graph_attributes?.falsifiability) {
        lines.push(`    Falsifiability: ${n.graph_attributes.falsifiability}`);
      }
      if (n.graph_attributes?.node_scope) {
        lines.push(`    Scope: ${n.graph_attributes.node_scope}`);
      }
      if (n.graph_attributes?.intellectual_lineage && n.graph_attributes.intellectual_lineage.length > 0) {
        lines.push(`    Intellectual lineage: ${n.graph_attributes.intellectual_lineage.join('; ')}`);
      }
      if (n.graph_attributes?.assumes && n.graph_attributes.assumes.length > 0) {
        lines.push(`    Assumes: ${n.graph_attributes.assumes.join('; ')}`);
      }
    }
    lines.push('');
  }

  // Positional vulnerabilities — steelman_vulnerability entries, scored by relevance, cap at 10
  const vulnEntries: { nodeId: string; label: string; text: string; score: number }[] = [];
  for (const n of povSlice) {
    if (n.graph_attributes?.steelman_vulnerability) {
      const sv = n.graph_attributes.steelman_vulnerability;
      const svText = typeof sv === 'string' ? sv : Object.values(sv).filter(Boolean).join(' | ');
      vulnEntries.push({
        nodeId: n.id,
        label: n.label,
        text: svText,
        score: ctx.nodeScores?.get(n.id) ?? 0,
      });
    }
  }
  if (vulnEntries.length > 0 && (cfg.vulnEnabled ?? true)) {
    const VULN_LIMIT = cfg.vulnMax ?? 10;
    const sorted = vulnEntries.sort((a, b) => b.score - a.score || a.nodeId.localeCompare(b.nodeId)).slice(0, VULN_LIMIT);
    lines.push('=== POSITIONAL VULNERABILITIES (where your position is weakest) ===');
    lines.push('These are pre-filtered for relevance to the current topic. Acknowledge when directly relevant — but do not over-concede or apologize for your core stance.');
    for (const v of sorted) {
      lines.push(`- [${v.nodeId}] ${v.label}: ${v.text}`);
    }
    lines.push('');
  }

  // Reasoning watchlist — configurable confidence filter
  const fallacyLines: string[] = [];
  const fallacyEnabled = cfg.fallacyEnabled ?? true;
  const fallacyFilter = cfg.fallacyConfidence ?? 'likely';
  if (fallacyEnabled) for (const n of povSlice) {
    if (n.graph_attributes?.possible_fallacies && n.graph_attributes.possible_fallacies.length > 0) {
      const likely = n.graph_attributes.possible_fallacies.filter(f => fallacyFilter === 'all' || f.confidence === 'likely');
      for (const f of likely) {
        fallacyLines.push(`- [${n.id}] ${n.label}: ${f.fallacy.replace(/_/g, ' ')} — ${f.explanation}`);
      }
    }
  }
  if (fallacyLines.length > 0) {
    lines.push('=== REASONING WATCHLIST (errors to self-monitor) ===');
    lines.push('These are reasoning patterns you tend toward. Self-monitor — if you catch yourself using one, flag it explicitly rather than letting it pass.');
    lines.push(...fallacyLines.slice(0, 10));
    lines.push('');
  }

  // Situations section — top nodes get full interpretations, rest get selective detail
  if (ctx.situationNodes.length > 0) {
    const SIT_PRIMARY = cfg.sitPrimary ?? 8;
    const otherPovs = POV_KEYS.filter(p => p !== pov);

    // Sort by relevance score if available
    let sortedSit = ctx.situationNodes;
    if (hasScores) {
      sortedSit = [...ctx.situationNodes].sort((a, b) => (ctx.nodeScores!.get(b.id) ?? 0) - (ctx.nodeScores!.get(a.id) ?? 0) || a.id.localeCompare(b.id));
    }

    lines.push('=== SITUATIONS (contested concepts — cite sit- IDs in taxonomy_refs) ===');
    lines.push("These are contested concepts where perspectives diverge. When your argument engages a concept listed here, CITE its sit- ID in your taxonomy_refs — this tracks which contested concepts the debate actually addressed. Your interpretation differs from others'; understanding their full position helps you identify genuine disagreements.");

    for (let i = 0; i < sortedSit.length; i++) {
      const n = sortedSit[i];
      const isPrimary = i < SIT_PRIMARY;
      lines.push(`${isPrimary ? '★ ' : '  '}[${n.id}] ${n.label}: ${n.description}`);

      // This agent's interpretation — always full
      const interp = n.interpretations?.[pov as keyof typeof n.interpretations];
      if (interp) {
        const myInterp = typeof interp === 'object' ? interp : undefined;
        if (isPrimary && myInterp && isBdiInterpretation(interp)) {
          // BDI-decomposed: show structured breakdown for primary nodes
          lines.push(`  Your interpretation (BDI breakdown):`);
          lines.push(`    Belief: ${myInterp.belief}`);
          lines.push(`    Desire: ${myInterp.desire}`);
          lines.push(`    Intention: ${myInterp.intention}`);
        } else {
          lines.push(`  Your interpretation: ${interpretationText(interp)}`);
        }
      }

      if (isPrimary) {
        // Top nodes: show ALL interpretations — BDI breakdown when available
        for (const p of otherPovs) {
          const val = n.interpretations?.[p];
          if (val) {
            if (isBdiInterpretation(val)) {
              lines.push(`  ${p.charAt(0).toUpperCase() + p.slice(1)}:`);
              lines.push(`    Belief: ${val.belief}`);
              lines.push(`    Desire: ${val.desire}`);
              lines.push(`    Intention: ${val.intention}`);
            } else {
              lines.push(`  ${p.charAt(0).toUpperCase() + p.slice(1)}: ${interpretationText(val)}`);
            }
          }
        }
      } else {
        // Remaining nodes: show the most contested interpretation in full, truncate others
        // Heuristic: longest other interpretation = most detailed/divergent
        const otherInterps = otherPovs
          .map(p => ({ pov: p, text: interpretationText(n.interpretations?.[p]) }))
          .filter(o => o.text.length > 0)
          .sort((a, b) => b.text.length - a.text.length || a.pov.localeCompare(b.pov));

        if (otherInterps.length > 0) {
          // Most contested in full
          const most = otherInterps[0];
          lines.push(`  ${most.pov.charAt(0).toUpperCase() + most.pov.slice(1)}: ${most.text}`);
          // Others truncated
          for (const other of otherInterps.slice(1)) {
            const truncated = other.text.length > 120 ? other.text.slice(0, 117) + '...' : other.text;
            lines.push(`  ${other.pov.charAt(0).toUpperCase() + other.pov.slice(1)}: ${truncated}`);
          }
        }
      }
    }
  }

  // Policy registry section — configurable limit, with top 3 marked as primary
  if (ctx.policyRegistry && ctx.policyRegistry.length > 0 && (cfg.policyEnabled ?? true)) {
    const POLICY_LIMIT = cfg.policyMax ?? 10;
    const POLICY_PRIMARY = 3;
    const policies = ctx.policyRegistry.slice(0, POLICY_LIMIT);

    lines.push('');
    lines.push('=== POLICY ACTIONS (reference by pol-NNN ID when relevant) ===');
    lines.push('These are concrete policy actions identified in the research. When your argument supports or opposes a specific policy, reference its ID in your policy_refs.');
    if (policies.length > POLICY_PRIMARY) {
      lines.push('(★ = most relevant to current topic)');
    }
    for (let i = 0; i < policies.length; i++) {
      const pol = policies[i];
      const povTag = pol.source_povs && pol.source_povs.length > 0
        ? ` (${pol.source_povs.join(', ')})`
        : '';
      const prefix = i < POLICY_PRIMARY ? '★ ' : '  ';
      lines.push(`${prefix}[${pol.id}] ${pol.action}${povTag}`);
    }
  }

  return lines.join('\n');
}

/** Instrumentation data for tracking what was injected vs what was used. */
export interface ContextInjectionManifest {
  povNodeIds: string[];
  povPrimaryIds: string[];
  situationNodeIds: string[];
  vulnerabilityCount: number;
  policyCount: number;
  totalTokenEstimate: number;
  /** Relevance scores for injected POV nodes (for calibration variance analysis). */
  nodeScores?: number[];
}

/**
 * Compute the injection manifest — what node IDs would be injected for this context.
 * Call alongside formatTaxonomyContext and store on the transcript entry for usage analysis.
 */
export function computeInjectionManifest(
  ctx: TaxonomyContext,
  pov: string,
  maxNodes?: number,
  config?: FormatContextConfig,
): ContextInjectionManifest {
  const cfg = config ?? {};
  const limit = cfg.maxNodes ?? maxNodes ?? 50;
  const PRIMARY_COUNT = cfg.primaryCount ?? 5;
  const SIT_PRIMARY = cfg.sitPrimary ?? 8;

  // Replicate the same filtering/slicing logic as formatTaxonomyContext
  let filteredNodes = ctx.povNodes;
  if (cfg.relevantBranches && cfg.relevantBranches.size > 0) {
    const nodeMap = new Map(ctx.povNodes.map(n => [n.id, n]));
    const rootCache = new Map<string, string>();
    function findRoot(id: string): string {
      if (rootCache.has(id)) return rootCache.get(id)!;
      const node = nodeMap.get(id);
      if (!node || !node.parent_id) { rootCache.set(id, id); return id; }
      const root = findRoot(node.parent_id);
      rootCache.set(id, root);
      return root;
    }
    filteredNodes = ctx.povNodes.filter(n => {
      const root = findRoot(n.id);
      return cfg.relevantBranches!.has(root) || n.parent_id === null;
    });
  }

  const povSlice = filteredNodes.slice(0, limit);

  // Group by BDI to find primaries (same logic as formatTaxonomyContext)
  const groups: Record<string, typeof povSlice> = { 'Beliefs': [], 'Desires': [], 'Intentions': [] };
  for (const n of povSlice) {
    const cat = n.category || 'Intentions';
    (groups[cat] ?? groups['Intentions']).push(n);
  }

  const primaryIds: string[] = [];
  for (const cat of ['Beliefs', 'Desires', 'Intentions']) {
    const sorted = ctx.nodeScores
      ? groups[cat].sort((a, b) => (ctx.nodeScores!.get(b.id) ?? 0) - (ctx.nodeScores!.get(a.id) ?? 0) || a.id.localeCompare(b.id))
      : groups[cat];
    for (let i = 0; i < Math.min(PRIMARY_COUNT, sorted.length); i++) {
      primaryIds.push(sorted[i].id);
    }
  }

  const sitSlice = (ctx.situationNodes ?? []).slice(0, 15);
  const sitIds = sitSlice.map(n => n.id);

  // Rough token estimate: ~80 tokens per POV node, ~150 per primary situation, ~50 per non-primary
  const tokenEst = povSlice.length * 80
    + Math.min(sitSlice.length, SIT_PRIMARY) * 150
    + Math.max(0, sitSlice.length - SIT_PRIMARY) * 50
    + (ctx.vulnerabilities?.length ?? 0) * 60
    + (ctx.policyRegistry?.length ?? 0) * 40;

  // Collect relevance scores for injected nodes (for calibration parameter #9 variance analysis)
  const nodeScores = ctx.nodeScores
    ? povSlice.map(n => ctx.nodeScores!.get(n.id) ?? 0)
    : undefined;

  return {
    povNodeIds: povSlice.map(n => n.id),
    povPrimaryIds: primaryIds,
    situationNodeIds: sitIds,
    vulnerabilityCount: Math.min((ctx.vulnerabilities ?? []).length, cfg.vulnMax ?? 10),
    policyCount: Math.min((ctx.policyRegistry ?? []).length, cfg.policyMax ?? 10),
    totalTokenEstimate: tokenEst,
    nodeScores,
  };
}
