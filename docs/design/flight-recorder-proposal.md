# Flight Recorder Diagnostic System — Design Proposal

## Problem Statement

When an error occurs in the debate engine or taxonomy editor, the current diagnostic data is either (a) scattered across per-turn diagnostics embedded in the debate session, (b) lost because it was only logged to console/stderr, or (c) unavailable because the error occurred before any diagnostic data was captured. The existing trace system (`lib/trace.ts`) provides lightweight telemetry for cloud log ingestion, but it drops events when the server is unreachable and has no crash-persistence mechanism.

We need a system that continuously records the last N events in memory, then dumps them to a self-describing file when an error occurs — giving a diagnostic tool (human or AI) full context about what the system was doing in the seconds or minutes before the failure.

---

## Industry Precedents and Design Lessons

This proposal draws from eight production systems. The key lessons that shape every decision below:

| System | Key Contribution | What Went Wrong |
|--------|-----------------|-----------------|
| **ETW (Windows)** | Manifest/dictionary separates schema from data — zero per-event metadata cost | Manifest authoring is complex; binary manifests must ship with provider binary |
| **Java Flight Recorder** | Thread-local buffers + constant pool + self-describing chunks = <1% overhead | Binary format requires specialized tooling; no human-readable fallback |
| **Linux ftrace** | Per-CPU ring buffers with overwrite mode; reserve/commit two-phase writes | Merging cross-CPU events requires timestamp sorting |
| **Erlang crash dumps** | Capture *everything* at crash time — message queues, process state, heap | Can freeze the system for minutes on large deployments; no pre-crash ring buffer |
| **Sentry breadcrumbs** | 100-event ring with type/category/level/data schema; insertion-order preserved | Flat list — no parent-child correlation; no structured dictionary |
| **ARINC 767** | Self-describing recordings (FRED file embedded with data); explicit timestamps | Early versions (717) used positional timing, which created fragile coupling |
| **Bitdrift** | Two-stage buffer (RAM → disk) with CRC integrity; reserve/commit protocol | Over-engineered for simple application-level use cases |

**Three non-negotiable principles** extracted from these systems:

1. **Self-describing dumps.** The persisted file must contain everything needed to interpret it — no external schema files, no version-matching, no "you need the binary that produced this." (Lesson from ARINC 767 vs 717, JFR vs ETW.)

2. **Dictionary/constant pool.** Repeated strings (component names, model IDs, prompt templates, taxonomy node IDs) must be stored once and referenced by index. This is the single largest space optimization across every system studied. (ETW manifests, JFR constant pools, ARINC 767 FRED files.)

3. **Overwrite mode.** The ring buffer must always keep the most recent events. When the buffer is full, the oldest events are silently discarded. For a flight recorder, recent context is always more valuable than ancient history. (Every system studied uses this.)

---

## Architecture

### Component Overview

```
                    ┌──────────────────────────────────────────┐
                    │            FlightRecorder                │
                    │                                          │
   record() ──────►│  Dictionary ──┐                          │
                    │               │    Ring Buffer            │
   recordError() ──►│  (string      │   [slot 0][slot 1]...    │
                    │   interning)  │   [slot N]...[slot max]  │
   snapshot() ─────►│               │                          │
                    │               └── Events reference       │
                    │                   dictionary by index    │
                    │                                          │
                    │  ┌─────────────────────────────────┐     │
                    │  │  On error: serialize to NDJSON   │     │
                    │  │  Dictionary header + events      │     │
                    │  │  → flight-recorder-{ts}.jsonl    │     │
                    │  └─────────────────────────────────┘     │
                    └──────────────────────────────────────────┘
```

### Three Subsystems

**1. Dictionary (constant pool)**
- Registers frequently-used strings at startup or on first use
- Returns a small integer handle (e.g., `$3`) that events use instead of the full string
- Categories: component names, model IDs, POV identifiers, event type names, prompt template names, taxonomy node IDs, file paths
- Immutable once registered — handles are stable for the lifetime of the process
- Serialized as the first section of the dump file

