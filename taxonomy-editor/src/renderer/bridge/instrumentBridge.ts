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
import { trackAICall } from '../lib/analyticsEmitter';
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

/** Redact secret-bearing arguments before logging. Key = method name, value = arg indices to redact. */
const REDACT_ARGS: Record<string, number[]> = {
  setApiKey: [0],                // arg 0 is the raw API key
  exportKeysForSharing: [0],     // arg 0 is the passphrase
  importKeysFromSharing: [0, 1], // arg 0 is encrypted payload, arg 1 is passphrase
};

function redactSecret(value: unknown): string {
  if (typeof value !== 'string' || value.length < 8) return '[REDACTED]';
  return value.slice(0, 4) + '…' + value.slice(-2);
}

/** Summarize args array for flight recorder (max 3 args logged). */
function summarizeArgs(args: unknown[], method?: string): unknown[] {
  const redactIndices = method ? REDACT_ARGS[method] : undefined;
  return args.slice(0, 3).map((a, i) =>
    redactIndices?.includes(i) ? redactSecret(a) : truncateArg(a),
  );
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
  if (method === 'listDebateSessionsMeta') {
    // Log returned debate IDs so a 404 dump can distinguish an orphaned index
    // from user navigation: was the missing ID actually in the list? (t/2365)
    if (!Array.isArray(v)) return undefined;
    const ids = (v as Array<{ id?: unknown }>)
      .map((s) => s?.id)
      .filter((id): id is string => typeof id === 'string');
    return { count: v.length, ids: ids.slice(0, 20) };
  }
  if (method === 'listOpEdSets') {
    // Record the RESULT SHAPE, not just the count, so a summary-vs-full regression is
    // visible in the dump alone (t/2606). The t/2605 crash was listOpEdSets returning a
    // full OpEdSet[] where the caller expected OpEdSetSummary[] (no `opeds`); result_type
    // makes a repeat diagnosable without re-reading source. Empty list → 'summary' (the
    // expected default). `has_opeds` is the same signal at the per-row level.
    if (!Array.isArray(v)) return undefined;
    const first = (v as unknown[])[0] as Record<string, unknown> | undefined;
    const has_opeds = !!first && 'opeds' in first;
    return { count: (v as unknown[]).length, result_type: has_opeds ? 'full' : 'summary', has_opeds };
  }
  if (method === 'loadOpEdSet') {
    // Record grounding presence on the loaded set so a "grounding No data" report is
    // diagnosable from the dump alone — distinguishes "grounding absent in the payload"
    // from "present but not rendering" (which previously needed the on-disk JSON). t/2621.
    const opeds = Array.isArray(v.opeds) ? (v.opeds as Array<{ grounding?: unknown[] }>) : [];
    const grounded_member_count = opeds.filter(m => (m.grounding?.length ?? 0) > 0).length;
    return { member_count: opeds.length, has_grounding: grounded_member_count > 0, grounded_member_count };
  }
  if (method === 'generateText' || method === 'generateTextWithSearch') {
    const text = v.text;
    const meta: Record<string, unknown> = {};
    if (typeof text === 'string') {
      meta.response_chars = text.length;
      meta.response_preview = text.slice(0, 300) + (text.length > 300 ? '…' : '');
    }
    const usage = v.tokenUsage as Record<string, unknown> | undefined;
    if (usage) {
      meta.input_tokens = usage.inputTokens;
      meta.output_tokens = usage.outputTokens;
    }
    return Object.keys(meta).length > 0 ? meta : undefined;
  }
  return undefined;
}

/** Methods that should NOT be wrapped. */
const SKIP = new Set([
  // Event listeners return unsubscribe functions, not promises
  'onChatStreamChunk', 'onChatStreamDone', 'onChatStreamError', 'onChatStreamUrlMetadata',
  'onDiagnosticsStateUpdate', 'onDiagnosticsPopoutClosed', 'onReExtractClaims',
  'onDebateWindowLoad', 'onDebatePopoutClosed',
  'onGenerateTextProgress', 'onReloadTaxonomy', 'onFocusNode', 'onTaxonomyUpdated',
  'onTerminalData', 'onTerminalExit',
  // Sync methods
  'sendDiagnosticsState', 'requestReExtractClaims',
  'focusNodeInMainWindow',
  // Avoid recursion — dump calls the bridge itself
  'dumpFlightRecorder',
  // High-frequency polling — noise that evicts useful diagnostic events
  'adminReviewStats', 'adminReviewConfigured',
]);

