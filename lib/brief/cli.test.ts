// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Tests for the full-pipeline CLI (t/2837). runBriefPipeline + the adapter/repo
// resolvers are mocked — this asserts the CLI's own contract: arg parsing,
// error-code mapping, the one-line TriadDeckExport stdout, WARN-on-stderr, artifact
// writes (incl. on gate failure), and the --skip-narration adapter guard.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { mkdtemp, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('./pipeline.js', () => ({ runBriefPipeline: vi.fn() }));
vi.mock('../debate/aiAdapter.js', () => ({ createCLIAdapter: vi.fn(() => ({ generateText: vi.fn() })) }));
vi.mock('../debate/taxonomyLoader.js', () => ({ resolveRepoRoot: vi.fn(() => '/repo') }));

import { runBriefPipeline } from './pipeline.js';
import { createCLIAdapter } from '../debate/aiAdapter.js';
import { runCli, parseArgs } from './cli.js';

function okResult(over: Record<string, unknown> = {}) {
  return {
    spec: { meta: { id: 'sess-1', title: 'My Title' } },
    narration: {},
    pptxBytes: new Uint8Array([1]),
    htmlDoc: '<html>',
    manifest: { debate_id: 'sess-1', trace_coverage_pct: 100, verdict_counts: { Supported: 2 }, warnings: [] },
    artifacts: [
      { name: 'deck_spec.json', text: '{}' },
      { name: 'narration.json', text: '{}' },
      { name: 'brief.pptx', bytes: new Uint8Array([1]) },
      { name: 'brief.html', text: '<html>' },
      { name: 'audit-manifest.json', text: '{}' },
    ],
    hardFailures: [] as string[],
    warnings: [] as string[],
    ...over,
  };
}

let dir: string;
let outSpy: Mock;
let errSpy: Mock;

beforeEach(async () => {
  vi.clearAllMocks();
  dir = await mkdtemp(join(tmpdir(), 'brief-cli-'));
  await writeFile(join(dir, 'debate.json'), JSON.stringify({ id: 'sess-1', phase: 'closed' }));
  outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true) as unknown as Mock;
  errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true) as unknown as Mock;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

const stdout = () => outSpy.mock.calls.map(c => String(c[0])).join('');
const stderr = () => errSpy.mock.calls.map(c => String(c[0])).join('');

describe('parseArgs', () => {
  it('requires --path, --model, --out', () => {
    expect(() => parseArgs(['--model', 'm', '--out', 'o'])).toThrow(/required/);
    expect(() => parseArgs(['--path', 'p', '--out', 'o'])).toThrow(/required/);
    expect(() => parseArgs(['--path', 'p', '--model', 'm'])).toThrow(/required/);
  });
  it('rejects an unknown preset', () => {
    expect(() => parseArgs(['--path', 'p', '--model', 'm', '--out', 'o', '--preset', 'nope'])).toThrow(/preset/);
  });
  it('parses boolean flags', () => {
    const a = parseArgs(['--path', 'p', '--model', 'm', '--out', 'o', '--skip-narration', '--allow-open', '--no-framing-meta']);
    expect(a.skipNarration).toBe(true);
    expect(a.allowOpen).toBe(true);
    expect(a.framingMeta).toBe(false);
  });
});

describe('runCli', () => {
  it('success → exit 0, one line of TriadDeckExport JSON on stdout, artifacts written', async () => {
    (runBriefPipeline as Mock).mockResolvedValue(okResult());
    const out = join(dir, 'out');
    const r = await runCli(['--path', join(dir, 'debate.json'), '--model', 'gemini', '--out', out]);
    expect(r.exitCode).toBe(0);

    const lines = stdout().trim().split('\n');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.debateId).toBe('sess-1');
    expect(parsed.title).toBe('My Title');
    expect(parsed.path).toMatch(/brief\.pptx$/);
    expect(parsed.manifestPath).toMatch(/audit-manifest\.json$/);
    expect(parsed.verdicts).toEqual({ Supported: 2 });

    const written = await readdir(out);
    expect(written.sort()).toEqual(
      ['audit-manifest.json', 'brief.html', 'brief.pptx', 'deck_spec.json', 'narration.json'],
    );
  });

  it('verify-gate failure → exit 1, error code on stderr, artifacts still written', async () => {
    (runBriefPipeline as Mock).mockResolvedValue(okResult({ hardFailures: ['symmetry breach'], warnings: ['thin camp'] }));
    const out = join(dir, 'out');
    const r = await runCli(['--path', join(dir, 'debate.json'), '--model', 'gemini', '--out', out]);
    expect(r.exitCode).toBe(1);
    expect(stdout()).toBe(''); // stdout stays clean on failure
    expect(stderr()).toContain('WARN: thin camp');
    const errLine = stderr().trim().split('\n').find(l => l.startsWith('{'))!;
    expect(JSON.parse(errLine).errorCode).toBe('SymmetryFailure');
    const written = await readdir(out);
    expect(written).toContain('audit-manifest.json');
  });

  it('bad --path → DebateFileInvalid, exit 1', async () => {
    const r = await runCli(['--path', join(dir, 'nope.json'), '--model', 'gemini', '--out', join(dir, 'out')]);
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(stderr().trim()).errorCode).toBe('DebateFileInvalid');
    expect(runBriefPipeline).not.toHaveBeenCalled();
  });

  it('stage throw with "closed" message → DebateNotClosed', async () => {
    (runBriefPipeline as Mock).mockRejectedValue(new Error('Debate is not closed; pass allowOpen'));
    const r = await runCli(['--path', join(dir, 'debate.json'), '--model', 'gemini', '--out', join(dir, 'out')]);
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(stderr().trim()).errorCode).toBe('DebateNotClosed');
  });

  it('--skip-narration does NOT build a model adapter', async () => {
    (runBriefPipeline as Mock).mockResolvedValue(okResult());
    await runCli(['--path', join(dir, 'debate.json'), '--model', 'gemini', '--out', join(dir, 'out'), '--skip-narration']);
    expect(createCLIAdapter).not.toHaveBeenCalled();
  });

  it('builds the model adapter when narration is NOT skipped', async () => {
    (runBriefPipeline as Mock).mockResolvedValue(okResult());
    await runCli(['--path', join(dir, 'debate.json'), '--model', 'gemini', '--out', join(dir, 'out')]);
    expect(createCLIAdapter).toHaveBeenCalledTimes(1);
  });
});