**2. Ring Buffer**
- Fixed-capacity circular array of event slots
- Overwrite-oldest semantics (no blocking, no backpressure)
- Single-threaded (JavaScript main thread) — no lock-free complexity needed
- Capacity: 1,000 events default, configurable

**3. Dump Trigger**
- On unhandled error, rejection, or explicit `recordError()`: serialize dictionary + ring buffer contents to disk
- Dump file is self-describing NDJSON — each line is a complete JSON object
- Dump includes a header with dictionary, system context, and schema version

---

## Dictionary Design

### Registration API

```typescript
// At module initialization or first use
const DICT_COMPONENT_DEBATE_ENGINE = recorder.intern('component', 'debate-engine');
const DICT_COMPONENT_TURN_PIPELINE = recorder.intern('component', 'turn-pipeline');
const DICT_COMPONENT_QBAF          = recorder.intern('component', 'qbaf');
const DICT_COMPONENT_MODERATOR     = recorder.intern('component', 'moderator');
const DICT_COMPONENT_AI_ADAPTER    = recorder.intern('component', 'ai-adapter');
const DICT_COMPONENT_AN_EXTRACT    = recorder.intern('component', 'argument-network-extraction');
const DICT_COMPONENT_STORE         = recorder.intern('component', 'debate-store');

const DICT_MODEL_GEMINI_FLASH      = recorder.intern('model', 'gemini-2.5-flash');
const DICT_MODEL_CLAUDE_SONNET     = recorder.intern('model', 'claude-sonnet-4-6');

const DICT_POV_PROMETHEUS          = recorder.intern('pov', 'prometheus');
const DICT_POV_SENTINEL            = recorder.intern('pov', 'sentinel');
const DICT_POV_CASSANDRA           = recorder.intern('pov', 'cassandra');
```

### Interning Behavior

```typescript
interface DictionaryEntry {
  handle: number;       // Small integer, monotonically increasing
  category: string;     // Grouping key (component, model, pov, node, prompt, path)
  value: string;        // The full string being compressed
  registered_at: number; // performance.now() timestamp
}
```

Rules:
- `intern(category, value)` returns the existing handle if the same `(category, value)` pair was already registered. Idempotent.
- Handles start at 0, increment by 1. The dictionary is append-only.
- Maximum 4,096 entries. Beyond that, `intern()` returns the raw string (no handle). This cap prevents a programming error from turning the dictionary into a memory leak.
- Short strings (<=8 chars) are never interned — the handle reference (`$17`) is not meaningfully shorter. `intern()` returns the raw string for these.

### Dictionary Reference Format

In event payloads, a dictionary reference is encoded as a string prefixed with `$`:

```json
{"component": "$3", "model": "$7", "speaker": "$10"}
```

On dump, the dictionary is serialized first, so a reader can build a lookup table before encountering any `$N` references. The AI diagnostic tool's first step is always: parse the dictionary, build the expansion map, then read events with full string values.

### Why This Design

ETW uses binary manifest IDs with zero per-event cost, but requires a binary toolchain. JFR uses LEB128-encoded constant pool indices, but requires a binary parser. For an Electron/TypeScript application targeting AI-readable NDJSON output, the `$N` string-prefix convention is the right tradeoff: human-scannable, trivially parseable, and still much shorter than the full string.

The category field (`component`, `model`, `pov`, etc.) exists solely for the dictionary section of the dump file — it groups entries for human readability and helps an AI diagnostic tool understand what kind of thing each handle represents. It is not stored in events.

---

## Ring Buffer Design

### Data Structure

```typescript
interface RingBuffer<T> {
  slots: (T | null)[];   // Fixed-size array, pre-allocated
  capacity: number;      // Default 1000
  writeIndex: number;    // Next write position (mod capacity)
  count: number;         // Total events written (for sequence numbering)
  oldestSeq: number;     // Sequence number of the oldest surviving event
}
```

### Write Operation

