// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Server configuration — resolves data paths and settings from environment
 * variables and .aitriad.json without any Electron dependency.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { log } from './logger.js';
import { getGlobalRecorder } from '../../../lib/flight-recorder/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Data path resolution ──

interface AiTriadConfig {
  data_root: string;
  sources_root?: string;
  taxonomy_dir: string;
  sources_dir: string;
  summaries_dir: string;
  conflicts_dir: string;
  debates_dir: string;
  queue_file: string;
  version_file: string;
}

// In source: __dirname = .../taxonomy-editor/src/server (3 levels to monorepo root)
// Compiled:  __dirname = .../taxonomy-editor/dist/server (3 levels to monorepo root)
// Container: __dirname = /app/dist/server (only 2 levels to /app which has scripts/)
// Resolve by checking which ancestor has .aitriad.json or scripts/
const PROJECT_ROOT = (() => {
  const hasMarker = (d: string) =>
    fs.existsSync(path.join(d, '.aitriad.json')) || fs.existsSync(path.join(d, 'scripts'));
  for (let i = 2; i <= 6; i++) {
    const candidate = path.resolve(__dirname, '../'.repeat(i));
    if (hasMarker(candidate)) return candidate;
  }
  return path.resolve(__dirname, '../../..');
})();

const DEFAULT_CONFIG: AiTriadConfig = {
  data_root: '.',
  taxonomy_dir: 'taxonomy/Origin',
  sources_dir: 'sources',
  summaries_dir: 'summaries',
  conflicts_dir: 'conflicts',
  debates_dir: 'debates',
  queue_file: '.summarise-queue.json',
  version_file: 'TAXONOMY_VERSION',
};

let _configCache: AiTriadConfig | null = null;

export function loadDataConfig(): AiTriadConfig {
  if (_configCache) return _configCache;

  const configPath = path.join(PROJECT_ROOT, '.aitriad.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const merged = { ...DEFAULT_CONFIG, ...raw };
      _configCache = merged;
      log.server.debug({ configPath }, 'Loaded config');
      return merged;
    }
  } catch { /* telemetry — silent by design;  use defaults */ }

  _configCache = DEFAULT_CONFIG;
  return _configCache;
}

export function getDataRoot(): string {
  const envRoot = process.env.AI_TRIAD_DATA_ROOT;
  if (envRoot) return path.resolve(envRoot);

  const config = loadDataConfig();
  return path.isAbsolute(config.data_root)
    ? config.data_root
    : path.resolve(PROJECT_ROOT, config.data_root);
}

export function resolveDataPath(subPath: string): string {
  const dataRoot = getDataRoot();
  return path.isAbsolute(subPath) ? subPath : path.resolve(dataRoot, subPath);
}

/**
 * Resolve sources root independently from data root.
 * Priority: AI_TRIAD_SOURCES_ROOT env var > .aitriad.json sources_root > null.
 * Returns null when sources are unavailable (web/container mode, or repo not cloned).
 */
export function getSourcesRoot(): string | null {
  const envRoot = process.env.AI_TRIAD_SOURCES_ROOT;
  if (envRoot) {
    const resolved = path.resolve(envRoot);
    // In API mode the backend handles existence — skip local filesystem check
    // eslint-disable-next-line @typescript-eslint/no-use-before-define -- STORAGE_MODE is module-level const, safe at call-time
    return (STORAGE_MODE === 'github-api' || fs.existsSync(resolved)) ? resolved : null;
  }

  const config = loadDataConfig();
  if (config.sources_root) {
    const resolved = path.isAbsolute(config.sources_root)
      ? config.sources_root
      : path.resolve(PROJECT_ROOT, config.sources_root);
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    return (STORAGE_MODE === 'github-api' || fs.existsSync(resolved)) ? resolved : null;
  }

  return null;
}

export function getProjectRoot(): string {
  return PROJECT_ROOT;
}

// ── API key resolution ──

// t/958: derive the key-store backend union from the shared ApiKeyBackend
// (= BackendId | 'tavily') instead of duplicating the literals — so adding a
// backend to BackendId can't silently diverge the server type (the root cause of
// the t/945 build break). ENV_KEY_NAMES below stays Record<AIBackend, string>, so
// tsc flags a missing key-name entry for any newly added backend at compile time.
import type { ApiKeyBackend } from '../../../lib/ai-client/types.js';
export type AIBackend = ApiKeyBackend;

const ENV_KEY_NAMES: Record<AIBackend, string> = {
  gemini: 'GEMINI_API_KEY',
  claude: 'ANTHROPIC_API_KEY',
  groq: 'GROQ_API_KEY',
  openai: 'OPENAI_API_KEY',
  tavily: 'TAVILY_API_KEY',
  ollama: '', // local — no key needed
  deepseek: 'DEEPSEEK_API_KEY',
  azure: 'AZURE_OPENAI_API_KEY', // t/945 build-fix; actual Azure-backend wiring owned elsewhere
};

// Imported after AIBackend is defined (keyStore depends on the type).
import { getKeyStore, type KeyRotationResult } from './keyStore.js';
import { getCurrentUserId } from './userContext.js';

