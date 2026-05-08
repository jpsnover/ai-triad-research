// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Pure helper functions extracted from useDebateStore.
 * No UI, Zustand, or Electron dependencies.
 */

import type { SpeakerId, TranscriptEntry, TaxonomyRef } from './types.js';
import { POVER_INFO } from './types.js';

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
export function parseAtMention(input: string): { targets: SpeakerId[]; cleanedInput: string } {
  const mentionMap: Record<string, SpeakerId> = {
    prometheus: 'prometheus',
    sentinel: 'sentinel',
    cassandra: 'cassandra',
  };

  const targets: SpeakerId[] = [];
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
  contextSummaries?: { up_to_entry_id: string; summary: string; tier?: string }[],
): string {
  const recent = transcript.slice(-(maxEntries * 2)).filter((e) => e.type !== 'system').slice(-maxEntries);
  if (recent.length === 0) return '(No prior exchanges)';

  const parts: string[] = [];

  // Prepend context summaries — tiered if available
  if (contextSummaries && contextSummaries.length > 0) {
    const distant = contextSummaries.filter(s => s.tier === 'distant');
    const medium = contextSummaries.filter(s => s.tier === 'medium');
    const legacy = contextSummaries.filter(s => !s.tier);

    if (distant.length > 0) {
      const latest = distant[distant.length - 1];
      parts.push(`[Distant context — structural summary]:\n${latest.summary}`);
    }
    if (medium.length > 0) {
      const latest = medium[medium.length - 1];
      parts.push(`[Medium context — key claims & commitments]:\n${latest.summary}`);
    }
    if (distant.length === 0 && medium.length === 0 && legacy.length > 0) {
      const latest = legacy[legacy.length - 1];
      parts.push(`[Earlier debate summary]: ${latest.summary}`);
    }
  }

  for (const e of recent) {
    const label = e.speaker === 'user' ? 'Moderator'
      : e.speaker === 'system' ? 'System'
      : POVER_INFO[e.speaker as Exclude<SpeakerId, 'user'>]?.label || e.speaker;
    const typeTag = e.type === 'question' ? ' [question]' : e.type === 'opening' ? ' [opening]' : '';
    const contentStr = typeof e.content === 'string' ? e.content : JSON.stringify(e.content);
    parts.push(`${label}${typeTag}: ${contentStr}`);
  }

  return parts.join('\n\n');
}

/** Structured dialectical move annotation */
export interface MoveAnnotation {
  move: string;
  target?: string;
  detail: string;
}

