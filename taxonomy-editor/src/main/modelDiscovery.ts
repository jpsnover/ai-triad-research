// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
import path from 'path';
import { loadApiKey } from './apiKeyStore';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'ai-models.json');

interface ModelEntry {
  id: string;
  apiModelId: string;
  label: string;
  backend: string;
}

interface AIModelsConfig {
  backends: { id: string; label: string }[];
  models: ModelEntry[];
  defaults: Record<string, string>;
  lastRefreshed: string | null;
}

function loadConfig(): AIModelsConfig {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  return JSON.parse(raw) as AIModelsConfig;
}

function saveConfig(config: AIModelsConfig): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

// ── Gemini: GET /v1beta/models ──────────────────────────────────────────────

interface GeminiModelInfo {
  name: string;           // "models/gemini-2.5-flash"
  displayName: string;    // "Gemini 2.5 Flash"
  supportedGenerationMethods: string[];
}

async function discoverGeminiModels(apiKey: string): Promise<ModelEntry[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=100`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Gemini models API ${resp.status}: ${body.slice(0, 200)}`);
  }
  const json = await resp.json() as { models: GeminiModelInfo[] };

  return json.models
    .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
    .filter(m => {
      const id = m.name.replace('models/', '');
      // Skip embedding, AQA, and legacy models
      return !id.includes('embedding') && !id.includes('aqa') && !id.startsWith('chat-');
    })
    .map(m => {
      const apiModelId = m.name.replace('models/', '');
      return {
        id: apiModelId,
        apiModelId,
        label: m.displayName || apiModelId,
        backend: 'gemini',
      };
    });
}

// ── Groq: GET /openai/v1/models ─────────────────────────────────────────────

interface GroqModelInfo {
  id: string;             // "llama-3.3-70b-versatile"
  owned_by: string;
  active: boolean;
}

