// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * URL content fetching with SSRF defenses — extracted from fileIO.ts (ADR-007).
 *
 * Fetches a remote HTTPS page and converts it to Markdown (markitdown, with an
 * HTML-strip fallback). Re-exported from fileIO.ts for a stable surface.
 *
 * TRANSPORT IS NOT IMPLEMENTED HERE. Every request goes through
 * `lib/url-fetch/fetchUrlForPrompt` — the single hardened fetcher (t/2482).
 * This module contributes only the two things that are specific to the server's
 * `POST /api/fetch-url` route:
 *
 *   1. A STRICTER pre-flight than the shared fetcher applies (HTTPS-only, no
 *      credentials in the URL, no local/internal hostname suffixes). The shared
 *      fetcher permits http: for the debate path; this route must not.
 *   2. markitdown HTML→Markdown conversion of the fetched body, which is why it
 *      asks for `rawBody` rather than the fetcher's tag-stripped extraction.
 *
 * WHY THE DELEGATION (t/720 → t/2482 consolidation): this module previously ran
 * its own DNS pre-check and then called `fetch(url)`, which re-resolved the
 * hostname at connect time — a DNS-rebinding TOCTOU window. `fetchUrlForPrompt`
 * closes it by connecting to the IP it just validated (with SNI/Host preserved),
 * and additionally brings a request timeout, a response size cap with mid-stream
 * abort, a content-type gate, and per-hop redirect re-validation, none of which
 * existed here. Keeping two implementations is what let the weaker one end up on
 * the internet-facing route; do not reintroduce a local transport.
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import { fetchUrlForPrompt, isPrivateIp } from '../../../../lib/url-fetch/fetchUrlForPrompt.js';
import type { UrlFetchResult } from '../../../../lib/url-fetch/types.js';

/**
 * L5 (t/720): classify an IP literal (IPv4 or IPv6) as private/internal.
 *
 * Thin adapter over the shared `isPrivateIp` — it normalizes the address forms
 * DNS and URL parsing produce (surrounding whitespace, IPv6 zone ids like
 * `fe80::1%eth0`, bracketed literals like `[::1]`) and then applies the single
 * shared range table. Kept exported because `fileIO` re-exports it and the t/720
 * suite asserts against it directly.
 */
export function isBlockedAddress(addr: string): boolean {
  const ip = addr.trim().toLowerCase()
    .replace(/^\[|\]$/g, '')  // bracketed IPv6 literal from URL.hostname
    .split('%')[0];            // IPv6 zone id
  return isPrivateIp(ip);
}

/**
 * True when `host` is an IP literal rather than a domain name. Gating the
 * literal check on this is load-bearing: `isPrivateIp` classifies IPv6 by
 * string prefix, so feeding it a domain name would block every host beginning
 * `fc`/`fd` (ULA) or `ff` (multicast) — `fdsa.com`, `ffmpeg.org`. URL parsing
 * brackets IPv6 literals and normalizes every numeric IPv4 form (decimal,
 * octal, hex) to dotted-quad, so these two shapes are exhaustive.
 */
function isIpLiteral(host: string): boolean {
  return host.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function validateFetchUrl(url: string): string | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { /* telemetry — silent by design */ return 'Invalid URL'; }

  if (parsed.protocol !== 'https:') return 'Only HTTPS URLs are allowed';
  if (parsed.username || parsed.password) return 'URLs with credentials are not allowed';

  // Hostname-literal check. The authoritative check is the resolved-IP one
  // inside fetchUrlForPrompt; this one fails fast with a precise message and
  // catches bracketed IPv6 literals before they reach DNS.
  if (isIpLiteral(parsed.hostname) && isBlockedAddress(parsed.hostname))
    return 'URLs targeting private/internal addresses are not allowed';
  if (parsed.hostname === 'localhost' || parsed.hostname.endsWith('.local'))
    return 'URLs targeting local addresses are not allowed';
  if (parsed.hostname.endsWith('.internal') || parsed.hostname.endsWith('.corp'))
    return 'URLs targeting internal addresses are not allowed';

  return null;
}