```typescript
function record(event: FlightRecorderEvent): void {
  const seq = buffer.count++;
  event._seq = seq;
  event._ts = performance.now();  // Monotonic, high-resolution
  event._wall = Date.now();       // Wall clock for human readability
  buffer.slots[buffer.writeIndex] = event;
  buffer.writeIndex = (buffer.writeIndex + 1) % buffer.capacity;
  if (buffer.count > buffer.capacity) {
    buffer.oldestSeq = buffer.count - buffer.capacity;
  }
}
```

### Why 1,000 Events

The debate engine generates roughly 20-40 events per cross-respond round (AI calls, extraction, validation, QBAF, convergence, moderator). A 12-round debate produces ~300-500 events. A 1,000-event buffer captures 2-3 full debates or the complete last 25-50 rounds of a long debate. This provides ample pre-error context without significant memory pressure.

At an estimated ~500 bytes per event (after dictionary compression), the buffer consumes ~500 KB of memory. Negligible compared to debate session state (typically 1-15 MB).

### Sizing Configuration

```typescript
interface FlightRecorderConfig {
  capacity: number;          // Ring buffer size (default: 1000)
  dumpOnError: boolean;      // Auto-dump on uncaught error/rejection (default: true)
  dumpDir: string;           // Output directory for dump files
  maxDumpFiles: number;      // Retain last N dumps, delete older (default: 10)
  includeSystemContext: boolean; // Include OS/app version in dump header (default: true)
}
```

---

## Event Schema

### Core Event Structure

Every event in the ring buffer has a fixed header and a variable payload:

```typescript
interface FlightRecorderEvent {
  // ── Header (set by record()) ──
  _seq: number;          // Monotonic sequence number
  _ts: number;           // performance.now() — monotonic, high-resolution
  _wall: number;         // Date.now() — wall clock for human correlation

  // ── Required fields (set by caller) ──
  type: EventType;       // Enumerated event type (see below)
  component: string | number; // Component name or dictionary handle
  level: EventLevel;     // severity

  // ── Correlation IDs (optional) ──
  debate_id?: string;    // Session ID
  turn_id?: string;      // Transcript entry ID
  call_id?: string;      // Per-AI-call correlation
  speaker?: string | number; // POV or dictionary handle

  // ── Payload (type-specific) ──
  message?: string;      // Short human-readable description (<=200 chars)
  data?: Record<string, unknown>; // Structured payload
  error?: {              // Present only for error/warning events
    name: string;
    message: string;
    stack?: string;       // First 500 chars of stack trace
  };
  duration_ms?: number;  // For span-end events: elapsed time
}
```

### Event Types

Modeled after Sentry breadcrumbs but extended for this system's needs:

```typescript
type EventType =
  // Lifecycle
  | 'lifecycle'      // Component init, shutdown, phase transition
  // AI operations
  | 'ai.request'     // Outbound AI API call
  | 'ai.response'    // AI API response received
  | 'ai.error'       // AI API error (timeout, rate limit, parse failure)
  // Argument network
  | 'an.extract'     // Claim extraction attempt
  | 'an.commit'      // Nodes/edges committed to network
  | 'an.reject'      // Claim rejected (overlap, confidence)
  | 'an.qbaf'        // QBAF propagation run
  | 'an.gc'          // Network garbage collection
  // Turn pipeline
  | 'turn.stage'     // Pipeline stage start/complete (brief, plan, draft, cite)
  | 'turn.validate'  // Validation attempt (pass, retry, flag)
  | 'turn.repair'    // Repair hint injected, retry started
  // Debate flow
  | 'debate.phase'   // Phase transition (clarification → opening → debate → synthesis)
  | 'debate.round'   // Cross-respond round start/end
  | 'debate.signal'  // Convergence signal computed
  | 'debate.moderate'// Moderator intervention or selection
  // Adaptive staging
  | 'adaptive.eval'  // Phase transition predicate evaluated
  | 'adaptive.transition' // Phase change (thesis→exploration→synthesis)
  | 'adaptive.regress'    // Phase regression
  // State management
  | 'state.save'     // Debate session saved to disk
  | 'state.load'     // Debate session loaded from disk
  | 'state.error'    // State operation failed
  // User interaction
  | 'user.action'    // User-initiated action (button click, config change)
  // System
  | 'system.error'   // Uncaught error or unhandled rejection
  | 'system.warning' // Non-fatal warning
  | 'system.memory'  // Memory pressure event
  | 'system.perf';   // Performance threshold exceeded
```

