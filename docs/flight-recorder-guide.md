# Flight Recorder Usage Guide

The flight recorder is a ring-buffer event logger that continuously captures the last 1,000 events in memory, then serializes to NDJSON on error. It enables post-mortem debugging from crash dumps without the overhead of persistent logging.

## Quick Reference

```typescript
import { getGlobalRecorder } from '@lib/flight-recorder/index';

getGlobalRecorder()?.record({
  type: 'ai.request',
  component: 'myComponent',
  level: 'info',
  message: 'what happened',
  data: { key: 'value' },
});
```

Always use `getGlobalRecorder()?.record()` with optional chaining — the recorder is null in tests and CLI contexts.

## When to Record

### Always Record

| Situation | Event Type | Level |
|-----------|-----------|-------|
| AI API call starts | `ai.request` | `info` |
| AI API call succeeds | `ai.response` | `info` |
| AI API call fails | `ai.error` | `error` |
| Caught error in a `catch` block | `system.error` | `error` |
| Debate phase transition | `debate.phase` | `info` |
| Debate round boundary | `debate.round` | `info` |
| Argument network extraction | `an.extract` | `info` |
| QBAF recomputation | `an.qbaf` | `info` |
| State save/load | `state.save` / `state.load` | `info` |
| Data quality warning | varies | `warn` |

### Record When Debugging Value is High

| Situation | Event Type | Level |
|-----------|-----------|-------|
| Turn validation pass/fail | `turn.validate` | `info`/`warn` |
| Turn repair attempt | `turn.repair` | `warn` |
| Convergence signal detected | `debate.signal` | `info` |
| Crux resolution | `debate.crux` | `info` |
| Cache hit/miss on hot path | `cache.hit` / `cache.miss` | `debug` |
| User-initiated action | `user.action` | `info` |
| UI navigation | `ui.navigate` | `debug` |

### Do Not Record

- Routine loop iterations or trivial getters
- Events that would fire more than ~10 times per second (ring buffer churn)
- Sensitive data (API keys, user credentials, PII)

## Event Types

Use the most specific `EventType` available. See `lib/flight-recorder/types.ts` for the full list. Key families:

| Prefix | Domain | Examples |
|--------|--------|----------|
| `ai.*` | AI backend calls | `ai.request`, `ai.response`, `ai.error` |
| `an.*` | Argument network | `an.extract`, `an.commit`, `an.qbaf`, `an.gc` |
| `turn.*` | Turn pipeline | `turn.stage`, `turn.validate`, `turn.repair` |
| `debate.*` | Debate flow | `debate.phase`, `debate.round`, `debate.signal`, `debate.crux` |
| `state.*` | State management | `state.save`, `state.load`, `state.error`, `state.change` |
| `ui.*` | User interaction | `ui.navigate`, `ui.select`, `ui.toggle` |
| `cache.*` | Cache operations | `cache.hit`, `cache.miss`, `cache.invalidate` |
| `github.api.*` | GitHub API | `github.api.request`, `github.api.error` |
| `system.*` | System-level | `system.error`, `system.scaling_warning` |

If no existing type fits, add a new one to `lib/flight-recorder/types.ts` following the `domain.action` naming convention.

## Required Fields

Every `record()` call must include:

```typescript
{
  type: EventType,      // What category of event
  component: string,    // Which module/component (e.g., 'aiAdapter', 'debate-store')
  level: EventLevel,    // 'debug' | 'info' | 'warn' | 'error' | 'fatal'
  message: string,      // Human-readable description of what happened
}
```

## Optional Fields

| Field | Use When |
|-------|----------|
| `debate_id` | Inside a debate context — correlates events to a specific debate |
| `turn_id` | Inside a turn — correlates events within a single turn |
| `call_id` | Tracking a specific AI call through request→response→error |
| `request_id` | Web bridge requests (end-to-end tracing) |
| `speaker` | Events tied to a specific debate speaker |
| `data` | Structured payload (token counts, model info, scores, etc.) |
| `error` | Caught error details: `{ name, message, stack? }` |
| `duration_ms` | Timed operations (AI calls, saves, computations) |
| `error_category` | Classifies errors: `'network'`, `'schema'`, `'ai_provider'`, `'state'`, `'render'`, `'permissions'` |

