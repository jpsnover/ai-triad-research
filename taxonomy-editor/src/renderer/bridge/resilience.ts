// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { ActionableError } from '@lib/debate/errors';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { getClientConfig } from '../lib/clientConfig';

// ── Public types ──

export type EndpointCategory = 'read' | 'mutation' | 'save' | 'ai' | 'admin' | 'telemetry';
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';
export type ThrottleState = 'NORMAL' | 'THROTTLED';

export interface ResilienceStatus {
  circuits: Record<EndpointCategory, { state: CircuitState; consecutiveFailures: number; recentFailures: string[] }>;
  throttles: Record<EndpointCategory, { state: ThrottleState; p95Ms: number; baselineMs: number }>;
}

/** Typed discriminator for a request rejected because its circuit breaker is OPEN (t/3073).
 *  A save that fails with this is NOT an ordinary error — it must be flagged degraded and
 *  queued for retry, never silently dropped. Keyed off a structured field so downstream
 *  logic never string-matches the message (fragile-prose class, t/2952). */
export interface CircuitOpenError { circuitOpen: true; circuitCategory: EndpointCategory }

export function isCircuitOpenError(err: unknown): err is CircuitOpenError {
  return typeof err === 'object' && err !== null && (err as { circuitOpen?: unknown }).circuitOpen === true;
}

export interface ResilientFetchOptions {
  timeoutMs: number;
  maxRetries: number;
  critical: boolean;
  category: EndpointCategory;
  /** Caller abort signal (t/2508). Composed with the per-attempt timeout so a
   *  deliberate cancel physically tears down the socket. A caller abort is
   *  non-retryable and does not trip the circuit breaker. */
  signal?: AbortSignal;
}

/** Compose the caller signal with the per-attempt timeout controller. Prefers the
 *  native `AbortSignal.any` (Electron 35 / Node 20.3+); manual link is a fallback so
 *  the composition never throws in an older runtime. */
function anySignal(caller: AbortSignal | undefined, timeout: AbortSignal): AbortSignal {
  if (!caller) return timeout;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([caller, timeout]);
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (caller.aborted || timeout.aborted) ctrl.abort();
  else {
    caller.addEventListener('abort', onAbort, { once: true });
    timeout.addEventListener('abort', onAbort, { once: true });
  }
  return ctrl.signal;
}

// ── Config accessors (backed by runtime config, falls back to hardcoded defaults) ──

function cfg() { return getClientConfig().resilience; }

const ALL_CATEGORIES: EndpointCategory[] = ['read', 'mutation', 'save', 'ai', 'admin', 'telemetry'];

/** Cooldown before an OPEN circuit admits a HALF_OPEN probe. Exposed so the debate
 *  save-durability path can schedule its post-breaker retry off the same source of
 *  truth as the breaker itself (t/3073). */
export function getCircuitCooldownMs(): number { return cfg().circuitCooldownMs; }

// ── Endpoint categorization ──

export function categorizeEndpoint(path: string, method: string): EndpointCategory {
  if (path === '/api/admin/telemetry' || path === '/api/admin/errors') return 'telemetry';
  if (path.startsWith('/api/ai/')) return 'ai';
  // Embedding compute is a read-like AI compute (returns vectors, mutates no user data).
  // It must NOT share a breaker with data-saving writes — a compute outage tripping the
  // save breaker escalates a recoverable failure into user data loss (t/3073). The 'ai'
  // breaker is its natural home.
  if (path.startsWith('/api/embeddings/')) return 'ai';
  if (path.startsWith('/api/admin/')) return 'admin';
  if (method === 'GET') return 'read';
  // Debate-session writes get a DEDICATED breaker so no unrelated mutation's failures can
  // open the save path — saves are the highest-integrity op (t/3073). Full save =
  // PUT /api/debates; delta save = PATCH /api/debates/:id. Deeper debate paths
  // (comments/exports/news-report) and POST/DELETE stay on the general 'mutation' breaker.
  if (method === 'PUT' && path === '/api/debates') return 'save';
  if (method === 'PATCH' && /^\/api\/debates\/[^/]+$/.test(path)) return 'save';
  return 'mutation';
}

// ── Circuit breaker ──

const RECENT_FAILURES_CAP = 5;

