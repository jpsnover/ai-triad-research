// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Structured JSON logger for the taxonomy-editor web server.
 *
 * Uses Pino for fast, structured JSON logging with:
 * - Per-request correlation IDs via AsyncLocalStorage
 * - Component-scoped child loggers (server, auth, data-pull, etc.)
 * - Automatic redaction of sensitive fields (API keys, tokens)
 *
 * In development (NODE_ENV !== 'production'), logs are piped through
 * pino-pretty for human-readable output.
 */

import pino from 'pino';
import { AsyncLocalStorage } from 'async_hooks';
import { Writable } from 'stream';
import crypto from 'crypto';
import { recordServerLog } from './serverLogBuffer.js';

// ── Request context (correlation ID) ──

export interface RequestContext {
  requestId: string;
  method?: string;
  path?: string;
  userId?: string;
  debateId?: string; // t/966: set by /api/ai/generate so debate sessions are filterable in logs
}

const requestAls = new AsyncLocalStorage<RequestContext>();

/** Run a callback with a request-scoped correlation ID. */
export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return requestAls.run(ctx, fn);
}

/** Get the current request's correlation ID, or undefined outside a request. */
export function getRequestId(): string | undefined {
  return requestAls.getStore()?.requestId;
}

/** Get the full request context, or undefined outside a request. */
export function getRequestContext(): RequestContext | undefined {
  return requestAls.getStore();
}

/** Generate a unique request ID (UUID-based, prefixed for easy grep; no PII). */
export function generateRequestId(): string {
  return `req-${crypto.randomUUID()}`;
}

// ── Logger configuration ──

const isProduction = process.env.NODE_ENV === 'production';

function hasPinoPretty(): boolean {
  try { require.resolve('pino-pretty'); return true; } catch { /* telemetry — silent by design */ return false; }
}

// Evaluate before pino constructor — pino resolves transports eagerly
const usePretty = !isProduction && hasPinoPretty();

// Tee every emitted (already-redacted) log line into the bounded server-log
// buffer so flight-recorder dumps are self-contained. Only on the non-pretty
// path (pretty mode runs a worker transport that bypasses an in-process
// destination); opt out with FR_DUMP_INCLUDE_LOGS=0.
const teeLogs = !usePretty && process.env.FR_DUMP_INCLUDE_LOGS !== '0';
const teeStream = new Writable({
  write(chunk: Buffer | string, _enc, cb) {
    const s = chunk.toString();
    process.stdout.write(s);
    recordServerLog(s);
    cb();
  },
});

// ── Log-line size caps (t/1475) ──
// Azure Container Apps captures stdout via Fluent Bit, which slices lines past a
// ~16 KB per-line buffer; a sliced JSON line is invalid and unparseable in Log
// Analytics. Pino can emit arbitrarily large lines (full request/response bodies,
// deep objects, base64). We truncate oversized string fields and cap the whole
// object so every line stays parseable. Logs are telemetry — the flight recorder
// (getGlobalRecorder events) keeps full fidelity and is untouched by this.
export const LOG_MAX_FIELD_CHARS = 4096;   // per-string-field cap (AC#3)
export const LOG_MAX_LINE_BYTES = 15_000;  // object cap, under the 16 KB line limit (level/time/msg add ~200B)
const LOG_MAX_DEPTH = 8;
const LOG_MAX_ARRAY = 100;
// Small, always-keep triage fields (present in the merged log object; level/time/
// msg are pino-managed and re-added after formatters). Never dropped by the cap.
const LOG_TRIAGE_KEYS = ['component', 'requestId', 'userId', 'debateId', 'method', 'path', 'status', 'statusCode', 'duration_ms', 'type', 'reason'] as const;

function truncateLogString(s: string): string {
  return s.length <= LOG_MAX_FIELD_CHARS ? s : `${s.slice(0, LOG_MAX_FIELD_CHARS)}…[truncated ${s.length - LOG_MAX_FIELD_CHARS} chars]`;
}

