// @vitest-environment node
//
// t/3653 AC#2 — the SO-mandated end-to-end revoke proof (e/201#2 condition 4; split confirmed
// t/3626#8 / t/3627#6). This is the ONE test that exercises the short-TTL parse cache in
// routes/inquiryShare.ts, so it has to live with that route (nowhere else has the cache).
//
// Real store (NO mock of inquiryShareStore) against an in-memory backend, real cache, fake timers:
//   mint → publish → GET (200, populates cache)
//   → revoke (unpublish deletes the public copy + registry)
//   → GET immediately: STILL 200 from the cache (bounded staleness — the SO-flagged eventual-
//     consistency window; documented, accepted)
//   → advance past the 5s cache TTL → GET: uniform 404 (revoke is durable once the cache expires).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { StorageBackend } from '../storage/storageBackend.js';
import * as fileIO from '../storage/fileIO.js';
import * as userContext from '../security/userContext.js';
import { saveInquiryResult } from '../storage/inquiryResultStore.js';
import { publishInquiryShare, unpublishInquiryShare } from '../storage/inquiryShareStore.js';
import type { InquiryResult } from '../../../../lib/inquiry/index.js';
import { createRouter, type Handler } from '../httpKit.js';
import { registerInquiryShareRoutes, _resetPublicInquiryCache } from '../routes/inquiryShare.js';

/** In-memory backend that actually persists writes (mirrors communityInquiries.test.ts). */
class MemBackend implements StorageBackend {
  files = new Map<string, string>();
  private norm(p: string) { return p.replace(/\\/g, '/'); }
  async readFile(p: string): Promise<string | null> { const k = this.norm(p); return this.files.has(k) ? this.files.get(k)! : null; }
  async writeFile(p: string, c: string): Promise<void> { this.files.set(this.norm(p), c); }
  async listDirectory(d: string): Promise<string[]> {
    const pre = this.norm(d).replace(/\/$/, '') + '/'; const out = new Set<string>();
    for (const k of this.files.keys()) if (k.startsWith(pre)) out.add(k.slice(pre.length).split('/')[0]);
    return [...out];
  }
  async deleteFile(p: string): Promise<void> { this.files.delete(this.norm(p)); }
  async fileExists(p: string): Promise<boolean> { return this.files.has(this.norm(p)); }
  async readBinaryFile(): Promise<Buffer | null> { return null; }
  async writeBinaryFile(): Promise<void> { /* stub */ }
}

/** A fully-populated InquiryResult that projects cleanly (mirrors lib/inquiry/publicShare.test.ts). */
function makeFullResult(): InquiryResult {
  const node = { nodeId: 'skp-beliefs-029', label: 'Precaution', camp: 'skp' as const };
  return {
    schemaVersion: 1,
    request: { question: 'Should X?', fidelity: 'standard', situationId: 'sit-42', models: { debaters: 'gemini-3.1-pro-preview', evaluator: 'claude-opus-5' } },
    campVerdicts: [{ camp: 'saf', verdict: 'A verdict', nodes: [node] }],
    convergences: [{ claim: 'A convergence', nodes: [node] }],
    evidenceLayers: [{ title: 'Ev', role: 'grounds', solves: 'scope', sources: ['https://example.org/paper'] }],
    unresolvedGaps: [{ description: 'a gap', confidence: 'low' }],
    calibration: [{ metric: 'claim_acceptance', value: 0.85, displayValue: '72 / 84', trust: { verdict: 'trust', reason: 'quorum', terminationReason: 'natural', metricFamily: 'convergence' } }],
    derivation: { fidelity: 'standard', models: { debate: 'gemini-3.1-pro-preview' }, rounds: 6, callBudget: 200, callsUsed: 180, costUsd: 4.2 },
    grounding: { anchorSituationId: 'sit-42', anchorSummary: 'ctx', nodesByCamp: { skp: [node] } },
    singleRunCaveat: 'One run is not a finding.',
    debateId: 'debate-abc',
  } as InquiryResult;
}

const alice = { principalName: 'alice', idp: 'github', storageUserId: 'alice', isAnonymous: false };
let dataRoot: string;
let mem: MemBackend;

function res() {
  const r = { statusCode: 0, body: '', writableEnded: false, headersSent: false,
    writeHead(s: number) { r.statusCode = s; r.headersSent = true; return r; },
    setHeader() {}, write() { return true; },
    end(b?: string) { r.body = b ?? ''; r.writableEnded = true; return r; } };
  return r as unknown as ServerResponse & { statusCode: number; body: string };
}
function req(url: string): IncomingMessage {
  return { url, method: 'GET', headers: {}, socket: { remoteAddress: '10.0.0.9' } } as unknown as IncomingMessage;
}
function publicGet(): Handler {
  const routes: { method: string; path: string; handler: Handler }[] = [];
  registerInquiryShareRoutes(createRouter(routes as never) as never, {} as never);
  return routes.find(r => r.method === 'GET' && r.path === '/api/public/inquiry/:shareId')!.handler;
}

describe('t/3653 AC#2 — cache-level revoke E2E (SO e/201#2 condition 4)', () => {
  beforeEach(() => {
    process.env.AI_TRIAD_DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'iq-share-e2e-'));
    dataRoot = process.env.AI_TRIAD_DATA_ROOT;
    mem = new MemBackend();
    fileIO.setBackend(mem);
    _resetPublicInquiryCache();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(dataRoot, { recursive: true, force: true });
    delete process.env.AI_TRIAD_DATA_ROOT;
  });

  it('mint → GET 200 → revoke → (cached within TTL still 200) → past TTL → uniform 404', async () => {
    const shareId = await userContext.runWithUser(alice, async () => {
      await saveInquiryResult('job-e2e', makeFullResult(), {
        jobId: 'job-e2e', question: 'Should X?', debateId: 'debate-abc', truncated: false, createdAt: '2026-09-24T00:00:00.000Z',
      });
      const r = await publishInquiryShare('job-e2e');
      return r!.shareId;
    });
    expect(shareId).toBeTruthy();

    // GET → 200, populates the 5s cache.
    const g1 = res(); await publicGet()(req(`/api/public/inquiry/${shareId}`), g1, undefined);
    expect(g1.statusCode).toBe(200);

    // Revoke: deletes the public copy + registry entry.
    const removed = await userContext.runWithUser(alice, () => unpublishInquiryShare('job-e2e'));
    expect(removed).toBe(true);

    // Immediately after revoke: STILL 200 from the cache — the SO-flagged bounded-staleness window.
    const g2 = res(); await publicGet()(req(`/api/public/inquiry/${shareId}`), g2, undefined);
    expect(g2.statusCode).toBe(200);

    // Advance past the 5s cache TTL → cache miss → store returns null → uniform 404.
    vi.advanceTimersByTime(5_001);
    const g3 = res(); await publicGet()(req(`/api/public/inquiry/${shareId}`), g3, undefined);
    expect(g3.statusCode).toBe(404);
  });
});
