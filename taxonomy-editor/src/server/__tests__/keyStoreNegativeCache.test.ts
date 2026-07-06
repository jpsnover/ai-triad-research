// @vitest-environment node

/**
 * t/1340 — Key Vault negative cache: SecretNotFound results are cached,
 * write-path invalidation ensures a just-registered key is returned
 * immediately (not masked by stale negative cache).
 *
 * Since AzureKeyVaultKeyStore is not exported, we drive the behavior through
 * getKeyStore() with AZURE_KEYVAULT_URL set, mocking the Azure SDK.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockGetSecret = vi.fn();
const mockSetSecret = vi.fn();
const mockBeginDeleteSecret = vi.fn();

vi.mock('@azure/keyvault-secrets', () => {
  class MockSecretClient {
    constructor() {}
    getSecret(...args: unknown[]) { return mockGetSecret(...args); }
    setSecret(...args: unknown[]) { return mockSetSecret(...args); }
    beginDeleteSecret(...args: unknown[]) { return mockBeginDeleteSecret(...args); }
  }
  return { SecretClient: MockSecretClient };
});

vi.mock('@azure/identity', () => ({
  DefaultAzureCredential: class {},
  ManagedIdentityCredential: class {},
}));

vi.mock('../../../../lib/flight-recorder/index.js', () => ({
  getGlobalRecorder: () => ({ record: vi.fn() }),
}));

const USER = 'test-user@example.com';
const BACKEND = 'gemini' as const;

function notFoundError(variant: 'code' | 'status' = 'code'): Error {
  const err = new Error('SecretNotFound');
  if (variant === 'code') Object.assign(err, { code: 'SecretNotFound', statusCode: 404 });
  else Object.assign(err, { statusCode: 404 });
  return err;
}

describe('Key Vault negative cache (t/1340)', () => {
  let getKeyStore: typeof import('../security/keyStore.js').getKeyStore;

  beforeEach(async () => {
    vi.resetModules();
    mockGetSecret.mockReset();
    mockSetSecret.mockReset();
    mockBeginDeleteSecret.mockReset();
    process.env.AZURE_KEYVAULT_URL = 'https://test-vault.vault.azure.net';
    const mod = await import('../security/keyStore.js');
    getKeyStore = mod.getKeyStore;
  });

  afterEach(() => {
    delete process.env.AZURE_KEYVAULT_URL;
  });

  it('caches SecretNotFound — second get does not call Key Vault again', async () => {
    mockGetSecret.mockRejectedValue(notFoundError());
    const store = getKeyStore(() => '/tmp');

    expect(await store.get(BACKEND, USER)).toBeNull();
    expect(await store.get(BACKEND, USER)).toBeNull();
    expect(mockGetSecret).toHaveBeenCalledTimes(1);
  });

  it('caches 404 status code variant', async () => {
    mockGetSecret.mockRejectedValue(notFoundError('status'));
    const store = getKeyStore(() => '/tmp');

    expect(await store.get(BACKEND, USER)).toBeNull();
    expect(await store.get(BACKEND, USER)).toBeNull();
    expect(mockGetSecret).toHaveBeenCalledTimes(1);
  });

  it('register-after-negative-cache returns the key immediately', async () => {
    mockGetSecret.mockRejectedValueOnce(notFoundError());
    mockSetSecret.mockResolvedValue({});
    mockGetSecret.mockResolvedValue({ value: 'real-key-value' });

    const store = getKeyStore(() => '/tmp');

    expect(await store.get(BACKEND, USER)).toBeNull();
    expect(mockGetSecret).toHaveBeenCalledTimes(1);

    await store.set(BACKEND, USER, 'real-key-value');

    const result = await store.get(BACKEND, USER);
    expect(result).toBe('real-key-value');
    expect(mockGetSecret).toHaveBeenCalledTimes(2);
  });

  it('addKey after negative cache also invalidates', async () => {
    mockGetSecret.mockRejectedValueOnce(notFoundError());
    mockSetSecret.mockResolvedValue({});
    mockGetSecret.mockResolvedValue({ value: JSON.stringify(['key-1']) });

    const store = getKeyStore(() => '/tmp');

    expect(await store.get(BACKEND, USER)).toBeNull();
    await store.addKey(BACKEND, USER, 'key-1');

    const result = await store.get(BACKEND, USER);
    expect(result).toBe(JSON.stringify(['key-1']));
  });

  it('unexpected errors are NOT negatively cached', async () => {
    mockGetSecret.mockRejectedValue(new Error('ECONNREFUSED'));
    const store = getKeyStore(() => '/tmp');

    expect(await store.get(BACKEND, USER)).toBeNull();
    expect(await store.get(BACKEND, USER)).toBeNull();
    expect(mockGetSecret).toHaveBeenCalledTimes(2);
  });

  it('delete also invalidates negative cache', async () => {
    mockGetSecret.mockRejectedValueOnce(notFoundError());
    mockBeginDeleteSecret.mockRejectedValue(notFoundError());
    mockGetSecret.mockResolvedValue({ value: 'new-key' });

    const store = getKeyStore(() => '/tmp');

    expect(await store.get(BACKEND, USER)).toBeNull();
    await store.delete(BACKEND, USER);

    const result = await store.get(BACKEND, USER);
    expect(result).toBe('new-key');
    expect(mockGetSecret).toHaveBeenCalledTimes(2);
  });
});
