import fs from 'fs';
import path from 'path';
import { ActionableError } from '../debate/errors.js';
import { getGlobalRecorder } from '../flight-recorder/index.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ModelEntry {
  id: string;
  apiModelId: string;
  label: string;
  backend: string;
}

export interface AIModelsConfig {
  backends: { id: string; label: string }[];
  models: ModelEntry[];
  defaults: Record<string, string>;
  lastRefreshed: string | null;
}

export interface BackendResult {
  ok: boolean;
  count: number;
  error?: string;
}

export interface RefreshResult {
  gemini:   BackendResult;
  claude:   BackendResult;
  groq:     BackendResult;
  openai:   BackendResult;
  deepseek: BackendResult;
  ollama:   BackendResult;
  totalModels: number;
}

export interface ModelDiscoveryDeps {
  loadApiKey: (backend: string) => string | null;
  repoRoot: string;
}

// ── Config I/O ─────────────────────────────────────────────────────────────────

function configPath(repoRoot: string): string {
  return path.join(repoRoot, 'ai-models.json');
}

export function loadModelConfig(repoRoot: string): AIModelsConfig {
  const raw = fs.readFileSync(configPath(repoRoot), 'utf-8');
  return JSON.parse(raw) as AIModelsConfig;
}

export function saveModelConfig(repoRoot: string, config: AIModelsConfig): void {
  fs.writeFileSync(configPath(repoRoot), JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

// ── Gemini: GET /v1beta/models ─────────────────────────────────────────────────

interface GeminiModelInfo {
  name: string;
  displayName: string;
  supportedGenerationMethods: string[];
}

type GeminiTier = 'pro' | 'flash' | 'flash-lite';

function classifyGeminiTier(id: string): GeminiTier | null {
  if (id.includes('-flash-lite')) return 'flash-lite';
  if (id.includes('-flash')) return 'flash';
  if (id.includes('-pro')) return 'pro';
  return null;
}

function extractGeminiVersion(id: string): number {
  const match = id.match(/^gemini-(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
}

const GEMINI_EXCLUDE_RE = /tts|robotics|agent|image|audio|embed|aqa|lyria/i;

export function curateGeminiModels(rawModels: GeminiModelInfo[]): ModelEntry[] {
  const candidates = rawModels
    .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
    .map(m => ({ ...m, id: m.name.replace('models/', '') }))
    .filter(m => /^gemini-\d/.test(m.id))
    .filter(m => !GEMINI_EXCLUDE_RE.test(m.id));

  const byTier = new Map<GeminiTier, { info: (typeof candidates)[0]; version: number }>();

  for (const m of candidates) {
    const tier = classifyGeminiTier(m.id);
    if (!tier) continue;
    const version = extractGeminiVersion(m.id);
    const existing = byTier.get(tier);
    if (!existing || version > existing.version ||
        (version === existing.version && m.id.length < existing.info.id.length)) {
      byTier.set(tier, { info: m, version });
    }
  }

  return [...byTier.values()].map(({ info }) => ({
    id: info.id,
    apiModelId: info.id,
    label: info.displayName || info.id,
    backend: 'gemini',
  }));
}

export async function discoverGeminiModels(apiKey: string): Promise<ModelEntry[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=100`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const body = await resp.text();
    throw new ActionableError({
      goal: 'Discover available Gemini models',
      problem: `Gemini models API returned HTTP ${resp.status}: ${body.slice(0, 200)}`,
      location: 'modelDiscovery.discoverGeminiModels',
      nextSteps: ['Check your API key is valid', 'Verify network connectivity', 'The API may be temporarily unavailable'],
    });
  }
  const json = await resp.json() as { models: GeminiModelInfo[] };
  return curateGeminiModels(json.models);
}

// ── Groq: GET /openai/v1/models ────────────────────────────────────────────────

interface GroqModelInfo {
  id: string;
  owned_by: string;
  active: boolean;
}

export async function discoverGroqModels(apiKey: string): Promise<ModelEntry[]> {
  const resp = await fetch('https://api.groq.com/openai/v1/models', {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new ActionableError({
      goal: 'Discover available Groq models',
      problem: `Groq models API returned HTTP ${resp.status}: ${body.slice(0, 200)}`,
      location: 'modelDiscovery.discoverGroqModels',
      nextSteps: ['Check your API key is valid', 'Verify network connectivity', 'The API may be temporarily unavailable'],
    });
  }
  const json = await resp.json() as { data: GroqModelInfo[] };

  return json.data
    .filter(m => m.active !== false)
    .filter(m => {
      const id = m.id.toLowerCase();
      return !id.includes('whisper') && !id.includes('embed') && !id.includes('guard');
    })
    .map(m => {
      const friendlyId = 'groq-' + m.id
        .replace(/^meta-llama\//, '')
        .replace(/^mistralai\//, '')
        .replace(/-instruct$/, '')
        .replace(/[^a-z0-9.-]/gi, '-')
        .toLowerCase();
      const label = m.id
        .replace(/^meta-llama\//, '')
        .replace(/^mistralai\//, '')
        .replace(/-/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
      return { id: friendlyId, apiModelId: m.id, label, backend: 'groq' };
    });
}

// ── Anthropic: probe candidate model IDs ───────────────────────────────────────

const CLAUDE_CANDIDATES: { apiModelId: string; label: string }[] = [
  { apiModelId: 'claude-opus-4-8',                label: 'Opus 4.8 (alias)' },
  { apiModelId: 'claude-fable-5',                 label: 'Fable 5 (alias)' },
  { apiModelId: 'claude-opus-4-6-20250514',       label: 'Opus 4.6' },
  { apiModelId: 'claude-sonnet-4-6-20250514',     label: 'Sonnet 4.6' },
  { apiModelId: 'claude-sonnet-4-5-20241022',     label: 'Sonnet 4.5 (Oct 2024)' },
  { apiModelId: 'claude-sonnet-4-5-20250514',     label: 'Sonnet 4.5 (May 2025)' },
  { apiModelId: 'claude-opus-4-20250514',         label: 'Opus 4' },
  { apiModelId: 'claude-sonnet-4-20250514',       label: 'Sonnet 4' },
  { apiModelId: 'claude-haiku-4-5-20251001',      label: 'Haiku 4.5' },
  { apiModelId: 'claude-3-5-haiku-20241022',      label: 'Haiku 3.5' },
  { apiModelId: 'claude-3-5-sonnet-20241022',     label: 'Sonnet 3.5 v2 (Oct 2024)' },
  { apiModelId: 'claude-3-5-sonnet-20240620',     label: 'Sonnet 3.5 (Jun 2024)' },
  { apiModelId: 'claude-sonnet-4-5',              label: 'Sonnet 4.5 (alias)' },
  { apiModelId: 'claude-sonnet-4-6',              label: 'Sonnet 4.6 (alias)' },
  { apiModelId: 'claude-opus-4-6',                label: 'Opus 4.6 (alias)' },
];

export async function discoverClaudeModels(apiKey: string): Promise<ModelEntry[]> {
  console.log(`[ModelDiscovery] Probing ${CLAUDE_CANDIDATES.length} Claude model candidates...`);
  const results: ModelEntry[] = [];

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
      const valid = resp.status !== 404;
      const bodySnippet = await resp.text().then(t => t.slice(0, 100));
      console.log(`[ModelDiscovery] Claude probe ${candidate.apiModelId}: ${resp.status} ${valid ? 'VALID' : 'NOT FOUND'} ${bodySnippet}`);
      return valid;
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'model-discovery',
        level: 'error',
        message: 'Claude model probe failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      console.warn(`[ModelDiscovery] Claude probe ${candidate.apiModelId} failed:`, err);
      return false;
    }
  };

  for (let i = 0; i < CLAUDE_CANDIDATES.length; i += 3) {
    const batch = CLAUDE_CANDIDATES.slice(i, i + 3);
    const probes = await Promise.all(batch.map(c => probeModel(c).then(valid => ({ ...c, valid }))));
    for (const p of probes) {
      if (p.valid) {
        const friendlyId = p.apiModelId
          .replace(/-\d{8}$/, '')
          .replace(/^claude-3-5-/, 'claude-3.5-');
        results.push({ id: friendlyId, apiModelId: p.apiModelId, label: p.label, backend: 'claude' });
      }
    }
  }

  const seen = new Map<string, ModelEntry>();
  for (const m of results) {
    const existing = seen.get(m.id);
    if (!existing || m.apiModelId.length > existing.apiModelId.length) {
      seen.set(m.id, m);
    }
  }
  return [...seen.values()];
}

export function getKnownClaudeModels(): ModelEntry[] {
  return [
    { id: 'claude-opus-4',     apiModelId: 'claude-opus-4-20250514',     label: 'Opus 4',              backend: 'claude' },
    { id: 'claude-sonnet-4-5', apiModelId: 'claude-sonnet-4-5-20250514', label: 'Sonnet 4.5',          backend: 'claude' },
    { id: 'claude-haiku-3.5',  apiModelId: 'claude-3-5-haiku-20241022',  label: 'Haiku 3.5 (fastest)', backend: 'claude' },
  ];
}

// ── OpenAI: GET /v1/models ─────────────────────────────────────────────────────

interface OpenAIModelInfo {
  id: string;
  owned_by: string;
}

export async function discoverOpenAIModels(apiKey: string): Promise<ModelEntry[]> {
  const resp = await fetch('https://api.openai.com/v1/models', {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new ActionableError({
      goal: 'Discover available OpenAI models',
      problem: `OpenAI models API returned HTTP ${resp.status}: ${body.slice(0, 200)}`,
      location: 'modelDiscovery.discoverOpenAIModels',
      nextSteps: ['Check your API key is valid', 'Verify network connectivity', 'The API may be temporarily unavailable'],
    });
  }
  const json = await resp.json() as { data: OpenAIModelInfo[] };

  return json.data
    .filter(m => {
      const id = m.id.toLowerCase();
      return id.startsWith('gpt-') || id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4');
    })
    .filter(m => {
      const id = m.id.toLowerCase();
      return !id.includes('realtime') && !id.includes('audio') && !id.includes('transcribe');
    })
    .map(m => {
      const friendlyId = 'openai-' + m.id.toLowerCase();
      const label = m.id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      return { id: friendlyId, apiModelId: m.id, label, backend: 'openai' };
    });
}

// ── DeepSeek: OpenAI-compatible GET /models ────────────────────────────────────

export async function discoverDeepSeekModels(apiKey: string): Promise<ModelEntry[]> {
  const resp = await fetch('https://api.deepseek.com/models', {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new ActionableError({
      goal: 'Discover available DeepSeek models',
      problem: `DeepSeek models API returned HTTP ${resp.status}: ${body.slice(0, 200)}`,
      location: 'modelDiscovery.discoverDeepSeekModels',
      nextSteps: ['Check your API key is valid', 'Verify network connectivity', 'The API may be temporarily unavailable'],
    });
  }
  const json = await resp.json() as { data: { id: string; owned_by: string }[] };

  return (json.data ?? [])
    .filter(m => {
      const id = m.id.toLowerCase();
      return !id.includes('embed') && !id.includes('whisper');
    })
    .map(m => {
      const friendlyId = 'deepseek-' + m.id.replace(/[^a-z0-9.-]/gi, '-').toLowerCase();
      const label = m.id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      return { id: friendlyId, apiModelId: m.id, label, backend: 'deepseek' };
    });
}

// ── Ollama: GET /api/tags ──────────────────────────────────────────────────────

interface OllamaModelInfo {
  name: string;
  model: string;
  size: number;
  details: {
    family: string;
    parameter_size: string;
    quantization_level: string;
  };
}

export async function discoverOllamaModels(): Promise<ModelEntry[]> {
  const resp = await fetch('http://localhost:11434/api/tags', {
    signal: AbortSignal.timeout(5000),
  });
  if (!resp.ok) {
    throw new ActionableError({
      goal: 'Discover available Ollama models',
      problem: `Ollama /api/tags returned HTTP ${resp.status}`,
      location: 'modelDiscovery.discoverOllamaModels',
      nextSteps: ['Verify Ollama is running: ollama serve', 'Check Ollama version'],
    });
  }
  const json = await resp.json() as { models: OllamaModelInfo[] };

  return (json.models ?? []).map(m => {
    const friendlyId = 'ollama-' + m.name
      .replace(/:/g, '-')
      .replace(/[^a-z0-9.-]/gi, '-')
      .toLowerCase();
    const sizeInfo = m.details?.parameter_size ? ` (${m.details.parameter_size})` : '';
    const quantInfo = m.details?.quantization_level ? ` ${m.details.quantization_level}` : '';
    return {
      id: friendlyId,
      apiModelId: m.name,
      label: `${m.name}${sizeInfo}${quantInfo}`,
      backend: 'ollama',
    };
  });
}

// ── Main refresh orchestrator ──────────────────────────────────────────────────

function recordError(err: unknown): void {
  getGlobalRecorder()?.record({
    type: 'system.error',
    component: 'model-discovery',
    level: 'error',
    message: 'Operation failed',
    error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
  });
}

async function discoverBackend(
  backendId: string,
  config: AIModelsConfig,
  deps: ModelDiscoveryDeps,
  existingClaude: ModelEntry[],
): Promise<{ models: ModelEntry[]; result: BackendResult }> {
  if (backendId === 'ollama') {
    try {
      const models = await discoverOllamaModels();
      console.log(`[ModelDiscovery] Ollama: discovered ${models.length} local models`);
      return { models, result: { ok: true, count: models.length } };
    } catch (err) {
      recordError(err);
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[ModelDiscovery] Ollama not available: ${msg}`);
      return {
        models: config.models.filter(m => m.backend === 'ollama'),
        result: { ok: false, count: 0, error: msg },
      };
    }
  }

  const apiKey = deps.loadApiKey(backendId);
  if (!apiKey) {
    const fallback = backendId === 'claude'
      ? (existingClaude.length > 0 ? existingClaude : getKnownClaudeModels())
      : config.models.filter(m => m.backend === backendId);
    return { models: fallback, result: { ok: false, count: 0, error: 'No API key configured' } };
  }

  const discoverers: Record<string, (key: string) => Promise<ModelEntry[]>> = {
    gemini: discoverGeminiModels,
    claude: discoverClaudeModels,
    groq: discoverGroqModels,
    openai: discoverOpenAIModels,
    deepseek: discoverDeepSeekModels,
  };

  const discover = discoverers[backendId];
  if (!discover) {
    return { models: [], result: { ok: false, count: 0, error: `Unknown backend: ${backendId}` } };
  }

  try {
    const models = await discover(apiKey);
    if (backendId === 'claude' && models.length === 0) {
      const fallback = existingClaude.length > 0 ? existingClaude : getKnownClaudeModels();
      return { models: fallback, result: { ok: false, count: 0, error: 'No valid models found via probing — kept existing' } };
    }
    console.log(`[ModelDiscovery] ${backendId}: discovered ${models.length} models`);
    return { models, result: { ok: true, count: models.length } };
  } catch (err) {
    recordError(err);
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ModelDiscovery] ${backendId} error:`, msg);
    const fallback = backendId === 'claude'
      ? (existingClaude.length > 0 ? existingClaude : getKnownClaudeModels())
      : config.models.filter(m => m.backend === backendId);
    return { models: fallback, result: { ok: false, count: 0, error: msg } };
  }
}

const ALL_BACKENDS = ['gemini', 'claude', 'groq', 'openai', 'deepseek', 'ollama'] as const;

export async function refreshAIModels(deps: ModelDiscoveryDeps): Promise<RefreshResult> {
  const config = loadModelConfig(deps.repoRoot);
  const result: RefreshResult = {
    gemini:   { ok: false, count: 0 },
    claude:   { ok: false, count: 0 },
    groq:     { ok: false, count: 0 },
    openai:   { ok: false, count: 0 },
    deepseek: { ok: false, count: 0 },
    ollama:   { ok: false, count: 0 },
    totalModels: 0,
  };

  const existingClaude = config.models.filter(m => m.backend === 'claude');
  const newModels: ModelEntry[] = [];

  for (const backendId of ALL_BACKENDS) {
    const discovery = await discoverBackend(backendId, config, deps, existingClaude);
    newModels.push(...discovery.models);
    result[backendId] = discovery.result;
  }

  config.models = newModels;
  config.lastRefreshed = new Date().toISOString();

  for (const [backend, defaultId] of Object.entries(config.defaults)) {
    if (!newModels.some(m => m.id === defaultId)) {
      const first = newModels.find(m => m.backend === backend);
      if (first) config.defaults[backend] = first.id;
    }
  }

  result.totalModels = newModels.length;
  saveModelConfig(deps.repoRoot, config);
  console.log(`[ModelDiscovery] Saved ${newModels.length} models to ai-models.json`);

  return result;
}