/** Extended metadata from enriched debate prompts */
export interface PoverResponseMeta {
  move_types?: (string | MoveAnnotation)[];
  disagreement_type?: string;
  key_assumptions?: { assumption: string; if_wrong: string }[];
  my_claims?: { claim: string; targets: string[] }[];
  policy_refs?: string[];
  position_update?: string;
  turn_symbols?: { symbol: string; tooltip: string }[];
  pin_response?: Record<string, unknown>;
  probe_response?: Record<string, unknown>;
  challenge_response?: Record<string, unknown>;
  clarification?: Record<string, unknown>;
  check_response?: Record<string, unknown>;
  revoice_response?: Record<string, unknown>;
  reflection?: Record<string, unknown>;
  compressed_thesis?: string;
  commitment?: Record<string, unknown>;
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

const CANONICAL_MOVES: Record<string, string> = {
  'DISTINGUISH': 'DISTINGUISH',
  'COUNTEREXAMPLE': 'COUNTEREXAMPLE',
  'CONCEDE-AND-PIVOT': 'CONCEDE-AND-PIVOT',
  'CONCEDE_AND_PIVOT': 'CONCEDE-AND-PIVOT',
  'CONCEDEANDPIVOT': 'CONCEDE-AND-PIVOT',
  'CONCEDE AND PIVOT': 'CONCEDE-AND-PIVOT',
  'REFRAME': 'REFRAME',
  'EMPIRICAL CHALLENGE': 'EMPIRICAL CHALLENGE',
  'EMPIRICAL-CHALLENGE': 'EMPIRICAL CHALLENGE',
  'EMPIRICAL_CHALLENGE': 'EMPIRICAL CHALLENGE',
  'EMPIRICALCHALLENGE': 'EMPIRICAL CHALLENGE',
  'EXTEND': 'EXTEND',
  'UNDERCUT': 'UNDERCUT',
  'GROUND-CHECK': 'GROUND-CHECK',
  'GROUND_CHECK': 'GROUND-CHECK',
  'GROUNDCHECK': 'GROUND-CHECK',
  'CONDITIONAL-AGREE': 'CONDITIONAL-AGREE',
  'CONDITIONAL_AGREE': 'CONDITIONAL-AGREE',
  'CONDITIONALGREE': 'CONDITIONAL-AGREE',
  'IDENTIFY-CRUX': 'IDENTIFY-CRUX',
  'IDENTIFY_CRUX': 'IDENTIFY-CRUX',
  'IDENTIFYCRUX': 'IDENTIFY-CRUX',
  'CRUX': 'IDENTIFY-CRUX',
  'CRUX-IDENTIFICATION': 'IDENTIFY-CRUX',
  'FORCE_CRUX': 'IDENTIFY-CRUX',
  'PROPOSE-CRUX': 'IDENTIFY-CRUX',
  'CLARIFY-CRUX': 'IDENTIFY-CRUX',
  'INTEGRATE': 'INTEGRATE',
  'STEEL-BUILD': 'STEEL-BUILD',
  'STEEL_BUILD': 'STEEL-BUILD',
  'STEELBUILD': 'STEEL-BUILD',
  'EXPOSE-ASSUMPTION': 'EXPOSE-ASSUMPTION',
  'EXPOSE_ASSUMPTION': 'EXPOSE-ASSUMPTION',
  'EXPOSEASSUMPTION': 'EXPOSE-ASSUMPTION',
  'PRESUPPOSITION-CHALLENGE': 'EXPOSE-ASSUMPTION',
  'SPECIFY': 'SPECIFY',
  'SPECIFY-MECHANISM': 'SPECIFY',
  'SPECIFY_MECHANISM': 'SPECIFY',
  'SPECIFY-ASSUMPTIONS': 'EXPOSE-ASSUMPTION',
  'SPECIFY_ASSUMPTIONS': 'EXPOSE-ASSUMPTION',
  'ACKNOWLEDGE-ASSUMPTION': 'EXPOSE-ASSUMPTION',
  'ACKNOWLEDGE_ASSUMPTION': 'EXPOSE-ASSUMPTION',
  'CHALLENGE-ASSUMPTION': 'EXPOSE-ASSUMPTION',
  'SURFACE-ASSUMPTION': 'EXPOSE-ASSUMPTION',
  'CHALLENGE-EMPIRICAL': 'EMPIRICAL CHALLENGE',
  'RECIPROCAL-CHALLENGE': 'COUNTEREXAMPLE',
  'RECIPROCAL_CHALLENGE': 'COUNTEREXAMPLE',
  'BURDEN-SHIFT': 'BURDEN-SHIFT',
  'BURDEN_SHIFT': 'BURDEN-SHIFT',
  'BURDENSHIFT': 'BURDEN-SHIFT',
  'CONCEDE': 'CONCEDE',
  'PARTIAL-CONCEDE': 'CONDITIONAL-AGREE',
  'ACKNOWLEDGE-VULNERABILITY': 'CONDITIONAL-AGREE',
  'ACKNOWLEDGE-SCOPE': 'CONDITIONAL-AGREE',
  'REDUCE': 'REDUCE',
  'ESCALATE': 'ESCALATE',
  'ASSERT': 'ASSERT',
  'SPECIFY-BOUNDARY-CONDITIONS': 'SPECIFY',
  'RESOLVE-TENSION': 'IDENTIFY-CRUX',
  'RESOLVE_TENSION': 'IDENTIFY-CRUX',
  'CHALLENGE': 'EMPIRICAL CHALLENGE',
  'DIRECT-CHALLENGE': 'EMPIRICAL CHALLENGE',
  'DIRECT_CHALLENGE': 'EMPIRICAL CHALLENGE',
  'ANALOGY-CHALLENGE': 'COUNTEREXAMPLE',
  'CHALLENGE-ANALOGY': 'COUNTEREXAMPLE',
  'STEELMAN': 'STEEL-BUILD',
  'STEEL-MAN': 'STEEL-BUILD',
  'NARROW': 'DISTINGUISH',
  'NARROW-SCOPE': 'DISTINGUISH',
  'SYNTHESIZE': 'INTEGRATE',
  'SYNTHESIS': 'INTEGRATE',
  'QUALIFY': 'CONDITIONAL-AGREE',
  'QUALIFY-CLAIM': 'CONDITIONAL-AGREE',
  'CONDITIONAL-CONCESSION': 'CONDITIONAL-AGREE',
  'CONDITIONAL_CONCESSION': 'CONDITIONAL-AGREE',
  'PIVOT': 'CONCEDE-AND-PIVOT',
  'CONCESSION': 'CONCEDE-AND-PIVOT',
  'PROPOSE-TEST': 'SPECIFY',
  'PROPOSE_TEST': 'SPECIFY',
  'PROPOSE-BENCHMARK': 'SPECIFY',
  'PROPOSE_BENCHMARK': 'SPECIFY',
  'FALSIFY': 'SPECIFY',
  'COMPARATIVE-ANALYSIS': 'DISTINGUISH',
  'COMPARATIVE_ANALYSIS': 'DISTINGUISH',
  'ASSUMPTION-AUDIT': 'EXPOSE-ASSUMPTION',
  'ASSUMPTION_AUDIT': 'EXPOSE-ASSUMPTION',
  'REINTERPRET-EVIDENCE': 'REFRAME',
  'REINTERPRET_EVIDENCE': 'REFRAME',
  'SPECIFY-CRUX': 'IDENTIFY-CRUX',
  'SPECIFY_CRUX': 'IDENTIFY-CRUX',
};

const FUZZY_KEYWORDS: [RegExp, string][] = [
  [/CHALLENGE/i, 'EMPIRICAL CHALLENGE'],
  [/CONCEDE|CONCESSION|GRANT/i, 'CONCEDE-AND-PIVOT'],
  [/CRUX|TENSION|RESOLVE/i, 'IDENTIFY-CRUX'],
  [/ASSUMPTION|PRESUPPOS/i, 'EXPOSE-ASSUMPTION'],
  [/SPECIFY|MECHANISM|OPERATIONALIZE/i, 'SPECIFY'],
  [/STEEL|STRENGTHEN/i, 'STEEL-BUILD'],
  [/INTEGRAT|SYNTHESIZ|COMBIN/i, 'INTEGRATE'],
  [/NARROW|SCOPE|BOUNDAR/i, 'DISTINGUISH'],
  [/BURDEN|PROOF/i, 'BURDEN-SHIFT'],
  [/REFRAME|RECAST|SHIFT.*FRAME/i, 'REFRAME'],
  [/COUNTER.*EXAMPLE|EXCEPTION/i, 'COUNTEREXAMPLE'],
  [/CONDITION|QUALIF|PARTIAL/i, 'CONDITIONAL-AGREE'],
  [/UNDERCUT|WARRANT/i, 'UNDERCUT'],
  [/GROUND|FACT.*CHECK|VERIFY/i, 'GROUND-CHECK'],
  [/EXTEND|BUILD.*ON|EXPAND/i, 'EXTEND'],
];

function canonicalizeMove(name: string): string {
  const key = name.toUpperCase().trim();
  const exact = CANONICAL_MOVES[key]
    ?? CANONICAL_MOVES[key.replace(/-/g, ' ')]
    ?? CANONICAL_MOVES[key.replace(/-/g, '_')];
  if (exact) return exact;

  for (const [pattern, canonical] of FUZZY_KEYWORDS) {
    if (pattern.test(key)) return canonical;
  }
  return name;
}

function normalizeMoveTypes(raw: unknown[]): (string | MoveAnnotation)[] {
  return raw.map(item => {
    if (typeof item === 'string') return canonicalizeMove(item);
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      if (typeof obj.move === 'string') {
        return {
          move: canonicalizeMove(obj.move),
          target: typeof obj.target === 'string' ? obj.target : undefined,
          detail: typeof obj.detail === 'string' ? obj.detail : '',
        } as MoveAnnotation;
      }
    }
    return String(item);
  });
}

