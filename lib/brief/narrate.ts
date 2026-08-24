// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// T3 Brief Export — Narrate stage (t/2801).
// Single model call: deck_spec → narration.json (traced, preset-compressed).
// Validates output against the strict write schema and checks trace resolvability
// before returning (the T2 lesson: structured-output requests are NOT self-validating).

import { Ajv } from 'ajv';
import type { AIAdapter } from '../debate/aiAdapter.js';
import { ActionableError } from '../debate/errors.js';
import { getGlobalRecorder } from '../flight-recorder/index.js';
import type {
  DeckSpec, BriefPreset, ModelSource, Narration,
  NarrationEntry, AudienceQuestion, SymmetryAudit,
} from './types.js';
import { buildTrace, isResolvable, resolveTrace } from './traceResolver.js';
import { missingCamps } from './campCoverage.js';
import narrationWriteSchema from './schemas/narration.write.json' with { type: 'json' };

const LOCATION = 'lib/brief/narrate.ts:narrate';
const DECK_SPEC_VERSION = '1.0';
const MAX_REPAIR_RETRIES = 1;

const _ajv = new Ajv({ allErrors: true, strict: false });
const _validateNarration = _ajv.compile(narrationWriteSchema);

// ── Public types ──────────────────────────────────────────────────────────────

export interface NarrationInput {
  spec: DeckSpec;
  preset: BriefPreset;
  modelId: string;
  modelSource: ModelSource;
  checkerModelId?: string;
  checkerModelSource?: ModelSource;
  skipNarration?: boolean;
}

export interface CheckerReport {
  passed: boolean;
  fidelity_failures: { trace: string; reason: string }[];
  symmetry: SymmetryAudit;
}

export interface NarrationResult {
  narration: Narration;
  checkerReport?: CheckerReport;
  /**
   * Camps the narrator dropped that were deterministically backfilled from their
   * real top_claim (t/2883). Empty/absent when the narrator covered every camp (or
   * in deterministic mode, which narrates all top_claims). The pipeline forwards
   * this to verify() so each backfilled camp surfaces as an export-record warning.
   */
  backfilledCamps?: string[];
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function narrate(
  input: NarrationInput,
  adapter: AIAdapter,
): Promise<NarrationResult> {
  const { spec, preset, modelId, modelSource, checkerModelId, checkerModelSource, skipNarration } = input;

  let narration: Narration;
  let backfilledCamps: string[] = [];
  if (skipNarration) {
    // Deterministic mode narrates every top_claim, so every camp is covered by
    // construction — no completeness repair/backfill is possible or needed.
    narration = buildDeterministicNarration(spec, preset, modelId, modelSource);
  } else {
    ({ narration, backfilledCamps } = await buildNarratedNarration(spec, preset, modelId, modelSource, adapter));
  }

  // Self-validate: AJV schema + trace resolvability (the T2 lesson)
  validateNarration(narration, spec);

  let checkerReport: CheckerReport | undefined;
  if (checkerModelId && !skipNarration) {
    checkerReport = await runMakerChecker(narration, spec, checkerModelId, checkerModelSource ?? 'Default', adapter);
    narration = {
      ...narration,
      checker_model: checkerModelId,
      checker_model_source: checkerModelSource ?? 'Default',
      checker_passed: checkerReport.passed,
    };
    // Re-validate after checker fields are written
    validateNarration(narration, spec);
  }

  return { narration, checkerReport, backfilledCamps: backfilledCamps.length ? backfilledCamps : undefined };
}

// ── skipNarration: deterministic mode ─────────────────────────────────────────

function buildDeterministicNarration(
  spec: DeckSpec,
  preset: BriefPreset,
  modelId: string,
  modelSource: ModelSource,
): Narration {
  const entries: NarrationEntry[] = [];
  let slide = 1;

  const pushSection = (path: (string | number)[], text: string) => {
    if (text) entries.push({ trace: buildTrace(path), text, slide: slide++ });
  };

  pushSection(['question'], spec.question.core_proposition);

  if (spec.framing_critique.rewritten_motion) {
    pushSection(['framing_critique'], spec.framing_critique.rewritten_motion);
  }

  spec.agreements.forEach((a, i) => pushSection(['agreements', i], a.text));
  spec.disagreements.forEach((d, i) => pushSection(['disagreements', i], d.text));
  spec.cruxes.forEach((c, i) => pushSection(['cruxes', i], c.text));

  spec.resolution_analysis.stronger_camp_findings.forEach((f, i) =>
    pushSection(['resolution_analysis', 'stronger_camp_findings', i], f.finding));

  spec.fact_checks.forEach((f, i) => pushSection(['fact_checks', i], f.claim));
  spec.top_claims.forEach((c, i) => pushSection(['top_claims', i], c.claim));
  spec.convergence.forEach((cv, i) => pushSection(['convergence', i], cv.issue));
  spec.open_threads.forEach((t, i) => pushSection(['open_threads', i], t.text));

  // Audience questions: tensions only (skipNarration is verbatim mode)
  const audience_questions: AudienceQuestion[] = (spec.question.tensions ?? []).map((t, i) => ({
    trace: buildTrace(['question', 'tensions', i]),
    question: t,
  }));

  return {
    deck_spec_version: DECK_SPEC_VERSION,
    narration_mode: 'deterministic',
    preset,
    narrator_model: modelId,
    narrator_model_source: modelSource,
    checker_model: null,
    checker_model_source: null,
    checker_passed: null,
    entries,
    audience_questions,
  };
}

// ── Narrated mode: single model call ─────────────────────────────────────────

const PRESET_GUIDANCE: Record<BriefPreset, string> = {
  policymaker:
    'Terse executive-summary style. 1–2 sentences per entry maximum. ' +
    'Focus on policy implications, evidence quality, and actionable conclusions. No academic hedging.',
  conference:
    'Full analytical coverage. 2–4 sentences per entry. ' +
    'Include key evidence, methodological notes, and theoretical stakes. Maintain camp attribution.',
  classroom:
    'Full coverage with pedagogical framing. 2–4 sentences per entry. ' +
    'Explain concepts clearly. Derive extra audience_questions from cruxes to serve as discussion prompts.',
};

const NARRATION_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    entries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          trace: { type: 'string' },
          text: { type: 'string' },
          slide: { type: 'integer' },
        },
        required: ['trace', 'text'],
      },
    },
    audience_questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          trace: { type: 'string' },
          question: { type: 'string' },
        },
        required: ['trace', 'question'],
      },
    },
  },
  required: ['entries', 'audience_questions'],
};

