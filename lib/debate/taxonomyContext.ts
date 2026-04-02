// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Pure functions for formatting taxonomy data into BDI-structured context
 * for debate agent prompts. Extracted from useDebateStore for testability.
 */

import type { PovNode, CrossCuttingNode, GraphAttributes } from './taxonomyTypes';

export interface PolicyRef {
  id: string;
  action: string;
  source_povs?: string[];
}

export interface TaxonomyContext {
  povNodes: PovNode[];
  crossCuttingNodes: CrossCuttingNode[];
  /** New name for crossCuttingNodes — Phase 1 shim. */
  situationNodes?: CrossCuttingNode[];
  policyRegistry?: PolicyRef[];
}

/** Map taxonomy categories to BDI sections */
export const CATEGORY_TO_BDI: Record<string, { header: string; framing: string }> = {
  'Beliefs': {
    header: '=== YOUR BELIEFS (what you take as empirically true) ===',
    framing: 'These are the factual claims and empirical observations that ground your worldview.',
  },
  'Desires': {
    header: '=== YOUR DESIRES (what you prioritize and why) ===',
    framing: 'These are the goals and principles you argue from. They are normative commitments, not empirical claims.',
  },
  'Intentions': {
    header: '=== YOUR INTENTIONS (how you argue) ===',
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

/** Format taxonomy nodes into a BDI-structured context block for the LLM prompt */
export function formatTaxonomyContext(ctx: TaxonomyContext, pov: string, maxNodes: number = 50): string {
  const povSlice = ctx.povNodes.slice(0, maxNodes);

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

  // Emit BDI sections in Beliefs → Desires → Intentions order
  for (const cat of ['Beliefs', 'Desires', 'Intentions'] as const) {
    const nodes = groups[cat];
    if (nodes.length === 0) continue;
    const bdi = CATEGORY_TO_BDI[cat];
    lines.push(bdi.header);
    lines.push(bdi.framing);
    for (const n of nodes) {
      lines.push(`[${n.id}] ${n.label}: ${n.description}`);
      if (n.graph_attributes?.epistemic_type) {
        lines.push(`  Epistemic type: ${n.graph_attributes.epistemic_type}`);
      }
      if (n.graph_attributes?.assumes && n.graph_attributes.assumes.length > 0) {
        lines.push(`  Assumes: ${n.graph_attributes.assumes.join('; ')}`);
      }
    }
    lines.push('');
  }

  // Vulnerabilities section — aggregated from all POV nodes
  const vulnLines: string[] = [];
  for (const n of povSlice) {
    if (n.graph_attributes?.steelman_vulnerability) {
      const sv = n.graph_attributes.steelman_vulnerability;
      const svText = typeof sv === 'string' ? sv : Object.values(sv).filter(Boolean).join(' | ');
      vulnLines.push(`- [${n.id}] ${n.label}: ${svText}`);
    }
    if (n.graph_attributes?.possible_fallacies && n.graph_attributes.possible_fallacies.length > 0) {
      const notable = n.graph_attributes.possible_fallacies.filter(f => f.confidence !== 'borderline');
      for (const f of notable) {
        vulnLines.push(`- [${n.id}] ${n.label}: Watch for ${f.fallacy.replace(/_/g, ' ')} (${f.confidence})`);
      }
    }
  }
  if (vulnLines.length > 0) {
    lines.push('=== YOUR KNOWN VULNERABILITIES ===');
    lines.push('Be aware of these weaknesses in your positions. Acknowledging them when relevant strengthens your credibility — but do not over-concede or apologize for your core stance.');
    lines.push(...vulnLines.slice(0, 50));
    lines.push('');
  }

  // Situations section — show this agent's interpretation prominently
  const ccNodes = ctx.situationNodes ?? ctx.crossCuttingNodes;
  if (ccNodes.length > 0) {
    lines.push('=== CROSS-CUTTING CONCERNS ===');
    lines.push("These concepts are contested across all perspectives. Your interpretation differs from others'.");
    for (const n of ccNodes) {
      lines.push(`[${n.id}] ${n.label}: ${n.description}`);
      // Show this agent's interpretation prominently
      const interp = n.interpretations?.[pov as keyof typeof n.interpretations];
      if (interp) {
        lines.push(`  Your interpretation: ${interp}`);
      }
      // Brief note about other views
      const otherPovs = ['accelerationist', 'safetyist', 'skeptic'].filter(p => p !== pov);
      const otherViews = otherPovs
        .map(p => {
          const val = n.interpretations?.[p as keyof typeof n.interpretations];
          return val ? `${p.charAt(0).toUpperCase() + p.slice(1, 3)}: ${val.length > 80 ? val.slice(0, 77) + '...' : val}` : null;
        })
        .filter(Boolean);
      if (otherViews.length > 0) {
        lines.push(`  Other views: ${otherViews.join(' | ')}`);
      }
    }
  }

  // Policy registry section — shows available policy actions debaters can reference
  if (ctx.policyRegistry && ctx.policyRegistry.length > 0) {
    lines.push('');
    lines.push('=== POLICY ACTIONS (reference by pol-NNN ID when relevant) ===');
    lines.push('These are concrete policy actions identified in the research. When your argument supports or opposes a specific policy, reference its ID in your policy_refs.');
    for (const pol of ctx.policyRegistry.slice(0, 30)) {
      const povTag = pol.source_povs && pol.source_povs.length > 0
        ? ` (${pol.source_povs.join(', ')})`
        : '';
      lines.push(`[${pol.id}] ${pol.action}${povTag}`);
    }
  }

  return lines.join('\n');
}
