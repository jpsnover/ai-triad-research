// @vitest-environment node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Gate: every backend registered in ai-models.json must have a corresponding
 * entry in BACKEND_ENV_KEYS in aiAdapter.ts, or be explicitly listed as
 * keyless (e.g. ollama — local inference, no API key required).
 *
 * Background: zai was absent from BACKEND_ENV_KEYS for months and silently
 * resolved to the AI_API_KEY fallback (t/1955). This test closes the signal
 * gap so the next backend addition fails loudly if the env-key entry is missed.
 *
 * When adding a new backend:
 *   1. Add it to ai-models.json
 *   2. Add its env key to BACKEND_ENV_KEYS in aiAdapter.ts
 *   3. Mirror the entry in EXPECTED_BACKEND_ENV_KEYS below
 *   4. Or add it to KEYLESS_BACKENDS if it needs no API key
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

// Mirror of BACKEND_ENV_KEYS in aiAdapter.ts.
// Keep in sync: add entries here AND in aiAdapter.ts when registering a backend.
const EXPECTED_BACKEND_ENV_KEYS: Record<string, string> = {
  gemini:   'GEMINI_API_KEY',
  claude:   'ANTHROPIC_API_KEY',
  groq:     'GROQ_API_KEY',
  openai:   'OPENAI_API_KEY',
  azure:    'AZURE_OPENAI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  moonshot: 'MOONSHOT_API_KEY',
  zai:      'ZAI_API_KEY',
};

// Backends that intentionally require no API key.
const KEYLESS_BACKENDS = new Set(['ollama']);

interface ModelRegistry {
  backends: Array<{ id: string; label: string }>;
}

describe('BACKEND_ENV_KEYS completeness gate', () => {
  it('every backend in ai-models.json has a BACKEND_ENV_KEYS entry or is explicitly keyless', () => {
    const registry: ModelRegistry = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'ai-models.json'), 'utf-8')
    );

    const missing = registry.backends
      .map(b => b.id)
      .filter(id => !KEYLESS_BACKENDS.has(id) && !(id in EXPECTED_BACKEND_ENV_KEYS));

    expect(
      missing,
      `Backends missing from BACKEND_ENV_KEYS: [${missing.join(', ')}]. ` +
        'Add entries in aiAdapter.ts BACKEND_ENV_KEYS AND in EXPECTED_BACKEND_ENV_KEYS ' +
        'in lib/debate/backendEnvKeys.test.ts.',
    ).toHaveLength(0);
  });
});
