// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Output formatters for the CLI debate runner.
 * Slug generation, Markdown export, diagnostics/harvest output builders.
 */

import type { DebateSession, PoverId, TranscriptEntry } from './types';
import { POVER_INFO } from './types';
import {
  extractConflictCandidates,
  extractSteelmanCandidates,
  extractDebateRefCandidates,
  extractVerdictCandidates,
  extractConceptCandidates,
} from './harvestUtils';

// ── Slug generation (port of New-Slug.ps1) ───────────────

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'of', 'in', 'to', 'for', 'with', 'on', 'at',
  'is', 'it', 'by', 'that', 'this', 'be', 'are', 'was', 'or', 'not',
]);

export function generateSlug(text: string, maxLength: number = 60): string {
  // Normalize Unicode → ASCII approximation
  let slug = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  slug = slug.toLowerCase();
  slug = slug.replace(/[^\w\s-]/g, '');  // keep word chars, spaces, hyphens
  slug = slug.replace(/[\s_]+/g, '-');    // collapse whitespace to hyphens
  slug = slug.replace(/^-+|-+$/g, '');    // trim leading/trailing hyphens

  // Remove stop words
  slug = slug.split('-').filter(w => !STOP_WORDS.has(w)).join('-');
  slug = slug.replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');

  if (slug.length > maxLength) {
    slug = slug.substring(0, maxLength);
    const lastHyphen = slug.lastIndexOf('-');
    if (lastHyphen > 10) slug = slug.substring(0, lastHyphen);
  }

  if (!slug) {
    slug = `debate-${new Date().toISOString().slice(0, 10)}`;
  }

  return slug;
}

// ── Markdown export ──────────────────────────────────────

function speakerLabel(speaker: string): string {
  if (speaker === 'user') return 'Moderator';
  if (speaker === 'system') return 'System';
  const info = POVER_INFO[speaker as Exclude<PoverId, 'user'>];
  return info ? `${info.label} (${info.pov})` : speaker;
}

