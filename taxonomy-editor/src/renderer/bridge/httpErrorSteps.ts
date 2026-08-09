// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Maps an HTTP error status + response body to user-actionable ActionableError
 * "next steps". Pure and side-effect-free so it can be unit-tested at the leaf
 * (importing web-bridge.ts pulls in the whole bridge/resilience/crypto graph).
 */
export function nextStepsForStatus(status: number, responseText: string): string[] {
  if (status === 403) {
    try {
      const body = JSON.parse(responseText) as Record<string, unknown>;
      if (body.reason === 'anon_route_blocked') {
        const detail = typeof body.detail === 'string' ? body.detail : 'Sign in with GitHub at /.auth/login/github';
        return [detail];
      }
      const error = typeof body.error === 'string' ? body.error : undefined;
      if (error) return [error, 'Check your API key tier supports this backend'];
    } catch { /* telemetry — silent by design */ }
    return ['Verify your authentication', 'Check your API key tier supports this backend'];
  }
  if (status === 404) {
    // A structured "…not found" body means the resource is genuinely gone — the
    // server clearly ran and auth isn't the issue, so the generic "check the
    // server / verify auth" copy is misleading (t/2366). Give context-specific
    // steps for resource-not-found; fall through to generic only for unexpected
    // 404s (missing routes, HTML error pages — no "not found" in the body).
    let errorText: string | undefined;
    try {
      const body = JSON.parse(responseText) as Record<string, unknown>;
      errorText = typeof body.error === 'string' ? body.error : undefined;
    } catch { /* telemetry — silent by design: non-JSON 404 body (missing route / HTML), errorText stays undefined */ }
    const haystack = errorText ?? responseText;
    if (/not found/i.test(haystack)) {
      if (/debate/i.test(haystack)) {
        return [
          'This debate session was not found — it may have been deleted',
          'If signed in anonymously, clearing browser data may have rotated your session ID; old debates are no longer accessible',
        ];
      }
      return [
        'The requested item was not found — it may have been deleted or moved',
        'If signed in anonymously, clearing browser data may have rotated your session ID',
      ];
    }
  }
  return ['Check the server is running', 'Verify your authentication'];
}