### Event Levels

```typescript
type EventLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
```

Level semantics:
- **debug**: Verbose operational detail (QBAF iterations, dictionary registrations). Only recorded when explicitly enabled.
- **info**: Normal operations (AI call completed, round started, claims extracted). The default level for most events.
- **warn**: Degraded but recoverable (validation retry, claim rejected, API rate-limited and retrying).
- **error**: Operation failed (AI call failed after retries, parse error, state save failed).
- **fatal**: Unrecoverable (uncaught exception, unhandled promise rejection). Triggers immediate dump.

### Event Type Schemas (Payload Conventions)

Each event type has a recommended `data` shape. These are conventions, not enforced schemas — the flight recorder accepts any `Record<string, unknown>`. But consistent shapes make AI diagnosis far more effective.

**ai.request / ai.response:**
```typescript
{
  model: "$7",                    // dictionary handle
  backend: "gemini",
  purpose: "claim_extraction",    // what this call is for
  prompt_chars: 12400,
  prompt_tokens_est: 3100,        // estimated, not precise
  // On response:
  response_chars: 2800,
  response_time_ms: 4200,
  status: "ok",                   // or "parse_error", "timeout", "rate_limited"
  cached_tokens: 0,
}
```

**an.extract:**
```typescript
{
  candidates_proposed: 5,
  candidates_accepted: 3,
  candidates_rejected: 2,
  rejection_reasons: { overlap: 1, low_confidence: 1 },
  an_nodes_before: 42,
  an_nodes_after: 45,
  extraction_mode: "hybrid",      // or "full"
}
```

**turn.stage:**
```typescript
{
  stage: "draft",                 // brief | plan | draft | cite
  action: "start",               // start | complete | failed
  attempt: 1,                    // 1-based attempt number
  duration_ms: 3200,             // on complete
}
```

**debate.signal:**
```typescript
{
  round: 4,
  move_disposition: 0.65,
  engagement_depth: 0.78,
  recycling_rate: 0.12,
  concession_opportunity: 0.3,
  position_delta: 0.08,
  crux_rate: 0.4,
}
```

**adaptive.eval:**
```typescript
{
  phase: "exploration",
  saturation_score: 0.62,
  convergence_score: 0.45,
  confidence: 0.71,
  action: "stay",                // stay | transition | force_transition | regress | terminate
  reason: "saturation below threshold (0.62 < 0.65)",
}
```

---

## Dump File Format

### Why NDJSON

The dump file format must optimize for AI diagnostic consumption. The research is clear: **structured JSON is the best format for LLM analysis.** Binary formats (JFR, ETW) are more space-efficient but require specialized parsers. Plain text (Erlang crash dumps) is human-readable but hard for LLMs to parse reliably.

NDJSON (Newline-Delimited JSON) — one JSON object per line — provides:
- **Streamable**: an AI tool can process events one at a time without loading the entire file
- **Grep-friendly**: `grep "ai.error"` works out of the box
- **Self-describing**: no external schema needed
- **LLM-native**: JSON is the most common structured format in LLM training data

### File Structure

```
Line 1:   {"_type": "header", ...}        ← System context + schema version
Line 2:   {"_type": "dictionary", ...}    ← Full dictionary for $N expansion
Line 3-N: {"_type": "event", ...}         ← Ring buffer events, oldest first
Last line: {"_type": "trigger", ...}      ← The error/event that caused the dump
```

### Header Line

