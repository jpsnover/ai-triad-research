/**
 * DEPRECATED stub (t/1426) — multi-key rotation removed.
 * Preserves the export contract for aiBackends.ts until t/1432 removes the
 * callWithKeyRotation consumer. All functions are trivial pass-throughs.
 */

export function isRateLimited(_backend: string, _index: number): boolean {
  return false;
}

export function markRateLimited(_backend: string, _index: number, _retryAfterMs: number): void {}

export function clearExpiredLimits(): void {}

export function getNextKey(_backend: string, keys: string[]): { key: string; index: number } | null {
  if (keys.length === 0) return null;
  return { key: keys[0], index: 0 };
}

export function _resetRotatorState(): void {}
