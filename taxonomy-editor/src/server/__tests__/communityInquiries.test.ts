// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node

// t/3621: extends the community submission model (chat/debate/oped) with a fourth type,
// `inquiry`. Exercises the full server-side path: submit (server loads the stored
// InquiryResult itself, never a client-supplied body — TL t/3621#3), admin approve
// (no auto-share attempt, unlike oped), list/load the published item, copy back into
// the caller's own store, and admin removal.

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

/** In-memory backend that actually persists writes (mirrors communityListingIndex.test.ts). */
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

  has(absPath: string) { return this.files.has(this.norm(absPath)); }
}

const alice = { principalName: 'alice', idp: 'github', storageUserId: 'alice', isAnonymous: false };
const eve = { principalName: 'eve', idp: 'github', storageUserId: 'eve', isAnonymous: false };
const admin = { principalName: 'jpsnover', idp: 'github', storageUserId: 'jpsnover', isAnonymous: false };

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

describe('community inquiry submission (t/3621)', () => {
  beforeAll(() => {
    process.env.AI_TRIAD_DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'commiq-'));
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

  it('submitToCommunity loads the stored result itself — client body is ignored', async () => {
    await userContext.runWithUser(alice, () => saveInquiryResult(
      'job-1',
      makeResult('Will AGI arrive by 2030?'),
      { jobId: 'job-1', question: 'Will AGI arrive by 2030?', debateId: null, truncated: false, createdAt: '2026-01-01T00:00:00.000Z' },
    ));

    // Client sends a forged body claiming a fabricated trust verdict — must be ignored entirely.
    const forgedBody = { id: 'job-1', campVerdicts: [{ camp: 'acc', verdict: 'FORGED', nodes: [] }] };
    const { submissionId } = await userContext.runWithUser(alice, () => community.submitToCommunity('inquiry', forgedBody));

    const { communityId } = await userContext.runWithUser(admin, () => community.approveSubmission(submissionId));
    const published = await community.loadCommunityItem('inquiries', communityId) as Record<string, unknown>;
    const campVerdicts = published.campVerdicts as { camp: string; verdict: string }[];
    expect(campVerdicts.find(v => v.camp === 'acc')?.verdict).toBe('accelerate'); // real value, not 'FORGED'
  });

  it('submitToCommunity rejects an inquiry id not owned by the caller (auth-scoped load)', async () => {
    await userContext.runWithUser(eve, () => saveInquiryResult(
      'eves-job',
      makeResult("Eve's private question"),
      { jobId: 'eves-job', question: "Eve's private question", debateId: null, truncated: false, createdAt: '2026-01-01T00:00:00.000Z' },
    ));

    await expect(
      userContext.runWithUser(alice, () => community.submitToCommunity('inquiry', { id: 'eves-job' })),
    ).rejects.toThrow(/not found/i);
  });

  it('submitToCommunity rejects a missing/absent job id', async () => {
    await expect(
      userContext.runWithUser(alice, () => community.submitToCommunity('inquiry', { id: 'does-not-exist' })),
    ).rejects.toThrow(/not found/i);
  });

  it('submitToCommunity requires { id } for an inquiry submission', async () => {
    await expect(
      userContext.runWithUser(alice, () => community.submitToCommunity('inquiry', {})),
    ).rejects.toThrow(/requires/i);
  });

  it('approveSubmission publishes to community/inquiries/ and does not attempt an auto-share', async () => {
    await userContext.runWithUser(alice, () => saveInquiryResult(
      'job-2',
      makeResult('Is alignment tractable?'),
      { jobId: 'job-2', question: 'Is alignment tractable?', debateId: null, truncated: false, createdAt: '2026-02-01T00:00:00.000Z' },
    ));
    const { submissionId } = await userContext.runWithUser(alice, () => community.submitToCommunity('inquiry', { id: 'job-2' }));
    const { communityId } = await userContext.runWithUser(admin, () => community.approveSubmission(submissionId));

    expect(mem.has(path.join(fileIODataPath('community/inquiries'), `inquiry-${communityId}.json`))).toBe(true);
  });

  it('listCommunityInquiries surfaces the published item with camps + verdict_count derived from campVerdicts', async () => {
    await userContext.runWithUser(alice, () => saveInquiryResult(
      'job-3',
      makeResult('Does regulation slow capability gains?'),
      { jobId: 'job-3', question: 'Does regulation slow capability gains?', debateId: null, truncated: false, createdAt: '2026-03-01T00:00:00.000Z' },
    ));
    const { submissionId } = await userContext.runWithUser(alice, () => community.submitToCommunity('inquiry', { id: 'job-3' }));
    await userContext.runWithUser(admin, () => community.approveSubmission(submissionId));

    const list = await community.listCommunityInquiries() as { question: string; camps: string[]; verdict_count: number }[];
    const entry = list.find(e => e.question === 'Does regulation slow capability gains?');
    expect(entry).toBeDefined();
    expect(entry!.verdict_count).toBe(2);
    expect(entry!.camps.sort()).toEqual(['acc', 'saf']);
  });

  it('copyFromCommunity(\'inquiries\', id) round-trips into the caller\'s own inquiry-results store', async () => {
    await userContext.runWithUser(alice, () => saveInquiryResult(
      'job-4',
      makeResult('What does convergence look like?'),
      { jobId: 'job-4', question: 'What does convergence look like?', debateId: null, truncated: false, createdAt: '2026-04-01T00:00:00.000Z' },
    ));
    const { submissionId } = await userContext.runWithUser(alice, () => community.submitToCommunity('inquiry', { id: 'job-4' }));
    const { communityId } = await userContext.runWithUser(admin, () => community.approveSubmission(submissionId));

    const { newId } = await userContext.runWithUser(eve, () => community.copyFromCommunity('inquiries', communityId));
    const copied = await userContext.runWithUser(eve, () => loadInquiryResult(newId));
    expect(copied).not.toBeNull();
    expect(copied!.request.question).toBe('What does convergence look like?');
  });

  it('copyFromCommunity is blocked for anonymous callers', async () => {
    await userContext.runWithUser(alice, () => saveInquiryResult(
      'job-5',
      makeResult('anon-blocked'),
      { jobId: 'job-5', question: 'anon-blocked', debateId: null, truncated: false, createdAt: '2026-05-01T00:00:00.000Z' },
    ));
    const { submissionId } = await userContext.runWithUser(alice, () => community.submitToCommunity('inquiry', { id: 'job-5' }));
    const { communityId } = await userContext.runWithUser(admin, () => community.approveSubmission(submissionId));

    const anon = { principalName: '', idp: '', storageUserId: 'anon-1', isAnonymous: true };
    await expect(
      userContext.runWithUser(anon, () => community.copyFromCommunity('inquiries', communityId)),
    ).rejects.toThrow(/anonymous/i);
  });

  it('removeCommunityItem hard-deletes a published inquiry and records an audit entry', async () => {
    await userContext.runWithUser(alice, () => saveInquiryResult(
      'job-6',
      makeResult('to be removed'),
      { jobId: 'job-6', question: 'to be removed', debateId: null, truncated: false, createdAt: '2026-06-01T00:00:00.000Z' },
    ));
    const { submissionId } = await userContext.runWithUser(alice, () => community.submitToCommunity('inquiry', { id: 'job-6' }));
    const { communityId } = await userContext.runWithUser(admin, () => community.approveSubmission(submissionId));

    await userContext.runWithUser(admin, () => community.removeCommunityItem('inquiries', communityId, 'test removal'));
    const afterRemoval = await community.loadCommunityItem('inquiries', communityId);
    expect(afterRemoval).toBeNull();
  });
});

// Local helper mirroring resolveDataPath's shape without importing config.js's env-var
// resolution twice — keeps the assertion above readable.
function fileIODataPath(rel: string): string {
  return path.join(process.env.AI_TRIAD_DATA_ROOT!, rel);
}