/**
 * Resolve an API key for the given backend.
 * Priority: backend-specific env var → keyStore (local file or Azure KV) → AI_API_KEY fallback.
 *
 * In Azure (AZURE_KEYVAULT_URL set), keys are partitioned per authenticated
 * user via getCurrentUserId(). Locally, a single shared key is used per backend.
 */
export async function getApiKey(backend: AIBackend = 'gemini'): Promise<string | null> {
  const envKey = process.env[ENV_KEY_NAMES[backend]];
  if (envKey) return envKey;

  try {
    // t/835: stored value may be a JSON array of keys — take the first.
    const stored = await getKeyStore(getDataRoot).getKeys(backend, getCurrentUserId());
    if (stored.length > 0) return stored[0];
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'server-config',
      level: 'error',
      message: 'Operation failed',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    log.server.warn({ backend, err }, 'getApiKey failed');
  }

  if (process.env.AI_API_KEY) return process.env.AI_API_KEY;

  return null;
}

/**
 * All API keys for a backend (t/835), in rotation order. Precedence mirrors
 * getApiKey: a configured env key (platform/free, single) wins; otherwise the
 * user's stored BYOK key list; otherwise the AI_API_KEY fallback. Returns [] if
 * none. Used by the key rotator for round-robin selection.
 */
export async function getApiKeys(backend: AIBackend = 'gemini'): Promise<string[]> {
  const envKey = process.env[ENV_KEY_NAMES[backend]];
  if (envKey) return [envKey];

  try {
    const stored = await getKeyStore(getDataRoot).getKeys(backend, getCurrentUserId());
    if (stored.length > 0) return stored;
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'server-config',
      level: 'error',
      message: 'Operation failed',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    log.server.warn({ backend, err }, 'getApiKeys failed');
  }

  if (process.env.AI_API_KEY) return [process.env.AI_API_KEY];
  return [];
}

/** The user's stored BYOK keys for a backend (t/835) — excludes env/platform
 *  keys; for the Settings key-management list. */
export async function getStoredApiKeys(backend: AIBackend = 'gemini'): Promise<string[]> {
  return getKeyStore(getDataRoot).getKeys(backend, getCurrentUserId());
}

/** Append a BYOK key for a backend (t/835); returns the new key list. */
export async function addApiKey(key: string, backend: AIBackend = 'gemini'): Promise<string[]> {
  return getKeyStore(getDataRoot).addKey(backend, getCurrentUserId(), key);
}

/** Remove the BYOK key at `index` for a backend (t/835); returns the new key list. */
export async function removeApiKey(index: number, backend: AIBackend = 'gemini'): Promise<string[]> {
  return getKeyStore(getDataRoot).removeKey(backend, getCurrentUserId(), index);
}

export async function hasApiKey(backend: AIBackend = 'gemini'): Promise<boolean> {
  return (await getApiKey(backend)) !== null;
}

export async function storeApiKey(key: string, backend: AIBackend = 'gemini'): Promise<void> {
  await getKeyStore(getDataRoot).set(backend, getCurrentUserId(), key);
}

/** All user-configurable AI backends — iterated by deleteAllApiKeys(). */
const ALL_AI_BACKENDS: AIBackend[] = ['gemini', 'claude', 'groq', 'openai', 'tavily', 'ollama', 'deepseek'];

export async function deleteApiKey(backend: AIBackend = 'gemini'): Promise<void> {
  await getKeyStore(getDataRoot).delete(backend, getCurrentUserId());
}

export async function deleteAllApiKeys(): Promise<void> {
  const store = getKeyStore(getDataRoot);
  const userId = getCurrentUserId();
  await Promise.all(ALL_AI_BACKENDS.map(b => store.delete(b, userId)));
}

/**
 * Rotate the key store's encryption material and re-encrypt all stored keys
 * (t/809). No-op on Key Vault (platform-managed encryption). Admin-triggered.
 */
export async function rotateApiKeyMaterial(): Promise<KeyRotationResult> {
  return getKeyStore(getDataRoot).rotateKeyMaterial();
}

// ── Storage mode ──

export type StorageMode = 'github-api' | 'filesystem';

/** Select backend: explicit STORAGE_MODE env var, or auto-detect from NODE_ENV. */
export const STORAGE_MODE: StorageMode =
  (process.env.STORAGE_MODE === 'github-api' || process.env.STORAGE_MODE === 'filesystem')
    ? process.env.STORAGE_MODE
    : (process.env.NODE_ENV === 'production' ? 'github-api' : 'filesystem');

export const CACHE_DIR = process.env.TAXONOMY_CACHE_DIR || '/tmp/taxonomy-cache';

// ── Server settings ──

export const PORT = parseInt(process.env.PORT || '7862', 10);

export const EMBED_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'embed_taxonomy.py');
export const SCRIPTS_DIR = path.join(PROJECT_ROOT, 'scripts');
export const BROKER_SCRIPT = path.join(PROJECT_ROOT, 'src', 'main', 'pty-broker.py');
