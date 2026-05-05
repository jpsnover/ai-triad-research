// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { extractClaimsPrompt, classifyClaimsPrompt } from './argumentNetwork.js';

describe('DOMAIN_VOCABULARY in extractClaimsPrompt', () => {
  it('includes domain vocabulary block', () => {
    const prompt = extractClaimsPrompt('AI is dangerous', 'sentinel', []);
    expect(prompt).toContain('PREFERRED DOMAIN TERMINOLOGY');
    expect(prompt).toContain('"AI alignment"');
    expect(prompt).toContain('"existential risk"');
    expect(prompt).toContain('"deployment guardrails"');
  });

  it('places vocabulary before JSON schema', () => {
    const prompt = extractClaimsPrompt('AI is dangerous', 'sentinel', []);
    const vocabIdx = prompt.indexOf('PREFERRED DOMAIN TERMINOLOGY');
    const jsonIdx = prompt.indexOf('Return ONLY JSON');
    expect(vocabIdx).toBeLessThan(jsonIdx);
  });

  it('includes advisory note about exact phrasing', () => {
    const prompt = extractClaimsPrompt('AI is dangerous', 'sentinel', []);
    expect(prompt).toContain("use the debater's exact phrasing when it's already precise");
  });
});

describe('DOMAIN_VOCABULARY in classifyClaimsPrompt', () => {
  it('includes domain vocabulary block', () => {
    const prompt = classifyClaimsPrompt(
      'We need compute governance',
      'sentinel',
      [{ claim: 'Compute governance is essential', targets: [] }],
      [{ id: 'AN-1', text: 'AI scaling is safe', speaker: 'prometheus' }],
    );
    expect(prompt).toContain('PREFERRED DOMAIN TERMINOLOGY');
    expect(prompt).toContain('"compute governance"');
    expect(prompt).toContain('"regulatory capture"');
  });

  it('places vocabulary before JSON schema', () => {
    const prompt = classifyClaimsPrompt(
      'Test statement',
      'prometheus',
      [{ claim: 'Test claim', targets: [] }],
      [],
    );
    const vocabIdx = prompt.indexOf('PREFERRED DOMAIN TERMINOLOGY');
    const jsonIdx = prompt.indexOf('Return ONLY JSON');
    expect(vocabIdx).toBeLessThan(jsonIdx);
  });
});
