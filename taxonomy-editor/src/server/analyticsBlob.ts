// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Azure Append Blob backend for analytics NDJSON storage.
 *
 * Daily files stored as append blobs: `YYYY-MM-DD.ndjson`. Append blobs
 * support efficient concurrent appends without read-modify-write — ideal
 * for analytics event ingestion. Auth via DefaultAzureCredential (managed
 * identity in Azure, az-CLI locally).
 */

import { BlobServiceClient, type ContainerClient, RestError } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import { getGlobalRecorder } from '../../../lib/flight-recorder/index.js';
import type { AnalyticsBackend } from './analytics.js';

export interface AnalyticsBlobOptions {
  accountUrl: string;
  container: string;
  serviceClient?: BlobServiceClient;
}

function isNotFound(err: unknown): boolean {
  return err instanceof RestError
    ? (err.statusCode === 404 || err.code === 'BlobNotFound' || err.code === 'ContainerNotFound')
    : false;
}

function recordError(err: unknown, op: string, level: 'warn' | 'error'): void {
  getGlobalRecorder()?.record({
    type: 'system.error',
    component: 'analytics-blob',
    level,
    message: `analytics blob ${op} failed`,
    error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
  });
}

async function streamToString(readable: NodeJS.ReadableStream | undefined): Promise<string> {
  if (!readable) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array | string));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

export class BlobAnalyticsBackend implements AnalyticsBackend {
  private readonly client: ContainerClient;

  constructor(opts: AnalyticsBlobOptions) {
    const service = opts.serviceClient
      ?? new BlobServiceClient(opts.accountUrl, new DefaultAzureCredential());
    this.client = service.getContainerClient(opts.container);
  }

  async append(date: string, lines: string[]): Promise<void> {
    const blobName = `${date}.ndjson`;
    const appendClient = this.client.getAppendBlobClient(blobName);
    try {
      await appendClient.createIfNotExists({
        blobHTTPHeaders: { blobContentType: 'application/x-ndjson; charset=utf-8' },
      });
      const content = lines.join('\n') + '\n';
      await appendClient.appendBlock(content, Buffer.byteLength(content, 'utf-8'));
    } catch (err) {
      recordError(err, 'append', 'error');
    }
  }

  async readLines(date: string): Promise<string[]> {
    const blobName = `${date}.ndjson`;
    try {
      const resp = await this.client.getBlobClient(blobName).download();
      const text = await streamToString(resp.readableStreamBody);
      return text.split('\n').filter(Boolean);
    } catch (err) {
      if (isNotFound(err)) return [];
      recordError(err, 'readLines', 'error');
      return [];
    }
  }

  async listDates(): Promise<string[]> {
    const dates: string[] = [];
    try {
      for await (const blob of this.client.listBlobsFlat()) {
        const match = blob.name.match(/^(\d{4}-\d{2}-\d{2})\.ndjson$/);
        if (match) dates.push(match[1]);
      }
    } catch (err) {
      recordError(err, 'listDates', 'error');
    }
    return dates;
  }

  async prune(cutoffDate: string): Promise<void> {
    try {
      const dates = await this.listDates();
      for (const date of dates) {
        if (date < cutoffDate) {
          try {
            await this.client.getBlobClient(`${date}.ndjson`).delete();
          } catch (err) {
            if (!isNotFound(err)) recordError(err, 'prune', 'warn');
          }
        }
      }
    } catch (err) {
      recordError(err, 'prune', 'warn');
    }
  }
}
