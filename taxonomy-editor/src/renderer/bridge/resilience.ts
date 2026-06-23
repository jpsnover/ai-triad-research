// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { ActionableError } from '@lib/debate/errors';
import { getGlobalRecorder } from '@lib/flight-recorder/index';

// ── Public types ──

export type EndpointCategory = 'read' | 'mutation' | 'ai' | 'admin' | 'telemetry';
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';
export type ThrottleState = 'NORMAL' | 'THROTTLED';

export interface ResilienceStatus {
  circuits: Record<EndpointCategory, { state: CircuitState; consecutiveFailures: number }>;
  throttles: Record<EndpointCategory, { state: ThrottleState; p95Ms: number; baselineMs: number }>;
}

export interface ResilientFetchOptions {
  timeoutMs: number;
  maxRetries: number;
  critical: boolean;
  category: EndpointCategory;
}

// ── Constants ──

const CIRCUIT_THRESHOLD = 5;
const CIRCUIT_COOLDOWN_MS = 60_000;

const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 30_000;
const RETRY_JITTER_MAX_MS = 500;
const MAX_RETRY_AFTER_MS = 30_000;

const THROTTLE_WINDOW_SIZE = 20;
const THROTTLE_BASELINE_COUNT = 10;
const THROTTLE_ENTER_FACTOR = 2.0;
const THROTTLE_EXIT_FACTOR = 1.5;
const THROTTLE_DELAY_MS = 2_000;

const ALL_CATEGORIES: EndpointCategory[] = ['read', 'mutation', 'ai', 'admin', 'telemetry'];

// ── Endpoint categorization ──

export function categorizeEndpoint(path: string, method: string): EndpointCategory {
  if (path === '/api/admin/telemetry' || path === '/api/admin/errors') return 'telemetry';
  if (path.startsWith('/api/ai/')) return 'ai';
  if (path.startsWith('/api/admin/')) return 'admin';
  if (method === 'GET') return 'read';
  return 'mutation';
}

// ── Circuit breaker ──

interface CircuitEntry {
  state: CircuitState;
  consecutiveFailures: number;
  lastFailureTime: number;
}

const circuits = new Map<EndpointCategory, CircuitEntry>();

function getCircuit(cat: EndpointCategory): CircuitEntry {
  let e = circuits.get(cat);
  if (!e) {
    e = { state: 'CLOSED', consecutiveFailures: 0, lastFailureTime: 0 };
    circuits.set(cat, e);
  }
  return e;
}

function checkCircuit(cat: EndpointCategory, path: string): void {
  const c = getCircuit(cat);
  if (c.state === 'CLOSED') return;
  if (c.state === 'OPEN') {
    const elapsed = Date.now() - c.lastFailureTime;
    if (elapsed >= CIRCUIT_COOLDOWN_MS) {
      c.state = 'HALF_OPEN';
      recordEvent('network.circuit_half_open', 'warn',
        `Circuit '${cat}' → HALF_OPEN, allowing probe request`);
      notifyListeners();
      return;
    }
    const remaining = Math.ceil((CIRCUIT_COOLDOWN_MS - elapsed) / 1000);
    throw new ActionableError({
      goal: `Make request to ${path}`,
      problem: `Circuit breaker OPEN for '${cat}' after ${c.consecutiveFailures} consecutive failures. ${remaining}s cooldown remaining.`,
      location: 'web-bridge/resilience',
      nextSteps: ['Wait for the cooldown period to expire', 'Check whether the server is healthy'],
    });
  }
  // HALF_OPEN — allow one probe request through
}

function onCircuitSuccess(cat: EndpointCategory): void {
  const c = getCircuit(cat);
  const wasNotClosed = c.state !== 'CLOSED';
  if (c.state === 'HALF_OPEN') {
    recordEvent('network.circuit_closed', 'info',
      `Circuit '${cat}' → CLOSED after successful probe`);
  }
  c.consecutiveFailures = 0;
  c.state = 'CLOSED';
  if (wasNotClosed) notifyListeners();
}

function onCircuitFailure(cat: EndpointCategory): void {
  const c = getCircuit(cat);
  const prevState = c.state;
  c.consecutiveFailures++;
  c.lastFailureTime = Date.now();
  if (c.state === 'HALF_OPEN') {
    c.state = 'OPEN';
    recordEvent('network.circuit_open', 'warn',
      `Circuit '${cat}' re-OPEN after failed probe`);
  } else if (c.consecutiveFailures >= CIRCUIT_THRESHOLD && c.state === 'CLOSED') {
    c.state = 'OPEN';
    recordEvent('network.circuit_open', 'error',
      `Circuit '${cat}' → OPEN after ${c.consecutiveFailures} consecutive failures`);
  }
  if (c.state !== prevState) notifyListeners();
}

// ── Adaptive throttle ──

interface ThrottleEntry {
  latencies: number[];
  baseline: number;
  state: ThrottleState;
}

const throttles = new Map<EndpointCategory, ThrottleEntry>();

function getThrottle(cat: EndpointCategory): ThrottleEntry {
  let e = throttles.get(cat);
  if (!e) {
    e = { latencies: [], baseline: 0, state: 'NORMAL' };
    throttles.set(cat, e);
  }
  return e;
}

function computeP95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(Math.ceil(0.95 * sorted.length) - 1, sorted.length - 1);
  return sorted[idx];
}

