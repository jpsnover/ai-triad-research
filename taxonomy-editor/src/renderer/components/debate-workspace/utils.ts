// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { POVER_INFO } from '../../types/debate';
import type { SpeakerId, TranscriptEntry, TaxonomyRef } from '../../types/debate';
import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import { api } from '@bridge';
import { nodePovFromId } from '@lib/debate/nodeIdUtils';
import type { TabId } from '../../types/taxonomy';

// ── Speaker helpers ──────────────────────────────────────

export function speakerLabel(speaker: SpeakerId | 'system' | 'document' | 'moderator'): string {
  if (speaker === 'system') return 'System';
  if (speaker === 'moderator') return 'Moderator';
  if (speaker === 'user') return 'You';
  if (speaker === 'document') return 'Document';
  const info = POVER_INFO[speaker as Exclude<SpeakerId, 'user'>];
  return info ? info.label : speaker;
}

export function speakerColor(speaker: SpeakerId | 'system' | 'document' | 'moderator'): string | undefined {
  if (speaker === 'system' || speaker === 'user' || speaker === 'document') return undefined;
  if (speaker === 'moderator') return 'var(--color-moderator, #8b5cf6)';
  const info = POVER_INFO[speaker as Exclude<SpeakerId, 'user'>];
  return info?.color;
}

// ── Policy action lookup ──────────────────────────────────

export function getPolicyAction(polId: string): string {
  const registry = useTaxonomyStore.getState().policyRegistry;
  if (!registry) return polId;
  const entry = registry.find(p => p.id === polId);
  return entry ? entry.action : polId;
}

// ── Grounding helpers ────────────────────────────────────

export function groundingLabel(baseStrength: number | undefined): string {
  if (baseStrength === undefined) return '';
  if (baseStrength >= 0.65) return 'Grounded';
  if (baseStrength >= 0.35) return 'Reasoned';
  return 'Asserted';
}

export const GROUNDING_COLORS: Record<string, string | undefined> = {
  Grounded: '#22c55e',
  Asserted: '#f59e0b',
};

// ── Strength band helper ─────────────────────────────────

export const STRENGTH_BAND = (v: number) =>
  v >= 0.8 ? { label: 'Strong', color: '#22c55e' }
  : v >= 0.5 ? { label: 'Moderate', color: '#3b82f6' }
  : v >= 0.3 ? { label: 'Weak', color: '#f59e0b' }
  : { label: 'Very Weak', color: '#ef4444' };

// ── Percentage formatter ─────────────────────────────────

export function pctFmt(v: number): string { return `${(v * 100).toFixed(0)}%`; }

// ── POV color map ────────────────────────────────────────

export const POV_COLOR_VAR: Record<string, string> = {
  accelerationist: 'var(--color-acc)',
  safetyist: 'var(--color-saf)',
  skeptic: 'var(--color-skp)',
  situations: 'var(--color-sit)',
};

// ── Taxonomy cross-navigation helpers ────────────────────

/** Map node_id prefix to the taxonomy tab and CSS color */
export function nodeIdToTab(nodeId: string): { tab: TabId; colorVar: string } {
  const pov = nodePovFromId(nodeId);
  if (pov) return { tab: pov as TabId, colorVar: POV_COLOR_VAR[pov] || 'var(--text-muted)' };
  return { tab: 'situations', colorVar: 'var(--text-muted)' };
}

/** Resolve a node_id to its label from the taxonomy store */
export function getNodeLabel(nodeId: string): string {
  const state = useTaxonomyStore.getState();
  const { tab } = nodeIdToTab(nodeId);

  if (tab === 'situations') {
    const node = state.situations?.nodes?.find((n: { id: string }) => n.id === nodeId);
    if (node) return node.label;
  } else {
    const povFile = state[tab as 'accelerationist' | 'safetyist' | 'skeptic'];
    const node = povFile?.nodes?.find((n: { id: string }) => n.id === nodeId);
    if (node) return node.label;
  }
  return nodeId;
}

export function getNodeWeight(nodeId: string): { category?: string; confidence?: number; priority?: number; operationality?: number } | null {
  const state = useTaxonomyStore.getState();
  const { tab } = nodeIdToTab(nodeId);
  if (tab === 'situations') return null;
  const povFile = state[tab as 'accelerationist' | 'safetyist' | 'skeptic'];
  const node = povFile?.nodes?.find((n: { id: string }) => n.id === nodeId);
  if (!node) return null;
  return { category: node.category, confidence: node.confidence, priority: node.priority, operationality: node.operationality };
}

/** Navigate the main application window to a taxonomy node and focus it. */
export function focusMainWindowNode(nodeId: string): void {
  api.focusNodeInMainWindow(nodeId);
}

// ── Policy ref helpers ────────────────────────────────────