function buildNarrationPrompt(spec: DeckSpec, preset: BriefPreset, priorErrors?: string): string {
  const guidance = PRESET_GUIDANCE[preset];
  return [
    `You are a debate brief narrator. Compress the following debate analysis (deck_spec) into ` +
    `slide-length narration entries for the "${preset}" preset.`,
    '',
    `PRESET GUIDANCE: ${guidance}`,
    '',
    'REQUIREMENTS:',
    '- Return a JSON object with two arrays: "entries" and "audience_questions".',
    '- Each entry MUST have: "trace" (RFC 6901 JSON Pointer into the deck_spec below), "text" (slide copy), and "slide" (integer ≥1).',
    '- Traces MUST be valid RFC 6901 pointers into the exact deck_spec provided (e.g. /cruxes/0, /agreements/1).',
    '- audience_questions derive from cruxes AND tensions, each traced to its source (e.g. /cruxes/0, /question/tensions/1).',
    '- Temperature 0. No web access. No content beyond compressing what is in the deck_spec.',
    '- Do NOT invent information not present in the deck_spec.',
    '',
    ...(priorErrors ? ['REPAIR ATTEMPT — prior response had these errors (fix them):', priorErrors, ''] : []),
    'DECK SPEC:',
    JSON.stringify(spec, null, 2),
  ].join('\n');
}

/**
 * Build one narration entry per dropped camp, tracing to that camp's REAL top_claim
 * (t/2883 B1 backfill). Slides continue after the highest slide the narrator used.
 * A camp whose top_claim has empty text is skipped (nothing real to show) — it stays
 * missing and verify's presence arm correctly hard-fails on it, since we never
 * fabricate narration. Every expected camp derives from `top_claims`, so a missing
 * camp always has an index; the guard is defensive only.
 */
