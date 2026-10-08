// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Pure unit tests for the code-referenced-models list (t/3553 item 1; TL checklist e/271#12 items 3, 4, 6; SO e/271#15).

import { describe, it, expect } from 'vitest';
import {
  buildCodeReferencedModels,
  missingFromList,
  parseCodeReferencedModels,
  parsePsEmitterOutput,
  registeredLiteralIds,
  serializeCodeReferencedModels,
  staleExtras,
  REGENERATE_HINT,
} from './codeReferencedModels.js';
import { SUPPRESS_MARKER } from './modelLiteralLint.js';

const VALID = new Set(['claude-opus-5', 'gemini-3.5-flash-lite', 'gpt-6-mini']);

describe('registeredLiteralIds: membership is by registration, not by marker (SO e/271#6 (c))', () => {
  it('a registered literal is in, with or without a marker; an unregistered one is out, with or without a marker', () => {
    const ids = registeredLiteralIds(
      [
        { path: 'a.ts', content: `const a = 'claude-opus-5';` },
        { path: 'b.ts', content: `const b = 'gemini-3.5-flash-lite'; // ${SUPPRESS_MARKER}-pin marked AND registered` },
        { path: 'c.ts', content: `const c = 'gemini-embed-1'; // ${SUPPRESS_MARKER}-external marked, NOT registered` },
        { path: 'd.ts', content: `const d = 'claude-retired-9';` },
      ],
      VALID,
    );
    expect(ids.sort()).toEqual(['claude-opus-5', 'gemini-3.5-flash-lite']);
  });
});

describe('buildCodeReferencedModels: one sort point, registered only, byte-stable (TL e/271#2)', () => {
  it('unions and sorts both sources, de-duplicates, and drops unregistered ids', () => {
    const f = buildCodeReferencedModels(['gpt-6-mini', 'claude-opus-5', 'claude-opus-5'], ['claude-opus-5', 'not-registered-1'], VALID);
    expect(f.ids).toEqual(['claude-opus-5', 'gpt-6-mini']);
    expect(f.bySource).toEqual({ ps: ['claude-opus-5'], ts: ['claude-opus-5', 'gpt-6-mini'] });
  });

  it('regenerating from the same hits in any order gives byte-identical output', () => {
    const a = serializeCodeReferencedModels(buildCodeReferencedModels(['gpt-6-mini', 'claude-opus-5'], ['gemini-3.5-flash-lite'], VALID));
    const b = serializeCodeReferencedModels(buildCodeReferencedModels(['claude-opus-5', 'gpt-6-mini', 'gpt-6-mini'], ['gemini-3.5-flash-lite'], VALID));
    expect(b).toBe(a);
    expect(a.endsWith('}\n')).toBe(true);
  });
});

describe('freshness helpers', () => {
  const list = buildCodeReferencedModels(['claude-opus-5', 'gpt-6-mini'], ['gemini-3.5-flash-lite'], VALID);

  it('missingFromList: a found id that is not listed is missing (the blocking arm); listed ids are not', () => {
    expect(missingFromList(['claude-opus-5', 'gemini-3.5-flash-lite'], list)).toEqual([]);
    const dropped = { ...list, ids: list.ids.filter((id) => id !== 'claude-opus-5') };
    expect(missingFromList(['claude-opus-5'], dropped)).toEqual(['claude-opus-5']);
  });

  it('missingFromList checks the union: an id listed only under the other source still counts as listed', () => {
    expect(missingFromList(['gemini-3.5-flash-lite'], list)).toEqual([]);
  });

  it('staleExtras: entries for a source that its lint no longer finds', () => {
    expect(staleExtras(list, 'ts', ['claude-opus-5'])).toEqual(['gpt-6-mini']);
    expect(staleExtras(list, 'ps', ['gemini-3.5-flash-lite'])).toEqual([]);
  });

  it('the fix text names the command and pwsh 7', () => {
    expect(REGENERATE_HINT).toContain('npm run gen:code-referenced-models');
    expect(REGENERATE_HINT).toContain('requires pwsh 7');
  });
});

describe('parseCodeReferencedModels: a malformed list fails loudly', () => {
  it('accepts a generated file', () => {
    const f = buildCodeReferencedModels(['claude-opus-5'], [], VALID);
    expect(parseCodeReferencedModels(JSON.parse(serializeCodeReferencedModels(f)))).toEqual(f);
  });

  it.each([
    ['a bare array', ['claude-opus-5']],
    ['missing bySource', { ids: [] }],
    ['a non-string id', { ids: [1], bySource: { ps: [], ts: [] } }],
    ['null', null],
  ])('throws on %s', (_name, raw) => {
    expect(() => parseCodeReferencedModels(raw)).toThrow(/malformed/);
  });
});

describe('parsePsEmitterOutput: fails closed, never reads a bad run as "no PS literals" (SO e/271#15)', () => {
  const run = (stdout: string, status: number | null = 0, stderr = '', error?: Error) => ({ stdout, status, stderr, error });

  it('accepts [] (zero ids) and ["x"] (one id) as arrays', () => {
    expect(parsePsEmitterOutput(run('[]\n'))).toEqual([]);
    expect(parsePsEmitterOutput(run('[\n  "claude-opus-5"\n]\n'))).toEqual(['claude-opus-5']);
  });

  it('refuses a bare string: the ConvertTo-Json one-element pitfall', () => {
    expect(() => parsePsEmitterOutput(run('"claude-opus-5"'))).toThrow(/JSON array of strings.*-AsArray/);
  });

  it('refuses null, empty stdout, and non-string elements', () => {
    expect(() => parsePsEmitterOutput(run('null'))).toThrow(/JSON array of strings/);
    expect(() => parsePsEmitterOutput(run('   \n'))).toThrow(/printed nothing/);
    expect(() => parsePsEmitterOutput(run('[1]'))).toThrow(/JSON array of strings/);
    expect(() => parsePsEmitterOutput(run('not json'))).toThrow(/non-JSON/);
  });

  it('refuses a non-zero exit even when stdout looks valid, and includes stderr', () => {
    expect(() => parsePsEmitterOutput(run('[]', 1, 'ModelLiteralScan.ps1 not found'))).toThrow(/exited 1.*ModelLiteralScan\.ps1 not found/);
    expect(() => parsePsEmitterOutput(run('[]', null))).toThrow(/exited null/);
  });

  it('refuses a spawn failure and names pwsh 7', () => {
    expect(() => parsePsEmitterOutput(run('', null, '', new Error('spawn pwsh ENOENT')))).toThrow(/requires pwsh 7.*ENOENT/);
  });
});
