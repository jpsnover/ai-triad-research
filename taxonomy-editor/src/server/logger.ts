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
import crypto from 'crypto';

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

/** Generate a short, unique request ID. */
export function generateRequestId(): string {
  return crypto.randomBytes(8).toString('hex');
}

// ── Logger configuration ──

const isProduction = process.env.NODE_ENV === 'production';

function hasPinoPretty(): boolean {
  try { require.resolve('pino-pretty'); return true; } catch { return false; }
}

const logger = pino({
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
  ...(!isProduction && hasPinoPretty()
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
});

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
