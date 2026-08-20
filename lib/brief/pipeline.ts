// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Brief Export shared pipeline (t/2837). The ONE orchestration of the four
// stages — extract → narrate(+checker) → render → verify — that BOTH the T6 REST
// server (briefExportJobs.runExportJob) and the offline CLI (lib/brief/cli.ts)
// call, so there is no second copy of the stage sequence to drift.
//
// The split (approved TL t/2837#2): runBriefPipeline owns the four stages and
// returns the artifacts + verify outcome; the CALLER owns everything
// wire/host-specific — job lifecycle (queued/done/failed), storage, idempotency,
// TTL, error-code mapping. This preserves T6's exact invariants:
//   • the manifest is the OUTPUT record, not a hashed input artifact — it is added
//     here after verify(), never inside verify();
//   • verify() NEVER throws on a gate failure — a failed gate comes back as a
//     non-empty `hardFailures`; only an unexpected stage fault throws;
//   • the `checking` sub-phase is surfaced post-hoc, only when a checker ran.

import { extractDeckSpec } from './extract.js';
import { narrate } from './narrate.js';
import { render } from './render/index.js';
import { verify } from './verify.js';
import { BRIEF_ARTIFACTS } from './types.js';
import type {
  DeckSpec, Narration, AuditManifest, BriefPreset, ModelSource,
  ExportJobState, BriefArtifactName,
} from './types.js';
import type { DebateSession } from '../debate/types.js';
import type { AIAdapter } from '../debate/aiAdapter.js';

/** Everything the four stages need. Mirrors T6's CreateJobArgs minus the
 *  host-specific fields (userId, idempotencyKey, debateId) the caller owns. */
export interface BriefPipelineInput {
  session: DebateSession;
  preset: BriefPreset;
  modelId: string;
  modelSource: ModelSource;
  checkerModelId?: string;
  checkerModelSource?: ModelSource;
  skipNarration?: boolean;
  template?: Uint8Array;
  /** When explicitly false, drops the framing_meta slide from classroom (t/2838). */
  framingMeta?: boolean;
  /** Export a non-closed (in-progress) debate as a watermarked snapshot (t/2816).
   *  Absent/false → extractDeckSpec throws on a non-closed session. */
  allowOpen?: boolean;
  /** Tool name → semver, recorded in the manifest. */
  toolVersions: Record<string, string>;
  /** ISO-8601; caller supplies it so the pipeline stays deterministic. */
  timestamp: string;
}

/** One emitted artifact — exactly one of text/bytes is set. */
export interface BriefArtifact {
  name: BriefArtifactName;
  text?: string;
  bytes?: Uint8Array;
}

export interface BriefPipelineResult {
  spec: DeckSpec;
  narration: Narration;
  pptxBytes: Uint8Array;
  htmlDoc: string;
  manifest: AuditManifest;
  /** deck_spec.json, narration.json, brief.pptx, brief.html, audit-manifest.json —
   *  in production order. The manifest is included (output record). */
  artifacts: BriefArtifact[];
  /** Empty ⇒ the verify gate passed. Non-empty ⇒ the caller must fail. */
  hardFailures: string[];
  /** Aggregated non-fatal render warnings + manifest warnings. */
  warnings: string[];
}

/**
 * Run the four Brief Export stages. Stage faults propagate (the caller maps them
 * to its own error codes); a verify GATE failure does NOT throw — it returns via
 * `hardFailures` with the manifest still produced, so the failure is diagnosable.
 *
 * @param onStage optional progress sink — emits extracting|narrating|checking|
 *   rendering|verifying as each stage begins (`checking` only when a checker ran).
 *   The caller owns queued/done/failed.
 * @param onArtifact optional per-artifact sink — invoked ONCE for each artifact the
 *   moment it is produced (deck_spec after extract … audit-manifest after verify),
 *   with the SAME object that lands in the returned `artifacts`. Lets a caller
 *   persist incrementally — so a later stage throw still leaves the earlier
 *   artifacts captured (T6 partial-persist-on-throw, t/2858; Electron parity,
 *   t/2840) — built once here rather than re-derived per caller. On success the
 *   returned `artifacts` equal the union of emitted artifacts, each exactly once.
 */
export async function runBriefPipeline(
  input: BriefPipelineInput,
  adapter: AIAdapter,
  onStage?: (stage: ExportJobState) => void,
  onArtifact?: (artifact: BriefArtifact) => void,
): Promise<BriefPipelineResult> {
  const artifacts: BriefArtifact[] = [];
  // Single sink: push and emit the SAME object, so returned `artifacts` and the
  // onArtifact stream can never diverge (each artifact appears in both, exactly once).
  const emit = (artifact: BriefArtifact): void => {
    artifacts.push(artifact);
    onArtifact?.(artifact);
  };

  // ── extract ──
  onStage?.('extracting');
  const spec = extractDeckSpec(input.session, { allowOpen: input.allowOpen });
  emit({ name: BRIEF_ARTIFACTS.deckSpec, text: JSON.stringify(spec, null, 2) });

  // ── narrate (+ optional maker-checker) ──
  onStage?.('narrating');
  const { narration } = await narrate({
    spec,
    preset: input.preset,
    modelId: input.modelId,
    modelSource: input.modelSource,
    checkerModelId: input.checkerModelId,
    checkerModelSource: input.checkerModelSource,
    skipNarration: input.skipNarration,
  }, adapter);
  // `checking` is a sub-phase inside narrate(); surface it only when a checker ran.
  if (input.checkerModelId && !input.skipNarration) onStage?.('checking');
  emit({ name: BRIEF_ARTIFACTS.narration, text: JSON.stringify(narration, null, 2) });

  // ── render (pptx + htmlDoc; PDF is Electron-only, never here) ──
  onStage?.('rendering');
  const { pptxBytes, htmlDoc, warnings: renderWarnings } = await render({
    spec,
    narration,
    preset: input.preset,
    template: input.template,
    framingMeta: input.framingMeta,
  });
  emit({ name: BRIEF_ARTIFACTS.pptx, bytes: pptxBytes });
  emit({ name: BRIEF_ARTIFACTS.htmlDoc, text: htmlDoc });

  // ── verify (build-fails-not-warns; manifest ALWAYS produced) ──
  onStage?.('verifying');
  const { manifest, hardFailures } = await verify({
    spec,
    narration,
    pptxBytes,
    meta: { toolVersions: input.toolVersions, timestamp: input.timestamp },
  });
  // Manifest is the output record, NOT a hashed input artifact — added here, not in verify().
  emit({ name: BRIEF_ARTIFACTS.manifest, text: JSON.stringify(manifest, null, 2) });

  return {
    spec,
    narration,
    pptxBytes,
    htmlDoc,
    manifest,
    artifacts,
    hardFailures,
    warnings: [...renderWarnings, ...manifest.warnings],
  };
}
