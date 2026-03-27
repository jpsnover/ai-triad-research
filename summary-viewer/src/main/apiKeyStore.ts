// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

type Backend = 'gemini' | 'claude' | 'groq';

function keyFilePath(backend?: Backend): string {
  const suffix = backend && backend !== 'gemini' ? `-${backend}` : '';
  return path.join(app.getPath('userData'), `api-key${suffix}.enc`);
}

export function storeApiKey(key: string, backend?: Backend): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption not available on this system');
  }
  const encrypted = safeStorage.encryptString(key);
  fs.writeFileSync(keyFilePath(backend), encrypted);
}

const ENV_VAR_MAP: Record<string, string> = {
  gemini: 'GEMINI_API_KEY',
  claude: 'ANTHROPIC_API_KEY',
  groq: 'GROQ_API_KEY',
};

export function loadApiKey(backend?: Backend): string | null {
  // 1. Encrypted storage (set via Settings dialog)
  const fp = keyFilePath(backend);
  if (fs.existsSync(fp) && safeStorage.isEncryptionAvailable()) {
    try {
      const encrypted = fs.readFileSync(fp);
      const key = safeStorage.decryptString(encrypted);
      if (key) return key;
    } catch { /* fall through */ }
  }

  // 2. Backend-specific env var
  const envVar = ENV_VAR_MAP[backend ?? 'gemini'];
  if (envVar && process.env[envVar]) return process.env[envVar]!;

  // 3. Universal fallback
  if (process.env.AI_API_KEY) return process.env.AI_API_KEY;

  return null;
}

export function hasApiKey(backend?: Backend): boolean {
  return fs.existsSync(keyFilePath(backend));
}
