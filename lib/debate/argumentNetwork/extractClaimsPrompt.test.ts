// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { extractClaimsPrompt } from './prompts.js';

// Prevention test for t/3765: steelman_of must not be offered to the LLM
// on non-opening turns via the extractClaimsPrompt path. Tests the prompt
// surface — the first gate before any LLM call or AN commit.

const STATEMENT = 'I concede that runtime perimeters provide some benefit, but alignment remains unsolved.';
const SPEAKER = 'Safetyist';
const PRIOR_CLAIMS = [
  { id: 'AN-1', text: 'Runtime perimeters help contain misuse', speaker: 'Accelerationist' },
  { id: 'AN-2', text: 'Alignment is unsolved', speaker: 'Safetyist' },
];

describe('extractClaimsPrompt — steelman phase gate (t/3765)', () => {
  it('non-opening turn (default) prohibits steelman_of with ALWAYS null instruction', () => {
    const prompt = extractClaimsPrompt(STATEMENT, SPEAKER, PRIOR_CLAIMS);
    expect(prompt).toContain('ALWAYS null');
    expect(prompt).toContain('only valid in opening statements');
  });

  it('non-opening turn (explicit false) prohibits steelman_of', () => {
    const prompt = extractClaimsPrompt(STATEMENT, SPEAKER, PRIOR_CLAIMS, undefined, undefined, false);
    expect(prompt).toContain('ALWAYS null');
    expect(prompt).not.toContain('presents the STRONGEST version');
  });

  it('opening turn allows steelman_of with full description', () => {
    const prompt = extractClaimsPrompt(STATEMENT, SPEAKER, PRIOR_CLAIMS, undefined, undefined, true);
    expect(prompt).toContain('presents the STRONGEST version');
    expect(prompt).not.toContain('ALWAYS null');
  });

  it('non-opening turn does not contain camp-id assignment instruction', () => {
    // The LLM must not be told it can set steelman_of to a camp id on cross-respond turns.
    const prompt = extractClaimsPrompt(STATEMENT, SPEAKER, PRIOR_CLAIMS, undefined, undefined, false);
    expect(prompt).not.toContain('"accelerationist", "safetyist", "skeptic"');
  });
});
