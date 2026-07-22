// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// ADR-007 file-size split of turnValidator.ts (t/1686).
// Repair-prompt builder plus the hedge-density helpers (Rule 10).
// computeHedgeDensity / getHedgeThreshold are exported for the core and
// stageValidation modules but are NOT re-exported by the turnValidator barrel —
// the public surface here is limited to buildRepairPrompt.

import type { DebatePhase, DebateAudience, TurnValidation } from '../types.js';
import { MOVE_CATALOG_RAW } from './moves.js';

// ── Repair prompt builder ────────────────────────────────

export function buildRepairPrompt(
  basePrompt: string,
  v: TurnValidation,
  attempt: number,
): string {
  const sections: string[] = [];
  sections.push('--- REPAIR INSTRUCTIONS ---');
  sections.push('Your prior response was rejected for the following reasons:');
  for (const h of v.repairHints) sections.push(`- ${h}`);
  sections.push('');
  sections.push('Do NOT repeat the rejected response. On this retry you MUST:');
  if (!v.dimensions.schema.pass) {
    sections.push('• Fix the JSON/schema issues above before anything else.');
    const hasMoveError = v.repairHints.some(h => h.includes('Unknown move_types'));
    if (hasMoveError) {
      sections.push(`• CRITICAL: move_types must use ONLY these exact values: ${MOVE_CATALOG_RAW.join(', ')}. Do NOT invent new move names.`);
    }
  }
  if (!v.dimensions.grounding.pass) {
    sections.push('• Replace filler `relevance` strings with one concrete sentence explaining the mechanism by which the cited node supports or complicates your claim.');
  }
  if (!v.dimensions.advancement.pass) {
    sections.push('• Include at least one NEW move from: DISTINGUISH, CONCEDE-AND-PIVOT, COUNTEREXAMPLE, or a falsifiable prediction with a timeline. Cite at least one taxonomy node you have not referenced in your last two turns.');
  }
  if (!v.dimensions.clarifies.pass) {
    sections.push('• If the evidence warrants it, use one `taxonomy_refs[i].relevance` to propose a node clarification — say whether its description should be narrowed, broadened, or split, and cite the evidence from this turn.');
  }
  sections.push('• Keep `statement` to 3–5 paragraphs. Do not restate your opening.');

  if (attempt >= 2) {
    sections.push('');
    sections.push('Required JSON shape (minimal reminder):');
    sections.push('{ "statement": "…", "taxonomy_refs": [{"node_id":"…","relevance":"…"}], "move_types": [{"move":"…","detail":"…"}], "disagreement_type": "EMPIRICAL|VALUES|DEFINITIONAL", "my_claims": [{"claim":"…","targets":["…"]}] }');
  }

  const hasHedgeWarning = v.repairHints.some(h => h.includes('Hedge density'));
  if (hasHedgeWarning) {
    sections.push('• Reduce hedge-stacking: replace "may potentially", "could possibly", "it seems likely" with direct assertions. Name the actor and use active voice.');
  }

  return `${basePrompt}\n\n${sections.join('\n')}\n`;
}

// ── Hedge-density helpers (Rule 10) ─────────────────────────

const HEDGE_MARKERS = [
  /\bmay\b/gi, /\bmight\b/gi, /\bcould\b/gi, /\bperhaps\b/gi,
  /\bpossibly\b/gi, /\bpotentially\b/gi, /\barguably\b/gi,
  /\bseems?\b/gi, /\bappears?\b/gi, /\bsomewhat\b/gi,
  /\btends?\sto\b/gi, /\bit is (possible|conceivable|plausible) that\b/gi,
  /\bsome (argue|suggest|believe|contend)\b/gi,
  /\bit has been (suggested|argued|noted)\b/gi,
  /\bmay potentially\b/gi, /\bcould potentially\b/gi,
  /\bcould possibly\b/gi, /\bmight possibly\b/gi,
];

export function computeHedgeDensity(statement: string): number {
  const sentences = statement.split(/[.!?]+/).filter(s => s.trim().length > 10);
  if (sentences.length === 0) return 0;
  let hedgedSentences = 0;
  for (const sentence of sentences) {
    if (HEDGE_MARKERS.some(rx => rx.test(sentence))) {
      hedgedSentences++;
    }
    for (const rx of HEDGE_MARKERS) rx.lastIndex = 0;
  }
  return hedgedSentences / sentences.length;
}

export function getHedgeThreshold(phase: DebatePhase, audience?: DebateAudience): number {
  if (audience === 'academic_community') return 0.50;
  const byPhase: Record<DebatePhase, number> = {
    'confrontation': 0.40,
    argumentation: 0.30,
    concluding: 0.20,
    terminated: 0.20,
  };
  if (audience === 'general_public') {
    return (byPhase[phase] ?? 0.30) - 0.05;
  }
  return byPhase[phase] ?? 0.30;
}
