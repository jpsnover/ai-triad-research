// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Invariant guard: the Agent in githubRestClient is constructed from userland undici and
// passed as dispatcher: to Node's built-in fetch. This only works correctly when the
// userland major equals the node-bundled major — mismatched majors cause fetch to silently
// ignore the dispatcher, re-enabling TLS session caching (CVE-2026-58040, t/2053).
// Extracted to its own module so tests can import the function without triggering the
// module-level startup check in githubRestClient.ts. (t/2113)
export function assertUndiciMajorInvariant(
  userlandVersion: string,
  bundledVersion: string | undefined,
): void {
  if (!bundledVersion) return; // node <22 has no bundled undici — skip
  const userlandMajor = parseInt(userlandVersion.split('.')[0], 10);
  const bundledMajor = parseInt(bundledVersion.split('.')[0], 10);
  if (userlandMajor !== bundledMajor) {
    throw new Error(
      `undici major-version skew: userland ${userlandVersion} vs node built-in ${bundledVersion}. ` +
      `The GitHub dispatcher passes an undici.Agent as dispatcher: to Node's built-in fetch — ` +
      `mismatched majors cause fetch to silently ignore the dispatcher and fall back to TLS ` +
      `session caching (CVE-2026-58040 condition). Pin undici in package.json to match the ` +
      `node base-image's bundled major. (t/2053, t/2113)`,
    );
  }
}
