// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Tests for the shared verify-hardFailure → ExportErrorCode mapping (t/2840).

import { describe, it, expect } from 'vitest';
import { codeForHardFailures } from './errorMapping.js';

describe('codeForHardFailures', () => {
  it('maps each verify-gate family by substring', () => {
    expect(codeForHardFailures(['deck_spec schema invalid'])).toBe('SpecSchemaFailure');
    expect(codeForHardFailures(['trace coverage 80% < 100%'])).toBe('TraceGateFailure');
    expect(codeForHardFailures(['symmetry: acc word_budget off by 40%'])).toBe('SymmetryFailure');
    expect(codeForHardFailures(['OOXML lint: bad relationship'])).toBe('PptxLintFailure');
    expect(codeForHardFailures(['pptx corrupt'])).toBe('PptxLintFailure');
  });

  it('is order-sensitive: schema wins over a cascaded trace string', () => {
    // A schema failure can cascade into trace strings; schema must win.
    expect(codeForHardFailures(['schema invalid', 'trace unresolvable'])).toBe('SpecSchemaFailure');
  });

  it('is case-insensitive', () => {
    expect(codeForHardFailures(['SCHEMA broken'])).toBe('SpecSchemaFailure');
    expect(codeForHardFailures(['SYMMETRY breach'])).toBe('SymmetryFailure');
  });

  it('defaults to PptxLintFailure within the verify-gate family for unrecognized text', () => {
    expect(codeForHardFailures(['something unexpected'])).toBe('PptxLintFailure');
    expect(codeForHardFailures([])).toBe('PptxLintFailure');
  });
});