```json
{
  "_type": "header",
  "_version": 1,
  "schema_version": "1.0.0",
  "app_version": "0.12.0",
  "platform": "win32",
  "electron_version": "35.0.0",
  "node_version": "24.14.1",
  "timestamp": "2026-05-01T14:23:45.123Z",
  "uptime_ms": 3456789,
  "active_debate_id": "ae7c9509-83c9-45c7-8b79-aa2a05fe7bc1",
  "active_debate_phase": "debate",
  "active_debate_round": 7,
  "ring_buffer_capacity": 1000,
  "ring_buffer_events_total": 4523,
  "ring_buffer_events_retained": 1000,
  "events_lost": 3523,
  "memory_usage_mb": 142.5
}
```

The header gives the AI diagnostic tool immediate orientation: what app, what platform, what was happening, how much context was lost to ring buffer overflow.

### Dictionary Line

```json
{
  "_type": "dictionary",
  "entries": [
    {"handle": 0, "category": "component", "value": "debate-engine"},
    {"handle": 1, "category": "component", "value": "turn-pipeline"},
    {"handle": 2, "category": "component", "value": "qbaf"},
    {"handle": 3, "category": "component", "value": "moderator"},
    {"handle": 4, "category": "model", "value": "gemini-2.5-flash"},
    {"handle": 5, "category": "pov", "value": "prometheus"},
    {"handle": 6, "category": "pov", "value": "sentinel"},
    {"handle": 7, "category": "pov", "value": "cassandra"},
    {"handle": 8, "category": "node", "value": "acc-belief-042"},
    {"handle": 9, "category": "prompt", "value": "crossRespondPrompt"}
  ]
}
```

### Event Lines

Dictionary handles are expanded inline by the dump serializer. The persisted file contains full strings, not `$N` references. This is a deliberate choice: the dictionary saves memory in the ring buffer (runtime), but the dump file optimizes for readability (diagnostic time). An AI tool should never need to manually dereference handles.

```json
{"_type":"event","_seq":4501,"_ts":1234567.89,"_wall":1746100025123,"type":"ai.request","component":"turn-pipeline","level":"info","debate_id":"ae7c9509","turn_id":"S14","call_id":"k3m9x2f1","speaker":"prometheus","message":"DRAFT stage call","data":{"model":"gemini-2.5-flash","backend":"gemini","purpose":"draft","prompt_chars":18200,"prompt_tokens_est":4550,"attempt":1}}
{"_type":"event","_seq":4502,"_ts":1234571.23,"_wall":1746100028456,"type":"ai.response","component":"turn-pipeline","level":"info","debate_id":"ae7c9509","turn_id":"S14","call_id":"k3m9x2f1","speaker":"prometheus","data":{"model":"gemini-2.5-flash","response_chars":3400,"response_time_ms":3340,"status":"ok"},"duration_ms":3340}
{"_type":"event","_seq":4503,"_ts":1234571.45,"_wall":1746100028678,"type":"turn.validate","component":"turn-pipeline","level":"warn","debate_id":"ae7c9509","turn_id":"S14","speaker":"prometheus","message":"Validation failed: grounding check","data":{"outcome":"retry","score":0.45,"dimensions":{"schema":"pass","grounding":"fail","advancement":"pass"},"repair_hints":["Cite specific evidence for the scaling law claim"],"attempt":1}}
{"_type":"event","_seq":4504,"_ts":1234571.46,"_wall":1746100028679,"type":"turn.repair","component":"turn-pipeline","level":"info","debate_id":"ae7c9509","turn_id":"S14","speaker":"prometheus","message":"Retrying DRAFT with repair hints","data":{"attempt":2,"hints_count":1}}
```

### Trigger Line

