// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Pure helper functions extracted from useDebateStore.
 * No UI, Zustand, or Electron dependencies.
 */

import type { PoverId, TranscriptEntry, TaxonomyRef } from './types';
import { POVER_INFO } from './types';

export function generateId(): string {
  return crypto.randomUUID();
}

export function nowISO(): string {
  return new Date().toISOString();
}

/** Strip markdown code fences from LLM responses */
export function stripCodeFences(text: string): string {
  return text.replace(/```json\s*/g, '').replace(/```/g, '').trim();
}

/**
 * Robust JSON parser for LLM responses. Handles:
 *  - Markdown code fences
 *  - Trailing commas
 *  - Bare newlines and unescaped quotes inside strings
 *  - Preamble/postamble text around the JSON object
 *
 * Returns the parsed object, or null if all strategies fail.
 */
export function parseAIJson<T = unknown>(text: string): T | null {
  // Strategy 1: strip fences + direct parse
  const stripped = stripCodeFences(text);
  try { return JSON.parse(stripped) as T; } catch { /* continue */ }

  // Strategy 2: repair common issues (trailing commas, bare newlines, unescaped quotes)
  try { return JSON.parse(repairJson(stripped)) as T; } catch { /* continue */ }

  // Strategy 3: extract the outermost JSON object or array from the text
  const objStart = text.indexOf('{');
  const arrStart = text.indexOf('[');
  const start = objStart >= 0 && (arrStart < 0 || objStart < arrStart) ? objStart : arrStart;
  if (start >= 0) {
    const opener = text[start];
    const closer = opener === '{' ? '}' : ']';
    // Find the matching close bracket by counting nesting
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (esc) { esc = false; continue; }
      if (ch === '\\' && inStr) { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === opener) depth++;
      if (ch === closer) depth--;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        try { return JSON.parse(candidate) as T; } catch { /* continue */ }
        try { return JSON.parse(repairJson(candidate)) as T; } catch { /* continue */ }
        break;
      }
    }
  }

  return null;
}

/**
 * Attempt to repair common JSON issues from LLM responses:
 *  - Bare newlines inside string values
 *  - Unescaped quotes inside string values
 *  - Trailing commas before } or ]
 *
 * Strategy: find the top-level "statement" value and extract it by matching
 * the closing pattern, then re-escape it properly.
 */
function repairJson(text: string): string {
  // Strategy: locate known top-level keys and extract their string values robustly.
  // For the "statement" key specifically, the value often contains bare newlines and quotes.
  let repaired = text;

  // Fix bare newlines: walk through and escape newlines that appear inside JSON strings
  const chars: string[] = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < repaired.length; i++) {
    const ch = repaired[i];
    if (escaped) {
      chars.push(ch);
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      chars.push(ch);
      escaped = true;
      continue;
    }
    if (ch === '"') {
      // Heuristic: if we're "inside" a string and hit a quote, check if it looks like
      // a JSON structural quote (followed by : or , or } or ] or whitespace+those)
      // or a quote inside prose
      if (inString) {
        const rest = repaired.slice(i + 1).trimStart();
        const isStructural = rest.length === 0 || /^[,:\]}\n\r]/.test(rest);
        if (isStructural) {
          inString = false;
          chars.push(ch);
        } else {
          // This quote is inside a string value — escape it
          chars.push('\\', '"');
        }
        continue;
      } else {
        inString = true;
        chars.push(ch);
        continue;
      }
    }
    if (inString && (ch === '\n' || ch === '\r')) {
      chars.push(ch === '\n' ? '\\' : '\\', ch === '\n' ? 'n' : 'r');
      continue;
    }
    chars.push(ch);
  }
  repaired = chars.join('');

  // Remove trailing commas
  repaired = repaired.replace(/,\s*([\]}])/g, '$1');
  return repaired;
}