export function formatDebateMarkdown(session: DebateSession): string {
  const lines: string[] = [];

  // Header
  lines.push(`# Debate: ${session.title}`);
  lines.push('');
  lines.push(`**Date:** ${session.created_at.slice(0, 10)} | **Model:** ${session.debate_model ?? 'default'} | **Protocol:** ${session.protocol_id ?? 'structured'}`);
  lines.push(`**Debaters:** ${session.active_povers.filter(p => p !== 'user').map(p => speakerLabel(p)).join(', ')}`);
  lines.push('');

  // Topic
  lines.push('## Topic');
  lines.push('');
  lines.push(session.topic.final);
  if (session.topic.refined && session.topic.refined !== session.topic.original) {
    lines.push('');
    lines.push(`*Original:* ${session.topic.original}`);
    lines.push(`*Refined:* ${session.topic.refined}`);
  }
  lines.push('');

  // Group transcript by phases
  const openings = session.transcript.filter(e => e.type === 'opening');
  const debates = session.transcript.filter(e =>
    e.type === 'statement' || e.type === 'question' || e.type === 'probing',
  );
  const synthesis = session.transcript.find(e => e.type === 'synthesis');
  const factChecks = session.transcript.filter(e => e.type === 'fact-check');

  // Opening Statements
  if (openings.length > 0) {
    lines.push('## Opening Statements');
    lines.push('');
    for (const entry of openings) {
      lines.push(`### ${speakerLabel(entry.speaker)}`);
      lines.push('');
      lines.push(entry.content);
      lines.push('');
      if (entry.taxonomy_refs.length > 0) {
        lines.push(`*Taxonomy refs:* ${entry.taxonomy_refs.map(r => `\`${r.node_id}\``).join(', ')}`);
        lines.push('');
      }
    }
  }

  // Debate Rounds
  if (debates.length > 0) {
    lines.push('## Debate');
    lines.push('');
    for (const entry of debates) {
      const meta = entry.metadata as Record<string, unknown> | undefined;
      const focusPoint = meta?.focus_point as string | undefined;
      const addressing = entry.addressing;

      if (entry.type === 'question') {
        lines.push(`### Moderator`);
      } else if (entry.type === 'probing') {
        lines.push('### Probing Questions');
      } else {
        const target = addressing ? ` → ${speakerLabel(addressing as string)}` : '';
        lines.push(`### ${speakerLabel(entry.speaker)}${target}`);
      }

      if (focusPoint) {
        lines.push(`*Focus:* ${focusPoint}`);
      }
      lines.push('');
      lines.push(entry.content);
      lines.push('');

      if (entry.taxonomy_refs.length > 0) {
        lines.push(`*Refs:* ${entry.taxonomy_refs.map(r => `\`${r.node_id}\``).join(', ')}`);
        lines.push('');
      }
      if (entry.policy_refs && entry.policy_refs.length > 0) {
        lines.push(`*Policy refs:* ${entry.policy_refs.map(r => `\`${r}\``).join(', ')}`);
        lines.push('');
      }
    }
  }

  // Synthesis
  if (synthesis) {
    lines.push('## Synthesis');
    lines.push('');

    // Use the structured synthesis data if available for proper markdown formatting
    const synthData = (synthesis.metadata as Record<string, unknown>)?.synthesis as Record<string, unknown> | undefined;
    if (synthData) {
      // Areas of Agreement
      const agreements = synthData.areas_of_agreement as { point: string; povers: string[] }[] | undefined;
      if (agreements?.length) {
        lines.push('### Areas of Agreement');
        lines.push('');
        for (const a of agreements) {
          const povers = a.povers?.map(p => POVER_INFO[p as Exclude<PoverId, 'user'>]?.label ?? p).join(', ') ?? '';
          lines.push(`- ${a.point}${povers ? ` (${povers})` : ''}`);
        }
        lines.push('');
      }

      // Areas of Disagreement
      const disagreements = synthData.areas_of_disagreement as { point: string; type?: string; bdi_layer?: string; resolvability?: string; positions?: { pover: string; stance: string }[] }[] | undefined;
      if (disagreements?.length) {
        lines.push('### Areas of Disagreement');
        lines.push('');
        for (const d of disagreements) {
          const typeTag = d.type ? ` [${d.type}]` : '';
          const bdiTag = d.bdi_layer ? ` {${d.bdi_layer}}` : '';
          lines.push(`- **${d.point}**${typeTag}${bdiTag}`);
          for (const pos of d.positions ?? []) {
            const label = POVER_INFO[pos.pover as Exclude<PoverId, 'user'>]?.label ?? pos.pover;
            lines.push(`    - **${label}:** ${pos.stance}`);
          }
          if (d.resolvability) {
            lines.push(`    - *Resolution path: ${d.resolvability.replace(/_/g, ' ')}*`);
          }
        }
        lines.push('');
      }

      // Cruxes
      const cruxes = synthData.cruxes as { question: string; if_yes?: string; if_no?: string; type?: string }[] | undefined;
      if (cruxes?.length) {
        lines.push('### Cruxes');
        lines.push('');
        for (const c of cruxes) {
          lines.push(`- ${c.question}${c.type ? ` [${c.type}]` : ''}`);
          if (c.if_yes) lines.push(`    - If yes: ${c.if_yes}`);
          if (c.if_no) lines.push(`    - If no: ${c.if_no}`);
        }
        lines.push('');
      }

      // Unresolved Questions
      const unresolved = synthData.unresolved_questions as string[] | undefined;
      if (unresolved?.length) {
        lines.push('### Unresolved Questions');
        lines.push('');
        for (const q of unresolved) lines.push(`- ${q}`);
        lines.push('');
      }

      // Preferences
      const preferences = synthData.preferences as { conflict: string; prevails: string; criterion: string; rationale: string; what_would_change_this?: string }[] | undefined;
      if (preferences?.length) {
        lines.push('### Resolution Analysis');
        lines.push('');
        for (const p of preferences) {
          if (p.prevails === 'undecidable') {
            lines.push(`- **${p.conflict}** — Undecidable`);
          } else {
            lines.push(`- **${p.conflict}** — Stronger: ${p.prevails} (${p.criterion?.replace(/_/g, ' ')})`);
          }
          lines.push(`    - *${p.rationale}*`);
          if (p.what_would_change_this) {
            lines.push(`    - Would change if: ${p.what_would_change_this}`);
          }
        }
        lines.push('');
      }
    } else {
      // Fallback to raw content
      lines.push(synthesis.content);
      lines.push('');
    }
  }

  // Fact Checks
  if (factChecks.length > 0) {
    lines.push('## Fact Checks');
    lines.push('');
    for (const fc of factChecks) {
      const meta = fc.metadata as Record<string, unknown> | undefined;
      const verdict = meta?.verdict as string | undefined;
      lines.push(`- **${verdict ?? 'unknown'}**: ${fc.content.slice(0, 200)}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Diagnostics output ───────────────────────────────────

export function buildDiagnosticsOutput(session: DebateSession): object {
  return {
    debate_id: session.id,
    entries: session.diagnostics?.entries ?? {},
    overview: session.diagnostics?.overview ?? {
      total_ai_calls: 0,
      total_response_time_ms: 0,
      claims_accepted: 0,
      claims_rejected: 0,
      move_type_counts: {},
      disagreement_type_counts: {},
    },
  };
}

// ── Harvest output ───────────────────────────────────────

export function buildHarvestOutput(
  session: DebateSession,
  getNodeLabel: (id: string) => string | null,
  allNodeIds: Set<string>,
): object {
  return {
    debate_id: session.id,
    debate_title: session.title,
    conflicts: extractConflictCandidates(session),
    steelmans: extractSteelmanCandidates(session, getNodeLabel),
    debate_refs: extractDebateRefCandidates(session, getNodeLabel),
    verdicts: extractVerdictCandidates(session),
    concepts: extractConceptCandidates(session, allNodeIds),
  };
}