/** Deep-truncate oversized strings / long arrays / deep nesting. Structure and
 *  small fields are preserved; only long strings (bodies, stacks, base64) are cut. */
export function truncateLogValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return truncateLogString(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= LOG_MAX_DEPTH) return '…[truncated: max depth]';
  if (Array.isArray(value)) {
    const out = value.slice(0, LOG_MAX_ARRAY).map(v => truncateLogValue(v, depth + 1));
    if (value.length > LOG_MAX_ARRAY) out.push(`…[truncated ${value.length - LOG_MAX_ARRAY} items]`);
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = truncateLogValue(v, depth + 1);
  return out;
}

/** Pino `formatters.log` hook: field-truncate the merged log object, then enforce
 *  a hard total-size cap as a backstop (many small fields can still add up). On
 *  overflow, keep the triage fields + err/error name+message and mark the rest. */
export function capLogObject(obj: Record<string, unknown>): Record<string, unknown> {
  const truncated = truncateLogValue(obj) as Record<string, unknown>;
  if (JSON.stringify(truncated).length <= LOG_MAX_LINE_BYTES) return truncated;

  const reduced: Record<string, unknown> = {};
  for (const k of LOG_TRIAGE_KEYS) if (k in obj) reduced[k] = truncateLogValue(obj[k]);
  const err = obj.err as { type?: string; message?: string } | undefined;
  if (err && typeof err === 'object') reduced.err = { type: err.type, message: truncateLogString(String(err.message ?? '')) };
  const error = obj.error as { name?: string; message?: string } | undefined;
  if (error && typeof error === 'object') reduced.error = { name: error.name, message: truncateLogString(String(error.message ?? '')) };
  reduced._log_truncated = `line exceeded ${LOG_MAX_LINE_BYTES}B — verbose fields dropped for ACA/Fluent Bit; full detail in the flight recorder`;
  return reduced;
}

const pinoOptions = {
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  redact: {
    paths: [
      'apiKey',
      'api_key',
      'token',
      'password',
      'secret',
      'authorization',
      'headers.authorization',
      'headers.cookie',
      'credentials',
      '*.apiKey',
      '*.api_key',
      '*.token',
      '*.password',
      '*.secret',
    ],
    censor: '[REDACTED]',
  },
  ...(usePretty
    ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }
    : {}
  ),
  // Inject request context into every log line
  mixin() {
    const ctx = requestAls.getStore();
    if (ctx) {
      const merged: Record<string, unknown> = { requestId: ctx.requestId };
      if (ctx.userId) merged.userId = ctx.userId;
      if (ctx.debateId) merged.debateId = ctx.debateId;
      return merged;
    }
    return {};
  },
  // Customize the serialized error shape
  serializers: {
    err: pino.stdSerializers.err,
  },
  // t/1475: cap oversized log lines so ACA/Fluent Bit doesn't slice them into
  // unparseable JSON. Field-truncates bodies/stacks/base64 and hard-caps the
  // whole object; applies to Pino output only (stdout + the log-line tee) — the
  // flight recorder's structured events keep full fidelity.
  formatters: {
    log: capLogObject,
  },
};

// In pretty mode pino owns its output via a worker transport; otherwise route
// through the tee so log lines also land in the server-log buffer for dumps.
const logger = teeLogs ? pino(pinoOptions, teeStream) : pino(pinoOptions);

// ── Component child loggers ──

export const log = {
  server: logger.child({ component: 'server' }),
  auth: logger.child({ component: 'auth' }),
  dataPull: logger.child({ component: 'data-pull' }),
  storage: logger.child({ component: 'storage' }),
  cache: logger.child({ component: 'cache' }),
  session: logger.child({ component: 'session' }),
  api: logger.child({ component: 'api' }),
  git: logger.child({ component: 'git' }),
  security: logger.child({ component: 'security' }),
  trace: logger.child({ component: 'trace' }),
  github: logger.child({ component: 'github-api' }),
  analytics: logger.child({ component: 'analytics' }),
  fr: logger.child({ component: 'flight-recorder' }),
};

export default logger;
