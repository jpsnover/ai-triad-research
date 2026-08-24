// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Shared Brief Export error-code mapping (t/2840). The verify()-hardFailure → stable
// ExportErrorCode mapping is caller-side (the pipeline itself never maps errors — the
// caller owns wire/host-specific error codes), but it is IDENTICAL across every caller
// — the T6 REST job runner, the offline CLI, and the Electron handler (t/2840). Homing
// it here makes each consumer the Nth adopter without an Nth byte-identical copy.

import type { ExportErrorCode } from './types.js';

/**
 * Map a verify() hardFailure string to its stable ExportErrorCode. Order matters —
 * schema before trace (a schema failure can cascade into trace strings). The default
 * stays within the verify-gate family (PptxLintFailure).
 */
export function codeForHardFailures(hardFailures: string[]): ExportErrorCode {
  const joined = hardFailures.join(' | ').toLowerCase();
  if (joined.includes('schema')) return 'SpecSchemaFailure';
  if (joined.includes('trace')) return 'TraceGateFailure';
  if (joined.includes('symmetry')) return 'SymmetryFailure';
  if (joined.includes('ooxml') || joined.includes('pptx') || joined.includes('lint')) return 'PptxLintFailure';
  return 'PptxLintFailure'; // default within the verify-gate family
}
