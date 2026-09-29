// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { classifyClaimsPrompt } from './prompts.js';

// Prevention test for t/3759: steelman_of must not be available to the LLM
// in non-opening turns. Tests the prompt surface — the first gate before any
// LLM call or AN commit.

const STATEMENT = 'The accelerationist position is clear.';
const SPEAKER = 'Safetyist';
const CLAIMS_WITH_STEELMAN = [
  { claim: 'Cgroups give us useful walls', targets: ['AN-1'], steelman_of: 'accelerationist' },
  { claim: 'This does not mean alignment is solved', targets: ['AN-2'] },
];
const PRIOR_CLAIMS = [
  { id: 'AN-1', text: 'Runtime perimeters help', speaker: 'Accelerationist' },
  { id: 'AN-2', text: 'Alignment is unsolved', speaker: 'Safetyist' },
];

describe('classifyClaimsPrompt — steelman phase gate (t/3759)', () => {
  it('allowSteelman=true includes STEELMAN hint in claims block', () => {
    const prompt = classifyClaimsPrompt(STATEMENT, SPEAKER, CLAIMS_WITH_STEELMAN, PRIOR_CLAIMS, undefined, true);
    expect(prompt).toContain('[STEELMAN of accelerationist');
    expect(prompt).not.toContain('ALWAYS null');
  });

  it('allowSteelman=false strips STEELMAN hint from claims block', () => {
    const prompt = classifyClaimsPrompt(STATEMENT, SPEAKER, CLAIMS_WITH_STEELMAN, PRIOR_CLAIMS, undefined, false);
    expect(prompt).not.toContain('[STEELMAN of');
    expect(prompt).not.toContain('set steelman_of:');
  });

  it('allowSteelman=false replaces steelman_of description with hard prohibition', () => {
    const prompt = classifyClaimsPrompt(STATEMENT, SPEAKER, CLAIMS_WITH_STEELMAN, PRIOR_CLAIMS, undefined, false);
    expect(prompt).toContain('ALWAYS null');
    expect(prompt).toContain('only valid in opening statements');
  });

  it('default (no allowSteelman arg) preserves existing behaviour — steelman allowed', () => {
    // Backward-compat: callers that do not pass allowSteelman get the original behaviour.
    const prompt = classifyClaimsPrompt(STATEMENT, SPEAKER, CLAIMS_WITH_STEELMAN, PRIOR_CLAIMS);
    expect(prompt).toContain('[STEELMAN of accelerationist');
  });
});