function buildCampBackfillEntries(
  spec: DeckSpec,
  existing: NarrationEntry[],
  missing: string[],
): { entries: NarrationEntry[]; camps: string[] } {
  let nextSlide = existing.reduce((m, e) => Math.max(m, e.slide ?? 0), 0) + 1;
  const entries: NarrationEntry[] = [];
  const camps: string[] = [];
  for (const camp of missing) {
    const idx = spec.top_claims.findIndex(t => t.camp === camp);
    if (idx < 0 || !spec.top_claims[idx].claim) continue;
    entries.push({ trace: buildTrace(['top_claims', idx]), text: spec.top_claims[idx].claim, slide: nextSlide++ });
    camps.push(camp);
  }
  return { entries, camps };
}

async function buildNarratedNarration(
  spec: DeckSpec,
  preset: BriefPreset,
  modelId: string,
  modelSource: ModelSource,
  adapter: AIAdapter,
): Promise<{ narration: Narration; backfilledCamps: string[] }> {
  const recorder = getGlobalRecorder();
  let priorErrors: string | undefined;

  for (let attempt = 0; attempt <= MAX_REPAIR_RETRIES; attempt++) {
    const prompt = buildNarrationPrompt(spec, preset, priorErrors);
    const raw = await adapter.generateText(prompt, modelId, {
      temperature: 0,
      responseSchema: NARRATION_RESPONSE_SCHEMA,
    });

    // Parse the model's JSON response
    let parsed: { entries: NarrationEntry[]; audience_questions: AudienceQuestion[] };
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch (e) {
      const msg = `Model returned non-JSON response (attempt ${attempt + 1}): ${String(e).slice(0, 200)}`;
      if (attempt < MAX_REPAIR_RETRIES) {
        priorErrors = msg;
        recorder?.record({ type: 'system.error' as const, component: 'brief-narrate', level: 'warn' as const, message: msg, data: {} });
        continue;
      }
      throw new ActionableError({
        goal: 'Narrate deck_spec into narration.json',
        problem: msg,
        location: LOCATION,
        nextSteps: ['Inspect the raw model response.', 'Ensure the model supports structured JSON output for this modelId.'],
      });
    }

    // Check trace resolvability before assembling (gives specific repair feedback)
    const badTraces: string[] = [];
    for (const entry of (parsed.entries ?? [])) {
      if (!isResolvable(spec, entry.trace)) badTraces.push(entry.trace);
    }
    for (const aq of (parsed.audience_questions ?? [])) {
      if (!isResolvable(spec, aq.trace)) badTraces.push(aq.trace);
    }

    if (badTraces.length > 0) {
      const msg = `Model emitted ${badTraces.length} unresolvable trace(s): ${badTraces.slice(0, 5).join(', ')}`;
      if (attempt < MAX_REPAIR_RETRIES) {
        priorErrors = `${msg}. Ensure every trace is a valid RFC 6901 pointer into the deck_spec (the exact JSON provided).`;
        recorder?.record({ type: 'system.error' as const, component: 'brief-narrate', level: 'warn' as const, message: msg, data: { badTraces } });
        continue;
      }
      throw new ActionableError({
        goal: 'Narrate deck_spec into narration.json',
        problem: msg,
        location: LOCATION,
        nextSteps: [
          ...badTraces.slice(0, 5).map(t => `Trace "${t}" is unresolvable in the deck_spec.`),
          'Model may have hallucinated JSON Pointer paths.',
        ],
      });
    }

    // Presence gate (t/2872): an empty entries array is AJV-schema-valid and trips
    // neither the JSON-parse nor the bad-trace gate, but yields a narration the model
    // never actually produced — downstream verify() then hard-fails symmetry for EVERY
    // camp (0 slides each), a confusing far-away error. Retry with a targeted repair
    // message; throw an actionable narrate-level error if exhausted. Mirrors the
    // badTrace gate above; a distinct FR `reason:'empty-entries'` lets the next
    // diagnosis tell "empty" from "bad traces".
    if ((parsed.entries ?? []).length === 0) {
      const msg = 'Model returned zero narration entries — narration must cover the deck_spec';
      if (attempt < MAX_REPAIR_RETRIES) {
        priorErrors = `${msg}. Emit at least one entry per deck_spec section, each with a valid RFC 6901 trace into the provided JSON.`;
        recorder?.record({ type: 'system.error' as const, component: 'brief-narrate', level: 'warn' as const, message: msg, data: { reason: 'empty-entries' } });
        continue;
      }
      throw new ActionableError({
        goal: 'Narrate deck_spec into narration.json',
        problem: msg,
        location: LOCATION,
        nextSteps: [
          'The model returned an empty entries array (AJV-valid but empty) on every attempt.',
          'Use a model with stronger structured-output compliance for narration — lite/economy tiers may fail this complex prompt.',
        ],
      });
    }

    // Camp-completeness gate (t/2883): the narrator can silently drop a whole camp —
    // its top_claim is in the deck_spec (so verify's presence-symmetry arm expects a
    // slide) but the narrator emitted 0 entries covering it, hard-failing the export
    // at the far-away verify stage. Mirror the presence gates above: one targeted
    // REPAIR re-prompt naming the dropped camp(s); if still missing after repair,
    // BACKFILL one entry per camp from its REAL top_claim (never fabricated text) so
    // the deck keeps every camp's position and the export succeeds (B1, TL t/2883#2).
    // The backfill is surfaced (FR event here + export-record warning in verify) so
    // the narrator drop signal survives the block→repair-and-warn conversion.
    let backfilledCamps: string[] = [];
    const missing = missingCamps(spec, (parsed.entries ?? []).map(e => e.trace));
    if (missing.length > 0) {
      const msg = `Narrator omitted camp(s): ${missing.join(', ')} — every debate camp with a top_claim must appear on ≥1 slide`;
      if (attempt < MAX_REPAIR_RETRIES) {
        priorErrors = `${msg}. Emit at least one entry for each omitted camp, traced to that camp's /top_claims/<i> in the provided deck_spec.`;
        recorder?.record({ type: 'system.error' as const, component: 'brief-narrate', level: 'warn' as const, message: msg, data: { reason: 'missing-camp', missing } });
        continue;
      }
      // Repair exhausted → deterministic backfill from the real top_claim (B1).
      const backfill = buildCampBackfillEntries(spec, parsed.entries ?? [], missing);
      parsed.entries = [...(parsed.entries ?? []), ...backfill.entries];
      backfilledCamps = backfill.camps;
      if (backfilledCamps.length > 0) {
        recorder?.record({
          type: 'system.error' as const, component: 'brief-narrate', level: 'warn' as const,
          message: `Narrator omitted camp(s) ${backfilledCamps.join(', ')}; backfilled from their top_claim (B1, t/2883)`,
          data: { reason: 'camp-backfill', backfilledCamps },
        });
      }
    }

    return {
      narration: {
        deck_spec_version: DECK_SPEC_VERSION,
        narration_mode: 'narrated',
        preset,
        narrator_model: modelId,
        narrator_model_source: modelSource,
        checker_model: null,
        checker_model_source: null,
        checker_passed: null,
        entries: parsed.entries ?? [],
        audience_questions: parsed.audience_questions ?? [],
      },
      backfilledCamps,
    };
  }

  // Unreachable (loop always returns or throws), but satisfies TS
  throw new ActionableError({
    goal: 'Narrate deck_spec into narration.json',
    problem: 'All repair attempts exhausted without a valid narration',
    location: LOCATION,
    nextSteps: ['Inspect prior error logs from the flight recorder.'],
  });
}