/** A single circuit failure with call attribution (t/2622). `reason` is the failure
 *  class (`HTTP 500`, `timeout`, `TypeError`); `endpoint`/`method` identify the failing
 *  request; `component` is a best-effort call-site label derived from the endpoint. */
interface FailureRecord {
  reason: string;
  endpoint?: string;
  method?: string;
  component?: string;
}

interface CircuitEntry {
  state: CircuitState;
  consecutiveFailures: number;
  lastFailureTime: number;
  recentFailures: FailureRecord[];
}

/** Best-effort call-site label from an endpoint: normalize id-like path segments to
 *  `:id` so `/api/nodes/acc-b-001/conflicts` → `/api/nodes/:id/conflicts` — a stable
 *  route pattern that distinguishes call-sites without a caller-supplied tag (t/2622). */
function deriveComponent(endpoint: string): string {
  const pathOnly = endpoint.split('?')[0];
  return pathOnly.split('/').map((seg) => {
    if (!seg) return seg;
    if (/^\d+$/.test(seg)) return ':id';                        // numeric id
    if (/^[0-9a-f]{8,}$/i.test(seg)) return ':id';              // uuid/hash
    if (seg.includes('-') && /\d/.test(seg) && /[a-z]/i.test(seg)) return ':id'; // node-id shape (acc-b-001)
    return seg;
  }).join('/');
}

const circuits = new Map<EndpointCategory, CircuitEntry>();

function getCircuit(cat: EndpointCategory): CircuitEntry {
  let e = circuits.get(cat);
  if (!e) {
    e = { state: 'CLOSED', consecutiveFailures: 0, lastFailureTime: 0, recentFailures: [] };
    circuits.set(cat, e);
  }
  return e;
}

function summarizeFailures(reasons: string[]): string {
  if (reasons.length === 0) return '';
  const runs: { reason: string; count: number }[] = [];
  for (const r of reasons) {
    const last = runs[runs.length - 1];
    if (last && last.reason === r) last.count++;
    else runs.push({ reason: r, count: 1 });
  }
  return runs.map(r => r.count > 1 ? `${r.reason} (x${r.count})` : r.reason).join(', ');
}

function checkCircuit(cat: EndpointCategory, path: string): void {
  const c = getCircuit(cat);
  if (c.state === 'CLOSED') return;
  if (c.state === 'OPEN') {
    const elapsed = Date.now() - c.lastFailureTime;
    if (elapsed >= cfg().circuitCooldownMs) {
      c.state = 'HALF_OPEN';
      recordEvent('network.circuit_half_open', 'warn',
        `Circuit '${cat}' → HALF_OPEN, allowing probe request`,
        { category: cat, state: 'HALF_OPEN', consecutiveFailures: c.consecutiveFailures, timeOpenMs: elapsed });
      notifyListeners();
      return;
    }
    const remaining = Math.ceil((cfg().circuitCooldownMs - elapsed) / 1000);
    const failureSummary = summarizeFailures(c.recentFailures.map(f => f.reason));
    const detail = failureSummary ? `\nLast failures: ${failureSummary}` : '';
    const circuitErr = new ActionableError({
      goal: `Make request to ${path}`,
      problem: `Circuit breaker OPEN for '${cat}' after ${c.consecutiveFailures} consecutive failures. ${remaining}s cooldown remaining.${detail}`,
      location: 'web-bridge/resilience',
      nextSteps: ['Wait for the cooldown period to expire', 'Check whether the server is healthy'],
    });
    // Typed discriminator (t/3073, TL refinement): downstream save-durability logic keys off
    // this structured field, never a message substring — the fragile-prose class (t/2952).
    Object.assign(circuitErr, { circuitOpen: true, circuitCategory: cat } satisfies CircuitOpenError);
    throw circuitErr;
  }
  // HALF_OPEN — allow one probe request through
}

function onCircuitSuccess(cat: EndpointCategory): void {
  const c = getCircuit(cat);
  const wasNotClosed = c.state !== 'CLOSED';
  if (c.state === 'HALF_OPEN') {
    recordEvent('network.circuit_closed', 'info',
      `Circuit '${cat}' → CLOSED after successful probe`,
      { category: cat, state: 'CLOSED', previousFailures: c.consecutiveFailures });
  }
  c.consecutiveFailures = 0;
  c.recentFailures = [];
  c.state = 'CLOSED';
  if (wasNotClosed) notifyListeners();
}

