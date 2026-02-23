import { safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.poviewer');
const KEY_PATH = path.join(CONFIG_DIR, 'apikey.enc');
const PLAIN_KEY_PATH = path.join(CONFIG_DIR, 'apikey.txt');

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function storeApiKey(key: string): void {
  ensureConfigDir();

  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(key);
    fs.writeFileSync(KEY_PATH, encrypted);
    // Remove plain file if it exists
    if (fs.existsSync(PLAIN_KEY_PATH)) {
      fs.unlinkSync(PLAIN_KEY_PATH);
    }
  } else {
    // Fallback: plain text with warning logged
    console.warn('[apiKeyStore] safeStorage not available, storing key in plain text');
    fs.writeFileSync(PLAIN_KEY_PATH, key, 'utf-8');
  }
}

export function getApiKey(): string | null {
  if (safeStorage.isEncryptionAvailable() && fs.existsSync(KEY_PATH)) {
    const encrypted = fs.readFileSync(KEY_PATH);
    return safeStorage.decryptString(encrypted);
  }

  if (fs.existsSync(PLAIN_KEY_PATH)) {
    return fs.readFileSync(PLAIN_KEY_PATH, 'utf-8').trim();
  }

  return null;
}

export async function validateApiKey(key: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey: key });
    // Lightweight validation: generate minimal content to verify key
    await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: 'Say "ok"',
      config: { maxOutputTokens: 5 },
    });
    return { valid: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { valid: false, error: message };
  }
}
