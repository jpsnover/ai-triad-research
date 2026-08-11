// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * SSRF-guarded URL fetch for prompt grounding (t/2482).
 *
 * Security design — all 5 TL-required changes implemented (t/2482#2):
 *
 * 1. INJECTABLE checkAddress PREDICATE — UrlFetchOptions.checkAddress replaces a
 *    hardcoded isPrivateIp call so tests can pass `() => false` to allow a localhost
 *    server without needing to mock dns.lookup. Default = isPrivateIp.
 *
 * 2. IP-PINNED REQUESTS (closes DNS-rebind TOCTOU) — requests use node:http /
 *    node:https with `host: resolvedIp` (connect to the IP we just validated),
 *    `servername: hostname` (SNI + cert validation against original hostname), and
 *    `Host: hostname` header (correct HTTP/1.1 virtual hosting). This prevents the
 *    window between DNS pre-check and TCP connect where a rebind can swap the IP.
 *
 * 3. MID-STREAM maxBytes ABORT — Content-Length is pre-checked before streaming
 *    begins; the body reader also maintains a running byte counter and calls
 *    res.destroy() + resolves null the moment it crosses maxBytes, so oversized
 *    responses never fully buffer.
 *
 * 4. IPv4-MAPPED IPv6 NORMALIZATION — addresses like `::ffff:127.0.0.1` or
 *    `::ffff:c0a8:0101` are normalized to their IPv4 equivalents before the
 *    private-range checks, preventing a bypass via the dual-stack representation.
 *
 * 5. too-many-redirects IS A DISTINCT REASON — redirect cap exhaustion returns
 *    `{ ok: false, reason: 'too-many-redirects' }` rather than 'network', so
 *    callers can surface a precise message and telemetry can distinguish redirect
 *    loops from hard connectivity failures.
 *
 * Node-only: imports node:dns, node:http, node:https. Never export through a barrel
 * that the renderer can reach — direct import path only.
 */

import { promises as dns } from 'node:dns';
import * as http from 'node:http';
import * as https from 'node:https';
import { sanitizeText } from '../sanitize/contentSanitizerCore.js';
import type { UrlFetchOptions, UrlFetchResult } from './types.js';

const DEFAULT_MAX_BYTES = 1_572_864; // 1.5 MB
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 5;

// ── IP normalization + private-range check ─────────────────────────────────

/**
 * Normalize an IPv4-mapped IPv6 address to its IPv4 form.
 * TL change #4: `::ffff:a.b.c.d` (dotted-decimal) and `::ffff:XXYY:ZZWW`
 * (hex-word) both collapse to `a.b.c.d` before range checks so dual-stack
 * representations cannot bypass the RFC-1918 / loopback blocks.
 */
export function normalizeIp(ip: string): string {
  // Dotted-decimal form: ::ffff:192.168.1.1
  const dotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(ip);
  if (dotted) return dotted[1];
  // Hex-word form: ::ffff:c0a8:0101  (two 16-bit hex groups)
  const hexWord = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
  if (hexWord) {
    const hi = parseInt(hexWord[1], 16);
    const lo = parseInt(hexWord[2], 16);
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  }
  return ip;
}

/** Returns true when the (already-normalized) IP should be blocked. */
export function isPrivateIp(ip: string): boolean {
  const norm = normalizeIp(ip);

  // IPv4 range checks
  const parts = norm.split('.');
  if (parts.length === 4) {
    const [a, b, c] = parts.map(Number);
    if (a === 127) return true;                            // loopback
    if (a === 10) return true;                             // RFC-1918 10/8
    if (a === 172 && b >= 16 && b <= 31) return true;    // RFC-1918 172.16/12
    if (a === 192 && b === 168) return true;              // RFC-1918 192.168/16
    if (a === 169 && b === 254) return true;              // link-local / metadata
    if (a === 0) return true;                              // unspecified
    if (a === 100 && (b & 0xc0) === 64) return true;     // CGNAT 100.64/10
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a === 192 && b === 0 && c === 2) return true;    // TEST-NET-1
    if (a === 255) return true;                            // broadcast
    return false;
  }

  // IPv6 checks (after normalization, mapped addresses are already IPv4 above)
  const lower = norm.toLowerCase();
  if (lower === '::1') return true;                 // loopback
  if (lower === '::') return true;                  // unspecified
  if (lower.startsWith('fe80:')) return true;       // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA
  if (lower.startsWith('ff')) return true;          // multicast
  if (lower.startsWith('64:ff9b:')) return true;   // NAT64
  return false;
}

// ── IP-pinned HTTP request (TL change #2) ─────────────────────────────────

function makeRequest(
  resolvedIp: string,
  hostname: string,
  port: number,
  path: string,
  isHttps: boolean,
  timeoutMs: number,
): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const options: http.RequestOptions & https.RequestOptions = {
      method: 'GET',
      host: resolvedIp,       // connect to the pre-validated IP — closes rebind TOCTOU
      servername: hostname,   // SNI for TLS + certificate CN/SAN validation
      port,
      path,
      headers: {
        'Host': hostname,     // correct HTTP/1.1 virtual-host routing
        'User-Agent': 'AI-Triad-Research/1.0 (url-fetch)',
        'Accept': 'text/html, text/plain;q=0.9, */*;q=0.1',
        'Accept-Encoding': 'identity', // avoid gzip complications
      },
    };
    const lib = isHttps ? https : http;
    const req = lib.request(options, resolve);
    req.setTimeout(timeoutMs, () => {
      timedOut = true;
      req.destroy();
    });
    req.on('error', err => {
      if (timedOut) reject(Object.assign(new Error('timeout'), { isTimeout: true }));
      else reject(err);
    });
    req.end();
  });
}

