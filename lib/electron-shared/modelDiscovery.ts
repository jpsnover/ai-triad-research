import fs from 'fs';
import path from 'path';
import { ActionableError } from '../debate/errors.js';
import { getGlobalRecorder } from '../flight-recorder/index.js';
import { findDanglingRefs, findChainlessDefaults, KNOWN_VERBATIM, CHAIN_EXEMPT_BACKENDS } from '../ai-config/validate.js';

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
  // Runtime-affecting model-id reference surfaces. Previously omitted from this
  // type — they survived only by JSON round-trip through load/saveModelConfig.
  // Made type-visible (t/2039) so the refresh repair pass + guard can operate on
  // them. `debateTiers` carries a leading "_comment" string key alongside the
  // per-tier backend maps.
  debateTiers?: Record<string, string | Record<string, string>>;
  fallbackChains?: Record<string, string[]>;
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
  // t/2039 validate-before-write guard outcome (consumed by the Settings panel,
  // t/2041). `written` is false iff the guard REFUSED to persist because the
  // repaired registry would still be invalid — in that case ai-models.json is
  // left byte-untouched. `configWarning` is present iff there is something to
  // report: the refusal reason when !written, or a non-fatal note when repairs
  // were applied on the successful-write path.
  written: boolean;
  configWarning?: string;
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
    written: false,
  };

  const existingClaude = config.models.filter(m => m.backend === 'claude');
  const newModels: ModelEntry[] = [];

  for (const backendId of ALL_BACKENDS) {
    const discovery = await discoverBackend(backendId, config, deps, existingClaude);
    newModels.push(...discovery.models);
    result[backendId] = discovery.result;
  }

  // Merge, not replace (t/1711): only the backends probed this run are regenerated.
  // Backends we did NOT probe (zai, azure, any manually-curated entry) must survive
  // untouched, along with their defaults/debateTiers/fallbackChains references. A bare
  // `config.models = newModels` silently deleted every non-probed backend — the Z.AI
  // outage root cause (dropped zai models[] left defaults.zai -> zai-glm-5-2 dangling
  // -> getApiModelId returns it verbatim -> Z.AI HTTP 1211 -> all opening statements fail).
  const probed = new Set<string>(ALL_BACKENDS);
  const preserved = config.models.filter(m => !probed.has(m.backend));
  config.models = [...preserved, ...newModels];
  // ── Repair pass (t/2039) ──────────────────────────────────────────────────────
  // Extend the merge repair from defaults-only to ALL runtime model-id reference
  // surfaces, on the merged in-memory config, BEFORE the validate-before-write guard.
  const resolves = (id: string): boolean =>
    config.models.some(m => m.id === id) || KNOWN_VERBATIM.has(id);
  const repairs: string[] = [];

  // 1. fallbackChains VALUES: prune failover targets that no longer resolve. A dead
  //    target is already a no-op, so pruning is strictly a repair (KNOWN_VERBATIM kept).
  if (config.fallbackChains) {
    for (const [key, chain] of Object.entries(config.fallbackChains)) {
      const kept = chain.filter(resolves);
      if (kept.length !== chain.length) {
        config.fallbackChains[key] = kept;
        repairs.push(`pruned ${chain.length - kept.length} dangling fallbackChains["${key}"] target(s)`);
      }
    }
  }

  // 2. defaults: repoint a dangling default to a surviving same-backend model that
  //    ITSELF has a non-empty chain (chain-exempt backend → any surviving same-backend
  //    model). Never silently repoint to a chain-less model — that just relocates the
  //    invariant break; the guard below refuses instead. Checked against the full merged
  //    set so a surviving non-probed backend's default is never falsely rewritten.
  for (const [backend, defaultId] of Object.entries(config.defaults)) {
    if (resolves(defaultId)) continue;
    const candidates = config.models.filter(m => m.backend === backend);
    const pick = CHAIN_EXEMPT_BACKENDS.has(backend)
      ? candidates[0]
      : candidates.find(m => (config.fallbackChains?.[m.id]?.length ?? 0) > 0);
    if (pick) {
      config.defaults[backend] = pick.id;
      repairs.push(`repointed dangling default["${backend}"] -> ${pick.id}`);
    }
    // else: leave dangling — the guard refuses the write below.
  }

  // 3. debateTiers VALUES: repoint a dangling {tier}.{backend} to the repaired backend
  //    default if it resolves, else drop that entry. Skip the "_comment" string key.
  if (config.debateTiers) {
    for (const [tier, tierValue] of Object.entries(config.debateTiers)) {
      // `tierValue === null` guard: typeof null === 'object' (t/2039#3 null-tier nit).
      if (tier === '_comment' || tierValue === null || typeof tierValue !== 'object') continue;
      for (const [backend, modelId] of Object.entries(tierValue)) {
        if (resolves(modelId)) continue;
        const repaired = config.defaults[backend];
        if (repaired && resolves(repaired)) {
          tierValue[backend] = repaired;
          repairs.push(`repointed dangling debateTiers.${tier}.${backend} -> ${repaired}`);
        } else {
          delete tierValue[backend];
          repairs.push(`dropped dangling debateTiers.${tier}.${backend}`);
        }
      }
    }
  }

  result.totalModels = config.models.length;

  // ── Validate-before-write guard (t/2039) ───────────────────────────────────────
  // Run the invariants IN-PROCESS on the repaired registry (TL t/2038#1: the pure
  // invariant fns, NOT a shell-out to the 6-gate verify:config runner). If anything
  // still dangles or a live non-exempt default is chain-less, REFUSE to write — leave
  // ai-models.json byte-untouched and report why. Never persist a known-invalid
  // registry (the t/2038 corruption class). Per-backend results above are already
  // populated (discovery ran) so a refuse still reports "discovered, not saved".
  const dangling = findDanglingRefs(config);
  const chainless = findChainlessDefaults(config);
  if (dangling.length > 0 || chainless.length > 0) {
    const reasons: string[] = [];
    if (dangling.length > 0) reasons.push(`dangling refs: ${dangling.join(', ')}`);
    if (chainless.length > 0) reasons.push(chainless.join('; '));
    result.written = false;
    result.configWarning =
      `Refused to write ai-models.json — the refreshed registry is invalid (${reasons.join(' | ')}). The existing file is unchanged.`;
    console.warn(`[ModelDiscovery] REFUSED write: ${result.configWarning}`);
    // t/2039#3: a refused write is a t/2038 corruption-class event — surface it in the
    // flight recorder too (beyond console + the RefreshResult field) so a diagnostics
    // dump captures which refs would have broken. Lists only ids/backends, no secrets.
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'model-discovery-refresh',
      level: 'warn',
      message: result.configWarning,
      data: { dangling, chainless },
    });
    return result;
  }

  // Clean (or fully repaired): persist. Bump lastRefreshed only on the write path so a
  // refused refresh leaves the on-disk timestamp untouched too.
  config.lastRefreshed = new Date().toISOString();
  saveModelConfig(deps.repoRoot, config);
  result.written = true;
  if (repairs.length > 0) {
    result.configWarning = `Refresh repaired config before writing: ${repairs.join('; ')}.`;
  }
  console.log(`[ModelDiscovery] Saved ${newModels.length} models to ai-models.json`);

  return result;
}
