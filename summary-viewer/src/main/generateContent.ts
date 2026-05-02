// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
import path from 'path';
import { loadApiKey } from './apiKeyStore';
import { ActionableError } from '../../../lib/debate/errors';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_RETRIES = 5;

type AIBackend = 'gemini' | 'claude' | 'groq' | 'openai';

function resolveBackend(model: string): AIBackend {
  if (model.startsWith('claude')) return 'claude';
  if (model.startsWith('groq')) return 'groq';
  if (model.startsWith('openai')) return 'openai';
  return 'gemini';
}

// ── API model ID mapping from ai-models.json ──

let _modelMapCache: Record<string, string> | null = null;
let _modelMapMtime = 0;

function getApiModelId(friendlyId: string): string {
  try {
    const configPath = path.join(PROJECT_ROOT, 'ai-models.json');
    const stat = fs.statSync(configPath);
    if (!_modelMapCache || stat.mtimeMs !== _modelMapMtime) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(raw) as { models: { id: string; apiModelId?: string }[] };
      const map: Record<string, string> = {};
      for (const m of config.models) {
        if (m.apiModelId && m.apiModelId !== m.id) {
          map[m.id] = m.apiModelId;
        }
      }
      _modelMapCache = map;
      _modelMapMtime = stat.mtimeMs;
    }
  } catch {
    if (!_modelMapCache) _modelMapCache = {};
  }
  return _modelMapCache[friendlyId] || friendlyId;
}

// ── Gemini ──

interface GeminiGenerateResponse {
  candidates: Array<{
    content: {
      parts: Array<{ text: string }>;
    };
  }>;
}

async function generateViaGemini(
  systemPrompt: string,
  userPrompt: string,
  model: string,
  apiKey: string,
): Promise<string> {
  const url = `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`;

  const body = {
    system_instruction: {
      parts: [{ text: systemPrompt }],
    },
    contents: [
      { role: 'user', parts: [{ text: userPrompt }] },
    ],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
    },
  };

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (response.status === 429) {
      if (attempt === MAX_RETRIES) {
        throw new ActionableError({
          goal: 'Generate content via Gemini API',
          problem: `Gemini API rate limited (429) after ${MAX_RETRIES} attempts`,
          location: 'generateContent.ts:generateViaGemini',
          nextSteps: [
            'Wait a minute and retry the request',
            'Check your Gemini API quota at https://console.cloud.google.com/',
            'Try switching to a different AI backend (Claude, Groq)',
          ],
        });
      }
      const backoff = Math.min(2 ** attempt, 30);
      console.log(`[generateContent] Rate limited (429), retrying in ${backoff}s (attempt ${attempt}/${MAX_RETRIES})`);
      await new Promise(resolve => setTimeout(resolve, backoff * 1000));
      continue;
    }

    if (!response.ok) {
      const text = await response.text();
      throw new ActionableError({
        goal: 'Generate content via Gemini API',
        problem: `Gemini API error ${response.status}: ${text}`,
        location: 'generateContent.ts:generateViaGemini',
        nextSteps: [
          'Check your Gemini API key is valid in Settings',
          'Verify network connectivity to generativelanguage.googleapis.com',
          'Try a different Gemini model',
        ],
      });
    }

    const json = (await response.json()) as GeminiGenerateResponse;
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new ActionableError({
      goal: 'Generate content via Gemini API',
      problem: 'Gemini API returned empty response (no candidates or text)',
      location: 'generateContent.ts:generateViaGemini',
      nextSteps: [
        'Retry the request -- this is sometimes a transient issue',
        'Check if the prompt is triggering content safety filters',
        'Try a different Gemini model',
      ],
    });
    return text;
  }

  throw new ActionableError({
    goal: 'Generate content via Gemini API',
    problem: 'Exhausted all retry attempts without a successful response',
    location: 'generateContent.ts:generateViaGemini',
    nextSteps: [
      'Wait a minute and retry the request',
      'Check Gemini API status at https://status.cloud.google.com/',
      'Try a different AI backend (Claude, Groq)',
    ],
  });
}

// ── Claude ──

