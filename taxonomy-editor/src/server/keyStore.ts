// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * API-key storage abstraction.
 *
 * - Local mode (default): AES-256-GCM encrypted file on the data volume, one
 *   file per backend — identical behavior to the pre-2026-04 implementation.
 *   Single-user: userId is ignored.
 *
 * - Azure mode (AZURE_KEYVAULT_URL set): one Key Vault secret per (user,
 *   backend). The container app authenticates to the vault via its
 *   system-assigned managed identity. Secret names are deterministic hashes
 *   of the principal so they fit KV's name constraints.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import type { AIBackend } from './config';

export interface KeyStore {
  get(backend: AIBackend, userId: string): Promise<string | null>;
  set(backend: AIBackend, userId: string, key: string): Promise<void>;
}

// ── Local file store (single-user, unchanged behavior) ────────────────────────

class LocalFileKeyStore implements KeyStore {
  constructor(private resolveDataRoot: () => string) {}

  private filePath(backend: AIBackend): string {
    return path.join(this.resolveDataRoot(), `.aitriad-key-${backend}.enc`);
  }

  // S11: Derive key from random material stored on disk instead of hostname.
  private derivedKey(): Buffer {
    const keyFile = path.join(this.resolveDataRoot(), '.aitriad-key-material');
    let material: Buffer;
    if (fs.existsSync(keyFile)) {
      material = fs.readFileSync(keyFile);
      if (material.length < 32) {
        material = crypto.randomBytes(64);
        fs.mkdirSync(path.dirname(keyFile), { recursive: true });
        fs.writeFileSync(keyFile, material, { mode: 0o600 });
      }
    } else {
      material = crypto.randomBytes(64);
      fs.mkdirSync(path.dirname(keyFile), { recursive: true });
      fs.writeFileSync(keyFile, material, { mode: 0o600 });
    }
    return crypto.pbkdf2Sync(material, 'aitriad-server-key-v2', 100_000, 32, 'sha256');
  }

  private legacyDerivedKey(): Buffer {
    return crypto.pbkdf2Sync(
      os.hostname() + 'aitriad-server-key-v1', 'aitriad-server-key-v1', 100_000, 32, 'sha256',
    );
  }

  private decrypt(filepath: string, key: Buffer): string {
    const combined = fs.readFileSync(filepath);
    const iv = combined.subarray(0, 16);
    const tag = combined.subarray(16, 32);
    const encrypted = combined.subarray(32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted) + decipher.final('utf-8');
  }

  async get(backend: AIBackend, _userId: string): Promise<string | null> {
    const p = this.filePath(backend);
    if (!fs.existsSync(p)) return null;
    try {
      return this.decrypt(p, this.derivedKey());
    } catch {
      // Migrate from legacy hostname-based key
      try {
        const value = this.decrypt(p, this.legacyDerivedKey());
        await this.set(backend, _userId, value);
        console.log(`[keyStore/local] Migrated ${backend} key to new key material`);
        return value;
      } catch (err) {
        console.warn(`[keyStore/local] Failed to decrypt ${p} with current and legacy keys:`, err);
        return null;
      }
    }
  }

  async set(backend: AIBackend, _userId: string, key: string): Promise<void> {
    const p = this.filePath(backend);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.derivedKey(), iv);
    const encrypted = Buffer.concat([cipher.update(key, 'utf-8'), cipher.final()]);
    const combined = Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, combined);
  }
}

// ── Azure Key Vault store (per-user) ──────────────────────────────────────────

interface AzureSecretClient {
  getSecret(name: string): Promise<{ value?: string } | null>;
  setSecret(name: string, value: string): Promise<unknown>;
}

class AzureKeyVaultKeyStore implements KeyStore {
  private client: AzureSecretClient;
  private cache = new Map<string, { value: string; expires: number }>();
  private readonly cacheTtlMs = 5 * 60 * 1000;

  constructor(vaultUrl: string) {
    // Lazy require so local installs that skip the Azure packages still build.
    // In Azure, these packages are installed in the container image.
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { SecretClient } = require('@azure/keyvault-secrets');
    const identity = require('@azure/identity');
    /* eslint-enable @typescript-eslint/no-var-requires */
    // Use ManagedIdentityCredential in production to avoid multi-second startup
    // delays from DefaultAzureCredential probing credential types that won't work.
    const credential = process.env.NODE_ENV === 'production'
      ? new identity.ManagedIdentityCredential()
      : new identity.DefaultAzureCredential();
    this.client = new SecretClient(vaultUrl, credential) as AzureSecretClient;
  }

  private secretName(backend: AIBackend, userId: string): string {
    // KV secret names: alphanumeric + hyphens, ≤127 chars. Hash the principal
    // to avoid leaking emails into secret names and to sidestep charset issues.
    const hash = crypto.createHash('sha256').update(userId).digest('hex').slice(0, 32);
    return `apikey-${backend}-${hash}`;
  }

  async get(backend: AIBackend, userId: string): Promise<string | null> {
    const name = this.secretName(backend, userId);
    const hit = this.cache.get(name);
    if (hit && hit.expires > Date.now()) return hit.value;
    try {
      const resp = await this.client.getSecret(name);
      const value = resp?.value ?? null;
      if (value) this.cache.set(name, { value, expires: Date.now() + this.cacheTtlMs });
      return value;
    } catch (err: unknown) {
      const code = (err as { code?: string; statusCode?: number })?.code;
      const status = (err as { statusCode?: number })?.statusCode;
      if (code === 'SecretNotFound' || status === 404) return null;
      console.warn(`[keyStore/kv] getSecret(${name}) failed:`, err);
      return null;
    }
  }

  async set(backend: AIBackend, userId: string, key: string): Promise<void> {
    const name = this.secretName(backend, userId);
    await this.client.setSecret(name, key);
    this.cache.delete(name);
  }
}

// ── Selector ──────────────────────────────────────────────────────────────────

let _store: KeyStore | null = null;

export function getKeyStore(resolveDataRoot: () => string): KeyStore {
  if (_store) return _store;
  const vaultUrl = process.env.AZURE_KEYVAULT_URL;
  if (vaultUrl) {
    console.log(`[keyStore] Using Azure Key Vault: ${vaultUrl}`);
    _store = new AzureKeyVaultKeyStore(vaultUrl);
  } else {
    console.log('[keyStore] Using local encrypted file store');
    _store = new LocalFileKeyStore(resolveDataRoot);
  }
  return _store;
}
