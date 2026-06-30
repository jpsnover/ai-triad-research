// @vitest-environment node

/**
 * t/720 — domain-level security fixes:
 * L4: harvestAddVerdict validates conflictId (path-traversal guard).
 * L7: community submissions have a global pending-queue cap.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import dns from 'dns';
import type { StorageBackend } from '../storage/storageBackend.js';
import * as fileIO from '../storage/fileIO.js';
import * as community from '../community/community.js';
import * as userContext from '../security/userContext.js';
import { resolveDataPath } from '../config.js';

class MemBackend implements StorageBackend {
  files = new Map<string, string>();
  private norm(p: string) { return p.replace(/\\/g, '/'); }
  async readFile(p: string): Promise<string | null> { return this.files.get(this.norm(p)) ?? null; }
  async writeFile(p: string, content: string): Promise<void> { this.files.set(this.norm(p), content); }
  async listDirectory(dirPath: string): Promise<string[]> {
    const d = this.norm(dirPath).replace(/\/$/, '') + '/';
    const names = new Set<string>();
    for (const k of this.files.keys()) if (k.startsWith(d)) names.add(k.slice(d.length).split('/')[0]);
    return [...names];
  }
  async deleteFile(p: string): Promise<void> { this.files.delete(this.norm(p)); }
  async fileExists(p: string): Promise<boolean> { return this.files.has(this.norm(p)); }
  async readBinaryFile(): Promise<Buffer | null> { return null; }
  async writeBinaryFile(): Promise<void> { /* stub */ }
}

const authedCtx = { principalName: 'alice', idp: 'github', storageUserId: 'alice', isAnonymous: false };
let dataRoot: string;
let mem: MemBackend;

describe('t/720 server security fixes', () => {
  beforeAll(() => {
    process.env.AI_TRIAD_DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 't720-'));
    dataRoot = process.env.AI_TRIAD_DATA_ROOT;
  });
  afterAll(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
    delete process.env.AI_TRIAD_DATA_ROOT;
  });
  beforeEach(() => {
    mem = new MemBackend();
    fileIO.setBackend(mem);
  });

  describe('L4: harvestAddVerdict validates conflictId', () => {
    it('rejects a path-traversal conflictId with a 400', async () => {
      await expect(
        userContext.runWithUser(authedCtx, () => fileIO.harvestAddVerdict('../../etc/evil', {})),
      ).rejects.toMatchObject({ statusCode: 400 });
    });
    it('accepts a safe conflictId (no file → false, no throw)', async () => {
      const ok = await userContext.runWithUser(authedCtx, () => fileIO.harvestAddVerdict('conflict-123', {}));
      expect(ok).toBe(false);
    });
  });

  describe('L7: global pending-submission cap', () => {
    it('rejects a submission when the global pending queue is full', async () => {
      // Seed 500 pending submissions from *other* users so the per-user cap (20)
      // isn't what trips — the submitting user (alice) has none pending.
      const subsDir = resolveDataPath('community/_submissions');
      for (let i = 0; i < 500; i++) {
        mem.files.set(
          `${subsDir.replace(/\\/g, '/')}/sub-${i}.json`,
          JSON.stringify({ id: `${i}`, type: 'chat', status: 'pending', submittedBy: `user-${i}`, submittedAt: '2026-01-01T00:00:00Z' }),
        );
      }
      await expect(
        userContext.runWithUser(authedCtx, () => community.submitToCommunity('chat', { id: 'chat-x' })),
      ).rejects.toMatchObject({ statusCode: 503 });
    });

    it('allows a submission when the queue is below the cap', async () => {
      const { submissionId } = await userContext.runWithUser(authedCtx, () =>
        community.submitToCommunity('chat', { id: 'chat-y' }));
      expect(submissionId).toBeTruthy();
    });
  });
});

describe('L5: SSRF / DNS-rebinding guard', () => {
  afterEach(() => vi.restoreAllMocks());

  describe('isBlockedAddress classifies resolved IPs', () => {
    it('blocks private/internal IPv4', () => {
      for (const ip of ['10.0.0.1', '172.16.5.5', '192.168.1.1', '127.0.0.1',
        '169.254.169.254', '100.64.0.1', '0.0.0.0']) {
        expect(fileIO.isBlockedAddress(ip)).toBe(true);
      }
    });
    it('allows public IPv4', () => {
      for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34']) {
        expect(fileIO.isBlockedAddress(ip)).toBe(false);
      }
    });
    it('blocks private/internal IPv6 (incl. IPv4-mapped + zone id)', () => {
      for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1',
        'fe80::1%eth0', '::ffff:127.0.0.1']) {
        expect(fileIO.isBlockedAddress(ip)).toBe(true);
      }
    });
    it('allows public IPv6', () => {
      for (const ip of ['2606:4700:4700::1111', '2001:4860:4860::8888']) {
        expect(fileIO.isBlockedAddress(ip)).toBe(false);
      }
    });
  });

  it('rejects a public hostname that resolves to a private IP (rebinding)', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue(
      [{ address: '127.0.0.1', family: 4 }] as never,
    );
    const res = await fileIO.fetchUrlContent('https://totally-public.example.com/page');
    expect(res.content).toBe('');
    expect(res.error).toMatch(/private\/internal/);
  });

  it('still rejects non-HTTPS and credentialed URLs before any DNS lookup', async () => {
    const lookup = vi.spyOn(dns.promises, 'lookup');
    const http = await fileIO.fetchUrlContent('http://example.com');
    expect(http.error).toMatch(/HTTPS/);
    const creds = await fileIO.fetchUrlContent('https://user:pass@example.com');
    expect(creds.error).toMatch(/credentials/);
    expect(lookup).not.toHaveBeenCalled();
  });
});
