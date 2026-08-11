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
  | { ok: false; reason: UrlFetchFailureReason };

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
   * Predicate that returns true when an IP address should be blocked (private/SSRF).
   * Default: internal isPrivateIp (blocks RFC-1918, loopback, link-local, CGNAT, etc.).
   * Tests override this to return false so a localhost test server is reachable.
   */
  checkAddress?: (ip: string) => boolean;
}
