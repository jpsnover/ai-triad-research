// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node
// Unit-tests the CLI's pure logic (arg parsing + result→JSON mapping) and a child_process smoke that
// proves the CLI runs under plain `node` (the packaging goal: no build/tsx). The SSRF/fetch path
// itself is covered by fetchUrlForPrompt.test.ts — this file guards only the CLI wrapper (t/3324).
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { parseArgs, buildOutput } from './fetch-url-cli.mjs';

const CLI = fileURLToPath(new URL('./fetch-url-cli.mjs', import.meta.url));
const run = promisify(execFile);

describe('parseArgs', () => {
  it('parses <url> --out <file>', () => {
    expect(parseArgs(['https://x.test/', '--out', 'f.bin'])).toEqual({ url: 'https://x.test/', out: 'f.bin', opts: {} });
  });
  it('parses --max-bytes and --timeout-ms into opts', () => {
    const r = parseArgs(['https://x.test/', '--out', 'f', '--max-bytes', '500', '--timeout-ms', '2000']);
    expect(r.opts).toEqual({ maxBytes: 500, timeoutMs: 2000 });
  });
  it('throws on missing url', () => expect(() => parseArgs(['--out', 'f'])).toThrow(/missing <url>/));
  it('throws on missing --out', () => expect(() => parseArgs(['https://x.test/'])).toThrow(/missing --out/));
  it('throws on an unknown flag', () => expect(() => parseArgs(['https://x.test/', '--out', 'f', '--nope'])).toThrow(/unknown flag/));
  it('throws on a non-numeric --max-bytes', () => expect(() => parseArgs(['u', '--out', 'f', '--max-bytes', 'abc'])).toThrow(/must be a number/));
});

describe('buildOutput', () => {
  it('maps a success to status 200 + contentType + finalUrl + bodySnippet, exit 0', () => {
    const { exitCode, json } = buildOutput({
      ok: true, bytes: Buffer.from('%PDF-hello'), contentType: 'application/pdf', finalUrl: 'https://x.test/doc.pdf',
    });
    expect(exitCode).toBe(0);
    expect(json).toEqual({
      status: 200, contentType: 'application/pdf', finalUrl: 'https://x.test/doc.pdf', error: null, bodySnippet: '%PDF-hello',
    });
  });
  it('truncates the bodySnippet to ~1KB', () => {
    const { json } = buildOutput({ ok: true, bytes: Buffer.alloc(5000, 0x61), contentType: 'text/html', finalUrl: 'u' });
    expect(json.bodySnippet.length).toBe(1024);
  });
  it('carries the HTTP status on an http-error, exit 1', () => {
    const { exitCode, json } = buildOutput({ ok: false, reason: 'http-error', status: 403 });
    expect(exitCode).toBe(1);
    expect(json).toEqual({ status: 403, contentType: null, finalUrl: null, error: 'http-error', bodySnippet: null });
  });
  it('maps a transport failure to status null + error reason, exit 1', () => {
    const { exitCode, json } = buildOutput({ ok: false, reason: 'ssrf-blocked' });
    expect(exitCode).toBe(1);
    expect(json).toEqual({ status: null, contentType: null, finalUrl: null, error: 'ssrf-blocked', bodySnippet: null });
  });
});

describe('CLI process (plain node)', () => {
  it('runs under plain `node` and reports a usage error (exit 1, parseable JSON)', async () => {
    // Also the packaging proof: if the CLI could not import the .ts fetcher under plain node
    // type-stripping, this would fail with ERR_MODULE_NOT_FOUND instead of our usage JSON.
    await run('node', [CLI]).then(
      () => { throw new Error('expected non-zero exit'); },
      (err) => {
        expect(err.code).toBe(1);
        const out = JSON.parse(err.stdout);
        expect(out.error).toMatch(/^usage: missing <url>/);
        expect(out.status).toBeNull();
      },
    );
  }, 15_000);
});
