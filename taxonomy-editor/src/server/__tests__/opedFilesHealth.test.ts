// @vitest-environment node
//
// t/2689 AC3 — both-arms Gate Verification for GET /api/health/oped-files, the
// deploy-smoke health check that asserts the op-ed runtime data assets (soul-docs
// + lib/oped/prompts) are present in the container image. The originating incident
// (t/2689) was those files missing from the image → op-ed generation ENOENT. This
// endpoint's failure arm (500 when an asset is missing) is what the gate relies on;
// it must be proven, not assumed (Gate Verification rule).

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const h = vi.hoisted(() => ({ root: '' }));

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config.js')>();
  return { ...actual, getProjectRoot: () => h.root };
});

import { createRouter } from '../httpKit.js';
import { registerDiagnosticsRoutes } from '../routes/diagnostics.js';

interface CapturedRes { statusCode: number; body: string }
function mockRes(): CapturedRes {
  const r = {
    statusCode: 0, body: '', writableEnded: false, headersSent: false,
    writeHead(code: number) { r.statusCode = code; return r; },
    setHeader() {}, write() { return true; },
    end(b?: string) { r.body = b ?? ''; r.writableEnded = true; return r; },
    on() { return r; },
  };
  return r as unknown as CapturedRes;
}

function opedFilesHandler(): (req: unknown, res: unknown, body: unknown) => unknown {
  const routes: Array<{ method: string; path: string; handler: (req: unknown, res: unknown, body: unknown) => unknown }> = [];
  registerDiagnosticsRoutes(createRouter(routes as never), { serverRecorder: null } as never);
  return routes.find(r => r.method === 'GET' && r.path === '/api/health/oped-files')!.handler;
}

/** Build a fake project root with the requested soul-docs + prompt files present. */
function makeRoot(souls: string[], prompts: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oped-health-'));
  const soulsDir = path.join(root, 'lib', 'debate', 'soul-docs');
  const promptsDir = path.join(root, 'lib', 'oped', 'prompts');
  fs.mkdirSync(soulsDir, { recursive: true });
  fs.mkdirSync(promptsDir, { recursive: true });
  for (const s of souls) fs.writeFileSync(path.join(soulsDir, `${s}.soul.json`), '{}');
  for (const p of prompts) fs.writeFileSync(path.join(promptsDir, p), 'x');
  return root;
}

let presentRoot: string;
let missingRoot: string;

beforeAll(() => {
  presentRoot = makeRoot(['accelerationist', 'safetyist', 'skeptic'], ['op-ed-generation-system.prompt']);
  // Failure fixture: skeptic soul-doc absent.
  missingRoot = makeRoot(['accelerationist', 'safetyist'], ['op-ed-generation-system.prompt']);
});
afterAll(() => {
  fs.rmSync(presentRoot, { recursive: true, force: true });
  fs.rmSync(missingRoot, { recursive: true, force: true });
});

describe('GET /api/health/oped-files — both-arms gate verification (t/2689 AC3)', () => {
  it('CLEAN arm: all assets present → 200 { ok:true, assets }', () => {
    h.root = presentRoot;
    const res = mockRes();
    opedFilesHandler()({}, res, {});
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.assets).toContain('lib/debate/soul-docs/skeptic.soul.json');
    expect(body.assets).toContain('lib/oped/prompts/op-ed-generation-system.prompt');
    expect(body.missing).toBeUndefined();
  });

  it('FAILURE arm: a soul-doc missing → 500 { ok:false, missing } (the gate must fire)', () => {
    h.root = missingRoot;
    const res = mockRes();
    opedFilesHandler()({}, res, {});
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
    expect(body.missing).toContain('lib/debate/soul-docs/skeptic.soul.json');
    // present list still reported for triage
    expect(body.present).toContain('lib/debate/soul-docs/accelerationist.soul.json');
  });

  it('FAILURE arm: prompts directory empty → 500 (covers the other asset class)', () => {
    const emptyPromptsRoot = makeRoot(['accelerationist', 'safetyist', 'skeptic'], []);
    h.root = emptyPromptsRoot;
    const res = mockRes();
    opedFilesHandler()({}, res, {});
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
    expect(body.missing.some((m: string) => m.includes('lib/oped/prompts/'))).toBe(true);
    fs.rmSync(emptyPromptsRoot, { recursive: true, force: true });
  });
});
