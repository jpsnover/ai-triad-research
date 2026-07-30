// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * URL content fetching with SSRF defenses — extracted from fileIO.ts (ADR-007).
 *
 * Fetches a remote HTTPS page and converts it to Markdown (markitdown, with an
 * HTML-strip fallback). All requests are vetted against private/internal address
 * ranges both at the hostname literal and at the DNS-resolved IP (t/720 L5,
 * DNS-rebinding / SSRF defense). Re-exported from fileIO.ts for a stable surface.
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import dns from 'dns';
import { execFile } from 'child_process';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';

function isPrivateIP(hostname: string): boolean {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => isNaN(n))) return false;
  // RFC 1918
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  // Loopback
  if (parts[0] === 127) return true;
  // Link-local (includes Azure IMDS 169.254.169.254)
  if (parts[0] === 169 && parts[1] === 254) return true;
  // CGNAT
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
  return false;
}

/**
 * L5 (t/720): classify a resolved IP literal (IPv4 or IPv6) as private/internal.
 * Extends isPrivateIP with IPv6 loopback/ULA/link-local + IPv4-mapped handling,
 * for vetting addresses DNS returns (rebinding / SSRF defense).
 */
export function isBlockedAddress(addr: string): boolean {
  let ip = addr.trim().toLowerCase().split('%')[0]; // drop IPv6 zone id (fe80::1%eth0)
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped IPv6
  if (mapped) ip = mapped[1];

  if (ip.includes(':')) { // IPv6
    if (ip === '::1' || ip === '::') return true;                 // loopback / unspecified
    if (ip.startsWith('fc') || ip.startsWith('fd')) return true;  // fc00::/7 unique-local
    if (/^fe[89ab]/.test(ip)) return true;                        // fe80::/10 link-local
    return false;
  }
  // IPv4 — reuse isPrivateIP, plus the 0.0.0.0/8 "this-network" block.
  if (Number(ip.split('.')[0]) === 0) return true;
  return isPrivateIP(ip);
}

/**
 * L5: resolve `hostname` and reject if ANY resolved address is private/internal.
 * Defends against DNS rebinding where a public-looking host resolves to an
 * internal IP (e.g. cloud metadata 169.254.169.254). Residual TOCTOU is
 * minimized by checking immediately before the fetch.
 */
async function assertHostnameResolvesPublic(hostname: string): Promise<string | null> {
  let addresses: { address: string }[];
  try {
    addresses = await dns.promises.lookup(hostname, { all: true });
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'file-io',
      level: 'warn',
      message: `DNS resolution failed for fetch host "${hostname}"`,
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    return 'DNS resolution failed';
  }
  if (addresses.length === 0) return 'DNS resolution returned no addresses';
  for (const a of addresses) {
    if (isBlockedAddress(a.address)) return 'URL resolves to a private/internal address';
  }
  return null;
}

function validateFetchUrl(url: string): string | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { /* telemetry — silent by design */ return 'Invalid URL'; }

  if (parsed.protocol !== 'https:') return 'Only HTTPS URLs are allowed';
  if (parsed.username || parsed.password) return 'URLs with credentials are not allowed';

  if (isPrivateIP(parsed.hostname)) return 'URLs targeting private/internal addresses are not allowed';
  if (parsed.hostname === 'localhost' || parsed.hostname.endsWith('.local'))
    return 'URLs targeting local addresses are not allowed';
  if (parsed.hostname.endsWith('.internal') || parsed.hostname.endsWith('.corp'))
    return 'URLs targeting internal addresses are not allowed';

  return null;
}

export async function fetchUrlContent(url: string): Promise<{ content: string; error?: string }> {
  const validationError = validateFetchUrl(url);
  if (validationError) return { content: '', error: validationError };
  // L5 (t/720): vet the resolved IP, not just the hostname literal (DNS rebinding / SSRF).
  const dnsError = await assertHostnameResolvesPublic(new URL(url).hostname);
  if (dnsError) return { content: '', error: dnsError };

  try {
    const resp = await fetch(url, { redirect: 'manual' });
    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get('location') || '';
      const redirectError = validateFetchUrl(location);
      if (redirectError) return { content: '', error: `Redirect blocked: ${redirectError}` };
      const redirectDnsError = await assertHostnameResolvesPublic(new URL(location).hostname);
      if (redirectDnsError) return { content: '', error: `Redirect blocked: ${redirectDnsError}` };
      const resp2 = await fetch(location, { redirect: 'manual' });
      if (!resp2.ok) return { content: '', error: `HTTP ${resp2.status}` };
      const html = await resp2.text();
      const markdown = await htmlToMarkdown(html);
      return { content: markdown };
    }
    if (!resp.ok) return { content: '', error: `HTTP ${resp.status}` };
    const html = await resp.text();
    const markdown = await htmlToMarkdown(html);
    return { content: markdown };
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
