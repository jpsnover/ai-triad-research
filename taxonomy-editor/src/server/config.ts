// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Server configuration — resolves data paths and settings from environment
 * variables and .aitriad.json without any Electron dependency.
 */

import fs from 'fs';
import path from 'path';

// ── Data path resolution ──

interface AiTriadConfig {
  data_root: string;
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
  const threeUp = path.resolve(__dirname, '../../..');
  if (fs.existsSync(path.join(threeUp, '.aitriad.json')) || fs.existsSync(path.join(threeUp, 'scripts'))) {
    return threeUp;
  }
  const twoUp = path.resolve(__dirname, '../..');
  if (fs.existsSync(path.join(twoUp, '.aitriad.json')) || fs.existsSync(path.join(twoUp, 'scripts'))) {
    return twoUp;
  }
  return threeUp; // fallback
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
      console.log(`[config] Loaded config from ${configPath}`);
      return merged;
    }
  } catch { /* use defaults */ }

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

export function getProjectRoot(): string {
  return PROJECT_ROOT;
}

// ── API key resolution ──

export type AIBackend = 'gemini' | 'claude' | 'groq';

const ENV_KEY_NAMES: Record<AIBackend, string> = {
  gemini: 'GEMINI_API_KEY',
  claude: 'ANTHROPIC_API_KEY',
  groq: 'GROQ_API_KEY',
};

/**
 * Resolve an API key for the given backend.
 * Priority: backend-specific env var → encrypted store file → AI_API_KEY fallback.
 */
export function getApiKey(backend: AIBackend = 'gemini'): string | null {
  // 1. Backend-specific env var
  const envKey = process.env[ENV_KEY_NAMES[backend]];
  if (envKey) return envKey;

  // 2. Encrypted key store (file-based, in data volume)
  try {
    const keyFile = path.join(getDataRoot(), `.aitriad-key-${backend}.enc`);
    if (fs.existsSync(keyFile)) {
      return decryptKeyFile(keyFile);
    }
  } catch { /* fall through */ }

  // 3. Universal fallback
  if (process.env.AI_API_KEY) return process.env.AI_API_KEY;

  return null;
}

export function hasApiKey(backend: AIBackend = 'gemini'): boolean {
  return getApiKey(backend) !== null;
}

export function storeApiKey(key: string, backend: AIBackend = 'gemini'): void {
  const keyFile = path.join(getDataRoot(), `.aitriad-key-${backend}.enc`);
  encryptKeyFile(keyFile, key);
}

// ── Simple file-based key encryption ──
// Uses AES-256-GCM with a machine-derived key. Not as strong as Electron
// safeStorage (OS keychain), but keeps keys encrypted at rest.

import crypto from 'crypto';

function getDerivedKey(): Buffer {
  // Derive from a stable machine identifier. In Docker, the container ID
  // is stable for the lifetime of the volume mount.
  const hostname = require('os').hostname();
  const salt = 'aitriad-server-key-v1';
  return crypto.pbkdf2Sync(hostname + salt, salt, 100_000, 32, 'sha256');
}

function encryptKeyFile(filePath: string, plaintext: string): void {
  const key = getDerivedKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv (16) + tag (16) + ciphertext
  const combined = Buffer.concat([iv, tag, encrypted]);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, combined);
}

function decryptKeyFile(filePath: string): string {
  const combined = fs.readFileSync(filePath);
  const iv = combined.subarray(0, 16);
  const tag = combined.subarray(16, 32);
  const encrypted = combined.subarray(32);
  const key = getDerivedKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf-8');
}

// ── Server settings ──

export const PORT = parseInt(process.env.PORT || '7862', 10);

export const EMBED_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'embed_taxonomy.py');
export const SCRIPTS_DIR = path.join(PROJECT_ROOT, 'scripts');
export const BROKER_SCRIPT = path.join(PROJECT_ROOT, 'src', 'main', 'pty-broker.py');
