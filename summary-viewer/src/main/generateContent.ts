// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
import path from 'path';
import { loadApiKey } from './apiKeyStore';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_RETRIES = 5;

type AIBackend = 'gemini' | 'claude' | 'groq';

function resolveBackend(model: string): AIBackend {
  if (model.startsWith('claude')) return 'claude';
  if (model.startsWith('groq')) return 'groq';
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
        throw new Error(
          'Gemini API rate limited after ' + MAX_RETRIES + ' attempts. ' +
          'Please wait a minute and try again.',
        );
      }
      const backoff = Math.min(2 ** attempt, 30);
      console.log(`[generateContent] Rate limited (429), retrying in ${backoff}s (attempt ${attempt}/${MAX_RETRIES})`);
      await new Promise(resolve => setTimeout(resolve, backoff * 1000));
      continue;
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${text}`);
    }

    const json = (await response.json()) as GeminiGenerateResponse;
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini API returned empty response');
    return text;
  }

  throw new Error('generateContent: exhausted all retry attempts');
}

// ── Claude ──

async function generateViaClaude(
  systemPrompt: string,
  userPrompt: string,
  model: string,
  apiKey: string,
): Promise<string> {
  const apiModel = getApiModelId(model);

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

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Claude API error ${response.status}: ${bodyText.slice(0, 500)}`);
  }

  const json = JSON.parse(bodyText) as { content?: { type: string; text: string }[] };
  if (!json.content || json.content.length === 0) {
    throw new Error(`No content in Claude response: ${bodyText.slice(0, 200)}`);
  }

  return json.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('');
}

// ── Groq ──

async function generateViaGroq(
  systemPrompt: string,
  userPrompt: string,
  model: string,
  apiKey: string,
): Promise<string> {
  const apiModel = getApiModelId(model);

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

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Groq API error ${response.status}: ${bodyText.slice(0, 500)}`);
  }

  const json = JSON.parse(bodyText) as { choices?: { message: { content: string } }[] };
  if (!json.choices || json.choices.length === 0) {
    throw new Error(`No choices in Groq response: ${bodyText.slice(0, 200)}`);
  }

  return json.choices[0].message.content;
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
    const names: Record<AIBackend, string> = { gemini: 'Gemini', claude: 'Claude', groq: 'Groq' };
    throw new Error(`No ${names[backend]} API key configured. Set it in Settings.`);
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

  switch (backend) {
    case 'claude':
      return generateViaClaude(systemPrompt, userPrompt, resolvedModel, apiKey);
    case 'groq':
      return generateViaGroq(systemPrompt, userPrompt, resolvedModel, apiKey);
    default:
      return generateViaGemini(systemPrompt, userPrompt, resolvedModel, apiKey);
  }
}