```json
{
  "_type": "trigger",
  "timestamp": "2026-05-01T14:23:48.456Z",
  "trigger_type": "uncaught_error",
  "error": {
    "name": "SyntaxError",
    "message": "Unexpected token '<' at position 0 in JSON",
    "stack": "SyntaxError: Unexpected token '<' ...\n    at JSON.parse (<anonymous>)\n    at extractClaims (useDebateStore.ts:523)\n    at crossRespond (useDebateStore.ts:2891)"
  },
  "context": {
    "active_component": "argument-network-extraction",
    "last_ai_call_id": "k3m9x2f1",
    "debate_round": 7,
    "debate_phase": "debate"
  }
}
```

---

## Dump Trigger Mechanisms

### Automatic Triggers

1. **Uncaught exceptions** — `window.addEventListener('error', ...)` in the renderer; `process.on('uncaughtException', ...)` in main/server.
2. **Unhandled promise rejections** — `window.addEventListener('unhandledrejection', ...)`.
3. **React Error Boundary** — `componentDidCatch` calls `recorder.dumpOnError(error, errorInfo)`.
4. **Explicit `recordError()`** — any catch block can trigger a dump for caught-but-important errors:
   ```typescript
   try { ... } catch (err) {
     recorder.recordError(err, { component: DICT_COMPONENT_AI_ADAPTER });
   }
   ```

### Manual Triggers

5. **Developer tools** — `window.__flightRecorder.dump()` for ad-hoc dumps during development.
6. **Keyboard shortcut** — Ctrl+Shift+D in Electron mode triggers a dump with a "manual" trigger type.

### Dump Throttling

To prevent dump storms (e.g., a loop that throws on every iteration), dumps are throttled:
- Minimum 10 seconds between automatic dumps
- Manual dumps bypass the throttle
- After 5 automatic dumps in 60 seconds, automatic dumping is disabled for the remainder of the session (with a warning logged)

---

## Integration with Existing Infrastructure

### Relationship to `lib/trace.ts`

The flight recorder does **not** replace the trace system. They serve different purposes:

| | Trace System | Flight Recorder |
|---|---|---|
| **Purpose** | Cloud log ingestion for operational monitoring | Pre-error context for post-mortem diagnosis |
| **Persistence** | Streamed to server, fire-and-forget | In-memory ring buffer, dumped on error |
| **Loss tolerance** | Events can be dropped | Events are retained until overwritten by newer events |
| **Format** | JSON batches via HTTP POST | NDJSON file on disk |
| **Consumer** | Log Analytics dashboards | AI diagnostic tool or human |

The flight recorder should **subscribe** to trace events — every `trace()` call also generates a flight recorder event. This means existing instrumentation automatically feeds the flight recorder without any code changes at call sites.

```typescript
// In trace.ts, after constructing the event:
if (globalFlightRecorder) {
  globalFlightRecorder.record({
    type: mapTraceEventToFlightRecorderType(event),
    component: inferComponent(event),
    level: inferLevel(event),
    debate_id: ev.debate_id,
    turn_id: ev.turn_id,
    call_id: ev.call_id,
    speaker: ev.speaker,
    message: event,
    data: ev.data,
  });
}
```

### Relationship to `DebateDiagnostics`

`DebateDiagnostics` captures rich per-turn data (full prompts, raw responses, extraction traces) that is too large for the flight recorder. The flight recorder captures *summaries* of these operations (e.g., "extraction completed: 5 candidates, 3 accepted, 2 rejected") while the full data remains in the debate session.

On dump, the flight recorder header includes the `active_debate_id`, which lets a diagnostic tool cross-reference the dump with the full debate session JSON for deeper investigation.

### Relationship to React Error Boundary

The existing `ErrorBoundary` in `App.tsx` currently logs to console. It should be extended to call `recorder.dumpOnError()`:

```typescript
componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
  globalFlightRecorder?.dumpOnError(error, {
    component_stack: errorInfo.componentStack?.slice(0, 1000),
  });
}
```

---

## What to Record: Instrumentation Points

### High-Value Events (Always Record)

These events have the highest diagnostic value per byte:

