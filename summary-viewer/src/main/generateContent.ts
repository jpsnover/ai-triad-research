// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { loadApiKey } from './apiKeyStore';
import { PROJECT_ROOT } from './fileIO';
import { ActionableError } from '../../../lib/debate/errors';
import { callByUsage } from '../../../lib/ai-client/usageRegistry.js';

// SECURITY INVARIANT (t/2024, CodeQL js/incomplete-multi-character-sanitization +
// js/bad-tag-filter): AI-generated text is NOT HTML-sanitized here. It is rendered
// exclusively via react-markdown (DocumentPane etc.), which does not execute embedded
// raw HTML unless the `rehype-raw` plugin is added. A regex-based sanitizer was both
// bypassable (CodeQL) and redundant, so it was removed (TL-approved p/56#192). The
// safety guarantee therefore depends on the renderer NOT introducing a raw-HTML sink:
// do NOT add `rehype-raw` or `dangerouslySetInnerHTML` to summary-viewer's renderer.
// Enforced by htmlSafetyInvariant.test.ts.

export async function generateContent(
  systemPrompt: string,
  userPrompt: string,
  model?: string,
): Promise<string> {
  const result = await callByUsage(
    'sv.generate-content',
    { prompt: userPrompt },
    {
      repoRoot: PROJECT_ROOT,
      fetch: globalThis.fetch,
      resolveApiKey: (backend: string) => {
        const key = loadApiKey(backend as Parameters<typeof loadApiKey>[0]);
        if (!key) {
          throw new ActionableError({
            goal: `Generate content via ${backend} API`,
            problem: `No ${backend} API key configured`,
            location: 'generateContent.ts:generateContent',
            nextSteps: [
              `Set your ${backend} API key in the Settings dialog`,
              'Or set the appropriate environment variable (GEMINI_API_KEY, ANTHROPIC_API_KEY, GROQ_API_KEY)',
              'Or set the universal fallback: AI_API_KEY',
            ],
          });
        }
        return key;
      },
    },
    {
      ...(model ? { model } : {}),
      systemMessage: systemPrompt,
    },
  );

  return result.text;
}