async function discoverGroqModels(apiKey: string): Promise<ModelEntry[]> {
  const resp = await fetch('https://api.groq.com/openai/v1/models', {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Groq models API ${resp.status}: ${body.slice(0, 200)}`);
  }
  const json = await resp.json() as { data: GroqModelInfo[] };

  return json.data
    .filter(m => m.active !== false)
    .filter(m => {
      // Skip whisper (audio), embedding, and tool-use-only models
      const id = m.id.toLowerCase();
      return !id.includes('whisper') && !id.includes('embed') && !id.includes('guard');
    })
    .map(m => {
      // Create a friendly ID: groq-<simplified-name>
      const friendlyId = 'groq-' + m.id
        .replace(/^meta-llama\//, '')
        .replace(/^mistralai\//, '')
        .replace(/-instruct$/, '')
        .replace(/[^a-z0-9.-]/gi, '-')
        .toLowerCase();
      // Create a display label
      const label = m.id
        .replace(/^meta-llama\//, '')
        .replace(/^mistralai\//, '')
        .replace(/-/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
      return {
        id: friendlyId,
        apiModelId: m.id,
        label,
        backend: 'groq',
      };
    });
}

// ── Anthropic: no list API — probe candidate model IDs ──────────────────────

// All known Claude model IDs to probe. The API returns 404 for invalid ones
// and 400 (missing messages) for valid ones when we send an empty request.
const CLAUDE_CANDIDATES: { apiModelId: string; label: string }[] = [
  // 4.6 family
  { apiModelId: 'claude-opus-4-6-20250514',       label: 'Opus 4.6' },
  { apiModelId: 'claude-sonnet-4-6-20250514',     label: 'Sonnet 4.6' },
  // 4.5 family
  { apiModelId: 'claude-sonnet-4-5-20241022',     label: 'Sonnet 4.5 (Oct 2024)' },
  { apiModelId: 'claude-sonnet-4-5-20250514',     label: 'Sonnet 4.5 (May 2025)' },
  // 4.0 family
  { apiModelId: 'claude-opus-4-20250514',         label: 'Opus 4' },
  { apiModelId: 'claude-sonnet-4-20250514',       label: 'Sonnet 4' },
  // Haiku
  { apiModelId: 'claude-haiku-4-5-20251001',      label: 'Haiku 4.5' },
  { apiModelId: 'claude-3-5-haiku-20241022',      label: 'Haiku 3.5' },
  // 3.5 family
  { apiModelId: 'claude-3-5-sonnet-20241022',     label: 'Sonnet 3.5 v2 (Oct 2024)' },
  { apiModelId: 'claude-3-5-sonnet-20240620',     label: 'Sonnet 3.5 (Jun 2024)' },
  // Short aliases (Anthropic sometimes accepts these)
  { apiModelId: 'claude-sonnet-4-5',              label: 'Sonnet 4.5 (alias)' },
  { apiModelId: 'claude-sonnet-4-6',              label: 'Sonnet 4.6 (alias)' },
  { apiModelId: 'claude-opus-4-6',                label: 'Opus 4.6 (alias)' },
];

async function discoverClaudeModels(apiKey: string): Promise<ModelEntry[]> {
  console.log(`[ModelDiscovery] Probing ${CLAUDE_CANDIDATES.length} Claude model candidates...`);

  const results: ModelEntry[] = [];

  // Probe in parallel with a concurrency limit
  const probeModel = async (candidate: typeof CLAUDE_CANDIDATES[0]): Promise<boolean> => {
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: candidate.apiModelId,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });

      // 200 = valid model (got a response)
      // 400 = valid model (bad request format, but model recognized)
      // 404 = model doesn't exist
      // 529 = overloaded but model exists
      const valid = resp.status !== 404;
      const bodySnippet = await resp.text().then(t => t.slice(0, 100));
      console.log(`[ModelDiscovery] Claude probe ${candidate.apiModelId}: ${resp.status} ${valid ? 'VALID' : 'NOT FOUND'} ${bodySnippet}`);
      return valid;
    } catch (err) {
      console.warn(`[ModelDiscovery] Claude probe ${candidate.apiModelId} failed:`, err);
      return false;
    }
  };

  // Run probes in batches of 3 to avoid rate limits
  for (let i = 0; i < CLAUDE_CANDIDATES.length; i += 3) {
    const batch = CLAUDE_CANDIDATES.slice(i, i + 3);
    const probes = await Promise.all(batch.map(c => probeModel(c).then(valid => ({ ...c, valid }))));
    for (const p of probes) {
      if (p.valid) {
        // Create a friendly ID from the API model ID
        const friendlyId = p.apiModelId
          .replace(/-\d{8}$/, '')  // strip date suffix
          .replace(/^claude-3-5-/, 'claude-3.5-');  // normalize
        results.push({
          id: friendlyId,
          apiModelId: p.apiModelId,
          label: p.label,
          backend: 'claude',
        });
      }
    }
  }

  // Deduplicate: if both alias and dated version exist, prefer the dated version
  const seen = new Map<string, ModelEntry>();
  for (const m of results) {
    const existing = seen.get(m.id);
    if (!existing || m.apiModelId.length > existing.apiModelId.length) {
      seen.set(m.id, m);
    }
  }

  return [...seen.values()];
}

function getKnownClaudeModels(): ModelEntry[] {
  return [
    { id: 'claude-opus-4',     apiModelId: 'claude-opus-4-20250514',     label: 'Opus 4',              backend: 'claude' },
    { id: 'claude-sonnet-4-5', apiModelId: 'claude-sonnet-4-5-20250514', label: 'Sonnet 4.5',          backend: 'claude' },
    { id: 'claude-haiku-3.5',  apiModelId: 'claude-3-5-haiku-20241022',  label: 'Haiku 3.5 (fastest)', backend: 'claude' },
  ];
}

// ── Main refresh function ───────────────────────────────────────────────────

export interface RefreshResult {
  gemini: { ok: boolean; count: number; error?: string };
  claude: { ok: boolean; count: number; error?: string };
  groq:   { ok: boolean; count: number; error?: string };
  totalModels: number;
}

export async function refreshAIModels(): Promise<RefreshResult> {
  const config = loadConfig();
  const result: RefreshResult = {
    gemini: { ok: false, count: 0 },
    claude: { ok: false, count: 0 },
    groq:   { ok: false, count: 0 },
    totalModels: 0,
  };

  // Preserve non-discovered models (manual entries) and Claude models
  const existingClaude = config.models.filter(m => m.backend === 'claude');

  const newModels: ModelEntry[] = [];

  // ── Gemini ──
  const geminiKey = loadApiKey('gemini');
  if (geminiKey) {
    try {
      const models = await discoverGeminiModels(geminiKey);
      newModels.push(...models);
      result.gemini = { ok: true, count: models.length };
      console.log(`[ModelDiscovery] Gemini: discovered ${models.length} models`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.gemini = { ok: false, count: 0, error: msg };
      console.error(`[ModelDiscovery] Gemini error:`, msg);
      // Keep existing Gemini models on failure
      newModels.push(...config.models.filter(m => m.backend === 'gemini'));
    }
  } else {
    // No key — keep existing
    newModels.push(...config.models.filter(m => m.backend === 'gemini'));
    result.gemini = { ok: false, count: 0, error: 'No API key configured' };
  }

  // ── Claude (probe candidate model IDs) ──
  const claudeKey = loadApiKey('claude');
  if (claudeKey) {
    try {
      const models = await discoverClaudeModels(claudeKey);
      if (models.length > 0) {
        newModels.push(...models);
        result.claude = { ok: true, count: models.length };
        console.log(`[ModelDiscovery] Claude: discovered ${models.length} valid models`);
      } else {
        // Probing found nothing — fall back to existing
        newModels.push(...existingClaude.length > 0 ? existingClaude : getKnownClaudeModels());
        result.claude = { ok: false, count: 0, error: 'No valid models found via probing — kept existing' };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.claude = { ok: false, count: 0, error: msg };
      console.error(`[ModelDiscovery] Claude error:`, msg);
      newModels.push(...existingClaude.length > 0 ? existingClaude : getKnownClaudeModels());
    }
  } else {
    newModels.push(...existingClaude.length > 0 ? existingClaude : getKnownClaudeModels());
    result.claude = { ok: false, count: 0, error: 'No API key configured' };
  }

  // ── Groq ──
  const groqKey = loadApiKey('groq');
  if (groqKey) {
    try {
      const models = await discoverGroqModels(groqKey);
      newModels.push(...models);
      result.groq = { ok: true, count: models.length };
      console.log(`[ModelDiscovery] Groq: discovered ${models.length} models`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.groq = { ok: false, count: 0, error: msg };
      console.error(`[ModelDiscovery] Groq error:`, msg);
      newModels.push(...config.models.filter(m => m.backend === 'groq'));
    }
  } else {
    newModels.push(...config.models.filter(m => m.backend === 'groq'));
    result.groq = { ok: false, count: 0, error: 'No API key configured' };
  }

  // ── Update config ──
  config.models = newModels;
  config.lastRefreshed = new Date().toISOString();

  // Validate defaults still exist
  for (const [backend, defaultId] of Object.entries(config.defaults)) {
    if (!newModels.some(m => m.id === defaultId)) {
      const first = newModels.find(m => m.backend === backend);
      if (first) config.defaults[backend] = first.id;
    }
  }

  result.totalModels = newModels.length;

  saveConfig(config);
  console.log(`[ModelDiscovery] Saved ${newModels.length} models to ai-models.json`);

  return result;
}