function onCircuitFailure(cat: EndpointCategory, reason: string, endpoint?: string, method?: string): void {
  const c = getCircuit(cat);
  const prevState = c.state;
  c.consecutiveFailures++;
  c.lastFailureTime = Date.now();
  // The failing call's attribution travels with the failure so the OPEN event can name
  // the triggering endpoint/call-site without walking preceding events (t/2622).
  const failure: FailureRecord = {
    reason,
    ...(endpoint !== undefined && { endpoint, component: deriveComponent(endpoint) }),
    ...(method !== undefined && { method }),
  };
  c.recentFailures.push(failure);
  if (c.recentFailures.length > RECENT_FAILURES_CAP) c.recentFailures.shift();
  // The just-pushed failure is the trigger (the latest / threshold-tripping entry).
  const trig = {
    triggering_endpoint: failure.endpoint,
    triggering_method: failure.method,
    triggering_component: failure.component,
  };
  if (c.state === 'HALF_OPEN') {
    c.state = 'OPEN';
    recordEvent('network.circuit_open', 'warn',
      `Circuit '${cat}' re-OPEN after failed probe (${reason})`,
      { category: cat, state: 'OPEN', trigger: 'half_open_probe_failed', consecutiveFailures: c.consecutiveFailures, cooldownMs: cfg().circuitCooldownMs, lastFailure: reason, ...trig });
  } else if (c.consecutiveFailures >= cfg().circuitThreshold && c.state === 'CLOSED') {
    c.state = 'OPEN';
    const summary = summarizeFailures(c.recentFailures.map(f => f.reason));
    recordEvent('network.circuit_open', 'error',
      `Circuit '${cat}' → OPEN after ${c.consecutiveFailures} consecutive failures. Last: ${summary}`,
      { category: cat, state: 'OPEN', trigger: 'threshold_exceeded', consecutiveFailures: c.consecutiveFailures, cooldownMs: cfg().circuitCooldownMs, recentFailures: c.recentFailures.map(f => f.reason), ...trig });
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
  if (t.latencies.length > cfg().throttleWindowSize) t.latencies.shift();

  if (t.baseline === 0 && t.latencies.length >= cfg().throttleBaselineCount) {
    t.baseline = t.latencies.slice(0, cfg().throttleBaselineCount)
      .reduce((a, b) => a + b, 0) / cfg().throttleBaselineCount;
  }
}

export function setThrottleFromProbe(
  state: ThrottleState,
  p95Ms: number,
  baselineMs: number,
): void {
  const cat: EndpointCategory = 'read';
  const t = getThrottle(cat);
  const prev = t.state;
  t.state = state;
  t.baseline = baselineMs;
  if (state !== prev) {
    if (state === 'THROTTLED') {
      recordEvent('network.throttle_active', 'warn',
        `Health probe detected degradation: p95=${Math.round(p95Ms)}ms > baseline ${Math.round(baselineMs)}ms`);
    } else {
      recordEvent('network.throttle_cleared', 'info',
        `Health probe detected recovery: p95=${Math.round(p95Ms)}ms`);
    }
    notifyListeners();
  }
}

async function maybeThrottleDelay(cat: EndpointCategory, critical: boolean): Promise<void> {
  const t = getThrottle(cat);
  if (t.state === 'THROTTLED' && !critical) {
    await new Promise<void>(r => setTimeout(r, cfg().throttleDelayMs));
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
  const delay = Math.min(cfg().retryBaseDelayMs * Math.pow(2, attempt), cfg().retryMaxDelayMs);
  return delay + Math.random() * cfg().retryJitterMaxMs;
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

/** A typed backpressure signal — the server is healthy but shedding load / rate-limiting and
 *  wants the client to honor Retry-After and re-offer the request (t/2922). Two shapes converge
 *  on one concept:
 *    - HTTP 429 (rate limit — backpressure by status), and
 *    - any retryable status whose JSON body carries `retryable: true` — the load-shed 503
 *      (t/2905, `routes/ai.ts`) and the upstream-429 mapping both set this.
 *  Backpressure resets the breaker (`onCircuitSuccess`) rather than tripping it. A genuine-down
 *  503 (no `retryable: true`, or a non-JSON/empty body) is NOT backpressure — it fails fast and
 *  trips the breaker, unchanged. The 429 disjunct is retained so a non-retryable `tokens_per_day`
 *  429 stays on the healthy path (a pure `retryable`-key would regress it into a breaker trip).
 *  Peeks a clone so the original body stays intact for the retry-path cancel or the caller's
 *  final read. */
async function isBackpressure(res: Response): Promise<boolean> {
  if (res.status === 429) return true;
  try {
    const data = await res.clone().json() as { retryable?: unknown } | null;
    return data?.retryable === true;
    // Classifier, not a degradation: a non-JSON / empty body means the response is NOT
    // typed-backpressure (e.g. a genuinely-down 503). Returning false routes it to the
    // real-failure path, which fails fast and trips the breaker — recorded there, not here.
    // eslint-disable-next-line local/require-warn-on-degraded-catch-return -- classification, not a fallback; the genuine-down path is what records (t/3222)
  } catch {
    /* silent by design: non-JSON / empty body = not typed-backpressure; the genuine-down path records downstream */
    return false;
  }
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
      // Compose the caller's abort signal (if any) with the per-attempt timeout (t/2508).
      // Without this, `signal: controller.signal` would overwrite init.signal and a
      // deliberate cancel could never reach the socket.
      const res = await fetch(path, { ...init, signal: anySignal(opts.signal, controller.signal) });
      clearTimeout(timer);
      recordLatency(category, performance.now() - start);

      if (res.ok || !isRetryableStatus(res.status)) {
        onCircuitSuccess(category);
        return res;
      }

      // Retryable HTTP status. Typed backpressure (429, or a retryable:true body — the
      // load-shed 503) means the server is healthy but shedding: honor Retry-After and
      // re-offer, and treat it as a success for the breaker. Anything else is a real
      // failure that trips the breaker (t/2922).
      const backpressure = await isBackpressure(res);
      if (backpressure) {
        onCircuitSuccess(category);
      } else {
        onCircuitFailure(category, `HTTP ${res.status}`, path, init.method);
      }

      if (attempt < maxRetries) {
        const retryAfterMs = backpressure ? parseRetryAfter(res) : null;
        if (retryAfterMs !== null && retryAfterMs > cfg().maxRetryAfterMs) {
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
      // Deliberate caller cancel (t/2508): not a server failure — don't trip the circuit,
      // don't retry, don't log an error. Re-throw so the bridge can tag it as a cancellation.
      if (opts.signal?.aborted) throw err;
      onCircuitFailure(category, (err as Error).name === 'AbortError' ? 'timeout' : (err as Error).name, path, init.method);

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
  emitConnectionPoolEvent();
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
    cs[cat] = { state: c.state, consecutiveFailures: c.consecutiveFailures, recentFailures: c.recentFailures.map(f => f.reason) };
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

// ── Connection pool metrics (injectable to avoid circular import with web-bridge) ──

export interface ConnectionPoolMetrics {
  activeWebSockets: number;
  connectingWebSockets: number;
}

let connectionPoolProvider: (() => ConnectionPoolMetrics) | null = null;

export function registerConnectionPoolProvider(provider: () => ConnectionPoolMetrics): void {
  connectionPoolProvider = provider;
}

function emitConnectionPoolEvent(): void {
  const pool = connectionPoolProvider?.() ?? { activeWebSockets: 0, connectingWebSockets: 0 };
  const circuitSnapshot: Record<string, { state: CircuitState; failures: number }> = {};
  for (const cat of ALL_CATEGORIES) {
    const c = getCircuit(cat);
    circuitSnapshot[cat] = { state: c.state, failures: c.consecutiveFailures };
  }
  getGlobalRecorder()?.record({
    type: 'network.connection_pool', component: 'web-bridge', level: 'debug',
    message: `Connection pool: ${pool.activeWebSockets} open WS, ${pool.connectingWebSockets} connecting`,
    data: { ...pool, circuits: circuitSnapshot },
  });
}

// ── Flight recorder helper ──

function recordEvent(type: string, level: 'info' | 'warn' | 'error', message: string, data?: Record<string, unknown>): void {
  getGlobalRecorder()?.record({ type: type as import('@lib/flight-recorder/types').EventType, component: 'web-bridge', level, message, ...(data ? { data } : {}) });
}
