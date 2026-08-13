// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { ALL_API_KEY_BACKENDS } from './types.js';

// The compile-time guarantee (Record<ApiKeyBackend, true> forces every union
// member) is the real protection — see t/1956. These runtime assertions guard
// against an accidental map/keys mismatch and document the expected membership.
describe('ALL_API_KEY_BACKENDS', () => {
  it('contains every API-key backend, including the previously-omitted zai and moonshot', () => {
    expect([...ALL_API_KEY_BACKENDS].sort()).toEqual(
      [
        'azure',
        'claude',
        'deepseek',
        'gemini',
        'groq',
        'moonshot',
        'ollama',
        'openai',
        'tavily',
        'xai',
        'zai',
      ].sort(),
    );
  });

  it('has no duplicates', () => {
    expect(new Set(ALL_API_KEY_BACKENDS).size).toBe(ALL_API_KEY_BACKENDS.length);
  });
});
