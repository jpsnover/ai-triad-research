// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
//
// Compile-time type assertion for Interpretation (t/3889).
// Never imported — exists solely to be checked by debate/tsconfig.json,
// which includes **/*.ts and EXCLUDES **/*.test.ts.
//
// Both arms proven (t/3889#7):
//   Interpretation = BdiInterpretation  → tsc exit 0 (@ts-expect-error consumed)
//   Interpretation = string | BdiInterpretation → TS2578 unused directive → exit 2

import type { Interpretation, BdiInterpretation } from './taxonomyTypes.js';

// Arm 1: a valid BdiInterpretation is assignable — no error expected here.
const _validBdi: Interpretation = {
  belief: 'AI capabilities are growing',
  desire: 'Accelerate development',
  intention: 'Remove constraints',
  summary: 'Push acceleration',
} satisfies BdiInterpretation;
void _validBdi;

// Arm 2: a plain string is NOT assignable — @ts-expect-error must be consumed.
// If Interpretation is ever widened to accept strings, tsc emits TS2578
// ("Unused '@ts-expect-error' directive") and the build fails.
// @ts-expect-error Interpretation is BdiInterpretation-only; plain strings must fail (t/3889)
const _invalidString: Interpretation = 'legacy string';
void _invalidString;
