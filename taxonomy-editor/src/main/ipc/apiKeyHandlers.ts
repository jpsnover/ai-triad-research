// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// API-key handlers (t/1689 split of ipcHandlers.ts, ADR-007).
// Secure key storage, validation/probing, masked retrieval, and QR-based key
// sharing. Raw keys never cross the IPC boundary to the renderer. Handler
// bodies moved verbatim; channel names unchanged.

import { ipcMain } from 'electron';
import { storeApiKey, hasApiKey, getApiKeySummary, exportKeysForSharing, importKeysFromSharing, deleteApiKey, deleteAllApiKeys, removeApiKey, getMaskedKeys, loadApiKeys } from '../apiKeyStore.js';
import type { KeySharePayload } from '../apiKeyStore.js';
import { probeApiKey, isSupportedProbeBackend } from '../keyProbe.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';

export function registerApiKeyHandlers(): void {
  ipcMain.handle('set-api-key', (_event, key: string, backend?: string) => {
    storeApiKey(key, backend as 'gemini' | 'claude' | 'groq' | 'openai' | 'deepseek' | undefined);
  });

  ipcMain.handle('validate-api-key', async (_event, key: string, backend: string): Promise<{ valid: boolean; error?: string }> => {
    if (!isSupportedProbeBackend(backend)) return { valid: false, error: `Unsupported backend: ${backend}` };
    try {
      const valid = await probeApiKey(backend, key);
      return valid ? { valid: true } : { valid: false, error: 'Invalid API key' };
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'ipc-handlers', level: 'warn',
        message: 'Key validation request failed',
        data: { backend },
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      return { valid: false, error: 'Could not reach provider — check your network' };
    }
  });

  ipcMain.handle('verify-stored-keys', async (_event, backend: string): Promise<{ results: { index: number; masked: string; valid: boolean; error?: string }[] }> => {
    const keys = loadApiKeys(backend as Parameters<typeof loadApiKeys>[0]);
    const masked = getMaskedKeys(backend as Parameters<typeof getMaskedKeys>[0]);
    if (!isSupportedProbeBackend(backend)) {
      return { results: keys.map((_key, i) => ({ index: i, masked: masked[i] ?? '••••', valid: false, error: `Unsupported backend: ${backend}` })) };
    }
    const results = await Promise.all(keys.map(async (key, i) => {
      try {
        const valid = await probeApiKey(backend, key);
        return { index: i, masked: masked[i] ?? '••••', valid, ...(!valid && { error: 'Invalid API key' }) };
      } catch (err) {
        getGlobalRecorder()?.record({
          type: 'system.error', component: 'ipc-handlers', level: 'warn',
          message: 'Stored key verification failed', data: { backend, index: i },
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
        return { index: i, masked: masked[i] ?? '••••', valid: false, error: 'Could not reach provider — check your network' };
      }
    }));
    return { results };
  });

  ipcMain.handle('has-api-key', (_event, backend?: string) => {
    if (backend === 'ollama') return true;
    return hasApiKey(backend as 'gemini' | 'claude' | 'groq' | 'openai' | 'deepseek' | undefined);
  });

  ipcMain.handle('get-api-key-summary', () => {
    return getApiKeySummary();
  });

  ipcMain.handle('delete-api-key', (_event, backend?: string) => {
    deleteApiKey(backend as Parameters<typeof deleteApiKey>[0]);
  });

  ipcMain.handle('delete-all-api-keys', () => {
    deleteAllApiKeys();
  });

  // Single-key management (t/1425, reversing t/834 round-robin). get-api-keys returns
  // MASKED keys only — raw keys never cross the IPC boundary to the renderer.
  // 'add-api-key' now REPLACES the backend's key (no append); channel name kept so the
  // Settings ticket (t/1427) can repoint/rename the UI at its own pace. Returns 1.
  ipcMain.handle('add-api-key', (_event, key: string, backend?: string) => {
    storeApiKey(key, backend as Parameters<typeof storeApiKey>[1]);
    return 1;
  });

  ipcMain.handle('remove-api-key', (_event, index: number, backend?: string) => {
    removeApiKey(index, backend as Parameters<typeof removeApiKey>[1]);
  });

  ipcMain.handle('get-api-keys', (_event, backend?: string) => {
    return getMaskedKeys(backend as Parameters<typeof getMaskedKeys>[0]);
  });

  ipcMain.handle('export-keys-for-sharing', async (_event, passphrase: string) => {
    const payload = exportKeysForSharing(passphrase);
    const payloadStr = JSON.stringify(payload);
    const QRCode = await import('qrcode');
    const dataUrl = await QRCode.toDataURL(payloadStr, { errorCorrectionLevel: 'M', width: 400 });
    return { dataUrl, payloadText: payloadStr };
  });

  ipcMain.handle('import-keys-from-sharing', (_event, payload: KeySharePayload, passphrase: string) => {
    return importKeysFromSharing(payload, passphrase);
  });
}