/** Parse @-mentions from user input. Returns { targets, cleanedInput } */
export function parseAtMention(input: string): { targets: PoverId[]; cleanedInput: string } {
  const mentionMap: Record<string, PoverId> = {
    prometheus: 'prometheus',
    sentinel: 'sentinel',
    cassandra: 'cassandra',
  };

  const targets: PoverId[] = [];
  let remaining = input;

  // Extract all leading @mentions
  while (true) {
    const match = remaining.match(/^@(\w+)[,:]?\s*/i);
    if (!match) break;
    const name = match[1].toLowerCase();
    const target = mentionMap[name];
    if (target && !targets.includes(target)) {
      targets.push(target);
      remaining = remaining.slice(match[0].length);
    } else {
      break;
    }
  }

  return { targets, cleanedInput: remaining };
}

/** Format recent transcript entries for inclusion in prompts.
 *  When context summaries exist, prepends the latest summary for compressed history. */
export function formatRecentTranscript(
  transcript: TranscriptEntry[],
  maxEntries: number = 8,
  contextSummaries?: { up_to_entry_id: string; summary: string }[],
): string {
  const recent = transcript.filter((e) => e.type !== 'system').slice(-maxEntries);
  if (recent.length === 0) return '(No prior exchanges)';

  const parts: string[] = [];

  // Prepend the latest context summary if available
  if (contextSummaries && contextSummaries.length > 0) {
    const latest = contextSummaries[contextSummaries.length - 1];
    parts.push(`[Earlier debate summary]: ${latest.summary}`);
  }

  for (const e of recent) {
    const label = e.speaker === 'user' ? 'Moderator'
      : e.speaker === 'system' ? 'System'
      : POVER_INFO[e.speaker as Exclude<PoverId, 'user'>]?.label || e.speaker;
    const typeTag = e.type === 'question' ? ' [question]' : e.type === 'opening' ? ' [opening]' : '';
    parts.push(`${label}${typeTag}: ${e.content}`);
  }

  return parts.join('\n\n');
}

/** Extended metadata from enriched debate prompts */
export interface PoverResponseMeta {
  move_types?: string[];
  disagreement_type?: string;
  key_assumptions?: { assumption: string; if_wrong: string }[];
  my_claims?: { claim: string; targets: string[] }[];
  policy_refs?: string[];
}

/** Try to parse JSON, with repair fallback for LLM formatting issues */
export function parseJsonRobust(text: string): unknown {
  const stripped = stripCodeFences(text);
  try {
    return JSON.parse(stripped);
  } catch {
    // Try with repair (bare newlines, unescaped quotes, trailing commas)
    try {
      return JSON.parse(repairJson(stripped));
    } catch {
      // Last resort: extract from first { to last } and try again
      const firstBrace = stripped.indexOf('{');
      const lastBrace = stripped.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        const extracted = stripped.slice(firstBrace, lastBrace + 1);
        try { return JSON.parse(extracted); } catch { /* fall through */ }
        return JSON.parse(repairJson(extracted));
      }
      const preview = text.slice(0, 200).replace(/\n/g, '\\n');
      throw new Error(
        `Cannot parse JSON after all repair attempts (strip fences, repair quotes/newlines, extract braces).\n` +
        `Input preview: ${preview}\n` +
        `This usually means the AI returned malformed or truncated output. Retry the operation or try a different model.`
      );
    }
  }
}

// ── Partial JSON salvage ─────────────────────────────────

/** Extract a single complete JSON array from a (possibly truncated) JSON string */
function extractArrayFromJson(json: string, key: string): unknown[] {
  const search1 = `"${key}": [`;
  const search2 = `"${key}":[`;
  let idx = json.indexOf(search1);
  if (idx < 0) idx = json.indexOf(search2);
  if (idx < 0) return [];

  const bracketStart = json.indexOf('[', idx);
  if (bracketStart < 0) return [];

  let depth = 0;
  for (let i = bracketStart; i < json.length; i++) {
    if (json[i] === '[') depth++;
    else if (json[i] === ']') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(json.slice(bracketStart, i + 1)); }
        catch { return []; }
      }
    }
  }
  return [];
}