// ── Streaming body reader with mid-stream abort (TL change #3) ────────────

function readBody(res: http.IncomingMessage, maxBytes: number): Promise<string | null> {
  return new Promise(resolve => {
    let settled = false;
    const done = (val: string | null) => { if (!settled) { settled = true; resolve(val); } };
    const chunks: Buffer[] = [];
    let total = 0;
    res.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        res.destroy(); // abort mid-stream immediately
        done(null);
        return;
      }
      chunks.push(chunk);
    });
    res.on('end', () => done(Buffer.concat(chunks).toString('utf-8')));
    res.on('error', () => done(null));
    // destroy() triggers 'close' but not 'end' — ensure we resolve
    res.on('close', () => done(null));
  });
}

// ── HTML → plain text ──────────────────────────────────────────────────────

function decodeBasicEntities(s: string): string {
  // Numeric refs first, then named, then &amp; LAST — prevents &amp;lt; double-unescaping to <
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&');
}

function htmlToText(html: string): { text: string; title: string | undefined } {
  const titleMatch = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  const title = titleMatch ? decodeBasicEntities(titleMatch[1].trim()) : undefined;

  let text = html
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<script\b[\s\S]*?<\/script\b[^>]*>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style\b[^>]*>/gi, ' ')
    .replace(/<(?:br|\/p|\/div|\/h[1-6]|\/li|\/tr|\/blockquote)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  text = decodeBasicEntities(text)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text, title };
}

// ── Main entry point ───────────────────────────────────────────────────────

export async function fetchUrlForPrompt(
  url: string,
  opts: UrlFetchOptions = {},
): Promise<UrlFetchResult> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const checkAddress = opts.checkAddress ?? isPrivateIp; // TL change #1

  let currentUrl = url;
  let redirectCount = 0;

  for (;;) {
    let parsed: URL;
    try {
      parsed = new URL(currentUrl);
    } catch {
      return { ok: false, reason: 'network' };
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, reason: 'network' };
    }

    const isHttps = parsed.protocol === 'https:';
    const hostname = parsed.hostname;
    const port = parsed.port ? parseInt(parsed.port, 10) : (isHttps ? 443 : 80);
    const path = (parsed.pathname || '/') + parsed.search;

    // DNS pre-resolution + SSRF check (TL changes #1, #4)
    let resolvedIp: string;
    try {
      const addrs = await dns.lookup(hostname, { all: true });
      if (!addrs.length) return { ok: false, reason: 'network' };
      // Normalize each address (IPv4-mapped IPv6) then apply the check
      const firstAllowed = addrs.find(a => !checkAddress(normalizeIp(a.address)));
      if (!firstAllowed) return { ok: false, reason: 'ssrf-blocked' };
      resolvedIp = firstAllowed.address;
    } catch {
      return { ok: false, reason: 'network' };
    }

    // IP-pinned request (TL change #2)
    let res: http.IncomingMessage;
    try {
      res = await makeRequest(resolvedIp, hostname, port, path, isHttps, timeoutMs);
    } catch (err) {
      if ((err as { isTimeout?: boolean }).isTimeout) return { ok: false, reason: 'timeout' };
      return { ok: false, reason: 'network' };
    }

    // Redirect handling (TL change #5 — distinct reason)
    if (res.statusCode !== undefined && res.statusCode >= 300 && res.statusCode < 400) {
      const location = res.headers.location;
      res.destroy();
      if (!location) return { ok: false, reason: 'network' };
      if (redirectCount >= maxRedirects) return { ok: false, reason: 'too-many-redirects' };
      redirectCount++;
      try {
        currentUrl = new URL(location, currentUrl).href;
      } catch {
        return { ok: false, reason: 'network' };
      }
      continue;
    }

    // HTTP errors
    if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
      res.destroy();
      return { ok: false, reason: 'http-error' };
    }

    // Content-Type gate — only fetch text (HTML or plain)
    const contentType = res.headers['content-type'] ?? '';
    const isHtml = contentType.includes('text/html');
    const isText = contentType.includes('text/plain');
    if (!isHtml && !isText) {
      res.destroy();
      return { ok: false, reason: 'unsupported-content' };
    }

    // Content-Length pre-check (TL change #3 — first half)
    const clHeader = res.headers['content-length'];
    if (clHeader !== undefined && parseInt(clHeader, 10) > maxBytes) {
      res.destroy();
      return { ok: false, reason: 'too-large' };
    }

    // Stream with mid-stream abort (TL change #3 — second half)
    const raw = await readBody(res, maxBytes);
    if (raw === null) return { ok: false, reason: 'too-large' };

    // HTML → text, then XSS safety pass via shared core
    const { text: extracted, title } = isHtml ? htmlToText(raw) : { text: raw, title: undefined };
    const safe = sanitizeText(extracted);

    // Soft token-budget truncation
    let text = safe;
    let truncated = false;
    if (opts.tokenBudget !== undefined && text.length > opts.tokenBudget) {
      text = text.slice(0, opts.tokenBudget);
      truncated = true;
    }

    return { ok: true, text, title, finalUrl: currentUrl, truncated };
  }
}