/**
 * Bridge methods where a specific HTTP status is an EXPECTED, non-error outcome —
 * the caller handles it gracefully (e.g. returns a default). Such rejections are
 * recorded at `debug` instead of `error`, so flight-recorder dumps aren't polluted
 * by a false alarm on every session, while ADR-003 is honored (the event is still
 * recorded; only the LEVEL drops). Keep this narrow and PER-METHOD: a blanket
 * status downgrade would mask a real authorization bug on some other call
 * (TL optionality-aware condition, t/1339 / t/1340).
 */
const EXPECTED_STATUS: Record<string, ReadonlySet<number>> = {
  // 403 for non-admin/anonymous users; App.tsx catches it and returns '' (t/2395).
  getDataRoot: new Set([403]),
};

/** True when `httpStatus` is a known non-error outcome for `method` (see EXPECTED_STATUS). */
function isExpectedStatus(method: string, httpStatus: number | undefined): boolean {
  return httpStatus !== undefined && (EXPECTED_STATUS[method]?.has(httpStatus) ?? false);
}

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

      const isAI = category === 'ai';

      // Record call start (only if recorder is initialized)
      recorder?.record({
        type: isAI ? 'ai.request' : 'lifecycle',
        component: recorder.intern('component', 'bridge') as string | number,
        level: 'debug',
        message: `bridge.${key}`,
        data: { method: key, category, arg_count: args.length, args: summarizeArgs(args, key) },
      });

      let result: unknown;
      try {
        result = (original as (...a: unknown[]) => unknown).apply(raw, args);
      } catch (err) {
        // Sync throw (rare for bridge methods)
        const duration_ms = Math.round(performance.now() - startTs);
        const httpStatus = typeof (err as { httpStatus?: unknown }).httpStatus === 'number'
          ? (err as { httpStatus: number }).httpStatus
          : undefined;
        const expected = !isAI && isExpectedStatus(key, httpStatus);
        getGlobalRecorder()?.record({
          type: isAI ? 'ai.error' : 'system.error',
          component: recorder?.intern('component', 'bridge') as string | number,
          level: expected ? 'debug' : 'error',
          message: expected ? `bridge.${key} expected ${httpStatus} (sync)` : `bridge.${key} failed (sync)`,
          duration_ms,
          error: normalizeError(err),
          data: { method: key, category, ...(httpStatus !== undefined && { http_status: httpStatus }) },
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
            type: isAI ? 'ai.response' : 'lifecycle',
            component: recorder.intern('component', 'bridge') as string | number,
            level: 'info',
            message: `bridge.${key} ok`,
            duration_ms,
            data: { method: key, category, ...resultMeta },
          });
          if (isAI) {
            const model = typeof args[1] === 'string' ? args[1] : 'unknown';
            trackAICall(model, duration_ms, resultMeta ? {
              tokens_in: resultMeta.input_tokens as number | undefined,
              tokens_out: resultMeta.output_tokens as number | undefined,
            } : undefined);
          }
          return value;
        },
        (err) => {
          const duration_ms = Math.round(performance.now() - startTs);
          const httpStatus = typeof (err as { httpStatus?: unknown }).httpStatus === 'number'
            ? (err as { httpStatus: number }).httpStatus
            : undefined;
          const expected = !isAI && isExpectedStatus(key, httpStatus);
          recorder?.record({
            type: isAI ? 'ai.error' : 'system.error',
            component: recorder.intern('component', 'bridge') as string | number,
            level: expected ? 'debug' : 'error',
            message: expected ? `bridge.${key} expected ${httpStatus}` : `bridge.${key} failed`,
            duration_ms,
            error: normalizeError(err),
            data: { method: key, category, ...(httpStatus !== undefined && { http_status: httpStatus }) },
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
