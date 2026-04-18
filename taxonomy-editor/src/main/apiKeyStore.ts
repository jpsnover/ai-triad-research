// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

type Backend = 'gemini' | 'claude' | 'groq' | 'tavily';

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
    return null;
  }
}

export function hasApiKey(backend?: Backend): boolean {
  return fs.existsSync(keyFilePath(backend));
}