| Event | Component | Why |
|-------|-----------|-----|
| AI API call start/complete/error | ai-adapter | Most common failure point; latency/timeout/rate-limit context |
| Claim extraction result | an-extract | Rejection reasons and overlap data explain network growth problems |
| Turn validation outcome | turn-pipeline | Retry chains are the #1 source of user-visible latency |
| Phase transitions | debate-engine | State machine errors need transition context |
| Moderator interventions | moderator | Intervention budget exhaustion causes silent moderator |
| Debate session save/load | debate-store | Persistence failures lose work |
| Uncaught errors | system | The trigger event itself |

### Medium-Value Events (Record at Info Level)

| Event | Component | Why |
|-------|-----------|-----|
| QBAF propagation | qbaf | Convergence failures or unexpected strength shifts |
| Convergence signals | debate-engine | Signal trends explain phase transition decisions |
| Adaptive staging evaluations | adaptive | Phase transition logic is complex; trace decisions |
| Context compression | debate-store | Compression can lose important context |
| Gap injection | debate-engine | Fourth-voice injection failures |
| Taxonomy node matching | debate-store | Relevance scoring problems |

### Low-Value Events (Record at Debug Level, Off by Default)

| Event | Component | Why |
|-------|-----------|-----|
| Dictionary registration | flight-recorder | Only useful for debugging the recorder itself |
| React component lifecycle | ui | Render performance issues |
| Zustand selector updates | state | State management debugging |
| Individual QBAF iterations | qbaf | Only relevant for convergence bugs |

---

## AI Diagnostic Consumption

### Prompt Template for AI Diagnosis

The dump file is designed to be fed directly to an LLM with a diagnostic prompt. The recommended prompt structure:

```
You are diagnosing a failure in the AI Triad debate engine. Below is a flight
recorder dump captured at the moment of failure.

The file has four sections:
1. HEADER — system context (app version, platform, active debate state)
2. DICTIONARY — string registry; handles ($N) in events expand to these values
3. EVENTS — ring buffer contents, oldest first, newest last
4. TRIGGER — the error that caused the dump

Analyze the events leading up to the trigger. Focus on:
- The causal chain: what sequence of events led to the failure?
- Any warnings or retries that preceded the error
- Whether the error is in the AI API layer, the extraction pipeline, the state
  management layer, or the UI
- Whether this is a systemic issue (likely to recur) or a transient failure
- Suggested fix or workaround

<dump file contents>
```

### Why NDJSON Is Optimal for This

1. **Token efficiency**: Each event is a single line. An LLM can skip irrelevant events by scanning `type` fields without parsing nested structures.
2. **Chronological narrative**: Events are ordered oldest-to-newest, matching how LLMs process sequential context.
3. **No nesting ambiguity**: Each line is independently parseable. No "which closing brace matches which opening brace" confusion.
4. **Selective inclusion**: A diagnostic tool can filter events by type or level before feeding to the LLM, reducing token usage for large dumps.

### File Size Estimates

| Buffer Size | Avg Event Size | Raw NDJSON | Gzipped |
|-------------|---------------|------------|---------|
| 100 events  | 500 bytes     | ~50 KB     | ~8 KB   |
| 500 events  | 500 bytes     | ~250 KB    | ~40 KB  |
| 1000 events | 500 bytes     | ~500 KB    | ~80 KB  |

A 500 KB dump file is ~125K tokens at ~4 chars/token — within the context window of modern LLMs. Gzipped dumps can be stored efficiently; NDJSON is decompressed for diagnosis.

---

## File Management

### Dump File Naming

```
flight-recorder-2026-05-01T14-23-48-456Z.jsonl
```

ISO 8601 timestamp with colons replaced by hyphens (filesystem-safe). Extension `.jsonl` signals NDJSON format.

### Retention Policy

- Default: retain the 10 most recent dump files
- On each new dump, check the dump directory and delete the oldest files beyond the retention limit
- Total disk budget: configurable, default 50 MB. If a dump would exceed the budget, delete oldest dumps until space is available.

### Dump Directory

