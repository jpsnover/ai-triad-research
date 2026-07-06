// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Paired flight-recorder dumps (t/908). A dump is correlated by a client-chosen
 * dumpId across two files in <dataRoot>/admin/flight-recorder-dumps/:
 *   client-{dumpId}.jsonl  — the renderer's ring buffer (uploaded)
 *   server-{dumpId}.jsonl  — this server's ring buffer (admin-only)
 * Both join client↔server events on the shared x-request-id (`requestId`).
 *
 * Retention keeps the last 20 dumpId *pairs* (not files) and enforces a 50 MB
 * cap, deleting whole pairs oldest-first so a client/server half is never
 * orphaned.
 */

import fs from 'fs';
import path from 'path';
import { getGlobalRecorder } from '../../../lib/flight-recorder/index.js';
import { getConfig } from './runtimeConfig.js';

export const MAX_DUMP_GROUPS = 20;
export const MAX_DUMP_BYTES = 50 * 1024 * 1024;

/** dumpIds are client-generated UUIDs; constrain to a safe filename segment. */
export function isValidDumpId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id);
}

export function dumpsDir(dataRoot: string): string {
  return path.join(dataRoot, 'admin', 'flight-recorder-dumps');
}

const DUMP_RE = /^(client|server)-(.+)\.jsonl$/;

export interface DumpFileInfo { name: string; dumpId: string; mtime: number; size: number }

/**
 * Pure retention decision: given the dump files in a dir, return the file names
 * to delete so that at most `maxGroups` dumpId pairs survive and their combined
 * size is ≤ `maxBytes`. Groups are ranked by most-recent mtime; whole groups are
 * dropped oldest-first.
 */
export function selectExpiredDumps(files: DumpFileInfo[], maxGroups = MAX_DUMP_GROUPS, maxBytes = MAX_DUMP_BYTES): string[] {
  const groups = new Map<string, { files: DumpFileInfo[]; mtime: number; size: number }>();
  for (const f of files) {
    const g = groups.get(f.dumpId) ?? { files: [], mtime: 0, size: 0 };
    g.files.push(f);
    g.mtime = Math.max(g.mtime, f.mtime);
    g.size += f.size;
    groups.set(f.dumpId, g);
  }
  const ranked = [...groups.values()].sort((a, b) => b.mtime - a.mtime); // newest first
  const toDelete: string[] = [];

  // 1. Drop groups beyond the count cap.
  const kept = ranked.slice(0, maxGroups);
  for (const g of ranked.slice(maxGroups)) toDelete.push(...g.files.map(f => f.name));

  // 2. Enforce the byte cap on the survivors, dropping oldest-first.
  let total = kept.reduce((s, g) => s + g.size, 0);
  for (let i = kept.length - 1; i >= 0 && total > maxBytes; i--) {
    toDelete.push(...kept[i].files.map(f => f.name));
    total -= kept[i].size;
  }
  return toDelete;
}

/** Apply retention to the dump dir (best-effort). */
export function pruneDumps(dir: string): void {
  try {
    const files: DumpFileInfo[] = fs.readdirSync(dir)
      .map(name => ({ name, m: DUMP_RE.exec(name) }))
      .filter((x): x is { name: string; m: RegExpExecArray } => x.m !== null)
      .map(({ name, m }) => {
        const stat = fs.statSync(path.join(dir, name));
        return { name, dumpId: m[2], mtime: stat.mtimeMs, size: stat.size };
      });
    for (const name of selectExpiredDumps(files, getConfig().flightRecorder.maxRetainedDumps, getConfig().flightRecorder.maxTotalDumpSizeBytes)) {
      try { fs.unlinkSync(path.join(dir, name)); } catch { /* telemetry — silent by design */ }
    }
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'flight-recorder-dumps', level: 'warn',
      message: 'Dump retention sweep failed',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
  }
}

