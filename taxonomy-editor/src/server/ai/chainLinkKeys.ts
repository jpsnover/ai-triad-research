// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Per-link key resolution for generateText's fallback chain, split out of aiBackends.ts (complexity and
// max-lines budgets, TL e/284#30). A t/4105 condition file: the refusal handling here is SO cond 6.

import { getApiKeys, type AIBackend } from '../config.js';
import { isKeyRoutingRefusal, LISTING_WARN } from '../../../../lib/ai-client/apiKeyFallback.js';
import { ActionableError } from '../../../../lib/debate/errors.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import { log } from '../logger.js';

/** No key for any model in the chain: throw a backend-named ActionableError. */
export function throwNoApiKeyError(backend: string, modelsToTry: string[]): never {
  const names: Record<string, string> = { gemini: 'Gemini', claude: 'Claude', groq: 'Groq', openai: 'OpenAI', tavily: 'Tavily', deepseek: 'DeepSeek', moonshot: 'Moonshot (Kimi)', xai: 'xAI (Grok)' };
  const backendName = names[backend] ?? backend;
  throw new ActionableError({
    goal: `Generate text via ${backendName}`,
    problem: `No API key configured for any model in the fallback chain: ${modelsToTry.join(' → ')}`,
    location: 'aiBackends.generateText',
    nextSteps: [`Set your ${backendName} API key in Settings`, 'Or switch to a backend that has a key configured'],
  });
}

/**
 * The keys for chain link `mi`, or null to skip it. SO e/284#12 cond 6: the PRIMARY's key refusal throws to the
 * caller, never served by a later link; a SECONDARY link with only AI_API_KEY is skipped like a keyless one, and a
 * foreign-credential refusal always surfaces. t/3176: a skipped keyless link WARNs, so a key gap is greppable.
 */
export async function chainLinkKeys(modelsToTry: string[], mi: number, backend: AIBackend, explicitKeys: string[] | undefined): Promise<string[] | null> {
  const model = modelsToTry[mi];
  let keys: string[];
  try {
    keys = explicitKeys ?? await getApiKeys(backend);
  } catch (err) {
    if (mi === 0 || !isKeyRoutingRefusal(err, 'AIApiKeyGeminiOnlyRefused')) throw err;
    log.api.warn({ model, backend, fallbackIndex: mi }, `generateText: ${LISTING_WARN} — skipping fallback chain entry`);
    return null;
  }
  if (keys.length > 0) return keys;
  if (mi === modelsToTry.length - 1) throwNoApiKeyError(backend, modelsToTry);
  getGlobalRecorder()?.record({
    type: 'ai.fallback', component: 'ai-adapter', level: 'info',
    message: `Skipping ${model}: no ${backend} API key — trying next fallback`,
    data: { model, backend, fallbackIndex: mi, chain: modelsToTry },
  });
  log.api.warn({ model, backend, fallbackIndex: mi }, 'generateText: no API key for backend — skipping to next fallback chain entry');
  return null;
}