- Electron mode: `{userData}/flight-recorder/` (e.g., `%APPDATA%/taxonomy-editor/flight-recorder/`)
- Web/container mode: `{dataDir}/flight-recorder/` (alongside debates directory)
- Configurable via `FlightRecorderConfig.dumpDir`

---

## Performance Characteristics

### Write Path (Hot Path)

The `record()` function is on the hot path — it is called from AI request handlers, extraction pipelines, and validation loops. Target: **<1 microsecond per event**.

Operations per `record()` call:
1. Increment sequence counter (1 integer addition)
2. Read `performance.now()` (1 platform call, ~100ns)
3. Read `Date.now()` (1 platform call, ~50ns)
4. Write event object to slot (1 array index assignment)
5. Advance write index (1 modulo operation)

No allocations on the hot path — the event object is allocated by the caller and simply stored by reference. No string formatting, no serialization, no I/O.

### Dump Path (Cold Path)

Serialization only happens on error (cold path). Target: **<500ms for a 1,000-event buffer**.

Operations:
1. Read events from ring buffer in sequence order
2. Expand dictionary handles to full strings
3. Serialize each event to JSON (one line per event)
4. Write NDJSON to disk

This is acceptable latency for an error path. The dump runs synchronously to ensure completion before the process potentially exits.

### Memory Overhead

- Ring buffer: 1,000 slots x ~500 bytes = ~500 KB
- Dictionary: ~4,096 entries x ~100 bytes = ~400 KB
- Total: **~1 MB** steady-state overhead

---

## Implementation Phases

### Phase 1: Core Infrastructure
- `FlightRecorder` class with ring buffer, dictionary, and dump serializer
- Global singleton initialization in app startup
- Automatic dump triggers (uncaught error, unhandled rejection, error boundary)
- NDJSON dump file format with header, dictionary, events, trigger sections
- File retention policy

### Phase 2: Instrumentation
- Hook into existing `trace()` calls (zero call-site changes)
- Add flight recorder events to AI adapter (request/response/error)
- Add flight recorder events to claim extraction pipeline
- Add flight recorder events to turn validation/repair
- Add flight recorder events to debate phase transitions

### Phase 3: AI Diagnostic Integration
- Diagnostic prompt template for LLM analysis
- CLI tool to pretty-print dump files with dictionary expansion
- Filter/slice utility (extract events by type, time range, or correlation ID)
- Integration with the debate engine's `ActionableError` pattern — dump file path included in error output

### Phase 4: Enhancements
- Configurable event level filter (e.g., only `warn`+ in production)
- Snapshot events — periodic snapshots of system state (memory usage, AN size, convergence scores) recorded every N seconds as `system.perf` events
- Cross-process dumps — Electron main process has its own ring buffer; dumps include both renderer and main process events
- Dump comparison tool — diff two dumps to identify what changed between a working run and a failing run

---

## Open Questions

1. **Should the ring buffer use a typed array for better memory layout?** For 1,000 events in JavaScript, the overhead of object references is small enough that a plain array is likely fine. A `Float64Array` approach (packing fields into fixed-width slots) would save memory but sacrifice readability during development. Recommend: plain array for v1, profile before optimizing.

2. **Should dumps include a truncated version of the active debate session?** The header already includes the `active_debate_id` for cross-referencing, but embedding a summary (topic, phase, round, AN size, recent transcript entry IDs) would make dumps more self-contained. Recommend: include a ~2KB session summary in the header.

3. **Should the dictionary support dynamic categories beyond the initial set?** The current design has a fixed set of categories (component, model, pov, node, prompt, path). AI adapter model names and taxonomy node IDs are known at startup; but user-defined strings (topic text, custom model names) are not. Recommend: allow arbitrary categories but log a warning when the dictionary exceeds 1,000 entries.

4. **Should dumps be encrypted or access-controlled?** Dumps may contain prompt text, AI responses, and taxonomy content. For the current single-user desktop app, this is not a concern. For a future cloud deployment, dumps should be encrypted at rest and access-controlled. Recommend: defer to Phase 4.
