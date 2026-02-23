import { safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

function keyFilePath(): string {
  return path.join(app.getPath('userData'), 'api-key.enc');
}

export function storeApiKey(key: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption not available on this system');
  }
  const encrypted = safeStorage.encryptString(key);
  fs.writeFileSync(keyFilePath(), encrypted);
}

export function loadApiKey(): string | null {
  const fp = keyFilePath();
  if (!fs.existsSync(fp)) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    const encrypted = fs.readFileSync(fp);
    return safeStorage.decryptString(encrypted);
  } catch {
    return null;
  }
}

export function hasApiKey(): boolean {
  return fs.existsSync(keyFilePath());
}
