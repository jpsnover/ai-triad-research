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
      return merged;
    }
    return {};
  },
  // Customize the serialized error shape
  serializers: {
    err: pino.stdSerializers.err,
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
