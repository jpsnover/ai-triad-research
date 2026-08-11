// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

// contentSanitizerCore imports decode-named-character-reference which only exists in
// taxonomy-editor/node_modules (not root). Mock it here so url-fetch tests don't
// depend on the taxonomy-editor install; sanitization behavior is tested in the
// server's own sanitizer test suite.
vi.mock('../sanitize/contentSanitizerCore.js', () => ({
  sanitizeText: (s: string) => s,
}));
import { fetchUrlForPrompt, isPrivateIp, normalizeIp } from './fetchUrlForPrompt.js';

// All happy-path tests override checkAddress to allow 127.0.0.1 (our test server).
// SSRF tests use the default isPrivateIp so 127.0.0.1 is naturally blocked.
const ALLOW_ALL: (ip: string) => boolean = () => false;

// ── Test server helpers ────────────────────────────────────────────────────

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

function startServer(handler: Handler): Promise<{ url: string; server: http.Server }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, server });
    });
    server.on('error', reject);
  });
}

function stopServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));
}

// ── normalizeIp unit tests (TL change #4) ─────────────────────────────────

describe('normalizeIp', () => {
  it('passes through plain IPv4 unchanged', () => {
    expect(normalizeIp('192.168.1.1')).toBe('192.168.1.1');
  });

  it('normalizes dotted-decimal mapped IPv6 to IPv4', () => {
    expect(normalizeIp('::ffff:192.168.1.1')).toBe('192.168.1.1');
    expect(normalizeIp('::FFFF:10.0.0.1')).toBe('10.0.0.1');
  });

  it('normalizes hex-word mapped IPv6 to IPv4', () => {
    // ::ffff:c0a8:0101 → 192.168.1.1
    expect(normalizeIp('::ffff:c0a8:0101')).toBe('192.168.1.1');
    // ::ffff:7f00:0001 → 127.0.0.1
    expect(normalizeIp('::ffff:7f00:0001')).toBe('127.0.0.1');
  });

  it('leaves non-mapped IPv6 unchanged', () => {
    expect(normalizeIp('::1')).toBe('::1');
    expect(normalizeIp('2001:db8::1')).toBe('2001:db8::1');
  });
});

// ── isPrivateIp unit tests (TL change #4 — via normalizeIp) ───────────────