/** Write one half of a paired dump and run retention. Returns the file path. */
export function writeDump(dataRoot: string, kind: 'client' | 'server', dumpId: string, ndjson: string): string {
  const dir = dumpsDir(dataRoot);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${kind}-${dumpId}.jsonl`);
  fs.writeFileSync(filePath, ndjson, 'utf-8');
  pruneDumps(dir);
  return filePath;
}

// ── Merge logic (t/939) ────────────────────────────────────────────────

interface ParsedDump {
  header: Record<string, unknown> | null;
  dictionary: Record<string, unknown>[];
  context: Record<string, unknown> | null;
  events: Record<string, unknown>[];
  triggers: Record<string, unknown>[];
}

function parseDumpNdjson(ndjson: string): ParsedDump {
  const result: ParsedDump = { header: null, dictionary: [], context: null, events: [], triggers: [] };
  const skippedLineNumbers: number[] = [];
  const lines = ndjson.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as Record<string, unknown>;
      switch (rec._type) {
        case 'header': result.header = rec; break;
        case 'dictionary': result.dictionary.push(rec); break;
        case 'context': result.context = rec; break;
        case 'trigger': result.triggers.push(rec); break;
        default: result.events.push(rec); break;
      }
      // t/1323 rule 2: a per-line skip in a bulk parse is aggregated into ONE
      // record after the loop (per-line recording would flood on a corrupt dump).
      // Line numbers only, not content — dumps may hold user data.
      // eslint-disable-next-line local/require-flight-recorder-in-catch -- aggregated after the loop (rule 2)
    } catch {
      skippedLineNumbers.push(i + 1);
    }
  }
  if (skippedLineNumbers.length > 0) {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'flight-recorder-dumps', level: 'warn',
      message: `Skipped ${skippedLineNumbers.length} malformed NDJSON line(s) while parsing a dump`,
      data: { skippedCount: skippedLineNumbers.length, firstSkippedLineNumbers: skippedLineNumbers.slice(0, 5) },
    });
  }
  return result;
}

/**
 * Merge a paired client + server dump into a single interleaved NDJSON string.
 * Events are sorted by `_wall` timestamp and tagged with `_source` and `_merged_seq`.
 * Mirrors the `Merge-FlightRecorderDumps` PowerShell cmdlet.
 */
export function mergeDumps(clientNdjson: string | null, serverNdjson: string | null): string {
  const client = clientNdjson ? parseDumpNdjson(clientNdjson) : null;
  const server = serverNdjson ? parseDumpNdjson(serverNdjson) : null;

  const lines: string[] = [];

  // Merged header
  const mergedHeader: Record<string, unknown> = {
    _type: 'header',
    merged: true,
    merge_timestamp: new Date().toISOString(),
    sources: [client && 'client', server && 'server'].filter(Boolean),
    total_events: (client?.events.length ?? 0) + (server?.events.length ?? 0),
  };
  for (const [src, dump] of [['client', client], ['server', server]] as const) {
    if (!dump?.header) continue;
    const h = dump.header;
    mergedHeader[`${src}_timestamp`] = h.timestamp ?? h._wall;
    mergedHeader[`${src}_uptime_ms`] = h.uptime_ms;
    mergedHeader[`${src}_capacity`] = h.capacity;
    mergedHeader[`${src}_retained`] = h.retained;
    mergedHeader[`${src}_lost`] = h.lost;
  }
  lines.push(JSON.stringify(mergedHeader));

  // Merged dictionary — deduplicate by category:value
  const seen = new Set<string>();
  let handle = 0;
  for (const [src, dump] of [['client', client], ['server', server]] as const) {
    if (!dump) continue;
    for (const entry of dump.dictionary) {
      const key = `${entry.category}:${entry.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(JSON.stringify({ ...entry, handle: handle++, source: src }));
    }
  }

  // Merged context — union fields, track provenance
  const mergedCtx: Record<string, unknown> = { _type: 'context' };
  const clientFields: string[] = [];
  const serverFields: string[] = [];
  for (const [src, dump, arr] of [['client', client, clientFields], ['server', server, serverFields]] as const) {
    if (!dump?.context) continue;
    for (const [k, v] of Object.entries(dump.context)) {
      if (k === '_type') continue;
      if (!(k in mergedCtx)) mergedCtx[k] = v;
      (arr as string[]).push(k);
    }
  }
  mergedCtx._client_fields = clientFields;
  mergedCtx._server_fields = serverFields;
  lines.push(JSON.stringify(mergedCtx));

  // Interleave events by _wall timestamp
  const allEvents: Record<string, unknown>[] = [];
  if (client) for (const e of client.events) allEvents.push({ ...e, _source: 'client' });
  if (server) for (const e of server.events) allEvents.push({ ...e, _source: 'server' });
  allEvents.sort((a, b) => {
    const wa = typeof a._wall === 'string' ? a._wall : '';
    const wb = typeof b._wall === 'string' ? b._wall : '';
    return wa < wb ? -1 : wa > wb ? 1 : 0;
  });
  for (let i = 0; i < allEvents.length; i++) {
    allEvents[i]._merged_seq = i;
    lines.push(JSON.stringify(allEvents[i]));
  }

  // Triggers from both sources
  if (client) for (const t of client.triggers) lines.push(JSON.stringify({ ...t, _source: 'client' }));
  if (server) for (const t of server.triggers) lines.push(JSON.stringify({ ...t, _source: 'server' }));

  return lines.join('\n') + '\n';
}

/**
 * Read and merge a paired dump by dumpId. Returns null if no readable half exists.
 *
 * `includeServer` (default true) gates the server half: the server ring buffer can
 * contain other users' request internals, so multi-user callers pass `false` for
 * non-admins — they still get their own client dump merged (t/1064). When false,
 * the server file is never read, so a server-only dumpId yields null for them.
 */
export function readMergedDump(
  dataRoot: string,
  dumpId: string,
  opts: { includeServer?: boolean } = {},
): string | null {
  const includeServer = opts.includeServer !== false;
  const dir = dumpsDir(dataRoot);
  const clientPath = path.join(dir, `client-${dumpId}.jsonl`);
  const serverPath = path.join(dir, `server-${dumpId}.jsonl`);

  const clientExists = fs.existsSync(clientPath);
  const serverExists = includeServer && fs.existsSync(serverPath);
  if (!clientExists && !serverExists) return null;

  const clientNdjson = clientExists ? fs.readFileSync(clientPath, 'utf-8') : null;
  const serverNdjson = serverExists ? fs.readFileSync(serverPath, 'utf-8') : null;

  return mergeDumps(clientNdjson, serverNdjson);
}
