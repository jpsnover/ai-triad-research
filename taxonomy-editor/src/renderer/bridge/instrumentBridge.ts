// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Bridge instrumentation — wraps every AppAPI method with flight recorder
 * events so all backend calls (IPC or REST) are automatically captured.
 *
 * Records:
 *   bridge.call  (level: info)  — on invocation, with method name
 *   bridge.call  (level: info)  — on success, with duration_ms
 *   bridge.call  (level: error) — on failure, with duration_ms and error
 */

import { getGlobalRecorder } from '@lib/flight-recorder/index';
import type { AppAPI } from './types';

/** Truncate an argument for logging. Keeps strings short, summarizes objects. */
function truncateArg(arg: unknown, maxLen = 200): unknown {
  if (arg === null || arg === undefined) return arg;
  if (typeof arg === 'string') return arg.length > maxLen ? arg.slice(0, maxLen) + '…' : arg;
  if (typeof arg === 'number' || typeof arg === 'boolean') return arg;
  if (Array.isArray(arg)) return `[Array(${arg.length})]`;
  if (typeof arg === 'object') {
    const keys = Object.keys(arg as object);
    return `{${keys.slice(0, 5).join(',')}}${keys.length > 5 ? `…+${keys.length - 5}` : ''}`;
  }
  return String(arg).slice(0, maxLen);
}

/** Summarize args array for flight recorder (max 3 args logged). */
function summarizeArgs(args: unknown[]): unknown[] {
  return args.slice(0, 3).map(a => truncateArg(a));
}

/** Extract result metadata for data-loading methods to enrich completion events. */
function extractResultMeta(method: string, args: unknown[], value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  if (method === 'loadTaxonomyFile') {
    const nodes = v.nodes;
    return { pov: args[0], node_count: Array.isArray(nodes) ? nodes.length : undefined };
  }
  if (method === 'loadSituations') {
    const nodes = v.nodes;
    return { node_count: Array.isArray(nodes) ? nodes.length : undefined };
  }
  if (method === 'loadConflicts') {
    return { count: Array.isArray(v) ? (v as unknown[]).length : Array.isArray(v.conflicts) ? (v.conflicts as unknown[]).length : undefined };
  }
  if (method === 'loadEdges') {
    const edges = v.edges;
    return { edge_count: Array.isArray(edges) ? edges.length : undefined };
  }
  return undefined;
}

/** Methods that should NOT be wrapped. */
const SKIP = new Set([
  // Event listeners return unsubscribe functions, not promises
  'onChatStreamChunk', 'onChatStreamDone', 'onChatStreamError',
  'onDiagnosticsStateUpdate', 'onDiagnosticsPopoutClosed',
  'onDebateWindowLoad', 'onDebatePopoutClosed',
  'onGenerateTextProgress', 'onReloadTaxonomy', 'onFocusNode',
  'onTerminalData', 'onTerminalExit',
  // Sync method
  'sendDiagnosticsState',
  // Avoid recursion — dump calls the bridge itself
  'dumpFlightRecorder',
]);

/** Categorize bridge methods for the recorder. */
function inferCategory(method: string): string {
  if (method.startsWith('generate') || method.startsWith('startChat') || method === 'nliClassify') return 'ai';
  if (method.startsWith('compute') || method.startsWith('updateNode')) return 'ai';
  if (method.startsWith('load') || method.startsWith('save') || method.startsWith('list')) return 'data';
  if (method.startsWith('delete') || method.startsWith('create')) return 'data';
  if (method.startsWith('harvest')) return 'harvest';
  if (method.startsWith('terminal')) return 'terminal';
  if (method.includes('Key') || method.includes('Model')) return 'config';
  if (method.includes('Window') || method.includes('grow') || method.includes('shrink')) return 'window';
  return 'bridge';
}

/**
 * Wrap an AppAPI instance so every async method is recorded by the flight
 * recorder. The original api object is not mutated.
 */
export function instrumentBridge(raw: AppAPI): AppAPI {
  const wrapped = { ...raw };

  for (const key of Object.keys(raw) as Array<keyof AppAPI>) {
    if (SKIP.has(key)) continue;
    const original = raw[key];
    if (typeof original !== 'function') continue;

    (wrapped as Record<string, unknown>)[key] = (...args: unknown[]) => {
      const recorder = getGlobalRecorder();
      const category = inferCategory(key);
      const startTs = performance.now();

      // Record call start (only if recorder is initialized)
      recorder?.record({
        type: 'lifecycle',
        component: recorder.intern('component', 'bridge') as string | number,
        level: 'debug',
        message: `bridge.${key}`,
        data: { method: key, category, arg_count: args.length, args: summarizeArgs(args) },
      });

      let result: unknown;
      try {
        result = (original as (...a: unknown[]) => unknown).apply(raw, args);
      } catch (err) {
        // Sync throw (rare for bridge methods)
        const duration_ms = Math.round(performance.now() - startTs);
        recorder?.record({
          type: 'system.error',
          component: recorder.intern('component', 'bridge') as string | number,
          level: 'error',
          message: `bridge.${key} failed (sync)`,
          duration_ms,
          error: normalizeError(err),
          data: { method: key, category },
        });
        throw err;
      }

      // If not a Promise, return as-is (shouldn't happen for non-skipped methods)
      if (!result || typeof (result as Promise<unknown>).then !== 'function') {
        return result;
      }

      // Wrap the promise to record completion/failure
      return (result as Promise<unknown>).then(
        (value) => {
          const duration_ms = Math.round(performance.now() - startTs);
          const resultMeta = extractResultMeta(key, args, value);
          recorder?.record({
            type: 'lifecycle',
            component: recorder.intern('component', 'bridge') as string | number,
            level: 'info',
            message: `bridge.${key} ok`,
            duration_ms,
            data: { method: key, category, ...resultMeta },
          });
          return value;
        },
        (err) => {
          const duration_ms = Math.round(performance.now() - startTs);
          recorder?.record({
            type: 'system.error',
            component: recorder.intern('component', 'bridge') as string | number,
            level: 'error',
            message: `bridge.${key} failed`,
            duration_ms,
            error: normalizeError(err),
            data: { method: key, category },
          });
          throw err;
        },
      );
    };
  }

  return wrapped;
}

function normalizeError(err: unknown): { name: string; message: string; stack?: string } {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack?.slice(0, 500) };
  }
  return { name: 'Error', message: String(err) };
}
