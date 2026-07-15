// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1574: single source of truth for API-key probe configurations. Both the
// server (global fetch) and Electron main (net.fetch) build their probe
// functions from this config — the URLs, methods, headers, and bodies are
// defined once here instead of duplicated across two files that have already
// drifted 3× (t/1458).
//
// Gemini uses POST generateContent, NOT the list-models endpoint: GET /models
// returns 200 for any key (public metadata), producing a false-green for
// invalid keys (t/1571, t/1572, t/1573).

export interface ProbeConfig {
  url: (key: string) => string;
  method?: 'GET' | 'POST';
  headers: (key: string) => Record<string, string>;
  body?: () => string;
}

export const KEY_PROBE_CONFIGS: Record<string, ProbeConfig> = {
  gemini: {
    url: key => `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: () => JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }], generationConfig: { maxOutputTokens: 1 } }),
  },
  claude: {
    url: () => 'https://api.anthropic.com/v1/models',
    headers: key => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
  },
  groq: {
    url: () => 'https://api.groq.com/openai/v1/models',
    headers: key => ({ Authorization: `Bearer ${key}` }),
  },
  openai: {
    url: () => 'https://api.openai.com/v1/models',
    headers: key => ({ Authorization: `Bearer ${key}` }),
  },
  deepseek: {
    url: () => 'https://api.deepseek.com/v1/models',
    headers: key => ({ Authorization: `Bearer ${key}` }),
  },
  zai: {
    url: () => 'https://api.z.ai/api/paas/v4/models',
    headers: key => ({ Authorization: `Bearer ${key}` }),
  },
};

export const SUPPORTED_PROBE_BACKENDS = Object.keys(KEY_PROBE_CONFIGS);
