// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Transport contract between the Get-OpEdSource PS shim and opedHandlers (t/2928).
//
// PowerShell `ConvertTo-Json` emits INVALID JSON for some real fetched web content (it left a
// bare unescaped `"` inside a string value), which made FromUrl op-ed generation fail end-to-end
// while the handler reported an opaque "No result received." Two defenses live here, extracted
// as pure functions (no electron import) so the real shim→handler boundary is unit-testable:
//
//  1. Arbitrary-web-content fields travel base64-encoded and are listed in `_b64Fields`; the shim
//     encodes them BEFORE ConvertTo-Json (so it only ever sees ASCII for them), and decodeB64Fields
//     restores them here. Bulletproof by construction, PS-version-independent.
//  2. parseShimLine SURFACES a result-line parse failure as an ActionableError instead of the old
//     `catch { continue }` that silently dropped it — the loud backstop if a future content field
//     is ever missed from the shim's encode list.

import { ActionableError, errorMessage } from '../../../../lib/debate/errors.js';

export interface ShimStageLine { type: 'stage'; stage: string }
export interface ShimResultLine { type: 'result'; data: Record<string, unknown> }
export type ShimLine = ShimStageLine | ShimResultLine;

/** Locked stdin contract (t/3306/t/3307). Field names are asserted by OpEdShimTransport.Tests.ps1. */
export interface ConvertStdinPayload {
  ContentPath: string;
  ContentType: string;
  SourceUrl?: string;
}

/** Locked stderr failure contract emitted by the shim on exit 1 (t/3306#4). */
export interface ShimErrorPayload {
  ErrorType?: string;
  Goal?: string;
  Problem: string;
  NextSteps?: string[];
}

/** Build the JSON stdin string for the PS convert shim. Export keeps field names unit-testable. */
export function buildConvertStdin(contentPath: string, contentType: string, sourceUrl?: string): string {
  const payload: ConvertStdinPayload = { ContentPath: contentPath, ContentType: contentType };
  if (sourceUrl) payload.SourceUrl = sourceUrl;
  return JSON.stringify(payload);
}

/**
 * Parse the last stderr line from the PS convert shim.
 * Returns the structured payload when present (field `Problem` is the discriminator).
 * Returns null when stderr is absent, non-JSON, or lacks the expected shape.
 */
export function parseShimError(lastStderrLine: string): ShimErrorPayload | null {
  try {
    const candidate = JSON.parse(lastStderrLine) as Record<string, unknown>;
    if (typeof candidate['Problem'] === 'string') {
      return candidate as unknown as ShimErrorPayload;
    }
  } catch {
    /* telemetry — silent by design: stderr may not be JSON (non-shim output) */
  }
  return null;
}

/** Bounded head+tail excerpt so a 13k-char malformed line doesn't flood the recorder while still
 *  showing where the parse broke (recovery-vs-silent-loss convention). */
function boundedSnippet(s: string, edge = 160): string {
  if (s.length <= edge * 2) return s;
  return `${s.slice(0, edge)} …[${s.length - edge * 2} chars]… ${s.slice(-edge)}`;
}

/**
 * Parse one stdout line from the Get-OpEdSource shim.
 * - Valid JSON → the parsed {@link ShimLine}.
 * - A non-result line that fails to parse (stage telemetry) → `null` (safe to skip).
 * - A line that LOOKS like the result (`"type":"result"`) but fails `JSON.parse` → THROWS an
 *   {@link ActionableError}. This is the hard serialization failure that must never be swallowed
 *   (t/2928); silently skipping it is what surfaced as the opaque "No result received."
 */
export function parseShimLine(trimmed: string): ShimLine | null {
  try {
    return JSON.parse(trimmed) as ShimLine;
  } catch (err) {
    // Not recorded here (ADR-003): a result-looking line re-throws below — the handler's catch
    // records that; a non-result line is intentionally skipped. (telemetry — silent by design)
    if (trimmed.includes('"type":"result"')) {
      throw new ActionableError({
        goal: 'Read the prepared source from Get-OpEdSource',
        problem: `The source shim emitted an unparseable result line (${errorMessage(err)}). Near: ${boundedSnippet(trimmed)}`,
        location: 'opedShimTransport.parseShimLine',
        nextSteps: [
          'This is a serialization defect in the Stage-A shim, not a problem with the web page',
          'Ensure every fetched-content field is base64-encoded in invoke-get-oped-source.ps1 (_b64Fields)',
        ],
        innerError: err,
      });
    }
    return null; // non-result line (e.g. a stage event) that didn't parse — skip, unchanged
  }
}

/**
 * Decode the base64 transport fields the shim flagged in `_b64Fields` back to UTF-8, in place,
 * and strip the marker so downstream consumers never see it. No-op when the marker is absent
 * (backward-safe against an un-upgraded shim). Byte-faithful: `UTF8.GetBytes` ↔ base64 ↔ utf-8.
 */
export function decodeB64Fields<T extends Record<string, unknown>>(data: T): T {
  const fields = data['_b64Fields'];
  if (Array.isArray(fields)) {
    for (const f of fields) {
      if (typeof f === 'string' && typeof data[f] === 'string') {
        (data as Record<string, unknown>)[f] = Buffer.from(data[f] as string, 'base64').toString('utf-8');
      }
    }
  }
  delete (data as Record<string, unknown>)['_b64Fields'];
  return data;
}
