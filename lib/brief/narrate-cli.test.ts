// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Tests for the narrate-stage debug CLI (t/2873). narrate() + the adapter/repo
// resolvers are mocked — this asserts the CLI's contract: arg parsing, the one-line
// JSON output, and the KEY behavior — a narrate() throw is CAPTURED into errors[]
// (exit 0, narration=null), not propagated; only spec-file/arg faults exit ≠0.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('./narrate.js', () => ({ narrate: vi.fn() }));
vi.mock('../debate/aiAdapter.js', () => ({ createCLIAdapter: vi.fn(() => ({ generateText: vi.fn() })) }));
vi.mock('../debate/taxonomyLoader.js', () => ({ resolveRepoRoot: vi.fn(() => '/repo') }));

import { narrate } from './narrate.js';
import { createCLIAdapter } from '../debate/aiAdapter.js';
import { runCli, parseArgs } from './narrate-cli.js';

const narration = {
  deck_spec_version: '1.0', narration_mode: 'narrated', preset: 'conference',
  narrator_model: 'm', narrator_model_source: 'Explicit', checker_model: null,
  checker_model_source: null, checker_passed: null,
  entries: [{ trace: '/cruxes/0', text: 'x' }],
  audience_questions: [{ trace: '/cruxes/0', question: 'q?' }],
};

let dir: string;
let specPath: string;
let outSpy: Mock;
let errSpy: Mock;

beforeEach(async () => {
  vi.clearAllMocks();
  dir = await mkdtemp(join(tmpdir(), 'narrate-cli-'));
  specPath = join(dir, 'deck_spec.json');
  await writeFile(specPath, JSON.stringify({ meta: { id: 's1', title: 'T' }, cruxes: [{ text: 'c' }] }));
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
  it('requires --spec and --model', () => {
    expect(() => parseArgs(['--model', 'm'])).toThrow(/required/);
    expect(() => parseArgs(['--spec', 's'])).toThrow(/required/);
  });
  it('rejects an unknown preset', () => {
    expect(() => parseArgs(['--spec', 's', '--model', 'm', '--preset', 'nope'])).toThrow(/preset/);
  });
});

describe('runCli', () => {
  it('success → exit 0, one JSON line with entry/question counts + narration', async () => {
    (narrate as Mock).mockResolvedValue({ narration });
    const r = await runCli(['--spec', specPath, '--model', 'gemini']);
    expect(r.exitCode).toBe(0);
    const lines = stdout().trim().split('\n');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.entryCount).toBe(1);
    expect(parsed.audienceQuestionCount).toBe(1);
    expect(parsed.errors).toEqual([]);
    expect(parsed.narration.entries).toHaveLength(1);
  });

  it('CAPTURES a narrate() throw into errors[] — exit 0, narration null, entryCount 0', async () => {
    (narrate as Mock).mockRejectedValue(new Error('Model returned zero narration entries — narration must cover the deck_spec'));
    const r = await runCli(['--spec', specPath, '--model', 'gemini-3.5-flash-lite']);
    expect(r.exitCode).toBe(0); // a completed-but-failed narrate is DATA, not an error
    expect(stderr()).toBe('');
    const parsed = JSON.parse(stdout().trim());
    expect(parsed.entryCount).toBe(0);
    expect(parsed.narration).toBeNull();
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]).toMatch(/zero narration entries/);
  });

  it('includes checkerReport when narrate returns one', async () => {
    (narrate as Mock).mockResolvedValue({ narration, checkerReport: { passed: true, fidelity_failures: [], symmetry: {} } });
    await runCli(['--spec', specPath, '--model', 'gemini', '--checker-model', 'c1']);
    const parsed = JSON.parse(stdout().trim());
    expect(parsed.checkerReport.passed).toBe(true);
  });

  it('bad spec file → SpecFileInvalid on stderr, exit 1, narrate not called', async () => {
    const r = await runCli(['--spec', join(dir, 'missing.json'), '--model', 'gemini']);
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(stderr().trim()).errorCode).toBe('SpecFileInvalid');
    expect(narrate).not.toHaveBeenCalled();
  });

  it('--skip-narration does NOT build a model adapter', async () => {
    (narrate as Mock).mockResolvedValue({ narration });
    await runCli(['--spec', specPath, '--model', 'gemini', '--skip-narration']);
    expect(createCLIAdapter).not.toHaveBeenCalled();
  });
});