/** Map a shared-fetcher failure onto this route's user-facing error string. */
function describeFailure(result: Extract<UrlFetchResult, { ok: false }>): string {
  switch (result.reason) {
    // Wording preserved from the pre-consolidation implementation — the t/720
    // suite matches on /private\/internal/.
    case 'ssrf-blocked': return 'URL resolves to a private/internal address';
    case 'http-error': return result.status ? `HTTP ${result.status}` : 'HTTP request failed';
    case 'timeout': return 'Request timed out';
    case 'too-large': return 'Response exceeded the maximum allowed size';
    case 'unsupported-content': return 'Only HTML and plain-text URLs can be fetched';
    case 'too-many-redirects': return 'Too many redirects';
    case 'network': return 'Network request failed (DNS, TLS, or connection error)';
  }
}

export async function fetchUrlContent(url: string): Promise<{ content: string; error?: string }> {
  const validationError = validateFetchUrl(url);
  if (validationError) return { content: '', error: validationError };

  try {
    // rawBody: markitdown converts the original markup; the fetcher's own
    // tag-stripped extraction would defeat the conversion.
    const result = await fetchUrlForPrompt(url, { rawBody: true });
    if (!result.ok) {
      const error = describeFailure(result);
      // Keep failed fetches diagnosable — the pre-consolidation code recorded
      // DNS failures here, and an ssrf-blocked result is a signal worth seeing
      // in the recorder rather than only in the caller's response body.
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'file-io',
        level: result.reason === 'ssrf-blocked' ? 'warn' : 'info',
        message: `URL fetch rejected (${result.reason})`,
        data: { url, reason: result.reason, status: result.status },
      });
      return { content: '', error };
    }
    return { content: await htmlToMarkdown(result.text) };
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'file-io',
      level: 'error',
      message: 'Operation failed',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    return { content: '', error: String(err) };
  }
}

async function htmlToMarkdown(html: string): Promise<string> {
  // mkdtemp inside the try so the finally cleanup runs even if writeFile throws
  // (predictable paths in os.tmpdir() are symlink-race targets — CodeQL js/insecure-temporary-file).
  let tmpDir: string | undefined;
  try {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aitriad-'));
    const tmpFile = path.join(tmpDir, 'input.html');
    await fs.writeFile(tmpFile, html, 'utf-8');
    return await new Promise<string>((resolve, reject) => {
      execFile('markitdown', [tmpFile], { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }, (err, out) => {
        if (err) reject(err); else resolve(out);
      });
    });
  } catch {
    /* telemetry — silent by design */
    return stripHtmlFallback(html);
  } finally {
    if (tmpDir) fs.rm(tmpDir, { recursive: true, force: true }).catch(() => { /* ignore */ });
  }
}

// Exported for testing. Note: this is a best-effort plain-text extractor for
// use when markitdown is unavailable — NOT an XSS sanitizer. Output is consumed
// as plain text / Markdown and is never re-rendered as HTML. Residual HTML tags
// in the output are harmless in a plain-text / LLM-input context.
export function stripHtmlFallback(html: string): string {
  const ENTITIES: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ',
  };
  // Single-pass entity decode. Fixes two CodeQL issues:
  //   js/double-escaping: chained replaces let &amp;lt; → &lt; → < (two-pass)
  //   js/incomplete-multi-character-sanitization: encoded tags bypass strip-then-decode
  const decoded = html.replace(/&([a-z][a-z0-9]*|#39);/gi,
    (_, e) => ENTITIES[e.toLowerCase()] ?? _);
  // Convert block-level tags to line breaks for readable plain-text output;
  // do NOT apply a catch-all tag stripper (CodeQL js/incomplete-multi-character-sanitization)
  // since this is not an XSS sanitizer — output goes to an LLM, never rendered as HTML.
  return decoded
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
