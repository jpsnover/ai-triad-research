// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * AzureBlobBackend — StorageBackend over Azure Blob Storage (t/697).
 *
 * Replaces the GitHub-API / filesystem backends for the Azure Blob storage
 * migration (epic t/695). Two containers:
 *   - community     ← paths under `community/` (shared, admin-curated)
 *   - user-content  ← everything else (taxonomy, debates, calibration, …)
 *
 * Blob names are the data-root-relative path (forward-slash normalized), e.g.
 * `taxonomy/Origin/nodes.json` or `community/_submissions/sub-x.json` — the same
 * relative layout the other backends use, so the container is the only routing
 * decision. Blob Storage has no directories (virtual dirs via `/` delimiter) and
 * no branches, so `opts.ref` is ignored.
 *
 * Auth: DefaultAzureCredential (Managed Identity in Azure, az-CLI locally). No
 * connection strings. Tests inject a shared-key client via `opts.serviceClient`.
 */

import path from 'path';
import { BlobServiceClient, type ContainerClient, RestError } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import { getDataRoot } from './config.js';
import type { StorageBackend } from './storageBackend.js';
import { ActionableError } from '../../../lib/debate/errors.js';

export interface AzureBlobBackendOptions {
  /** e.g. https://<account>.blob.core.windows.net — from AZURE_STORAGE_ACCOUNT_URL. */
  accountUrl: string;
  /** Container for general user content (default routing target). */
  userContentContainer: string;
  /** Container for shared `community/` data. */
  communityContainer: string;
  /**
   * Test seam: inject a pre-built BlobServiceClient (e.g. an Azurite shared-key
   * client). Production omits this → a client is built from accountUrl +
   * DefaultAzureCredential.
   */
  serviceClient?: BlobServiceClient;
}

async function streamToBuffer(readable: NodeJS.ReadableStream | undefined): Promise<Buffer> {
  if (!readable) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  for await (const chunk of readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array | string));
  }
  return Buffer.concat(chunks);
}

/** Treat BlobNotFound / 404 as a missing file rather than an error. */
function isNotFound(err: unknown): boolean {
  return err instanceof RestError
    ? (err.statusCode === 404 || err.code === 'BlobNotFound')
    : false;
}

/** Wrap a raw Blob SDK error in an ActionableError (never includes credentials —
 *  auth is via the credential object, not the message). */
function wrapBlobError(err: unknown, op: string, blob: string): ActionableError {
  return new ActionableError({
    goal: `Azure Blob ${op}`,
    problem: `Blob operation "${op}" failed for "${blob}": ${(err as Error)?.message ?? String(err)}`,
    location: `AzureBlobBackend.${op}`,
    nextSteps: [
      'Verify the storage account is reachable and the managed identity has data-plane access',
      'Check Azure Blob service health and retry; the operation is idempotent',
    ],
  });
}

export class AzureBlobBackend implements StorageBackend {
  private readonly userContentClient: ContainerClient;
  private readonly communityClient: ContainerClient;

  constructor(opts: AzureBlobBackendOptions) {
    const service = opts.serviceClient
      ?? new BlobServiceClient(opts.accountUrl, new DefaultAzureCredential());
    this.userContentClient = service.getContainerClient(opts.userContentContainer);
    this.communityClient = service.getContainerClient(opts.communityContainer);
  }

  /** Convert an absolute or relative path to a forward-slash, data-root-relative blob name. */
  private toBlobPath(filePath: string): string {
    let p = filePath.replace(/\\/g, '/');
    const root = getDataRoot().replace(/\\/g, '/');
    if (p === root) p = '';
    else if (p.startsWith(root + '/')) p = p.slice(root.length + 1);
    p = p.replace(/^\/+/, '');
    if (p === '') return '';
    // Normalize BEFORE the traversal check so sequences that resolve to an
    // escape (e.g. "a/../../b" → "../b") are caught, not just literal ".." segments.
    const normalized = path.posix.normalize(p).replace(/\/+$/, '');
    if (
      normalized === '..' || normalized.startsWith('../') ||
      normalized === '.git' || normalized.startsWith('.git/')
    ) {
      throw new ActionableError({
        goal: 'Resolve blob path',
        problem: `Rejected unsafe path: "${filePath}"`,
        location: 'AzureBlobBackend.toBlobPath',
        nextSteps: ['Use a clean path within the data root'],
      });
    }
    return normalized;
  }

  /** Route to the community container for `community/…`, else user-content. */
  private containerFor(blobPath: string): ContainerClient {
    return blobPath === 'community' || blobPath.startsWith('community/')
      ? this.communityClient
      : this.userContentClient;
  }

  async readFile(filePath: string, _opts?: { ref?: string }): Promise<string | null> {
    return (await this.readBinaryFile(filePath))?.toString('utf-8') ?? null;
  }

  async readBinaryFile(filePath: string): Promise<Buffer | null> {
    const blob = this.toBlobPath(filePath);
    try {
      const resp = await this.containerFor(blob).getBlobClient(blob).download();
      return await streamToBuffer(resp.readableStreamBody);
    } catch (err) {
      if (isNotFound(err)) return null;
      throw wrapBlobError(err, 'readFile', blob);
    }
  }

  async writeFile(filePath: string, content: string, _opts?: { ref?: string }): Promise<void> {
    const blob = this.toBlobPath(filePath);
    const data = Buffer.from(content, 'utf-8');
    try {
      // upload() overwrites an existing blob. No mkdir needed (virtual dirs).
      await this.containerFor(blob).getBlockBlobClient(blob).upload(data, data.byteLength, {
        blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8' },
      });
    } catch (err) {
      throw wrapBlobError(err, 'writeFile', blob);
    }
  }

  async deleteFile(filePath: string): Promise<void> {
    const blob = this.toBlobPath(filePath);
    try {
      await this.containerFor(blob).getBlobClient(blob).delete();
    } catch (err) {
      if (isNotFound(err)) return; // no-op on missing
      throw wrapBlobError(err, 'deleteFile', blob);
    }
  }

  async fileExists(filePath: string): Promise<boolean> {
    const blob = this.toBlobPath(filePath);
    try {
      return await this.containerFor(blob).getBlobClient(blob).exists();
    } catch (err) {
      throw wrapBlobError(err, 'fileExists', blob);
    }
  }

  async listDirectory(dirPath: string, _opts?: { ref?: string }): Promise<string[]> {
    const dir = this.toBlobPath(dirPath);
    const prefix = dir === '' ? '' : dir + '/';
    const names = new Set<string>();
    try {
      const iter = this.containerFor(prefix || dir).listBlobsByHierarchy('/', { prefix });
      for await (const item of iter) {
        // Blobs: item.name = "<prefix><file>". Virtual dirs: item.name = "<prefix><sub>/".
        const seg = item.name.slice(prefix.length).replace(/\/$/, '');
        if (seg) names.add(seg);
      }
    } catch (err) {
      throw wrapBlobError(err, 'listDirectory', dir);
    }
    return [...names];
  }
}
