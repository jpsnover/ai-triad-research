// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { app } from 'electron';

type Backend = 'gemini' | 'claude' | 'groq' | 'openai' | 'deepseek' | 'tavily' | 'ollama';

const ALL_BACKENDS: Backend[] = ['gemini', 'claude', 'groq', 'openai', 'deepseek', 'tavily', 'ollama'];

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

export function loadApiKey(backend?: Backend): string | null {
  const fp = keyFilePath(backend);
  if (!fs.existsSync(fp)) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    const encrypted = fs.readFileSync(fp);
    return safeStorage.decryptString(encrypted);
  } catch {
    /* telemetry — silent by design */
    return null;
  }
}

export function hasApiKey(backend?: Backend): boolean {
  return fs.existsSync(keyFilePath(backend));
}

export interface ApiKeySummaryEntry {
  backend: Backend;
  hasKey: boolean;
  maskedKey: string | null;
}

export function getApiKeySummary(): ApiKeySummaryEntry[] {
  return ALL_BACKENDS.map((backend) => {
    const key = loadApiKey(backend);
    let maskedKey: string | null = null;
    if (key) {
      if (key.length <= 8) {
        maskedKey = key.slice(0, 2) + '***';
      } else {
        maskedKey = key.slice(0, 4) + '...' + key.slice(-4);
      }
    }
    return { backend, hasKey: !!key, maskedKey };
  });
}

export interface KeySharePayload {
  v: 1;
  salt: string;
  iv: string;
  data: string;
  tag: string;
}

export function exportKeysForSharing(passphrase: string): KeySharePayload {
  const keys: Record<string, string> = {};
  for (const b of ALL_BACKENDS) {
    const k = loadApiKey(b);
    if (k) keys[b] = k;
  }
  if (Object.keys(keys).length === 0) {
    throw new Error('No API keys to export — save at least one key first');
  }

  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const derivedKey = crypto.pbkdf2Sync(passphrase, salt, 100_000, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);

  const plaintext = JSON.stringify({ keys });
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');

  return { v: 1, salt: salt.toString('hex'), iv: iv.toString('hex'), data: encrypted, tag };
}

export function importKeysFromSharing(payload: KeySharePayload, passphrase: string): string[] {
  const salt = Buffer.from(payload.salt, 'hex');
  const iv = Buffer.from(payload.iv, 'hex');
  const derivedKey = crypto.pbkdf2Sync(passphrase, salt, 100_000, 32, 'sha256');
  const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
  decipher.setAuthTag(Buffer.from(payload.tag, 'hex'));

  let decrypted = decipher.update(payload.data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  const { keys } = JSON.parse(decrypted) as { keys: Record<string, string> };
  const imported: string[] = [];
  for (const [backend, key] of Object.entries(keys)) {
    storeApiKey(key, backend as Backend);
    imported.push(backend);
  }
  return imported;
}
