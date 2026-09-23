// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// The single home for InquiryResult version policy (ADR-0002 §3, t/3574). Five roles read this
// artifact; a version integer only protects it if every reader interprets it identically, so all
// version handling lives HERE rather than being re-implemented at each deserialization boundary.
//
// ActionableError is imported from lib/debate/errors — the same de-facto-shared error primitive
// lib/ai-client providers already import from there. See the note in index.ts / the t/3574 PR: this
// is a leaf-utility dependency, not a coupling to the debate engine, but if ActionableError is later
// extracted to a neutral lib/errors.ts this import moves with it.

import { ActionableError } from '../debate/errors.js';
import { INQUIRY_SCHEMA_VERSION, InquiryResultSchema, type InquiryResult } from './schema.js';

/** Read the version defensively — a non-number (or absent) version is treated as "no usable version"
 *  and left to the schema validator to reject, rather than coerced. */
function readVersion(raw: unknown): number | undefined {
  const v = (raw as { schemaVersion?: unknown } | null | undefined)?.schemaVersion;
  return typeof v === 'number' ? v : undefined;
}

// Read-time migration home (ADR §3, older-version arm). No migration ships in v1 — it is the FIRST
// version, so there is no older shape to migrate from yet. The seam exists so a future v(N-1)→vN
// migration has exactly one home instead of five. If a stored version is somehow < current on a build
// with no registered migration, refuse loudly rather than pass an unmigrated shape to the validator.
function migrate(_raw: unknown, fromVersion: number): unknown {
  throw new ActionableError({
    goal: 'Read an older-version inquiry result',
    problem: `No migration is registered for InquiryResult schemaVersion ${fromVersion} → ${INQUIRY_SCHEMA_VERSION}`,
    location: 'lib/inquiry/parse.migrate',
    nextSteps: [
      'This build predates any v<current migration logic',
      'Open the result in the build that produced it, or upgrade the writer',
    ],
  });
}

/**
 * Parse an untrusted, persisted `InquiryResult`. Three arms (ADR §3):
 *  - **newer major** than this build understands → refuse loudly; never best-effort render an unknown shape
 *  - **same major** → tolerant read (`InquiryResultSchema` is `.passthrough()`, so a newer build's
 *    unknown field survives a round-trip instead of being silently stripped)
 *  - **older version** → migrate at read time via {@link migrate}
 * A structurally invalid same-major payload is refused with an `ActionableError` carrying the zod issues,
 * never a bare throw.
 */
export function parseInquiryResult(raw: unknown): InquiryResult {
  const v = readVersion(raw);

  if (v !== undefined && v > INQUIRY_SCHEMA_VERSION) {
    throw new ActionableError({
      goal: 'Read a persisted inquiry result',
      problem: `InquiryResult schemaVersion ${v} is newer than this build understands (max ${INQUIRY_SCHEMA_VERSION}). Refusing to render an unknown shape.`,
      location: 'lib/inquiry/parse.parseInquiryResult',
      nextSteps: [
        'Update the app to a build that understands this result version',
        'Do not hand-edit the stored result to lower its version',
      ],
    });
  }

  const candidate = v !== undefined && v < INQUIRY_SCHEMA_VERSION ? migrate(raw, v) : raw;

  const result = InquiryResultSchema.safeParse(candidate);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ActionableError({
      goal: 'Read a persisted inquiry result',
      problem: `InquiryResult failed schema validation: ${issues}`,
      location: 'lib/inquiry/parse.parseInquiryResult',
      nextSteps: [
        'The stored result is malformed or corrupt',
        'Re-run the inquiry to regenerate a valid result',
      ],
    });
  }
  return result.data;
}
