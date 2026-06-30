// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

export { FlightRecorder } from './flightRecorder.js';
export { Dictionary } from './dictionary.js';
export { RingBuffer } from './ringBuffer.js';
export { serializeDump } from './serializer.js';
export { redactString, redactFieldValue, redactRecord } from './redact.js';
export type {
  EventType,
  EventLevel,
  FlightRecorderEvent,
  RecordInput,
  FlightRecorderConfig,
  DictionaryEntry,
  DumpHeader,
  DumpDictionary,
  DumpEvent,
  DumpResult,
  RecorderSummary,
  DumpTrigger,
  TriggerType,
  ErrorCategory,
} from './types.js';
export { DEFAULT_CONFIG } from './types.js';

// ── Global singleton ─────────────────────────────────────────────────────

import { FlightRecorder } from './flightRecorder.js';

let _global: FlightRecorder | null = null;

/** Get the global flight recorder instance (null if not initialized). */
export function getGlobalRecorder(): FlightRecorder | null {
  return _global;
}

/** Set the global flight recorder instance. Called once during app init. */
export function setGlobalRecorder(recorder: FlightRecorder): void {
  _global = recorder;
}

/** Reset the global recorder to null. Used by test harnesses to avoid leaking recorders across runs. */
export function clearGlobalRecorder(): void {
  _global = null;
}
