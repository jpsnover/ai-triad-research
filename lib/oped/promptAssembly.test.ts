// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadAndAssemblePrompt, assembleReflectionPrompt, type PromptContext } from './promptLoader.js';

// Fixture prompt templates — minimal placeholders that cover every interpolation key
const SYSTEM_TEMPLATE =
  'SYSTEM|{{POV_LABEL}}|{{VOICE_BLOCK}}|{{WORD_COUNT}}|{{OUTLET_GUIDANCE}}';
const USER_TEMPLATE =
  'USER|{{TOPIC}}|{{WORD_COUNT}}|{{OUTLET_GUIDANCE}}|{{NEWS_HOOK}}|{{THESIS}}|{{AUTHOR_BIO}}' +
  '|{{SOURCE_MATERIAL}}|{{GROUNDING_NODES}}|{{SITUATIONS}}|{{PITCH_INSTRUCTION}}' +
  '|{{SOURCE_AUTHOR}}|{{SOURCE_ACTOR_TYPE}}|{{SOURCE_THESIS}}|{{SOURCE_STANCE}}' +
  '|{{SOURCE_RECOMMENDATIONS}}';
const REFLECTION_TEMPLATE = 'REFL|{{OPED_BODY}}|{{GROUNDING_LIST}}';

let promptsDir: string;

beforeAll(() => {
  promptsDir = mkdtempSync(join(tmpdir(), 'oped-prompts-test-'));
  writeFileSync(join(promptsDir, 'op-ed-generation-system.prompt'), SYSTEM_TEMPLATE, 'utf-8');
  writeFileSync(join(promptsDir, 'op-ed-generation-user.prompt'), USER_TEMPLATE, 'utf-8');
  writeFileSync(join(promptsDir, 'op-ed-grounding-reflection.prompt'), REFLECTION_TEMPLATE, 'utf-8');
});

afterAll(() => {
  rmSync(promptsDir, { recursive: true, force: true });
});

const FIXTURE_CTX: PromptContext = {
  topic: 'Mandatory AI audits',
  params: {
    wordCount: 800,
    outlet: 'Generic',
    newsHook: 'Senate AI bill next week',
    thesis: 'Audits prevent catastrophic failures',
    authorBio: 'A researcher at MIT',
    model: 'gemini-3.7-flash',
  },
  pov: 'safetyist',
  povLabel: 'The Safetyist',
  voiceBlock: 'VOICE: cautious and evidence-driven',
  groundingNodes: '- [saf-bel-001] [Belief] AI is dangerous: It really is.',
  situations: '- [sit-001] Runaway model: Bad outcome.',
  sourceMaterial: '(no external source supplied — argue from the topic and general knowledge)',
  outletGuidance: 'Generic: ~800 words',
  targetWords: 800,
};

describe('loadAndAssemblePrompt', () => {
  it('produces byte-identical output on repeated calls with the same inputs', () => {
    const first = loadAndAssemblePrompt(promptsDir, FIXTURE_CTX);
    const second = loadAndAssemblePrompt(promptsDir, FIXTURE_CTX);
    expect(first.system).toBe(second.system);
    expect(first.user).toBe(second.user);
  });

  it('interpolates POV_LABEL and VOICE_BLOCK into system prompt', () => {
    const { system } = loadAndAssemblePrompt(promptsDir, FIXTURE_CTX);
    expect(system).toContain('The Safetyist');
    expect(system).toContain('VOICE: cautious and evidence-driven');
    expect(system).toContain('800');
    expect(system).toContain('Generic: ~800 words');
  });

  it('interpolates topic, news hook, thesis, and grounding into user prompt', () => {
    const { user } = loadAndAssemblePrompt(promptsDir, FIXTURE_CTX);
    expect(user).toContain('Mandatory AI audits');
    expect(user).toContain('Senate AI bill next week');
    expect(user).toContain('Audits prevent catastrophic failures');
    expect(user).toContain('saf-bel-001');
    expect(user).toContain('sit-001');
  });

  it('fills missing optional fields with descriptive fallbacks', () => {
    const ctx: PromptContext = {
      ...FIXTURE_CTX,
      params: { ...FIXTURE_CTX.params, newsHook: undefined, thesis: undefined, authorBio: undefined },
    };
    const { user } = loadAndAssemblePrompt(promptsDir, ctx);
    expect(user).toContain('none supplied');
  });

  it('interpolates sourceBrief fields when present', () => {
    const ctx: PromptContext = {
      ...FIXTURE_CTX,
      sourceBrief: {
        author: 'Jane Doe',
        thesis: 'AI is risky',
        stance: 'cautionary',
        primary_recommendations: ['Audit', 'Regulate'],
      },
    };
    const { user } = loadAndAssemblePrompt(promptsDir, ctx);
    expect(user).toContain('Jane Doe');
    expect(user).toContain('AI is risky');
    expect(user).toContain('Audit; Regulate');
  });

  it('leaves no unresolved {{PLACEHOLDER}} tokens', () => {
    const { system, user } = loadAndAssemblePrompt(promptsDir, FIXTURE_CTX);
    expect(system).not.toMatch(/\{\{\w+\}\}/);
    expect(user).not.toMatch(/\{\{\w+\}\}/);
  });
});

describe('assembleReflectionPrompt', () => {
  it('produces byte-identical output on repeated calls', () => {
    const body = 'The essay body text.';
    const list = '- [saf-bel-001] (bdi/Belief) AI is dangerous';
    const first = assembleReflectionPrompt(promptsDir, body, list);
    const second = assembleReflectionPrompt(promptsDir, body, list);
    expect(first).toBe(second);
  });

  it('interpolates OPED_BODY and GROUNDING_LIST', () => {
    const result = assembleReflectionPrompt(
      promptsDir,
      'Essay body here.',
      '- [saf-bel-001] label',
    );
    expect(result).toContain('Essay body here.');
    expect(result).toContain('saf-bel-001');
  });
});
