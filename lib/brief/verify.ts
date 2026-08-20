// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// T5 Brief Export — Verify & lint gate (t/2803).
// Deterministic gate: schema validation, 100% trace resolution (narrated mode),
// OOXML lint, and per-camp symmetry. FAILS THE BUILD (not warns) on any hard-fail.
//
// Contract (TL, e/112): verify() ALWAYS produces a schema-valid audit-manifest —
// even on hard-fail — then the caller fails the build on non-empty hardFailures.
// The manifest records reality (real coverage, real symmetry numbers, warnings);
// policy (coverage==100, ±20% symmetry) is enforced here via hardFailures, not the schema.
// verify() AJV-validates its OWN emitted manifest against audit-manifest.write.json
// before returning (the T2 self-validation lesson — the manifest is itself an artifact).

import { createHash } from 'node:crypto';
import { Ajv } from 'ajv';
import JSZip from 'jszip';
import { ActionableError } from '../debate/errors.js';
import { getGlobalRecorder } from '../flight-recorder/index.js';
import type {
  DeckSpec, Narration, AuditManifest, SymmetryAudit,
  FactCheckVerdict, ModelSource,
} from './types.js';
import { BRIEF_ARTIFACTS } from './types.js';
import { isResolvable } from './traceResolver.js';
import { expectedCamps, campOfTrace } from './campCoverage.js';
import deckSpecSchema from './schemas/deck_spec.write.json' with { type: 'json' };
import narrationSchema from './schemas/narration.write.json' with { type: 'json' };
import auditManifestSchema from './schemas/audit-manifest.write.json' with { type: 'json' };

const LOCATION = 'lib/brief/verify.ts:verify';
const DEFAULT_TOLERANCE_PCT = 20;
const HEADLINE_ABSOLUTE_SLACK = 1; // headline_count allowed within ±1 OR ±tolerance of the mean

const _ajv = new Ajv({ allErrors: true, strict: false });
const _validateDeckSpec = _ajv.compile(deckSpecSchema);
const _validateNarration = _ajv.compile(narrationSchema);
const _validateManifest = _ajv.compile(auditManifestSchema);

// ── Public types ──────────────────────────────────────────────────────────────

export interface VerifyInput {
  spec: DeckSpec;
  narration: Narration;
  /** The real serialized .pptx bytes from T4 — the gate lints the SHIPPED bytes. */
  pptxBytes: Uint8Array;
  meta: {
    /** Tool name → semver, recorded in the manifest. */
    toolVersions: Record<string, string>;
    /** ISO-8601 timestamp; caller supplies it so verify() stays deterministic. */
    timestamp: string;
  };
  /** Symmetry tolerance (percent). Defaults to 20. */
  tolerancePct?: number;
  /**
   * Camps the narrate stage backfilled from their real top_claim because the
   * narrator model dropped them (t/2883). The presence-symmetry arm passes for
   * these (the backfill gives them a slide), so the drop signal MUST NOT vanish:
   * each is surfaced as a manifest `camp_backfill` warning here — the export-record
   * half of the required observability (the FR event is emitted in narrate.ts).
   */
  backfilledCamps?: string[];
}

