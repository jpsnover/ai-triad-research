// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Brief Export — Electron main-process handler tests (t/2840). Mocks the shared runBriefPipeline
// and drives the 5 IPC handlers against a real temp userData dir, so the persistence assertions
// (brief.html present, manifest-always, partial-persist-on-throw) are real file round-trips.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

const TMP = path.join(os.tmpdir(), `brief-export-test-${process.pid}`);

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: { getPath: vi.fn(() => TMP) },
}));

const runBriefPipeline = vi.hoisted(() => vi.fn());
vi.mock('../../../../lib/brief/pipeline.js', () => ({ runBriefPipeline }));
vi.mock('../../../../lib/brief/errorMapping.js', () => ({ codeForHardFailures: vi.fn(() => 'TraceGateFailure') }));
vi.mock('../electronAIAdapter.js', () => ({ makeElectronAIAdapter: vi.fn(() => ({ generateText: vi.fn() })) }));

const loadDebateSession = vi.hoisted(() => vi.fn());
vi.mock('../debateIO.js', () => ({ loadDebateSession }));

vi.mock('../../../../lib/debate/errors.js', () => ({
  ActionableError: class extends Error { constructor(o: { problem: string }) { super(o.problem); } },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
vi.mock('../../../../lib/flight-recorder/index.js', () => ({ getGlobalRecorder: vi.fn(() => null) }));
vi.mock('../../../../lib/ai-client/index.js', () => ({ DEFAULT_MODEL: 'gemini-2.5-flash' }));

import { ipcMain } from 'electron';
import { BRIEF_ARTIFACTS } from '../../../../lib/brief/types.js';
import { registerBriefExportHandlers } from '../ipc/briefExportHandlers.js';

type Handler = (...args: unknown[]) => unknown;
function handlers(): Record<string, Handler> {
  const map: Record<string, Handler> = {};
  for (const [ch, fn] of (ipcMain.handle as unknown as { mock: { calls: [string, Handler][] } }).mock.calls) map[ch] = fn;
  return map;
}

const SPEC = { meta: { title: 'Should AI be paused?', snapshot: false } };
const MANIFEST = { trace_coverage_pct: 100, warnings: [] as string[] };
const ALL_ARTIFACTS = [
  { name: BRIEF_ARTIFACTS.deckSpec, text: '{"deck":true}' },
  { name: BRIEF_ARTIFACTS.narration, text: '{"narr":true}' },
  { name: BRIEF_ARTIFACTS.pptx, bytes: new Uint8Array([1, 2, 3, 4]) },
  { name: BRIEF_ARTIFACTS.htmlDoc, text: '<html>brief</html>' },
  { name: BRIEF_ARTIFACTS.manifest, text: '{"manifest":true}' },
];
function result(over: Record<string, unknown> = {}) {
  return { spec: SPEC, narration: {}, pptxBytes: new Uint8Array([1, 2, 3, 4]), htmlDoc: '<html>brief</html>', manifest: MANIFEST, artifacts: ALL_ARTIFACTS, hardFailures: [] as string[], warnings: [] as string[], ...over };
}

async function createAndWait(h: Record<string, Handler>, body: Record<string, unknown> = { preset: 'policymaker' }) {
  const { jobId } = (await h['create-brief-export'](null, 'deb-1', body)) as { jobId: string };
  for (let i = 0; i < 100; i++) {
    const job = (await h['get-brief-export-job'](null, jobId)) as { status: string; exportId: string | null };
    if (job.status === 'done' || job.status === 'failed') return { jobId, job };
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('job did not terminate');
}

describe('briefExportHandlers — Electron parity (t/2840)', () => {
  beforeEach(() => {
    (ipcMain.handle as unknown as { mockReset: () => void }).mockReset();
    runBriefPipeline.mockReset();
    loadDebateSession.mockReset().mockResolvedValue({ phase: 'closed' });
    fs.rmSync(TMP, { recursive: true, force: true });
    registerBriefExportHandlers();
  });
  afterEach(() => { fs.rmSync(TMP, { recursive: true, force: true }); });

  it('create → done persists all 5 artifacts incl brief.html; list=1; download non-empty', async () => {
    runBriefPipeline.mockImplementation(async (_i: unknown, _a: unknown, onStage: (s: string) => void, onArtifact: (x: unknown) => void) => {
      onStage('extracting'); for (const art of ALL_ARTIFACTS) onArtifact(art); onStage('verifying');
      return result();
    });
    const h = handlers();
    const { job } = await createAndWait(h);
    expect(job.status).toBe('done');
    expect(job.exportId).toBeTruthy();
    const list = (await h['list-brief-exports'](null, 'deb-1')) as { artifacts: string[]; status: string }[];
    expect(list).toHaveLength(1);
    // brief.html must be persisted so the desktop "Save as PDF" button is never invisible (TL plus).
    expect(list[0].artifacts).toContain(BRIEF_ARTIFACTS.htmlDoc);
    expect(list[0].artifacts).toContain(BRIEF_ARTIFACTS.manifest);
    const bytes = (await h['download-brief-artifact'](null, job.exportId, BRIEF_ARTIFACTS.pptx)) as Uint8Array | null;
    expect(bytes && bytes.length).toBeGreaterThan(0);
  });

  it('verify hardFailures → failed + manifest still persisted (diagnosable)', async () => {
    runBriefPipeline.mockImplementation(async (_i: unknown, _a: unknown, _s: (s: string) => void, onArtifact: (x: unknown) => void) => {
      for (const art of ALL_ARTIFACTS) onArtifact(art);
      return result({ hardFailures: ['trace coverage 60% < 80% threshold'] });
    });
    const h = handlers();
    const { job } = await createAndWait(h);
    expect(job.status).toBe('failed');
    expect(job.exportId).toBeNull();
    const list = (await h['list-brief-exports'](null, 'deb-1')) as { artifacts: string[]; status: string }[];
    expect(list[0].status).toBe('failed');
    expect(list[0].artifacts).toContain(BRIEF_ARTIFACTS.manifest);
  });

  it('stage throw after extract → failed, deck_spec partial-persisted via onArtifact', async () => {
    runBriefPipeline.mockImplementation(async (_i: unknown, _a: unknown, onStage: (s: string) => void, onArtifact: (x: unknown) => void) => {
      onStage('extracting'); onArtifact({ name: BRIEF_ARTIFACTS.deckSpec, text: '{"deck":true}' });
      onStage('narrating'); throw new Error('provider 503');
    });
    const h = handlers();
    const { job } = await createAndWait(h);
    expect(job.status).toBe('failed');
    const list = (await h['list-brief-exports'](null, 'deb-1')) as { artifacts: string[] }[];
    expect(list[0].artifacts).toEqual([BRIEF_ARTIFACTS.deckSpec]);
  });

  it('delete removes the export from the store', async () => {
    runBriefPipeline.mockImplementation(async (_i: unknown, _a: unknown, _s: (s: string) => void, onArtifact: (x: unknown) => void) => {
      for (const art of ALL_ARTIFACTS) onArtifact(art); return result();
    });
    const h = handlers();
    const { job } = await createAndWait(h);
    await h['delete-brief-export'](null, job.exportId);
    const list = (await h['list-brief-exports'](null, 'deb-1')) as unknown[];
    expect(list).toHaveLength(0);
  });

  it('missing debate → job fails (loud, not silent)', async () => {
    loadDebateSession.mockResolvedValue(null);
    const h = handlers();
    const { job } = await createAndWait(h);
    expect(job.status).toBe('failed');
  });
});