function recordLatency(cat: EndpointCategory, ms: number): void {
  const t = getThrottle(cat);
  t.latencies.push(ms);
  if (t.latencies.length > THROTTLE_WINDOW_SIZE) t.latencies.shift();

  if (t.latencies.length <= THROTTLE_BASELINE_COUNT) {
    t.baseline = t.latencies.reduce((a, b) => a + b, 0) / t.latencies.length;
    return;
  }
  if (t.baseline === 0) {
    t.baseline = t.latencies.slice(0, THROTTLE_BASELINE_COUNT)
      .reduce((a, b) => a + b, 0) / THROTTLE_BASELINE_COUNT;
  }

  const p95 = computeP95(t.latencies);
  if (t.state === 'NORMAL' && p95 > t.baseline * THROTTLE_ENTER_FACTOR) {
    t.state = 'THROTTLED';
    recordEvent('network.throttle_active', 'warn',
      `Throttle '${cat}' activated: p95=${Math.round(p95)}ms > ${THROTTLE_ENTER_FACTOR}× baseline ${Math.round(t.baseline)}ms`);
    notifyListeners();
  } else if (t.state === 'THROTTLED' && p95 < t.baseline * THROTTLE_EXIT_FACTOR) {
    t.state = 'NORMAL';
    recordEvent('network.throttle_cleared', 'info',
      `Throttle '${cat}' cleared: p95=${Math.round(p95)}ms`);
    notifyListeners();
  }
}

async function maybeThrottleDelay(cat: EndpointCategory, critical: boolean): Promise<void> {
  const t = getThrottle(cat);
  if (t.state === 'THROTTLED' && !critical) {
    await new Promise<void>(r => setTimeout(r, THROTTLE_DELAY_MS));
  }
}

// ── Retry helpers ──

function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

function isRetryableError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof TypeError) return true;
  return false;
}

function computeBackoff(attempt: number): number {
  const delay = Math.min(RETRY_BASE_DELAY_MS * Math.pow(2, attempt), RETRY_MAX_DELAY_MS);
  return delay + Math.random() * RETRY_JITTER_MAX_MS;
}

function parseRetryAfter(res: Response): number | null {
  const h = res.headers.get('Retry-After');
  if (!h) return null;
  const secs = parseInt(h, 10);
  if (!isNaN(secs)) return secs * 1000;
  const ms = Date.parse(h);
  if (!isNaN(ms)) return Math.max(0, ms - Date.now());
  return null;
}

// ── Main entry point ──

export async function resilientFetch(
  path: string,
  init: RequestInit,
  opts: ResilientFetchOptions,
): Promise<Response> {
  const { timeoutMs, maxRetries, critical, category } = opts;

  checkCircuit(category, path);
  await maybeThrottleDelay(category, critical);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const start = performance.now();

    try {
      const res = await fetch(path, { ...init, signal: controller.signal });
      clearTimeout(timer);
      recordLatency(category, performance.now() - start);

      if (res.ok || !isRetryableStatus(res.status)) {
        onCircuitSuccess(category);
        return res;
      }

      // Retryable HTTP status (5xx or 429)
      onCircuitFailure(category);

      if (attempt < maxRetries) {
        const retryAfterMs = res.status === 429 ? parseRetryAfter(res) : null;
        if (retryAfterMs !== null && retryAfterMs > MAX_RETRY_AFTER_MS) {
          return res;
        }
        const backoff = retryAfterMs ?? computeBackoff(attempt);
        recordEvent('network.retry', 'warn',
          `Retry ${init.method ?? 'GET'} ${path} (${attempt + 2}/${maxRetries + 1}, HTTP ${res.status}, wait ${Math.round(backoff)}ms)`);
        res.body?.cancel().catch(() => { /* telemetry — silent by design: discarding intermediate response body */ });
        await new Promise<void>(r => setTimeout(r, backoff));
        checkCircuit(category, path);
        continue;
      }

      return res;
    } catch (err) {
      clearTimeout(timer);
      recordLatency(category, performance.now() - start);
      onCircuitFailure(category);

      if (attempt < maxRetries && isRetryableError(err)) {
        const backoff = computeBackoff(attempt);
        recordEvent('network.retry', 'warn',
          `Retry ${init.method ?? 'GET'} ${path} (${attempt + 2}/${maxRetries + 1}, ${(err as Error).name}, wait ${Math.round(backoff)}ms)`);
        await new Promise<void>(r => setTimeout(r, backoff));
        checkCircuit(category, path);
        continue;
      }

      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'web-bridge',
        level: 'error',
        message: `${init.method ?? 'GET'} ${path} failed after ${attempt + 1} attempt(s)`,
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      throw err;
    }
  }

  throw new Error('resilientFetch: unreachable');
}

// ── State subscription (for UI — t/876) ──

type ResilienceListener = (state: ResilienceStatus) => void;
const listeners = new Set<ResilienceListener>();

export function subscribeResilience(cb: ResilienceListener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function notifyListeners(): void {
  if (listeners.size === 0) return;
  const state = getResilienceState();
  for (const cb of listeners) cb(state);
}

// ── Public state getter ──

export function getResilienceState(): ResilienceStatus {
  const cs = {} as ResilienceStatus['circuits'];
  const ts = {} as ResilienceStatus['throttles'];
  for (const cat of ALL_CATEGORIES) {
    const c = getCircuit(cat);
    cs[cat] = { state: c.state, consecutiveFailures: c.consecutiveFailures };
    const t = getThrottle(cat);
    ts[cat] = {
      state: t.state,
      p95Ms: Math.round(computeP95(t.latencies)),
      baselineMs: Math.round(t.baseline),
    };
  }
  return { circuits: cs, throttles: ts };
}

export function resetResilience(): void {
  circuits.clear();
  throttles.clear();
  listeners.clear();
}

// ── Flight recorder helper ──

function recordEvent(type: string, level: 'info' | 'warn' | 'error', message: string): void {
  getGlobalRecorder()?.record({ type, component: 'web-bridge', level, message });
}
