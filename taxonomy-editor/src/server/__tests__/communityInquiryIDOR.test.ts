// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node

// t/3621 IDOR parity (mirrors communityDebateIDOR.test.ts / t/2368): the community
// inquiry reader — GET /api/community/inquiries/:id → loadCommunityItem('inquiries', id)
// — reads ONLY from communityInquiriesDir() (community/inquiries/inquiry-{id}.json). It
// can never reach a user-scoped inquiry-results blob, so a private inquiry id absent from
// the community store yields null — not the user's stored InquiryResult. assertSafeId()
// additionally blocks path traversal before any storage lookup. Inquiry results carry
// per-user content (keyed by job id in inquiryResultStore), so the reader endpoint I add
// needs the same disjoint-path + traversal guards the debate reader got.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { StorageBackend } from '../storage/storageBackend.js';
import * as fileIO from '../storage/fileIO.js';
import * as community from '../community/community.js';
import * as userContext from '../security/userContext.js';
import { saveInquiryResult, loadInquiryResult } from '../storage/inquiryResultStore.js';
import type { InquiryResult } from '../../../../lib/inquiry/index.js';

/** In-memory backend that actually persists writes (mirrors communityInquiries.test.ts). */
class MemBackend implements StorageBackend {
  files = new Map<string, string>();
  private norm(p: string) { return p.replace(/\\/g, '/'); }

  async readFile(filePath: string): Promise<string | null> {
    const k = this.norm(filePath);
    return this.files.has(k) ? this.files.get(k)! : null;
  }
  async writeFile(filePath: string, content: string): Promise<void> {
    this.files.set(this.norm(filePath), content);
  }
  async listDirectory(dirPath: string): Promise<string[]> {
    const d = this.norm(dirPath).replace(/\/$/, '') + '/';
    const names = new Set<string>();
    for (const k of this.files.keys()) {
      if (k.startsWith(d)) names.add(k.slice(d.length).split('/')[0]);
    }
    return [...names];
  }
  async deleteFile(filePath: string): Promise<void> { this.files.delete(this.norm(filePath)); }
  async fileExists(filePath: string): Promise<boolean> { return this.files.has(this.norm(filePath)); }
  async readBinaryFile(): Promise<Buffer | null> { return null; }
  async writeBinaryFile(): Promise<void> { /* stub */ }
}

const alice = { principalName: 'alice', idp: 'github', storageUserId: 'alice', isAnonymous: false };

let dataRoot: string;
let mem: MemBackend;

function makeResult(question: string): InquiryResult {
  return {
    schemaVersion: 1,
    request: { question, fidelity: 'quick' },
    campVerdicts: [
      { camp: 'acc', verdict: 'accelerate', nodes: [] },
      { camp: 'saf', verdict: 'caution', nodes: [] },
    ],
    convergences: [],
    evidenceLayers: [],
    unresolvedGaps: [],
    calibration: [],
    derivation: { fidelity: 'quick', models: {}, rounds: 1, callBudget: 10 },
    grounding: { nodesByCamp: {} },
    singleRunCaveat: 'Single run; not yet replicated.',
  };
}

describe('t/3621 — /api/community/inquiries/:id IDOR guard', () => {
  beforeAll(() => {
    process.env.AI_TRIAD_DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'iq-idor-'));
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

  it('a private inquiry in the user-scoped store is NOT visible through the community endpoint', async () => {
    // Plant a real inquiry result in the caller's own store (the path the answer view reads).
    // The community endpoint calls loadCommunityItem('inquiries', id) which reads only from
    // communityInquiriesDir() — a structurally disjoint path. The blob exists but the
    // community endpoint cannot see it → null → {found:false}@200.
    await userContext.runWithUser(alice, () => saveInquiryResult(
      'idor-planted',
      makeResult('Private question'),
      { jobId: 'idor-planted', question: 'Private question', debateId: null, truncated: false, createdAt: '2026-01-01T00:00:00.000Z' },
    ));
    // Positive control — proves the plant worked and alice can read her own inquiry.
    const own = await userContext.runWithUser(alice, () => loadInquiryResult('idor-planted'));
    expect(own).not.toBeNull();
    // Now assert the community endpoint cannot reach it.
    const communityResult = await community.loadCommunityItem('inquiries', 'idor-planted');
    expect(communityResult).toBeNull();
  });

  it('an inquiry id absent from the community store returns null', async () => {
    const result = await community.loadCommunityItem('inquiries', 'completely-absent');
    expect(result).toBeNull();
  });

  it('path traversal in id is rejected before any storage lookup', async () => {
    // assertSafeId() guard — cannot escape communityInquiriesDir() via ../
    await expect(
      community.loadCommunityItem('inquiries', '../users/alice/secret'),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
