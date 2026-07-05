// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { loadApiKey } from './apiKeyStore';
import { PROJECT_ROOT } from './fileIO';
import { ActionableError } from '../../../lib/debate/errors';
import { callByUsage } from '../../../lib/ai-client/usageRegistry.js';

function sanitizeAiText(text: string): string {
  return text
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '')
    .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '');
}

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

  return sanitizeAiText(result.text);
}