export interface VerifyResult {
  /** Schema-valid manifest recording reality. ALWAYS produced, pass or fail. */
  manifest: AuditManifest;
  /** Empty ⇒ passed. Non-empty ⇒ the caller must fail the build. */
  hardFailures: string[];
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function verify(input: VerifyInput): Promise<VerifyResult> {
  const { spec, narration, pptxBytes } = input;
  const tolerancePct = input.tolerancePct ?? DEFAULT_TOLERANCE_PCT;
  const recorder = getGlobalRecorder();
  const hardFailures: string[] = [];

  // 1 & 2 — schema validation (deck_spec + narration)
  for (const msg of validateSchema(_validateDeckSpec, spec, 'deck_spec')) hardFailures.push(msg);
  for (const msg of validateSchema(_validateNarration, narration, 'narration')) hardFailures.push(msg);

  // 3 & 4 — trace resolvability + coverage gate (narrated mode only)
  const { coveragePct, coverageFailures } = checkTraceCoverage(spec, narration);
  for (const msg of coverageFailures) hardFailures.push(msg);

  // 5 — per-camp symmetry. For an in-progress snapshot (meta.snapshot=true) the deck is
  // inherently incomplete/imbalanced (the debate hasn't concluded), so symmetry breaches
  // are recorded as warnings, NOT gate failures (t/2841) — else every snapshot errors.
  // Correctness checks (schema/trace/coverage/OOXML) stay HARD even for snapshots.
  const isSnapshot = spec.meta.snapshot === true;
  const { symmetry, symmetryFailures } = computeSymmetry(spec, narration, tolerancePct);
  const snapshotSymmetryWarnings: string[] = [];
  for (const msg of symmetryFailures) {
    if (isSnapshot) snapshotSymmetryWarnings.push(`snapshot_symmetry: ${msg}`);
    else hardFailures.push(msg);
  }

  // 6 — OOXML lint on the shipped bytes
  for (const msg of await lintOoxml(pptxBytes)) hardFailures.push(msg);

  // Warnings (recorded, never fail the build)
  const warnings = [
    ...computeWarnings(spec, symmetry, isSnapshot),
    ...snapshotSymmetryWarnings,
    ...backfillWarnings(input.backfilledCamps),
  ];

  // Assemble the manifest — records reality regardless of pass/fail
  const manifest: AuditManifest = {
    debate_id: spec.meta.id,
    run_id: spec.meta.run_id,
    deck_spec_version: spec.deck_spec_version,
    timestamp: input.meta.timestamp,
    tool_versions: input.meta.toolVersions,
    artifacts: [
      { name: BRIEF_ARTIFACTS.deckSpec, sha256: sha256(stableJson(spec)) },
      { name: BRIEF_ARTIFACTS.narration, sha256: sha256(stableJson(narration)) },
      { name: BRIEF_ARTIFACTS.pptx, sha256: sha256(pptxBytes) },
    ],
    narrator_model: narration.narrator_model,
    narrator_model_source: narration.narrator_model_source,
    checker_model: narration.checker_model ?? null,
    checker_model_source: (narration.checker_model_source ?? null) as ModelSource | null,
    narration_mode: narration.narration_mode,
    trace_coverage_pct: coveragePct,
    symmetry,
    verdict_counts: verdictCounts(spec),
    warnings,
  };

  // Self-validate the emitted manifest (MUST 1). A failure here is an internal bug
  // in this stage — not a gate failure — so it throws rather than becoming a hardFailure.
  const manifestErrors = validateSchema(_validateManifest, manifest, 'audit-manifest');
  if (manifestErrors.length > 0) {
    throw new ActionableError({
      goal: 'Emit a schema-valid audit-manifest.json',
      problem: `verify() produced a manifest that fails audit-manifest.write.json: ${manifestErrors[0]}`,
      location: LOCATION,
      nextSteps: [
        ...manifestErrors.slice(0, 5),
        'This is a T5 bug: the manifest assembly diverged from the frozen T1 schema.',
      ],
    });
  }

  if (hardFailures.length > 0) {
    recorder?.record({
      type: 'system.error' as const, component: 'brief-verify', level: 'error' as const,
      message: `Brief verify gate failed with ${hardFailures.length} hard-failure(s)`,
      data: { hardFailures, coveragePct, within_tolerance: symmetry.within_tolerance },
    });
  }

  return { manifest, hardFailures };
}

// ── Schema validation ─────────────────────────────────────────────────────────

function validateSchema(
  validator: ReturnType<typeof _ajv.compile>,
  data: unknown,
  label: string,
): string[] {
  const valid = validator(data);
  if (valid) return [];
  const errors = validator.errors ?? [];
  return errors.slice(0, 8).map(e => `${label} schema: ${e.instancePath || '(root)'} ${e.message ?? 'failed'}`);
}

// ── Trace resolvability + coverage ────────────────────────────────────────────

function checkTraceCoverage(
  spec: DeckSpec,
  narration: Narration,
): { coveragePct: number; coverageFailures: string[] } {
  const traces: string[] = [
    ...narration.entries.map(e => e.trace),
    ...narration.audience_questions.map(q => q.trace),
  ];
  const total = traces.length;
  const unresolvable = traces.filter(t => !isResolvable(spec, t));
  const resolvedCount = total - unresolvable.length;
  const coveragePct = total === 0 ? 100 : (resolvedCount / total) * 100;

  const coverageFailures: string[] = [];
  // Any unresolvable trace is always a hard-fail (the "every sentence traces" invariant).
  if (unresolvable.length > 0) {
    coverageFailures.push(
      `trace resolution: ${unresolvable.length} narration trace(s) do not resolve in the deck_spec: ${unresolvable.slice(0, 5).join(', ')}`,
    );
  }
  // Coverage==100 gate applies only in narrated mode (deterministic mode is verbatim, N/A).
  if (narration.narration_mode === 'narrated' && coveragePct < 100) {
    coverageFailures.push(
      `trace coverage: narrated mode requires 100% trace coverage, got ${coveragePct.toFixed(1)}%`,
    );
  }
  return { coveragePct, coverageFailures };
}

// ── Per-camp symmetry ─────────────────────────────────────────────────────────
//
// `expectedCamps` (which camps must be covered) and `campOfTrace` (which camp an
// entry covers) live in ./campCoverage.js so the narrate stage's completeness
// check (repair + backfill, t/2883) and this presence arm can never drift.

function countWords(text: string): number {
  const t = text.trim();
  return t === '' ? 0 : t.split(/\s+/).length;
}

function computeSymmetry(
  spec: DeckSpec,
  narration: Narration,
  tolerancePct: number,
): { symmetry: SymmetryAudit; symmetryFailures: string[] } {
  const camps = expectedCamps(spec);

  // Per-camp accumulators over camp-attributed narration entries.
  const slides = new Map<string, Set<number>>();
  const headlines = new Map<string, number>();
  const words = new Map<string, number>();
  for (const camp of camps) {
    slides.set(camp, new Set());
    headlines.set(camp, 0);
    words.set(camp, 0);
  }

  for (const entry of narration.entries) {
    const camp = campOfTrace(spec, entry.trace);
    if (camp === null || !slides.has(camp)) continue; // camp-less or unexpected → excluded
    if (typeof entry.slide === 'number') slides.get(camp)!.add(entry.slide);
    headlines.set(camp, headlines.get(camp)! + 1);
    words.set(camp, words.get(camp)! + countWords(entry.text));
  }

  const campAudits = camps.map(camp => ({
    camp,
    slide_count: slides.get(camp)!.size,
    headline_count: headlines.get(camp)!,
    word_budget: words.get(camp)!,
  }));

  const failures: string[] = [];

  // Presence: each expected camp must appear on ≥1 slide (boolean, never a ratio).
  for (const a of campAudits) {
    if (a.slide_count < 1) {
      failures.push(`symmetry: camp "${a.camp}" appears in the deck_spec but has 0 slides in the narration`);
    }
  }

  // Ratio-based tests apply only with ≥2 camps (nothing to compare otherwise).
  if (campAudits.length >= 2) {
    const meanWords = mean(campAudits.map(a => a.word_budget));
    const meanHeadlines = mean(campAudits.map(a => a.headline_count));
    const frac = tolerancePct / 100;

    // word_budget: continuous → per-camp within [ (1-frac)·mean, (1+frac)·mean ].
    if (meanWords > 0) {
      for (const a of campAudits) {
        const lo = meanWords * (1 - frac);
        const hi = meanWords * (1 + frac);
        if (a.word_budget < lo || a.word_budget > hi) {
          failures.push(
            `symmetry: camp "${a.camp}" word_budget ${a.word_budget} is outside ±${tolerancePct}% of the cross-camp mean ${meanWords.toFixed(1)} [${lo.toFixed(1)}, ${hi.toFixed(1)}]`,
          );
        }
      }
    }

    // headline_count: tiny integers → absolute-OR-relative slack (never a bare ratio).
    for (const a of campAudits) {
      const dev = Math.abs(a.headline_count - meanHeadlines);
      const withinAbsolute = dev <= HEADLINE_ABSOLUTE_SLACK;
      const withinRelative = meanHeadlines > 0 && dev <= meanHeadlines * frac;
      if (!withinAbsolute && !withinRelative) {
        failures.push(
          `symmetry: camp "${a.camp}" headline_count ${a.headline_count} deviates from the mean ${meanHeadlines.toFixed(1)} by more than ±${HEADLINE_ABSOLUTE_SLACK} and ±${tolerancePct}%`,
        );
      }
    }
  }

  const symmetry: SymmetryAudit = {
    camps: campAudits,
    within_tolerance: failures.length === 0,
    tolerance_pct: tolerancePct,
  };
  return { symmetry, symmetryFailures: failures };
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// ── OOXML lint (on the shipped .pptx bytes) ───────────────────────────────────

const CANONICAL_PRESENTATION_ORDER = [
  'sldMasterIdLst', 'notesMasterIdLst', 'handoutMasterIdLst',
  'sldIdLst', 'sldSz', 'notesSz',
];

async function lintOoxml(pptxBytes: Uint8Array): Promise<string[]> {
  const failures: string[] = [];
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(pptxBytes);
  } catch (e) {
    return [`ooxml: pptx bytes are not a readable zip package (${String(e).slice(0, 120)})`];
  }

  const xmlNames = Object.keys(zip.files).filter(n => n.endsWith('.xml'));
  for (const name of xmlNames) {
    // String extraction is intentional here: OOXML parts are small (KB-scale slide/
    // presentation XML), the regex lint needs text, and this runs server/CLI-side —
    // not the renderer V8 heap the jszip UTF-16-bloat guidance targets.
    const xml = await zip.files[name].async('string');

    // Negative a:off (x/y) or a:ext (cx/cy) anywhere — PowerPoint rejects, LibreOffice tolerates.
    for (const m of xml.matchAll(/<a:(off|ext)\b([^>]*)>/g)) {
      const tag = m[1];
      const attrs = m[2];
      const keys = tag === 'off' ? ['x', 'y'] : ['cx', 'cy'];
      for (const k of keys) {
        const am = new RegExp(`\\b${k}="(-\\d+)"`).exec(attrs);
        if (am) {
          failures.push(`ooxml: negative a:${tag} ${k}=${am[1]} in ${name} (PowerPoint rejects this)`);
        }
      }
    }

    // Chart XML: a chart part (or any file with c:chartSpace) must contain <c:chart>.
    const looksLikeChart = /\/charts\/chart[^/]*\.xml$/.test(name) || xml.includes('<c:chartSpace');
    if (looksLikeChart) {
      if (!xml.includes('<c:chartSpace')) {
        failures.push(`ooxml: chart part ${name} is missing <c:chartSpace>`);
      } else if (!/<c:chart[\s>]/.test(xml)) {
        failures.push(`ooxml: chart part ${name} has <c:chartSpace> but no <c:chart> element`);
      }
    }
  }

  // p:presentation children out of canonical order.
  const presName = Object.keys(zip.files).find(n => /(^|\/)presentation\.xml$/.test(n) && n.includes('ppt/'));
  if (presName) {
    const xml = await zip.files[presName].async('string');
    const positions = CANONICAL_PRESENTATION_ORDER
      .map(tag => ({ tag, at: xml.indexOf(`<p:${tag}`) }))
      .filter(p => p.at >= 0);
    for (let i = 1; i < positions.length; i++) {
      if (positions[i].at < positions[i - 1].at) {
        failures.push(
          `ooxml: p:presentation children out of canonical order in ${presName} — <p:${positions[i].tag}> precedes <p:${positions[i - 1].tag}>`,
        );
        break;
      }
    }
  }

  return failures;
}

// ── Warnings (recorded, never fail) ───────────────────────────────────────────

/**
 * Surface each narrate-stage camp backfill (t/2883) as a manifest warning naming
 * the dropped camp. This is the export-record half of the required observability:
 * B1 lets the presence arm pass on a backfilled camp, so without this the narrator
 * drop-rate would be invisible in the export record (silent-degradation). The FR
 * event is the other half, emitted in narrate.ts where the drop is detected.
 */
function backfillWarnings(backfilledCamps: string[] | undefined): string[] {
  return (backfilledCamps ?? []).map(camp =>
    `camp_backfill: narrator omitted camp "${camp}"; backfilled from its top_claim so the deck retains the camp's position`,
  );
}

function computeWarnings(spec: DeckSpec, symmetry: SymmetryAudit, isSnapshot: boolean): string[] {
  const warnings: string[] = [];
  if (spec.convergence.some(c => c.score < 0.3)) {
    warnings.push('low_convergence: one or more issues have a convergence score below 0.3');
  }
  if (spec.meta.phase !== 'closed') {
    warnings.push(`pre_concluding: debate phase is "${spec.meta.phase}", not "closed"`);
  }
  const zeroConcession = spec.concessions.filter(c => c.conceded === 0).map(c => c.camp);
  if (zeroConcession.length > 0) {
    warnings.push(`zero_concession_camp: camp(s) conceded nothing: ${zeroConcession.join(', ')}`);
  }
  if (spec.framing_critique.rating.toLowerCase() === 'weak') {
    warnings.push('weak_framing: framing critique is rated weak');
  }
  // A symmetry breach also surfaces as a manifest warning (the hard-fail is separate).
  if (!symmetry.within_tolerance) {
    warnings.push(isSnapshot
      ? 'symmetry_breach: per-camp parity is outside tolerance (allowed — in-progress snapshot)'
      : 'symmetry_breach: per-camp parity is outside tolerance (see hard-failures)');
  }
  return warnings;
}

// ── verdict tallies + hashing ─────────────────────────────────────────────────

function verdictCounts(spec: DeckSpec): Partial<Record<FactCheckVerdict, number>> {
  const counts: Partial<Record<FactCheckVerdict, number>> = {};
  for (const fc of spec.fact_checks) {
    counts[fc.verdict] = (counts[fc.verdict] ?? 0) + 1;
  }
  return counts;
}

/** Deterministic JSON serialization (sorted keys) for stable artifact hashing. */
function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}
