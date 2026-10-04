// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Compile-time assertions for t/3888. Deliberately NOT a *.test.ts file: tsconfig.json excludes
// test files from tsc, and vitest strips types without checking them, so a @ts-expect-error in a
// test file is never evaluated. This file IS compiled by renderer tsc (CI: renderer-tsc). If
// SituationNodeUpdate ever accepts a string interpretation again, the @ts-expect-error below
// becomes unused, tsc reports TS2578, and the build goes red. Never imported at runtime.

import type { SituationNodeUpdate } from './taxonomyDataSlice';

export const acceptsBdiInterpretation: SituationNodeUpdate = {
  interpretations: { accelerationist: { belief: 'b', desire: 'd', intention: 'i', summary: 's' } },
};

// @ts-expect-error a flat string interpretation must not compile through the editor's write API (t/3888)
export const rejectsFlatString: SituationNodeUpdate = { interpretations: { accelerationist: 'flat prose' } };