## Patterns

### AI Call Instrumentation (request → response/error)

```typescript
const t0 = performance.now();
getGlobalRecorder()?.record({
  type: 'ai.request', component: 'myComponent', level: 'info',
  message: `generateText ${backend}/${model}`,
  data: { backend, model, fn: 'generateText' },
});

try {
  const result = await callAI(...);
  getGlobalRecorder()?.record({
    type: 'ai.response', component: 'myComponent', level: 'info',
    duration_ms: Math.round(performance.now() - t0),
    message: `generateText success`,
    data: { tokens: result.usage?.totalTokens },
  });
} catch (err) {
  getGlobalRecorder()?.record({
    type: 'ai.error', component: 'myComponent', level: 'error',
    error_category: 'ai_provider',
    duration_ms: Math.round(performance.now() - t0),
    message: `generateText failed`,
    error: { name: (err as Error).name, message: String(err) },
  });
}
```

### Catch Block (mandatory in renderer code)

```typescript
catch (err) {
  getGlobalRecorder()?.record({
    type: 'system.error',
    component: 'component-name',
    level: 'error',
    message: 'what failed',
    error: { name: (err as Error).name ?? 'Error', message: String(err) },
  });
  // existing error handling...
}
```

Exceptions (must have explicit comment):
- Telemetry/trace code where silence is intentional: `catch { /* telemetry — silent by design */ }`
- Flight recorder init code (can't log to itself)

### State Transitions

```typescript
getGlobalRecorder()?.record({
  type: 'debate.phase', component: 'debateEngine', level: 'info',
  debate_id: session.id,
  message: `Phase transition: ${oldPhase} → ${newPhase}`,
  data: { from: oldPhase, to: newPhase, round: session.currentRound },
});
```

### Data Quality Warnings

```typescript
getGlobalRecorder()?.record({
  type: 'an.extraction_confidence_missing', component: 'argumentNetwork', level: 'warn',
  speaker,
  message: `LLM output missing extraction_confidence for claim "${claim.text.slice(0, 80)}"`,
  data: { fallbackConfidence: overlap },
});
```

## Levels

| Level | When to Use |
|-------|------------|
| `debug` | Verbose tracing (cache hits, UI navigation, internal state) — noise in most dumps |
| `info` | Normal operations worth seeing in post-mortem (AI calls, phase changes, saves) |
| `warn` | Unexpected but recoverable (missing fields, fallback logic, degraded quality) |
| `error` | Failed operations (API errors, caught exceptions, data corruption) |
| `fatal` | Unrecoverable (app must terminate or restart feature) |

## Component Naming

Use consistent, short component names. Existing conventions:

- `'aiAdapter'` — AI backend abstraction
- `'argumentNetwork'` — argument graph extraction
- `'debate-store'` — Zustand debate state
- `'taxonomy-store'` — Zustand taxonomy state
- `'debateEngine'` — core debate orchestration
- `'turnPipeline'` — per-turn processing

For new components, use the module filename in camelCase (e.g., `convergenceSignals.ts` → `'convergenceSignals'`).

## Dumps

Dumps are triggered automatically on uncaught errors/rejections, or manually via `Ctrl+Shift+D`. They are serialized as NDJSON files containing:

1. **Header** — app version, uptime, buffer stats, build date
2. **Context** — active debate state at dump time
3. **Dictionary** — interned string table for deduplication
4. **Events** — the last 1,000 recorded events
5. **Trigger** — what caused the dump

Dump files are written to the app's dump directory with automatic rotation (max 10 files, 50 MB total).

## Testing

In tests, `getGlobalRecorder()` returns `null`. This is by design — the optional chaining `?.record()` pattern makes recording a no-op in test contexts without mocking.

If you need to verify recording behavior in tests, create a local `FlightRecorder` instance:

```typescript
import { FlightRecorder } from '@lib/flight-recorder/index';

const recorder = new FlightRecorder({ capacity: 100, dumpOnError: false, dumpDir: '' });
// inject into the code under test, then inspect recorder.buffer
```