// ── Self-validation (AJV + trace resolvability) ───────────────────────────────

function validateNarration(narration: Narration, spec: DeckSpec): void {
  // (a) AJV schema validation
  const valid = _validateNarration(narration);
  if (!valid) {
    const errors = _validateNarration.errors ?? [];
    const first = errors[0];
    const firstMsg = first ? `${first.instancePath || '(root)'} ${first.message ?? 'failed'}` : 'unknown';
    throw new ActionableError({
      goal: 'Produce valid narration.json',
      problem: `AJV schema validation failed (${errors.length} error${errors.length > 1 ? 's' : ''}): ${firstMsg}`,
      location: LOCATION,
      nextSteps: [
        ...errors.slice(0, 5).map(e => `${e.instancePath || '(root)'}: ${e.message ?? 'failed'}`),
        'Check the narration assembly against narration.write.json.',
      ],
    });
  }

  // (b) Trace resolvability — every trace must point into spec
  const badTraces: string[] = [];
  for (const entry of narration.entries) {
    if (!isResolvable(spec, entry.trace)) badTraces.push(entry.trace);
  }
  for (const aq of narration.audience_questions) {
    if (!isResolvable(spec, aq.trace)) badTraces.push(aq.trace);
  }
  if (badTraces.length > 0) {
    throw new ActionableError({
      goal: 'Produce valid narration.json',
      problem: `${badTraces.length} narration trace(s) are not resolvable in the deck_spec: ${badTraces.slice(0, 5).join(', ')}`,
      location: LOCATION,
      nextSteps: [
        ...badTraces.slice(0, 5).map(t => `Trace "${t}" does not resolve in the deck_spec.`),
        'Ensure traces are built with buildTrace() or are valid RFC 6901 pointers.',
      ],
    });
  }
}

