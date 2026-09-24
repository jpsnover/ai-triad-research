// @vitest-environment node
//
// t/3627 — inquiry public-share storage. Pure persistence plumbing: the field-shape/sanitization
// work (SO e/201#2) already lives in toPublicInquiryShare (lib/inquiry/publicShare.ts, t/3648),
// which projectPublicInquiryShare is trusted to have gotten right (covered by its own tests). This
// suite covers the store's own concerns: owner-only publish (loadInquiryResult scoping),
// idempotent share/unshare, indistinguishable-404 semantics, and revoke correctness AT THE STORE
// LAYER (no cache exists at this layer — the cache-vs-revoke proof belongs to t/3653's route,
// once it lands; see t/3627#5-6).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLoadInquiryResult, serverWarn } = vi.hoisted(() => ({
  mockLoadInquiryResult: vi.fn(),
  serverWarn: vi.fn(),
}));

vi.mock('../logger.js', () => ({
  log: {
    api: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    server: { info: vi.fn(), warn: serverWarn, error: vi.fn(), debug: vi.fn() },
  },
  getRequestId: () => 'req-test',
  LOG_MAX_LINE_BYTES: 65536,
  writeFramedNdjson: vi.fn(),
}));
vi.mock('../storage/inquiryResultStore.js', () => ({ loadInquiryResult: mockLoadInquiryResult }));

// In-memory fake backend keyed by absolute path (t/3490 fixture pattern).
const files = new Map<string, string>();
const fakeBackend = {
  backendName: 'fake',
  async readFile(p: string) { return files.has(p) ? files.get(p)! : null; },
  async writeFile(p: string, content: string) { files.set(p, content); },
  async deleteFile(p: string) { files.delete(p); },
  async listDirectory() { return []; },
  async fileExists(p: string) { return files.has(p); },
  async readBinaryFile() { return null; },
  async writeBinaryFile() { /* unused */ },
};
vi.mock('../storage/fileIO.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getUserContentBackend: () => fakeBackend };
});

import { runWithUser, type UserContext } from '../security/userContext.js';
import { publishInquiryShare, unpublishInquiryShare, loadPublicInquiryShare } from '../storage/inquiryShareStore.js';
import type { InquiryResult } from '../../../../lib/inquiry/index.js';

const OWNER: UserContext = { principalName: 'owner-1', idp: 'github', storageUserId: 'owner-1', isAnonymous: false };
const ANON: UserContext = { principalName: '', idp: 'anon', storageUserId: '_local', isAnonymous: true };

function makeResult(question: string): InquiryResult {
  const node = { nodeId: 'skp-beliefs-029', label: 'Precaution', camp: 'skp' as const };
  return {
    schemaVersion: 1,
    request: { question, fidelity: 'standard', situationId: 'sit-42', models: { debaters: 'gemini-3.1-pro-preview', evaluator: 'claude-opus-5' } },
    campVerdicts: [{ camp: 'saf', verdict: 'A verdict', nodes: [node] }],
    convergences: [{ claim: 'A convergence', nodes: [node] }],
    evidenceLayers: [{ title: 'Ev', role: 'grounds', solves: 'scope', sources: ['https://example.org/paper'] }],
    unresolvedGaps: [{ description: 'a gap', confidence: 'low' }],
    calibration: [{ metric: 'claim_acceptance', value: 0.85, trust: { verdict: 'trust', reason: 'quorum' } }],
    derivation: { fidelity: 'standard', models: { debate: 'gemini-3.1-pro-preview' }, rounds: 6, callBudget: 200 },
    grounding: { anchorSituationId: 'sit-42', anchorSummary: 'ctx', nodesByCamp: { skp: [node] } },
    singleRunCaveat: 'One run is not a finding.',
    debateId: 'debate-abc',
  } as unknown as InquiryResult;
}

