// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { Dictionary } from './dictionary.js';
import type {
  FlightRecorderEvent,
  DumpHeader,
  DumpDictionary,
  DumpEvent,
  DumpTrigger,
} from './types.js';

/**
 * Serialize a flight recorder snapshot to NDJSON (one JSON object per line).
 *
 * Structure:
 *   Line 1:   header  — system context, buffer stats
 *   Line 2:   dictionary — all interned strings
 *   Lines 3…N: events — oldest first, dictionary handles expanded
 *   Last line: trigger — the error/event that caused the dump
 */
export function serializeDump(
  header: DumpHeader,
  dictionary: Dictionary,
  events: FlightRecorderEvent[],
  trigger: DumpTrigger,
): string {
  const lines: string[] = [];

  // Line 1: header
  lines.push(JSON.stringify(header));

  // Line 2: dictionary
  const dictLine: DumpDictionary = {
    _type: 'dictionary',
    entries: [...dictionary.getEntries()],
  };
  lines.push(JSON.stringify(dictLine));

  // Lines 3…N: events with dictionary handles expanded
  for (const event of events) {
    const expanded: DumpEvent = {
      _type: 'event',
      _seq: event._seq,
      _ts: event._ts,
      _wall: event._wall,
      type: event.type,
      component: dictionary.resolve(event.component),
      level: event.level,
      ...(event.debate_id !== undefined && { debate_id: event.debate_id }),
      ...(event.turn_id !== undefined && { turn_id: event.turn_id }),
      ...(event.call_id !== undefined && { call_id: event.call_id }),
      ...(event.speaker !== undefined && { speaker: dictionary.resolve(event.speaker) }),
      ...(event.message !== undefined && { message: event.message }),
      ...(event.data !== undefined && { data: expandData(event.data, dictionary) }),
      ...(event.error !== undefined && { error: event.error }),
      ...(event.duration_ms !== undefined && { duration_ms: event.duration_ms }),
    };
    lines.push(JSON.stringify(expanded));
  }

  // Last line: trigger
  lines.push(JSON.stringify(trigger));

  return lines.join('\n') + '\n';
}

/**
 * Expand dictionary handles in a data payload. Only expands top-level
 * string values that look like handles (typeof number); nested objects
 * are left as-is to avoid deep traversal on the cold path.
 */
function expandData(
  data: Record<string, unknown>,
  dictionary: Dictionary,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    result[key] = typeof value === 'number' && key !== 'duration_ms'
      ? value  // Keep numbers as numbers — only component/speaker use handles
      : value;
  }
  return result;
}