// ── Maker-Checker ─────────────────────────────────────────────────────────────

const CHECKER_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    fidelity_failures: {
      type: 'array',
      items: {
        type: 'object',
        properties: { trace: { type: 'string' }, reason: { type: 'string' } },
        required: ['trace', 'reason'],
      },
    },
    symmetry: {
      type: 'object',
      properties: {
        camps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              camp: { type: 'string' },
              slide_count: { type: 'integer' },
              headline_count: { type: 'integer' },
              word_budget: { type: 'integer' },
            },
            required: ['camp', 'slide_count', 'headline_count', 'word_budget'],
          },
        },
        within_tolerance: { type: 'boolean' },
        tolerance_pct: { type: 'number' },
      },
      required: ['camps', 'within_tolerance', 'tolerance_pct'],
    },
  },
  required: ['fidelity_failures', 'symmetry'],
};

async function runMakerChecker(
  narration: Narration,
  spec: DeckSpec,
  checkerModelId: string,
  checkerModelSource: ModelSource,
  adapter: AIAdapter,
): Promise<CheckerReport> {
  const entryContext = narration.entries.map(e => {
    let specText = '';
    try {
      specText = JSON.stringify(resolveTrace(spec, e.trace)).slice(0, 500);
    } catch { specText = '(unresolvable)'; }
    return `trace: ${e.trace}\nnarrated: ${e.text}\nspec text: ${specText}`;
  }).join('\n\n');

  const checkerPrompt = [
    'You are a debate brief fidelity checker. For each narration entry below, verify:',
    '1. FIDELITY: does the narrated text faithfully represent the traced spec text? (no hallucinations, no omissions of key claims)',
    '2. SYMMETRY: does the narration overall represent all camps proportionally?',
    '',
    'Return a JSON object with:',
    '- fidelity_failures: array of {trace, reason} for any entry that fails fidelity',
    '- symmetry: {camps: [{camp, slide_count, headline_count, word_budget}], within_tolerance: boolean, tolerance_pct: number}',
    '',
    'ENTRIES TO CHECK:',
    entryContext,
  ].join('\n');

  const raw = await adapter.generateText(checkerPrompt, checkerModelId, {
    temperature: 0,
    responseSchema: CHECKER_RESPONSE_SCHEMA,
  });

  let parsed: { fidelity_failures: { trace: string; reason: string }[]; symmetry: SymmetryAudit };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    // Checker failure is non-fatal — flag it and return a failed report
    return {
      passed: false,
      fidelity_failures: [{ trace: '(checker)', reason: 'Checker model returned non-JSON response' }],
      symmetry: { camps: [], within_tolerance: false, tolerance_pct: 0 },
    };
  }

  const passed =
    (parsed.fidelity_failures?.length ?? 0) === 0 &&
    (parsed.symmetry?.within_tolerance ?? false);

  return {
    passed,
    fidelity_failures: parsed.fidelity_failures ?? [],
    symmetry: parsed.symmetry ?? { camps: [], within_tolerance: false, tolerance_pct: 0 },
  };
}