async function generateViaClaude(
  systemPrompt: string,
  userPrompt: string,
  model: string,
  apiKey: string,
): Promise<string> {
  const apiModel = getApiModelId(model);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: apiModel,
        max_tokens: 8192,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (response.status === 429 || response.status === 529) {
      if (attempt === MAX_RETRIES) {
        throw new ActionableError({
          goal: 'Generate content via Claude API',
          problem: `Claude API rate limited after ${MAX_RETRIES} attempts`,
          location: 'generateContent.ts:generateViaClaude',
          nextSteps: [
            'Wait a minute and retry the request',
            'Check your Anthropic API usage at https://console.anthropic.com/',
            'Try switching to a different AI backend (Gemini, Groq)',
          ],
        });
      }
      const backoff = Math.min(2 ** attempt, 30);
      console.log(`[generateContent] Claude ${response.status}, retrying in ${backoff}s (attempt ${attempt}/${MAX_RETRIES})`);
      await new Promise(resolve => setTimeout(resolve, backoff * 1000));
      continue;
    }

    const bodyText = await response.text();
    if (!response.ok) {
      throw new ActionableError({
        goal: 'Generate content via Claude API',
        problem: `Claude API error ${response.status}: ${bodyText.slice(0, 500)}`,
        location: 'generateContent.ts:generateViaClaude',
        nextSteps: [
          'Check your Claude API key is valid in Settings',
          'Verify network connectivity to api.anthropic.com',
          'Try a different Claude model',
        ],
      });
    }

    const json = JSON.parse(bodyText) as { content?: { type: string; text: string }[] };
    if (!json.content || json.content.length === 0) {
      throw new ActionableError({
        goal: 'Generate content via Claude API',
        problem: `No content in Claude response: ${bodyText.slice(0, 200)}`,
        location: 'generateContent.ts:generateViaClaude',
        nextSteps: [
          'Retry the request -- this is sometimes a transient issue',
          'Check if the prompt is triggering content safety filters',
          'Try a different Claude model',
        ],
      });
    }

    return json.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('');
  }

  throw new ActionableError({
    goal: 'Generate content via Claude API',
    problem: 'Exhausted all retry attempts without a successful response',
    location: 'generateContent.ts:generateViaClaude',
    nextSteps: [
      'Wait a minute and retry the request',
      'Check Anthropic API status at https://status.anthropic.com/',
      'Try a different AI backend (Gemini, Groq)',
    ],
  });
}

// ── Groq ──

async function generateViaGroq(
  systemPrompt: string,
  userPrompt: string,
  model: string,
  apiKey: string,
): Promise<string> {
  const apiModel = getApiModelId(model);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: apiModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 8192,
      }),
    });

    if (response.status === 429) {
      if (attempt === MAX_RETRIES) {
        throw new ActionableError({
          goal: 'Generate content via Groq API',
          problem: `Groq API rate limited (429) after ${MAX_RETRIES} attempts`,
          location: 'generateContent.ts:generateViaGroq',
          nextSteps: [
            'Wait a minute and retry the request',
            'Check your Groq API quota at https://console.groq.com/',
            'Try switching to a different AI backend (Gemini, Claude)',
          ],
        });
      }
      const backoff = Math.min(2 ** attempt, 30);
      console.log(`[generateContent] Groq 429, retrying in ${backoff}s (attempt ${attempt}/${MAX_RETRIES})`);
      await new Promise(resolve => setTimeout(resolve, backoff * 1000));
      continue;
    }

    const bodyText = await response.text();
    if (!response.ok) {
      throw new ActionableError({
        goal: 'Generate content via Groq API',
        problem: `Groq API error ${response.status}: ${bodyText.slice(0, 500)}`,
        location: 'generateContent.ts:generateViaGroq',
        nextSteps: [
          'Check your Groq API key is valid in Settings',
          'Verify network connectivity to api.groq.com',
          'Try a different Groq model',
        ],
      });
    }

    const json = JSON.parse(bodyText) as { choices?: { message: { content: string } }[] };
    if (!json.choices || json.choices.length === 0) {
      throw new ActionableError({
        goal: 'Generate content via Groq API',
        problem: `No choices in Groq response: ${bodyText.slice(0, 200)}`,
        location: 'generateContent.ts:generateViaGroq',
        nextSteps: [
          'Retry the request -- this is sometimes a transient issue',
          'Check if the prompt is triggering content safety filters',
          'Try a different Groq model',
        ],
      });
    }

    return json.choices[0].message.content;
  }

  throw new ActionableError({
    goal: 'Generate content via Groq API',
    problem: 'Exhausted all retry attempts without a successful response',
    location: 'generateContent.ts:generateViaGroq',
    nextSteps: [
      'Wait a minute and retry the request',
      'Check Groq API status at https://status.groq.com/',
      'Try a different AI backend (Gemini, Claude)',
    ],
  });
}

// ── OpenAI ──

