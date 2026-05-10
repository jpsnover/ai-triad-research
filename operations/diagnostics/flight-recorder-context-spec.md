# Flight Recorder Context Record — Design Spec

## Goal

Every flight recorder dump should include a `_type: "context"` record (after the header and dictionary) that captures the full app state at dump time. This gives debuggers immediate answers to "what was the app doing?" without reconstructing state from individual events.

## Proposed Record Format

```jsonl
{
  "_type": "context",
  "app": {
    "version": "0.8.0",
    "build_date": "2026-05-10T14:22:33.000Z",
    "build_fingerprint": "build-1778431655343",
    "deployment_mode": "electron-dev",
    "vite_target": "electron",
    "node_version": "v22.22.1",
    "platform": "darwin",
    "arch": "arm64"
  },
  "windows": {
    "main": { "active_tab": "debate", "toolbar_panel": null, "selected_node_id": null },
    "debate_popups": ["c72fe2aa", "bd1d6c61"],
    "diagnostics": true,
    "pov_progression": false
  },
  "debate": {
    "id": "c72fe2aa-c6d9-4fad-ac28-2187abcf9ca1",
    "phase": "debate",
    "adaptive_phase": "argumentation",
    "transcript_length": 25,
    "an_nodes": 41,
    "model": "gemini-3.1-flash-lite-preview",
    "temperature": 0.7,
    "is_generating": false,
    "convergence_signals_count": 14,
    "protocol": "structured"
  },
  "taxonomy": {
    "data_root": "/Users/jsnover/source/repos/ai-triad-data",
    "loaded": { "accelerationist": 155, "safetyist": 222, "skeptic": 195, "situations": 218 },
    "dirty_files": [],
    "save_error": null,
    "validation_errors_count": 0,
    "edges_count": 14656
  },
  "ai": {
    "backend": "gemini",
    "model": "gemini-3.1-flash-lite-preview",
    "has_keys": { "gemini": true, "claude": false, "groq": false, "openai": false }
  },
  "performance": {
    "uptime_s": 1397,
    "heap_used_mb": 142,
    "heap_total_mb": 256,
    "ring_buffer_utilization_pct": 23
  },
  "environment": {
    "AI_TRIAD_DATA_ROOT": "/Users/jsnover/source/repos/ai-triad-data",
    "AUTH_DISABLED": null,
    "GIT_SYNC_ENABLED": null,
    "DEPLOY_TAG": null
  }
}
```

## Field Descriptions

### `app` — Application Identity

| Field | Source | Why |
|-------|--------|-----|
| `version` | `__APP_VERSION__` (vite define) | Track which version has the bug |
| `build_date` | `__BUILD_DATE__` (vite define) | Distinguish dev builds during HMR sessions |
| `build_fingerprint` | `BUILD_FINGERPRINT` (App.tsx) | Unique per page load — detects HMR reloads |
| `deployment_mode` | Inferred (see below) | "electron-dev", "electron-prod", "web-container" |
| `vite_target` | `import.meta.env.VITE_TARGET` | "web" or "electron" |
| `node_version` | `process.versions.node` (if available) | Runtime version |
| `platform` | `navigator.platform` | OS |
| `arch` | `navigator.userAgent` snippet | Architecture |

**Deployment mode detection:**
```typescript
function getDeploymentMode(): string {
  const target = import.meta.env.VITE_TARGET;
  if (target === 'web') return 'web-container';
  if (import.meta.env.DEV) return 'electron-dev';
  return 'electron-prod';
}
```

### `windows` — Open Windows State

| Field | Source | Why |
|-------|--------|-----|
| `main.active_tab` | `taxStore.activeTab` | Which section user was viewing |
| `main.toolbar_panel` | `taxStore.toolbarPanel` | Which toolbar was open |
| `main.selected_node_id` | `taxStore.selectedNodeId` | Which node was selected |
| `debate_popups` | Track from IPC forwarding origins | Which debate windows are open |
| `diagnostics` | Track from IPC forwarding origins | Is diagnostics window open |

### `debate` — Active Debate State

| Field | Source | Why |
|-------|--------|-----|
| `id` | `debateStore.activeDebateId` | Which debate was loaded |
| `phase` | `activeDebate.phase` | Top-level phase |
| `adaptive_phase` | `activeDebate.adaptive_staging?.current_phase` | Adaptive engine phase |
| `transcript_length` | `activeDebate.transcript.length` | How far into the debate |
| `an_nodes` | `activeDebate.argument_network?.nodes.length` | AN network size |
| `model` | `debateStore.debateModel` | AI model in use |
| `temperature` | `debateStore.debateTemperature` | Temperature setting |
| `is_generating` | `debateStore.debateGenerating` | Was AI generating when dump occurred |
| `convergence_signals_count` | `activeDebate.convergence_signals?.length` | Signal count |
| `protocol` | `activeDebate.protocol` | Debate protocol |

### `taxonomy` — Data State

| Field | Source | Why |
|-------|--------|-----|
| `data_root` | `api.getDataRoot()` or env var | Where data lives — critical for path issues |
| `loaded` | Per-POV node counts from store | Which files loaded, how many nodes |
| `dirty_files` | `taxStore.dirty` as array | Unsaved changes |
| `save_error` | `taxStore.saveError` | Active save error |
| `validation_errors_count` | Count of `taxStore.validationErrors` | Schema violations |
| `edges_count` | `taxStore.edgesFile?.edges.length` | Edge network size |