// ── Canonical move → edge classification ────────────────

export type MoveEdgeType = 'support' | 'attack' | 'neutral';

export interface MoveEdgeInfo {
  edgeType: MoveEdgeType;
  defaultAttackType?: 'rebut' | 'undercut' | 'undermine';
  dual?: boolean;
}

export const MOVE_EDGE_MAP: Record<string, MoveEdgeInfo> = {
  // ── Canonical 10 dialectical moves ──
  // Names use normalized form (spaces, uppercase) — the turn validator's
  // resolveMoveName() maps all aliases/legacy names to these before lookup.

  // Support moves — create RA-nodes / "supports" edges
  'CONCEDE AND PIVOT':    { edgeType: 'support', dual: true },
  'INTEGRATE':            { edgeType: 'support' },
  'EXTEND':               { edgeType: 'support' },

  // Attack moves — create CA-nodes / "attacks" edges
  'COUNTEREXAMPLE':       { edgeType: 'attack', defaultAttackType: 'rebut' },
  'DISTINGUISH':          { edgeType: 'attack', defaultAttackType: 'rebut' },
  'UNDERCUT':             { edgeType: 'attack', defaultAttackType: 'undercut' },
  'EMPIRICAL CHALLENGE':  { edgeType: 'attack', defaultAttackType: 'undermine' },
  'BURDEN SHIFT':         { edgeType: 'attack', defaultAttackType: 'undercut' },
  'REFRAME':              { edgeType: 'attack', defaultAttackType: 'rebut' },

  // Neutral moves — produce standalone claims, no directed edge
  'SPECIFY':              { edgeType: 'neutral' },
};

