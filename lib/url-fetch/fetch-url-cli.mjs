// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Standalone CLI over the SSRF-guarded binary fetcher (t/3324, TL contract t/3310#1). PS-standalone
// cmdlets (Import-AITriadDocument, Repair-PovLineage, Get-OpEdSource) can't call the Node function,
// so they invoke this:
//
//   node lib/url-fetch/fetch-url-cli.mjs <url> --out <file> [--max-bytes N] [--timeout-ms N]
//
// It writes the response bytes to --out and prints ONE line of JSON to stdout:
//   { status, contentType, finalUrl, error, bodySnippet }
//     status      : 200 on success; the HTTP code on an http-error; null on a transport failure
//                   (ssrf-blocked / timeout / too-large / too-many-redirects / network).
//     contentType : the response Content-Type on success, else null.
//     finalUrl    : the post-redirect URL on success, else null.
//     error       : null on success; the failure reason string otherwise.
//     bodySnippet : first ~1KB of the body decoded utf-8 (PS soft-404 liveness heuristic — a 200
//                   whose body is an error page), else null. Lossy for binary; a heuristic only.
// Exit code: 0 on success, 1 on any failure (incl. usage errors). PS can branch on either the exit
// code or the parsed JSON. Runs under plain `node` type-stripping — the fetcher's eager imports are
// node builtins only (the sanitizer is lazy in the text path, which this CLI never invokes).
//
// The fetcher enforces every SSRF/redirect/timeout/maxBytes guard; this CLI adds no network logic.
import { writeFileSync } from 'node:fs';
import { fetchUrlForPromptBinary } from './fetchUrlForPrompt.ts';

const SNIPPET_BYTES = 1024;

/** Parse `<url> --out <file> [--max-bytes N] [--timeout-ms N]`. Throws on missing/invalid args. */
export function parseArgs(argv) {
  let url;
  const opts = {};
  let out;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') { out = argv[++i]; }
    else if (a === '--max-bytes') { opts.maxBytes = Number(argv[++i]); }
    else if (a === '--timeout-ms') { opts.timeoutMs = Number(argv[++i]); }
    else if (a.startsWith('--')) { throw new Error(`unknown flag ${a}`); }
    else if (url === undefined) { url = a; }
    else { throw new Error(`unexpected argument ${a}`); }
  }
  if (!url) throw new Error('missing <url>');
  if (!out) throw new Error('missing --out <file>');
  if (opts.maxBytes !== undefined && !Number.isFinite(opts.maxBytes)) throw new Error('--max-bytes must be a number');
  if (opts.timeoutMs !== undefined && !Number.isFinite(opts.timeoutMs)) throw new Error('--timeout-ms must be a number');
  return { url, out, opts };
}

/** Map a UrlFetchBinaryResult to the CLI's { exitCode, json } (pure — unit-tested). */
export function buildOutput(result) {
  if (result.ok) {
    return {
      exitCode: 0,
      json: {
        status: 200,
        contentType: result.contentType,
        finalUrl: result.finalUrl,
        error: null,
        bodySnippet: result.bytes.subarray(0, SNIPPET_BYTES).toString('utf-8'),
      },
    };
  }
  return {
    exitCode: 1,
    json: {
      status: result.status ?? null,   // present only on http-error
      contentType: null,
      finalUrl: null,
      error: result.reason,
      bodySnippet: null,
    },
  };
}

function emit(json, exitCode) {
  process.stdout.write(JSON.stringify(json) + '\n');
  process.exitCode = exitCode;
}

async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (e) {
    emit({ status: null, contentType: null, finalUrl: null, error: `usage: ${e.message}`, bodySnippet: null }, 1);
    return;
  }
  const result = await fetchUrlForPromptBinary(parsed.url, parsed.opts);
  const { exitCode, json } = buildOutput(result);
  if (result.ok) writeFileSync(parsed.out, result.bytes);
  emit(json, exitCode);
}

// Run only when invoked directly (not when a test imports parseArgs/buildOutput).
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/url-fetch/fetch-url-cli.mjs')) {
  await main(process.argv.slice(2));
}