async function generateViaOpenAI(
  systemPrompt: string,
  userPrompt: string,
  model: string,
  apiKey: string,
): Promise<string> {
  const apiModel = getApiModelId(model);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: apiModel,
        instructions: systemPrompt,
        input: userPrompt,
        max_output_tokens: 16384,
      }),
    });

    if (response.status === 429) {
      if (attempt === MAX_RETRIES) {
        throw new ActionableError({
          goal: 'Generate content via OpenAI API',
          problem: `OpenAI API rate limited (429) after ${MAX_RETRIES} attempts`,
          location: 'generateContent.ts:generateViaOpenAI',
          nextSteps: [
            'Wait a minute and retry the request',
            'Check your OpenAI API quota at https://platform.openai.com/usage',
            'Try switching to a different AI backend (Gemini, Claude, Groq)',
          ],
        });
      }
      const backoff = Math.min(2 ** attempt, 30);
      console.log(`[generateContent] OpenAI 429, retrying in ${backoff}s (attempt ${attempt}/${MAX_RETRIES})`);
      await new Promise(resolve => setTimeout(resolve, backoff * 1000));
      continue;
    }

    const bodyText = await response.text();
    if (!response.ok) {
      throw new ActionableError({
        goal: 'Generate content via OpenAI API',
        problem: `OpenAI API error ${response.status}: ${bodyText.slice(0, 500)}`,
        location: 'generateContent.ts:generateViaOpenAI',
        nextSteps: [
          'Check your OpenAI API key is valid in Settings',
          'Verify network connectivity to api.openai.com',
          'Try a different OpenAI model',
        ],
      });
    }

    const json = JSON.parse(bodyText) as {
      output?: { type: string; content?: { type: string; text: string }[] }[];
    };
    const msgOutput = json.output?.find(o => o.type === 'message');
    const text = msgOutput?.content?.find(c => c.type === 'output_text')?.text;
    if (!text) {
      throw new ActionableError({
        goal: 'Generate content via OpenAI API',
        problem: `No message output in OpenAI response: ${bodyText.slice(0, 200)}`,
        location: 'generateContent.ts:generateViaOpenAI',
        nextSteps: [
          'Retry the request -- this is sometimes a transient issue',
          'Check if the prompt is triggering content safety filters',
          'Try a different OpenAI model',
        ],
      });
    }

    return text;
  }

  throw new ActionableError({
    goal: 'Generate content via OpenAI API',
    problem: 'Exhausted all retry attempts without a successful response',
    location: 'generateContent.ts:generateViaOpenAI',
    nextSteps: [
      'Wait a minute and retry the request',
      'Check OpenAI API status at https://status.openai.com/',
      'Try a different AI backend (Gemini, Claude, Groq)',
    ],
  });
}

// ── Sanitization ──

function sanitizeAiText(text: string): string {
  return text
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '')
    .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '');
}

// ── Main entry point ──

let _lastLoggedModel: string | null = null;

export async function generateContent(
  systemPrompt: string,
  userPrompt: string,
  model?: string,
): Promise<string> {
  const DEFAULT_MODEL = 'gemini-2.5-flash';
  const resolvedModel = model || DEFAULT_MODEL;
  const backend = resolveBackend(resolvedModel);

  const apiKey = loadApiKey(backend);
  const keySource = apiKey ? 'Electron encrypted store' : '(not found)';
  if (!apiKey) {
    const names: Record<AIBackend, string> = { gemini: 'Gemini', claude: 'Claude', groq: 'Groq', openai: 'OpenAI' };
    throw new ActionableError({
      goal: `Generate content via ${names[backend]} API`,
      problem: `No ${names[backend]} API key configured`,
      location: 'generateContent.ts:generateContent',
      nextSteps: [
        `Set your ${names[backend]} API key in the Settings dialog`,
        `Or set the environment variable: ${backend === 'gemini' ? 'GEMINI_API_KEY' : backend === 'claude' ? 'ANTHROPIC_API_KEY' : backend === 'groq' ? 'GROQ_API_KEY' : 'AI_API_KEY'}`,
        'Or set the universal fallback: AI_API_KEY',
      ],
    });
  }

  // Log on first call or model change
  if (_lastLoggedModel !== resolvedModel) {
    if (_lastLoggedModel) {
      console.log(`[AI] Model changed: ${_lastLoggedModel} → ${resolvedModel} | Backend: ${backend} | Key source: ${keySource}`);
    } else {
      console.log(`[AI] Backend: ${backend} | Model: ${resolvedModel} | Key source: ${keySource}`);
    }
    _lastLoggedModel = resolvedModel;
  }

  let result: string;
  switch (backend) {
    case 'claude':
      result = await generateViaClaude(systemPrompt, userPrompt, resolvedModel, apiKey);
      break;
    case 'groq':
      result = await generateViaGroq(systemPrompt, userPrompt, resolvedModel, apiKey);
      break;
    case 'openai':
      result = await generateViaOpenAI(systemPrompt, userPrompt, resolvedModel, apiKey);
      break;
    default:
      result = await generateViaGemini(systemPrompt, userPrompt, resolvedModel, apiKey);
      break;
  }

  return sanitizeAiText(result);
}