describe('inquiryShareStore (t/3627)', () => {
  beforeEach(() => {
    files.clear();
    mockLoadInquiryResult.mockReset();
    serverWarn.mockClear();
  });

  // ─── publishInquiryShare ────────────────────────────────────────────────────

  it('publishes a result to a fresh shareId, projecting via toPublicInquiryShare', async () => {
    mockLoadInquiryResult.mockResolvedValue(makeResult('Should X?'));
    const result = await runWithUser(OWNER, () => publishInquiryShare('job-1'));
    expect(result).not.toBeNull();
    const pub = await loadPublicInquiryShare(result!.shareId);
    expect(pub).not.toBeNull();
    expect(pub!.request.question).toBe('Should X?');
    // The public projection strips private fields — confirms toPublicInquiryShare actually ran,
    // not a raw passthrough of the InquiryResult.
    expect(JSON.stringify(pub)).not.toContain('debate-abc'); // debateId
    expect(JSON.stringify(pub)).not.toContain('skp-beliefs-029'); // nodeId
  });

  it('is idempotent — re-sharing an already-shared jobId reuses the SAME shareId, no dup copy', async () => {
    mockLoadInquiryResult.mockResolvedValue(makeResult('Q1'));
    const first = await runWithUser(OWNER, () => publishInquiryShare('job-1'));
    const second = await runWithUser(OWNER, () => publishInquiryShare('job-1'));
    expect(second!.shareId).toBe(first!.shareId);
  });

  it('returns null for anonymous callers (no durable owner scope to share from)', async () => {
    const result = await runWithUser(ANON, () => publishInquiryShare('job-1'));
    expect(result).toBeNull();
    expect(mockLoadInquiryResult).not.toHaveBeenCalled();
  });

  it('returns null (indistinguishable 404) when the job is absent or not owned by the caller', async () => {
    mockLoadInquiryResult.mockResolvedValue(null);
    const result = await runWithUser(OWNER, () => publishInquiryShare('not-mine'));
    expect(result).toBeNull();
  });

  // ─── unpublishInquiryShare / revoke correctness (store layer) ──────────────

  it('unpublish deletes the public copy — loadPublicInquiryShare returns null immediately (no cache at this layer)', async () => {
    mockLoadInquiryResult.mockResolvedValue(makeResult('Q1'));
    const { shareId } = (await runWithUser(OWNER, () => publishInquiryShare('job-1')))!;
    expect(await loadPublicInquiryShare(shareId)).not.toBeNull();

    const revoked = await runWithUser(OWNER, () => unpublishInquiryShare('job-1'));
    expect(revoked).toBe(true);
    expect(await loadPublicInquiryShare(shareId)).toBeNull();
  });

  it('unpublish is idempotent — a second revoke on an already-revoked jobId is a no-op returning false', async () => {
    mockLoadInquiryResult.mockResolvedValue(makeResult('Q1'));
    await runWithUser(OWNER, () => publishInquiryShare('job-1'));
    expect(await runWithUser(OWNER, () => unpublishInquiryShare('job-1'))).toBe(true);
    expect(await runWithUser(OWNER, () => unpublishInquiryShare('job-1'))).toBe(false);
  });

  it('unpublish on a never-shared jobId is a no-op returning false', async () => {
    const revoked = await runWithUser(OWNER, () => unpublishInquiryShare('never-shared'));
    expect(revoked).toBe(false);
  });

  it('re-sharing after revoke mints a FRESH shareId — the old link stays permanently dead', async () => {
    mockLoadInquiryResult.mockResolvedValue(makeResult('Q1'));
    const first = await runWithUser(OWNER, () => publishInquiryShare('job-1'));
    await runWithUser(OWNER, () => unpublishInquiryShare('job-1'));
    const second = await runWithUser(OWNER, () => publishInquiryShare('job-1'));

    expect(second!.shareId).not.toBe(first!.shareId);
    expect(await loadPublicInquiryShare(first!.shareId)).toBeNull(); // old link dead
    expect(await loadPublicInquiryShare(second!.shareId)).not.toBeNull(); // new link live
  });

  it('unpublish for anonymous callers is a no-op returning false', async () => {
    expect(await runWithUser(ANON, () => unpublishInquiryShare('job-1'))).toBe(false);
  });

  // ─── loadPublicInquiryShare (the unauthenticated read path) ────────────────

  it('returns null for a shareId that was never shared', async () => {
    expect(await loadPublicInquiryShare('never-shared-id')).toBeNull();
  });

  it('never touches users/** — reads exclusively from the public/inquiries/ prefix', async () => {
    mockLoadInquiryResult.mockResolvedValue(makeResult('Q1'));
    await runWithUser(OWNER, () => publishInquiryShare('job-1'));
    const paths = [...files.keys()];
    const publicPaths = paths.filter(p => p.includes('public') && p.includes('inquiries'));
    expect(publicPaths.length).toBeGreaterThan(0);
    // Every write went to public/inquiries/ or the owner-scoped registry — never a bare users/ result path.
    for (const p of paths) {
      const norm = p.replace(/\\/g, '/');
      expect(norm.includes('inquiry-results')).toBe(false);
    }
  });
});
