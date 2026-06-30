// @vitest-environment node

/**
 * t/698 — dual-backend routing. User content (chats / debates / community) must
 * route to the user-content backend while taxonomy/conflicts/calibration stay on
 * the taxonomy backend. When no user-content backend is set, it falls back to the
 * taxonomy backend (Electron / github-api rollback).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { StorageBackend } from '../storage/storageBackend.js';
import * as fileIO from '../storage/fileIO.js';
import * as community from '../community/community.js';
import * as userContext from '../security/userContext.js';

class MemoryBackend implements StorageBackend {
  files = new Map<string, string>();
  private norm(p: string) { return p.replace(/\\/g, '/'); }
  async readFile(p: string): Promise<string | null> { return this.files.get(this.norm(p)) ?? null; }
  async writeFile(p: string, c: string): Promise<void> { this.files.set(this.norm(p), c); }
  async listDirectory(d: string): Promise<string[]> {
    const prefix = this.norm(d) + '/';
    const out = new Set<string>();
    for (const k of this.files.keys()) if (k.startsWith(prefix)) out.add(k.slice(prefix.length).split('/')[0]);
    return [...out];
  }
  async deleteFile(p: string): Promise<void> { this.files.delete(this.norm(p)); }
  async fileExists(p: string): Promise<boolean> { return this.files.has(this.norm(p)); }
  async readBinaryFile(): Promise<Buffer | null> { return null; }
  async writeBinaryFile(): Promise<void> { /* stub */ }
  has(substr: string): boolean { return [...this.files.keys()].some(k => k.includes(substr)); }
}

const ctx = { principalName: 'alice', idp: 'github', storageUserId: 'alice', isAnonymous: false };

let dataRoot: string;
let tax: MemoryBackend;
let uc: MemoryBackend;

describe('dual-backend routing (t/698)', () => {
  beforeAll(() => {
    process.env.AI_TRIAD_DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'dual-'));
    dataRoot = process.env.AI_TRIAD_DATA_ROOT;
  });
  afterAll(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
    delete process.env.AI_TRIAD_DATA_ROOT;
  });
  beforeEach(() => {
    tax = new MemoryBackend();
    uc = new MemoryBackend();
    fileIO.setTaxonomyBackend(tax);
    fileIO.setUserContentBackend(uc);
  });

  it('routes debate saves to the user-content backend, not taxonomy', async () => {
    await userContext.runWithUser(ctx, () => fileIO.saveDebateSession({ id: 'd1', title: 'D' }));
    expect(uc.has('debate-d1.json')).toBe(true);
    expect(tax.has('debate-d1.json')).toBe(false);
  });

  it('routes chat saves to the user-content backend', async () => {
    await userContext.runWithUser(ctx, () => fileIO.saveChatSession({ id: 'c1', title: 'C' }));
    expect(uc.has('chat-c1.json')).toBe(true);
    expect(tax.has('chat-c1.json')).toBe(false);
  });

  it('routes taxonomy writes to the taxonomy backend, not user-content', async () => {
    await userContext.runWithUser(ctx, () => fileIO.writeEdgesFile({ edges: [] }));
    expect(tax.has('edges.json')).toBe(true);
    expect(uc.has('edges.json')).toBe(false);
  });

  it('routes community submissions to the user-content backend', async () => {
    await userContext.runWithUser(ctx, () => community.submitToCommunity('chat', { id: 'x', title: 'T' }));
    expect(uc.has('_submissions/sub-')).toBe(true);
    expect(tax.has('_submissions/sub-')).toBe(false);
  });

  it('debate read round-trips through the user-content backend', async () => {
    await userContext.runWithUser(ctx, () => fileIO.saveDebateSession({ id: 'd2', title: 'Two' }));
    const loaded = await userContext.runWithUser(ctx, () => fileIO.loadDebateSession('d2')) as { id: string };
    expect(loaded.id).toBe('d2');
  });

  it('falls back to the taxonomy backend when no user-content backend is set', async () => {
    const single = new MemoryBackend();
    fileIO.setTaxonomyBackend(single);
    fileIO.setUserContentBackend(undefined as unknown as StorageBackend);
    // getUserContentBackend() returns the taxonomy backend when unset.
    expect(fileIO.getUserContentBackend()).toBe(single);
    await userContext.runWithUser(ctx, () => fileIO.saveDebateSession({ id: 'd3', title: 'Three' }));
    expect(single.has('debate-d3.json')).toBe(true);
  });
});
