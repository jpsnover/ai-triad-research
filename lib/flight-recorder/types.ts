// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// ── Event types ──────────────────────────────────────────────────────────

export type EventType =
  // Lifecycle
  | 'lifecycle'
  // AI operations
  | 'ai.request'
  | 'ai.response'
  | 'ai.error'
  // Argument network
  | 'an.extract'
  | 'an.commit'
  | 'an.reject'
  | 'an.qbaf'
  | 'an.gc'
  // Turn pipeline
  | 'turn.stage'
  | 'turn.validate'
  | 'turn.repair'
  // Debate flow
  | 'debate.phase'
  | 'debate.round'
  | 'debate.signal'
  | 'debate.moderate'
  // Adaptive staging
  | 'adaptive.eval'
  | 'adaptive.transition'
  | 'adaptive.regress'
  // State management
  | 'state.save'
  | 'state.load'
  | 'state.error'
  // User interaction
  | 'user.action'
  // System
  | 'system.error'
  | 'system.warning'
  | 'system.memory'
  | 'system.perf';

export type EventLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

// ── Core event ───────────────────────────────────────────────────────────

export interface FlightRecorderEvent {
  // Header (set by record())
  _seq: number;
  _ts: number;           // performance.now() — monotonic, high-resolution
  _wall: number;         // Date.now() — wall clock

  // Required fields (set by caller)
  type: EventType;
  component: string | number;  // Component name or dictionary handle
  level: EventLevel;

  // Correlation IDs (optional)
  debate_id?: string;
  turn_id?: string;
  call_id?: string;
  speaker?: string | number;

  // Payload (type-specific)
  message?: string;
  data?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  duration_ms?: number;
}

/** Input to record() — header fields are stamped automatically. */
export type RecordInput = Omit<FlightRecorderEvent, '_seq' | '_ts' | '_wall'>;

// ── Dictionary ───────────────────────────────────────────────────────────

export interface DictionaryEntry {
  handle: number;
  category: string;
  value: string;
  registered_at: number;  // performance.now()
}

// ── Configuration ────────────────────────────────────────────────────────

export interface FlightRecorderConfig {
  capacity: number;              // Ring buffer size (default: 1000)
  dumpOnError: boolean;          // Auto-dump on uncaught error/rejection (default: true)
  dumpDir: string;               // Output directory for dump files
  maxDumpFiles: number;          // Retain last N dumps (default: 10)
  maxDumpBytes: number;          // Total disk budget in bytes (default: 50 MB)
  includeSystemContext: boolean;  // Include OS/app info in dump header (default: true)
}

export const DEFAULT_CONFIG: FlightRecorderConfig = {
  capacity: 1000,
  dumpOnError: true,
  dumpDir: '',  // Set by platform-specific init
  maxDumpFiles: 10,
  maxDumpBytes: 50 * 1024 * 1024,
  includeSystemContext: true,
};

// ── Dump file sections ───────────────────────────────────────────────────

export interface DumpHeader {
  _type: 'header';
  _version: 1;
  schema_version: '1.0.0';
  timestamp: string;
  uptime_ms: number;
  ring_buffer_capacity: number;
  ring_buffer_events_total: number;
  ring_buffer_events_retained: number;
  events_lost: number;
  // System context (optional)
  app_version?: string;
  platform?: string;
  electron_version?: string;
  node_version?: string;
  memory_usage_mb?: number;
  // Active debate context (optional)
  active_debate_id?: string;
  active_debate_phase?: string;
  active_debate_round?: number;
  [key: string]: unknown;
}

export interface DumpDictionary {
  _type: 'dictionary';
  entries: DictionaryEntry[];
}

export interface DumpEvent {
  _type: 'event';
  _seq: number;
  _ts: number;
  _wall: number;
  type: EventType;
  component: string;  // Always expanded string in dump
  level: EventLevel;
  debate_id?: string;
  turn_id?: string;
  call_id?: string;
  speaker?: string;   // Always expanded string in dump
  message?: string;
  data?: Record<string, unknown>;
  error?: { name: string; message: string; stack?: string };
  duration_ms?: number;
}

export type TriggerType = 'uncaught_error' | 'unhandled_rejection' | 'error_boundary' | 'explicit' | 'manual';

export interface DumpTrigger {
  _type: 'trigger';
  timestamp: string;
  trigger_type: TriggerType;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  context?: Record<string, unknown>;
}