export const SUPPORT_MOVES = new Set(
  Object.entries(MOVE_EDGE_MAP).filter(([, v]) => v.edgeType === 'support').map(([k]) => k),
);
export const ATTACK_MOVES = new Set(
  Object.entries(MOVE_EDGE_MAP).filter(([, v]) => v.edgeType === 'attack').map(([k]) => k),
);
export const NEUTRAL_MOVES = new Set(
  Object.entries(MOVE_EDGE_MAP).filter(([, v]) => v.edgeType === 'neutral').map(([k]) => k),
);

/** Word-overlap ratio between two texts (words >3 chars). Shared for convergence diagnostics. */
export function wordOverlap(a: string, b: string): number {
  const aw = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const bw = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  if (aw.size === 0) return 0;
  const inter = [...aw].filter(w => bw.has(w)).length;
  return inter / aw.size;
}

/** Extract the move name from either a plain string or a MoveAnnotation */
export function getMoveName(item: string | MoveAnnotation): string {
  return typeof item === 'string' ? item : item.move;
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
      move_types: Array.isArray(parsed.move_types) ? normalizeMoveTypes(parsed.move_types) : undefined,
      disagreement_type: typeof parsed.disagreement_type === 'string' ? parsed.disagreement_type : undefined,
      key_assumptions: Array.isArray(parsed.key_assumptions) ? parsed.key_assumptions : undefined,
      my_claims: Array.isArray(parsed.my_claims) ? parsed.my_claims.filter(
        (c: Record<string, unknown>) => typeof c.claim === 'string' && Array.isArray(c.targets),
      ) : undefined,
      policy_refs: Array.isArray(parsed.policy_refs) ? parsed.policy_refs.filter(
        (r: unknown) => typeof r === 'string',
      ) : undefined,
      position_update: typeof parsed.position_update === 'string' ? parsed.position_update : undefined,
      turn_symbols: Array.isArray(parsed.turn_symbols) ? parsed.turn_symbols.filter(
        (s: Record<string, unknown>) => typeof s.symbol === 'string' && typeof s.tooltip === 'string',
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
          move_types: Array.isArray(parsed.move_types) ? normalizeMoveTypes(parsed.move_types) : undefined,
          disagreement_type: typeof parsed.disagreement_type === 'string' ? parsed.disagreement_type : undefined,
          key_assumptions: Array.isArray(parsed.key_assumptions) ? parsed.key_assumptions : undefined,
          my_claims: Array.isArray(parsed.my_claims) ? parsed.my_claims : undefined,
          policy_refs: Array.isArray(parsed.policy_refs) ? parsed.policy_refs : undefined,
          turn_symbols: Array.isArray(parsed.turn_symbols) ? parsed.turn_symbols.filter(
            (s: Record<string, unknown>) => typeof s.symbol === 'string' && typeof s.tooltip === 'string',
          ) : undefined,
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

export function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

export function looksTruncated(s: string): boolean {
  if (!s) return false;
  const trimmed = s.trimEnd();
  if (trimmed.length === 0) return false;
  let depth = 0;
  for (const c of trimmed) {
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
  }
  if (depth > 0) return true;
  const last = trimmed.slice(-1);
  return !(last === '}' || last === ']' || last === '"');
}

export function maxOverlapVsExisting(text: string, existing: { text: string }[]): number {
  let max = 0;
  for (const n of existing) {
    const o = wordOverlap(text, n.text);
    if (o > max) max = o;
  }
  return max;
}

export function lookupTaxonomyEdgeWeight(
  sourceRefs: string[],
  targetRefs: string[],
  taxonomyEdges?: { source: string; target: string; weight?: number }[],
): number | undefined {
  if (!taxonomyEdges || sourceRefs.length === 0 || targetRefs.length === 0) return undefined;
  const srcSet = new Set(sourceRefs);
  const tgtSet = new Set(targetRefs);
  let best: number | undefined;
  for (const e of taxonomyEdges) {
    if (e.weight == null) continue;
    const match = (srcSet.has(e.source) && tgtSet.has(e.target))
      || (srcSet.has(e.target) && tgtSet.has(e.source));
    if (match && (best === undefined || e.weight > best)) {
      best = e.weight;
    }
  }
  return best;
}