describe('isPrivateIp', () => {
  it('blocks loopback', () => {
    expect(isPrivateIp('127.0.0.1')).toBe(true);
    expect(isPrivateIp('127.255.255.255')).toBe(true);
    expect(isPrivateIp('::1')).toBe(true);
  });

  it('blocks RFC-1918 ranges', () => {
    expect(isPrivateIp('10.0.0.1')).toBe(true);
    expect(isPrivateIp('172.16.0.1')).toBe(true);
    expect(isPrivateIp('172.31.255.255')).toBe(true);
    expect(isPrivateIp('192.168.0.1')).toBe(true);
  });

  it('blocks link-local / metadata endpoint', () => {
    expect(isPrivateIp('169.254.169.254')).toBe(true);
    expect(isPrivateIp('169.254.0.1')).toBe(true);
  });

  it('blocks CGNAT 100.64/10', () => {
    expect(isPrivateIp('100.64.0.1')).toBe(true);
    expect(isPrivateIp('100.127.255.255')).toBe(true);
  });

  it('allows public IPs', () => {
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    expect(isPrivateIp('1.1.1.1')).toBe(false);
    expect(isPrivateIp('93.184.216.34')).toBe(false);
  });

  it('blocks IPv4-mapped IPv6 loopback after normalization', () => {
    expect(isPrivateIp('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateIp('::ffff:7f00:0001')).toBe(true);
  });

  it('blocks IPv4-mapped IPv6 RFC-1918 after normalization', () => {
    expect(isPrivateIp('::ffff:c0a8:0101')).toBe(true);  // 192.168.1.1
    expect(isPrivateIp('::ffff:10.0.0.1')).toBe(true);
  });
});

// ── fetchUrlForPrompt integration tests ───────────────────────────────────

describe('fetchUrlForPrompt', () => {
  let server: http.Server | undefined;
  let baseUrl: string;

  afterEach(async () => {
    if (server) {
      await stopServer(server);
      server = undefined;
    }
  });

  // ── Happy path ────────────────────────────────────────────────────────

  it('fetches plain text and returns trimmed content', async () => {
    ({ url: baseUrl, server } = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('  Hello world  ');
    }));

    const result = await fetchUrlForPrompt(baseUrl, { checkAddress: ALLOW_ALL });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain('Hello world');
    expect(result.finalUrl).toBe(baseUrl);
    expect(result.truncated).toBe(false);
  });

  it('fetches HTML, extracts title and strips tags', async () => {
    ({ url: baseUrl, server } = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><head><title>Test Page</title></head><body><p>Hello <b>world</b></p></body></html>');
    }));

    const result = await fetchUrlForPrompt(baseUrl, { checkAddress: ALLOW_ALL });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.title).toBe('Test Page');
    expect(result.text).toContain('Hello');
    expect(result.text).toContain('world');
    expect(result.text).not.toContain('<b>');
  });

  it('follows redirects and returns finalUrl', async () => {
    ({ url: baseUrl, server } = await startServer((req, res) => {
      if (req.url === '/') {
        res.writeHead(301, { Location: '/dest' });
        res.end();
      } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('redirected');
      }
    }));

    const result = await fetchUrlForPrompt(baseUrl, { checkAddress: ALLOW_ALL });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.finalUrl).toContain('/dest');
    expect(result.text).toContain('redirected');
  });

  it('applies tokenBudget truncation', async () => {
    ({ url: baseUrl, server } = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ABCDEFGHIJ');
    }));

    const result = await fetchUrlForPrompt(baseUrl, { checkAddress: ALLOW_ALL, tokenBudget: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe('ABCDE');
    expect(result.truncated).toBe(true);
  });

  // ── SSRF blocking ─────────────────────────────────────────────────────

  it('blocks loopback via default isPrivateIp (no checkAddress override)', async () => {
    ({ url: baseUrl, server } = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('should not reach');
    }));
    // No checkAddress override — 127.0.0.1 is blocked by default isPrivateIp
    const result = await fetchUrlForPrompt(baseUrl);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('ssrf-blocked');
  });

  it('blocks when injectable checkAddress returns true for resolved IP', async () => {
    ({ url: baseUrl, server } = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('blocked');
    }));
    // Inject a predicate that blocks everything regardless
    const result = await fetchUrlForPrompt(baseUrl, { checkAddress: () => true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('ssrf-blocked');
  });

  // ── Error cases ───────────────────────────────────────────────────────

  it('returns http-error for non-2xx status', async () => {
    ({ url: baseUrl, server } = await startServer((_req, res) => {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    }));

    const result = await fetchUrlForPrompt(baseUrl, { checkAddress: ALLOW_ALL });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('http-error');
  });

  it('returns unsupported-content for non-text content-type', async () => {
    ({ url: baseUrl, server } = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/pdf' });
      res.end('%PDF');
    }));

    const result = await fetchUrlForPrompt(baseUrl, { checkAddress: ALLOW_ALL });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unsupported-content');
  });

  it('returns too-many-redirects after redirect cap (TL change #5)', async () => {
    ({ url: baseUrl, server } = await startServer((req, res) => {
      // Always redirect to /next, regardless of path — infinite loop
      res.writeHead(302, { Location: `${baseUrl}/next` });
      res.end();
    }));

    const result = await fetchUrlForPrompt(baseUrl, { checkAddress: ALLOW_ALL, maxRedirects: 2 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('too-many-redirects');
  });

  it('returns too-large when Content-Length exceeds maxBytes', async () => {
    ({ url: baseUrl, server } = await startServer((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Content-Length': '1000000',
      });
      res.end('x');
    }));

    const result = await fetchUrlForPrompt(baseUrl, { checkAddress: ALLOW_ALL, maxBytes: 100 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('too-large');
  });

  it('aborts mid-stream when body exceeds maxBytes (TL change #3)', async () => {
    // Server streams 200 bytes in two chunks of 150 each; maxBytes = 100
    ({ url: baseUrl, server } = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      // No Content-Length — so the pre-check won't catch it; the streaming counter must
      res.write('A'.repeat(60));
      res.write('B'.repeat(60));
      res.end('C'.repeat(60));
    }));

    const result = await fetchUrlForPrompt(baseUrl, { checkAddress: ALLOW_ALL, maxBytes: 100 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('too-large');
  });

  it('returns network for an invalid URL scheme', async () => {
    const result = await fetchUrlForPrompt('ftp://example.com/file', { checkAddress: ALLOW_ALL });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('network');
  });

  it('returns timeout when server hangs beyond timeoutMs', async () => {
    ({ url: baseUrl, server } = await startServer((_req, _res) => {
      // Never respond — simulate a hung server
    }));

    const result = await fetchUrlForPrompt(baseUrl, { checkAddress: ALLOW_ALL, timeoutMs: 100 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('timeout');
  }, 5000);
});
