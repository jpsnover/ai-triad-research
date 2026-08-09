// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node

// t/2368 IDOR regression: community.loadCommunityItem('debates', id) reads ONLY
// from communityDebatesDir() (community/debates/debate-{id}.json). It can never
// reach user-scoped blob paths, so a private debate ID absent from the community
// store yields null — not the user's debate blob.

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
}

const userCtx = { principalName: 'alice', idp: 'github', storageUserId: 'alice', isAnonymous: false };
let dataRoot: string;
let tax: MemoryBackend;
let uc: MemoryBackend;

describe('t/2368 — /api/community/debates/:id IDOR guard', () => {
  beforeAll(() => {
    process.env.AI_TRIAD_DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'idor-test-'));
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

  it('a debate planted in user-scoped storage is NOT visible through the community endpoint', async () => {
    // Plant a real debate in the user-content backend (same path loadDebateSession uses).
    // The community endpoint calls loadCommunityItem which reads only from
    // communityDebatesDir() — a structurally disjoint path. The blob exists but the
    // community endpoint cannot see it → null → {found:false}@200.
    await userContext.runWithUser(userCtx, () =>
      fileIO.saveDebateSession({ id: 'idor-planted', title: 'Private Debate', phase: 'complete' }, 'test'),
    );
    // Confirm the debate IS in user storage (positive control — proves the plant worked).
    const userLoaded = await userContext.runWithUser(userCtx, () => fileIO.loadDebateSession('idor-planted'));
    expect(userLoaded).toBeTruthy();
    // Now assert the community endpoint cannot reach it.
    const communityResult = await community.loadCommunityItem('debates', 'idor-planted');
    expect(communityResult).toBeNull();
  });

  it('a debate id absent from both stores returns null', async () => {
    const result = await community.loadCommunityItem('debates', 'idor-test-completely-absent');
    expect(result).toBeNull();
  });

  it('path traversal in id is rejected before any storage lookup', async () => {
    // assertSafeId() guard — cannot escape communityDebatesDir() via ../
    await expect(
      community.loadCommunityItem('debates', '../private/user-debate'),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