/** Combined taxonomy + policy refs entry type */
export type PolicyRefEntry = string | { policy_id: string; relevance: string };

export function resolvePolRef(ref: PolicyRefEntry): { id: string; relevance: string | null } {
  if (typeof ref === 'string') return { id: ref, relevance: null };
  return { id: ref.policy_id, relevance: ref.relevance };
}

// ── Explain prompt helpers ────────────────────────────────

export function buildExplainPrompt(entry: TranscriptEntry): string {
  const speaker = speakerLabel(entry.speaker);
  const refs = entry.taxonomy_refs || [];
  let prompt = `Explain this section of a debate between the Accelerationist, the Safetyist, and the Skeptic:\n\n`;
  prompt += `[${speaker} — ${entry.type}]\n${entry.content}\n`;
  if (refs.length > 0) {
    prompt += `\nTaxonomy references cited:\n`;
    for (const ref of refs) {
      const label = getNodeLabel(ref.node_id);
      prompt += `- ${ref.node_id} (${label}): ${ref.relevance}\n`;
    }
  }
  return prompt;
}

export function handleExplainEntry(entry: TranscriptEntry) {
  const prompt = buildExplainPrompt(entry);
  void api.clipboardWriteText(prompt);
  void api.openExternal('https://gemini.google.com/app');
}

// ── Markdown helpers ─────────────────────────────────────

/** Strip markdown headings the AI sometimes hallucinates at the top of a statement (e.g. "# Engine Thermometer Accelerator"). */
export function stripLeadingHeadings(text: string): string {
  return text.replace(/^(?:#{1,3}\s+.*\n*)+/, '').trimStart();
}

/** Fix markdown links broken by newlines inside `[text](url)` — AI models often wrap long URLs.
 *  Also repairs garbled DOI links: if the link text contains a (doi:...) parenthetical, extract
 *  the DOI and use it to reconstruct the correct URL, then clean up the display text. */
export function fixMarkdownLinks(text: string): string {
  return text.replace(/\[([^\]]*)\]\(\s*([\s\S]*?)\s*\)/g, (_match, linkText: string, url: string) => {
    let cleanUrl = url.replace(/\s+/g, '');
    let cleanText = linkText;

    // If the link text contains doi:..., extract the FIRST DOI and use it to fix the URL.
    // The AI often omits closing parens, so match flexibly: stop at whitespace, paren, or end.
    const doiMatch = linkText.match(/doi:\s*(10\.\d{4,9}\/\S+?)(?:\s|\)|$)/i);
    if (doiMatch) {
      cleanUrl = `https://doi.org/${doiMatch[1]}`;
      // Strip ALL doi parentheticals (with or without closing paren) and trailing junk
      cleanText = linkText
        .replace(/\s*\(?doi:[^)]*\)?/gi, '')
        .replace(/\s*\([A-Z]{1,5}\d{8,}\)/g, '')
        .replace(/\d+\)\]?$/, '')  // trailing "41)]" junk
        .trim();
    }

    return `[${cleanText || linkText}](${cleanUrl})`;
  });
}

/**
 * Rendered-text offset of a DOM point `(node, offset)` within `container` — the
 * length of the concatenated text-node content that precedes it. This lives in
 * the same rendered-text space CommentOverlay resolves against (its TreeWalker
 * concatenates text-node values), so a comment anchored with this offset round-
 * trips even when the selection spans inline markdown (**bold**, [links]) that
 * `selectedText.indexOf` on the raw markdown source would miss (t/1694).
 */
export function renderedOffsetOf(container: HTMLElement, node: Node, offset: number): number {
  const preRange = document.createRange();
  preRange.selectNodeContents(container);
  preRange.setEnd(node, offset);
  return preRange.toString().length;
}

// ── Find-in-debate helpers ────────────────────────────────

export function countOccurrences(text: string, query: string): number {
  if (!query) return 0;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let count = 0, pos = 0;
  while ((pos = lower.indexOf(q, pos)) !== -1) { count++; pos += q.length; }
  return count;
}

// ── Adaptive phase types (shared by DebateActionBar + DebateWorkspace) ──

export type AdaptivePhase = 'confrontation' | 'argumentation' | 'concluding';

export const ADAPTIVE_PHASES: AdaptivePhase[] = ['confrontation', 'argumentation', 'concluding'];

export const ADAPTIVE_PHASE_LABELS: Record<AdaptivePhase, string> = {
  'confrontation': 'Confrontation',
  'argumentation': 'Argumentation',
  'concluding': 'Concluding',
};

export const ADAPTIVE_PHASE_COLORS: Record<AdaptivePhase, string> = {
  'confrontation': '#f59e0b',
  'argumentation': '#3b82f6',
  'concluding': '#10b981',
};