/** Extract all known synthesis arrays from a truncated JSON response.
 *  Used when parseAIJson returns null due to token-limit truncation. */
export function extractArraysFromPartialJson(json: string): Record<string, unknown[]> {
  return {
    areas_of_agreement: extractArrayFromJson(json, 'areas_of_agreement'),
    areas_of_disagreement: extractArrayFromJson(json, 'areas_of_disagreement'),
    cruxes: extractArrayFromJson(json, 'cruxes'),
    unresolved_questions: extractArrayFromJson(json, 'unresolved_questions'),
    taxonomy_coverage: extractArrayFromJson(json, 'taxonomy_coverage'),
    argument_map: extractArrayFromJson(json, 'argument_map'),
    preferences: extractArrayFromJson(json, 'preferences'),
    policy_implications: extractArrayFromJson(json, 'policy_implications'),
  };
}

/** Parse a POVer response JSON from the LLM */
export function parsePoverResponse(text: string): { statement: string; taxonomyRefs: TaxonomyRef[]; meta: PoverResponseMeta } {
  let statement: string;
  let taxonomyRefs: TaxonomyRef[] = [];
  let meta: PoverResponseMeta = {};

  try {
    const parsed = parseJsonRobust(text) as Record<string, unknown>;
    statement = (parsed.statement as string) || text.trim();
    if (Array.isArray(parsed.taxonomy_refs)) {
      taxonomyRefs = parsed.taxonomy_refs
        .filter((r: Record<string, unknown>) => r.node_id && typeof r.node_id === 'string')
        .map((r: Record<string, unknown>) => ({
          node_id: r.node_id as string,
          relevance: (r.relevance as string) || '',
        }));
    }
    // Capture enriched debate metadata
    meta = {
      move_types: Array.isArray(parsed.move_types) ? parsed.move_types : undefined,
      disagreement_type: typeof parsed.disagreement_type === 'string' ? parsed.disagreement_type : undefined,
      key_assumptions: Array.isArray(parsed.key_assumptions) ? parsed.key_assumptions : undefined,
      my_claims: Array.isArray(parsed.my_claims) ? parsed.my_claims.filter(
        (c: Record<string, unknown>) => typeof c.claim === 'string' && Array.isArray(c.targets),
      ) : undefined,
      policy_refs: Array.isArray(parsed.policy_refs) ? parsed.policy_refs.filter(
        (r: unknown) => typeof r === 'string',
      ) : undefined,
    };
  } catch {
    // Fallback: look for a JSON object with "statement" embedded after preamble text
    const jsonIdx = text.indexOf('{\n  "statement"');
    const jsonIdx2 = text.indexOf('{"statement"');
    const idx = jsonIdx >= 0 ? jsonIdx : jsonIdx2;
    if (idx > 0) {
      try {
        const parsed = parseJsonRobust(text.slice(idx)) as Record<string, unknown>;
        statement = (parsed.statement as string) || text.trim();
        if (Array.isArray(parsed.taxonomy_refs)) {
          taxonomyRefs = parsed.taxonomy_refs
            .filter((r: Record<string, unknown>) => r.node_id && typeof r.node_id === 'string')
            .map((r: Record<string, unknown>) => ({ node_id: r.node_id as string, relevance: (r.relevance as string) || '' }));
        }
        meta = {
          move_types: Array.isArray(parsed.move_types) ? parsed.move_types : undefined,
          disagreement_type: typeof parsed.disagreement_type === 'string' ? parsed.disagreement_type : undefined,
          key_assumptions: Array.isArray(parsed.key_assumptions) ? parsed.key_assumptions : undefined,
          my_claims: Array.isArray(parsed.my_claims) ? parsed.my_claims : undefined,
          policy_refs: Array.isArray(parsed.policy_refs) ? parsed.policy_refs : undefined,
        };
      } catch {
        statement = text.trim();
      }
    } else {
      statement = text.trim();
    }
  }

  return { statement, taxonomyRefs, meta };
}
