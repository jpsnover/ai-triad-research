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

/** A single (pov, tag-id) pair. */
interface TagSoulSpec { pov: string; id: string }

/**
 * Build a fake project root with the requested soul-docs + prompt files present.
 * Tag soul files live at soul-docs/<pov>.<id>.soul.json (spec §3, t/3989).
 * `tags` → registered in pov-tags.json AND file written.
 * `registeredOnly` → registered but file intentionally absent (for missing-arm tests).
 * `strayTagFiles` → file written in soul-docs/ but NOT in registry (for stray-arm tests).
 */
function makeRoot(souls: string[], prompts: string[], opts?: {
  tags?: TagSoulSpec[];
  registeredOnly?: TagSoulSpec[];
  strayTagFiles?: string[];
}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oped-health-'));
  const soulsDir  = path.join(root, 'lib', 'debate', 'soul-docs');
  const promptsDir = path.join(root, 'lib', 'oped', 'prompts');
  fs.mkdirSync(soulsDir, { recursive: true });
  fs.mkdirSync(promptsDir, { recursive: true });
  for (const s of souls) fs.writeFileSync(path.join(soulsDir, `${s}.soul.json`), '{}');
  for (const p of prompts) fs.writeFileSync(path.join(promptsDir, p), 'x');
  // pov-tags.json: group all registered entries (tags + registeredOnly) by pov
  const byPov: Record<string, Array<{ id: string; label: string; soul_doc: string; description: string }>> = {};
  for (const t of [...(opts?.tags ?? []), ...(opts?.registeredOnly ?? [])]) {
    if (!byPov[t.pov]) byPov[t.pov] = [];
    byPov[t.pov].push({ id: t.id, label: t.id, soul_doc: `${t.pov}.${t.id}`, description: t.id });
  }
  fs.writeFileSync(path.join(soulsDir, 'pov-tags.json'), JSON.stringify({ version: 1, povs: byPov }));
  // tag soul files — only for 'tags', not 'registeredOnly'
  for (const t of (opts?.tags ?? [])) {
    fs.writeFileSync(path.join(soulsDir, `${t.pov}.${t.id}.soul.json`), '{}');
  }
  // stray files: in soul-docs/ but not in registry
  for (const f of (opts?.strayTagFiles ?? [])) fs.writeFileSync(path.join(soulsDir, f), '{}');
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

  it('CLEAN arm: registered tag soul present at soul-docs/<pov>.<id>.soul.json → 200', () => {
    // spec §3 path: soul-docs/skeptic.critical.soul.json (not tags/ subdir, t/3989)
    const r = makeRoot(
      ['accelerationist', 'safetyist', 'skeptic'],
      ['op-ed-generation-system.prompt'],
      { tags: [{ pov: 'skeptic', id: 'critical' }] },
    );
    h.root = r;
    const res = mockRes();
    opedFilesHandler()({}, res, {});
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.assets).toContain('lib/debate/soul-docs/skeptic.critical.soul.json');
    fs.rmSync(r, { recursive: true, force: true });
  });

  it('FAILURE arm: registered tag soul file absent → 500 (gate must fire)', () => {
    // Registry lists skeptic/critical but the file does not exist.
    const r = makeRoot(
      ['accelerationist', 'safetyist', 'skeptic'],
      ['op-ed-generation-system.prompt'],
      { registeredOnly: [{ pov: 'skeptic', id: 'critical' }] },
    );
    h.root = r;
    const res = mockRes();
    opedFilesHandler()({}, res, {});
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
    expect(body.missing).toContain('lib/debate/soul-docs/skeptic.critical.soul.json');
    fs.rmSync(r, { recursive: true, force: true });
  });

  it('FAILURE arm: stray tag soul in soul-docs/ not in registry → 500', () => {
    // skeptic.orphan.soul.json not registered → stray
    const r = makeRoot(
      ['accelerationist', 'safetyist', 'skeptic'],
      ['op-ed-generation-system.prompt'],
      { strayTagFiles: ['skeptic.orphan.soul.json'] },
    );
    h.root = r;
    const res = mockRes();
    opedFilesHandler()({}, res, {});
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
    expect(body.missing.some((m: string) => m.includes('skeptic.orphan.soul.json') && m.includes('stray'))).toBe(true);
    fs.rmSync(r, { recursive: true, force: true });
  });
});
