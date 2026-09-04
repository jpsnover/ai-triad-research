// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Result types for SSRF-guarded URL fetching (t/2482).
 * Node-only module — direct import path, never via a shared barrel
 * (barrels that the renderer can reach must not pull in node:http/node:dns).
 */

export type UrlFetchFailureReason =
  | 'ssrf-blocked'
  | 'timeout'
  | 'too-large'
  | 'http-error'
  | 'unsupported-content'
  | 'network'
  | 'too-many-redirects';

export type UrlFetchResult =
  | { ok: true; text: string; title: string | undefined; finalUrl: string; truncated: boolean }
  | { ok: false; reason: UrlFetchFailureReason; status?: number };

/**
 * Result of a binary (bytes) fetch — {@link fetchUrlForPromptBinary}, t/3311. Same SSRF-guarded
 * transport as {@link UrlFetchResult} but returns the raw response body instead of extracted text,
 * for content types the text path rejects (PDF op-ed sources). The success arm never carries
 * `unsupported-content` (binary accepts any content type); the failure arm reuses the shared reasons.
 */
export type UrlFetchBinaryResult =
  | { ok: true; bytes: Buffer; contentType: string; finalUrl: string }
  | { ok: false; reason: UrlFetchFailureReason; status?: number };

export interface UrlFetchOptions {
  /** Max response body size in bytes before abort. Default: 1.5 MB. */
  maxBytes?: number;
  /** Total request timeout in milliseconds. Default: 10 000. */
  timeoutMs?: number;
  /** Max redirect hops to follow. Default: 5. */
  maxRedirects?: number;
  /** Soft character budget: truncates extracted text to this length when set. */
  tokenBudget?: number;
  /**
   * Return the response body verbatim instead of the tag-stripped, sanitized
   * extraction. For callers that run their own converter over the raw markup
   * (the server's markitdown HTML→Markdown pass, t/720). Default: false.
   *
   * The SSRF transport guarantees — IP pinning, private-range blocking, size
   * cap, timeout, content-type gate — are unaffected; only the post-processing
   * of an already-fetched body changes. Raw output is NOT XSS-sanitized, so a
   * caller using this must treat the result as untrusted markup and never
   * re-render it as HTML.
   */
  rawBody?: boolean;
  /**
   * Predicate that returns true when an IP address should be blocked (private/SSRF).
   * Default: internal isPrivateIp (blocks RFC-1918, loopback, link-local, CGNAT, etc.).
   * Tests override this to return false so a localhost test server is reachable.
   */
  checkAddress?: (ip: string) => boolean;
}
