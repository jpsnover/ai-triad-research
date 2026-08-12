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
  | 'ai.retry'
  | 'ai.fallback'
  | 'ai.call_by_usage'
  | 'ai.cancelled' // t/2510: request cancelled by client disconnect (info, not a failure)
  // Argument network
  | 'an.extract'
  | 'an.commit'
  | 'an.qbaf'
  | 'an.gc'
  | 'an.commitment_update'
  | 'an.extraction_confidence_missing'
  | 'an.extraction_coverage_low'
  | 'an.extraction_confidence_delta'
  | 'an.extraction_coverage_error'
  | 'an.exclusion_violation'
  // Turn pipeline
  | 'turn.stage'
  | 'turn.validate'
  | 'turn.repair'
  | 'turn.micro-fix'
  | 'turn.hint-filtered'
  | 'turn.hint-suppressed'
  | 'turn.stage.validation.fail'
  | 'turn.prompt_size'
  | 'turn.taxonomy_inject'
  | 'turn.situation_inject'
  | 'turn.evidence'
  | 'turn.citation_bank'
  | 'turn.cite_quality'
  | 'turn.hallucinated_refs'
  | 'turn.quality_gate'
  | 'turn.micro-fix-preserved'
  | 'turn.orchestration.retry_decision'
  | 'turn.quality_gate_repair'
  | 'turn.scope_drift'
  | 'turn.validate.outcome'
  // Debate flow
  | 'debate.config'
  | 'debate.phase'
  | 'debate.round'
  | 'debate.signal'
  | 'debate.moderate'
  | 'debate.crux'
  | 'debate.crux_transition'
  | 'debate.crux_refresh'
  | 'debate.lifecycle'
  | 'debate.lookahead.filter'
  | 'debate.opening_added'
  // State management
  | 'state.save'
  | 'state.save-coalesced'
  | 'state.load'
  | 'state.load-coalesced'
  | 'state.load-guard'
  | 'state.error'
  | 'state.init'
  // Chat
  | 'chat.user-message'
  | 'chat.thinking-stripped'
  | 'chat.url-context-decision'
  | 'chat.url-context-result'
  // User interaction
  | 'user.action'
  | 'ui.navigate'
  | 'ui.select'
  | 'ui.toggle'
  // Store state changes
  | 'state.change'
  // GitHub API operations
  | 'github.api.request'
  | 'github.api.response'
  | 'github.api.error'
  | 'github.api.miss'
  | 'github.api.rate_limit'
  | 'github.api.circuit_break'
  | 'github.api.conflict'
  // Cache operations
  | 'cache.hit'
  | 'cache.miss'
  | 'cache.invalidate'
  | 'cache.manifest.swap'
  | 'cache.coherency_violation'
  // Session branch operations
  | 'branch.create'
  | 'branch.commit'
  | 'branch.delete'
  | 'branch.divergence'
  // Sync operations
  | 'sync.pr.create'
  | 'sync.pr.update'
  | 'sync.conflict'
  // Overlay operations
  | 'overlay.commit'
  // Storage / IO
  | 'storage.mode'
  | 'storage.fallback'
  | 'flight-recorder.dump.written' // t/1352: dump persisted — records which backend received it
  | 'io.retry'
  | 'io.recovered'    // t/1627: atomicWriteSync recovered a rename-exhausted write via in-place copy fallback
  | 'io.data-loss'    // t/1627: atomicWriteSync could not persist; new content preserved at tmpPath
  | 'io.lock-holder'  // t/2544: lock holder identified on EPERM exhaustion (handle.exe / unavailable fallback)
  // Lock instrumentation
  | 'lock.acquire_attempt'
  | 'lock.acquired'
  | 'lock.released'
  | 'lock.timeout'
  | 'lock.ttl_eviction'
  // Lineage
  | 'lineage.boost-applied'
  | 'lineage.boost-check'
  | 'lineage.boost-result'
  | 'lineage.boost-skipped'
  | 'lineage.debate-summary'
  | 'lineage.distribution'
  | 'lineage.pipeline-status'
  // Lookahead
  | 'lookahead.regen'
  // Situation
  | 'situation.divergence-summary'
  // Topic scope
  | 'topic.critique'
  | 'topic_scope_extracted'
  | 'topic_scope_extraction_failed'
  | 'topic_structure_extracted'
  // Debate engine signals
  | 'exploration_seeding'
  | 'turn.insularity_intervention'
  | 'qbaf.non_convergence'
  // Auth flow
  | 'auth.login_attempt'
  | 'auth.callback_landing'
  | 'auth.loop_detected'
  | 'auth.logout_initiated'
  | 'auth.session-recovery'
  // Network
  | 'network.connection_pool'
  // Service worker
  | 'sw.controller_change'
  | 'sw.active'
  | 'sw.update_found'
  // Embed / external content
  | 'embed.load-failure'
  // System
  | 'system.error'
  | 'system.info'
  | 'system.scaling_warning';

export type EventLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export type ErrorCategory = 'network' | 'schema' | 'ai_provider' | 'state' | 'render' | 'permissions';

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
  run_id?: string;
  turn_id?: string;
  call_id?: string;
  request_id?: string;      // X-Request-ID from web bridge for end-to-end tracing
  speaker?: string | number;

  // Window identity (optional — set via setEventContext at init)
  window_id?: string;
  load_generation?: number;

  // Debate positioning (optional — set via setEventContext per turn)
  phase?: string;
  round?: number;
  turn_index?: number;

  // Payload (type-specific)
  message?: string;
  data?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  duration_ms?: number;
  error_category?: ErrorCategory;
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
  run_id?: string;
  turn_id?: string;
  call_id?: string;
  request_id?: string;
  speaker?: string;   // Always expanded string in dump
  window_id?: string;
  load_generation?: number;
  phase?: string;
  round?: number;
  turn_index?: number;
  message?: string;
  data?: Record<string, unknown>;
  error?: { name: string; message: string; stack?: string };
  duration_ms?: number;
  error_category?: ErrorCategory;
}

export interface DumpContext {
  _type: 'context';
  [key: string]: unknown;
}

export interface DumpResult {
  path: string;
  event_count: number;
  first_event_ts: string;
  last_event_ts: string;
  debate_id?: string;
  size_bytes: number;
}

export interface RecorderSummary {
  event_count: number;
  first_event_ts?: string;
  last_event_ts?: string;
  debate_id?: string;
  buffer_size_bytes: number;
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