### `ai` — AI Backend State

| Field | Source | Why |
|-------|--------|-----|
| `backend` | `taxStore.aiBackend` | Active backend |
| `model` | `taxStore.geminiModel` or debate override | Active model |
| `has_keys` | `api.hasApiKey()` per backend | Which backends are configured |

### `performance` — Resource Usage

| Field | Source | Why |
|-------|--------|-----|
| `uptime_s` | `performance.now() / 1000` | Session duration |
| `heap_used_mb` | `performance.memory?.usedJSHeapSize` | Memory pressure |
| `heap_total_mb` | `performance.memory?.totalJSHeapSize` | Heap limit |
| `ring_buffer_utilization_pct` | `events_retained / capacity * 100` | Buffer pressure |

### `environment` — Key Environment Variables

| Field | Source | Why |
|-------|--------|-----|
| `AI_TRIAD_DATA_ROOT` | Direct env access | Data path override |
| `AUTH_DISABLED` | Direct env access | Container auth mode |
| `GIT_SYNC_ENABLED` | Direct env access | Sync mode |
| `DEPLOY_TAG` | Direct env access | Deployment identifier |

## Implementation

### Where: `flightRecorderInit.ts` context provider

The context provider at line 232 already runs synchronously at dump time. Expand it to return the full context record:

```typescript
recorder.setContextProvider(() => {
  try {
    const { useTaxonomyStore } = require('../hooks/useTaxonomyStore');
    const { useDebateStore } = require('../hooks/useDebateStore');
    const taxState = useTaxonomyStore.getState();
    const debateState = useDebateStore.getState();
    const debate = debateState.activeDebate;
    const mem = (performance as any).memory;

    return {
      app: {
        version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : undefined,
        build_date: typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : undefined,
        build_fingerprint: `build-${(window as any).__BUILD_FINGERPRINT ?? 'unknown'}`,
        deployment_mode: getDeploymentMode(),
        vite_target: import.meta.env.VITE_TARGET ?? 'electron',
        platform: navigator.platform,
      },
      windows: {
        main: {
          active_tab: taxState.activeTab,
          toolbar_panel: taxState.toolbarPanel,
          selected_node_id: taxState.selectedNodeId,
        },
        // Populated from tracked IPC origins
        debate_popups: Array.from(trackedOrigins).filter(o => o.startsWith('debate:')),
        diagnostics: trackedOrigins.has('diagnostics'),
      },
      debate: debate ? {
        id: debate.id,
        phase: debate.phase,
        adaptive_phase: debate.adaptive_staging?.current_phase,
        transcript_length: debate.transcript.length,
        an_nodes: debate.argument_network?.nodes?.length ?? 0,
        model: debateState.debateModel,
        temperature: debateState.debateTemperature,
        is_generating: !!debateState.debateGenerating,
        convergence_signals_count: debate.convergence_signals?.length ?? 0,
        protocol: debate.protocol,
      } : null,
      taxonomy: {
        data_root: taxState.dataRoot,
        loaded: {
          accelerationist: taxState.accelerationist?.nodes?.length ?? 0,
          safetyist: taxState.safetyist?.nodes?.length ?? 0,
          skeptic: taxState.skeptic?.nodes?.length ?? 0,
          situations: taxState.situations?.nodes?.length ?? 0,
        },
        dirty_files: [...(taxState.dirty ?? [])],
        save_error: taxState.saveError,
        edges_count: taxState.edgesFile?.edges?.length ?? 0,
      },
      performance: {
        uptime_s: Math.round(performance.now() / 1000),
        heap_used_mb: mem ? Math.round(mem.usedJSHeapSize / 1048576) : undefined,
        heap_total_mb: mem ? Math.round(mem.totalJSHeapSize / 1048576) : undefined,
      },
    };
  } catch { return {}; }
});
```

### Where: `FlightRecorder.buildDump()` in `lib/flight-recorder/flightRecorder.ts`

After the header and dictionary, insert the context record:

```typescript
buildDump(triggerType, error?, triggerContext?): { ndjson: string } {
  const lines: string[] = [];
  lines.push(JSON.stringify(this.buildHeader(triggerType, error)));
  lines.push(JSON.stringify(this.buildDictionary()));

  // Context record — captures app state at dump time
  if (this.contextProvider) {
    const ctx = this.contextProvider();
    if (ctx && Object.keys(ctx).length > 0) {
      lines.push(JSON.stringify({ _type: 'context', ...ctx }));
    }
  }

  // Events
  for (const event of this.events()) {
    lines.push(JSON.stringify(event));
  }
  // ...
}
```

### GUI Display

Add a "Context" section to the DiagnosticsWindow help panel or a dedicated "Flight Recorder" tab that parses the latest dump and displays the context record in a structured table.

## Constraints

- Context provider MUST be synchronous (runs during dump serialization)
- MUST handle stores not yet initialized (graceful `try/catch`)
- MUST NOT include secrets (API keys are booleans, not values)
- SHOULD keep total context record under 2KB (avoid bloating dumps)
- MUST NOT call async APIs (bridge calls are async)

## Related Tickets

- t/329 — Flight recorder improvements (parent)
- t/391 — Unified flight recorder with IPC forwarding
- t/403 — Error boundary dump cooldown bypass
