# Server-Side Flight Recorder — Design Spec

## Problem

Git sync operations (`initDataRepo`, `pullDataUpdates`, `fetchFromOrigin`, `git reset`) run server-side but are invisible to the flight recorder. When they fail, the client only sees "Server returned no result" after a 90s timeout. We can't diagnose which git command hung, whether credentials failed, or what the copy status was.

## Design

Add a `FlightRecorder` instance to the Node.js server process. It captures server-side events in a ring buffer and dumps to the same directory as client dumps. The `FlightRecorder` class is already Node.js compatible.

## Architecture

```
┌──────────────────────────────────────────────┐
│  Server (Node.js)                            │
│                                              │
│  FlightRecorder (capacity: 2000)             │
│    ├─ git operations (init, fetch, reset)    │
│    ├─ data-pull progress steps               │
│    ├─ copy-status transitions                │
│    ├─ API errors (AI, auth, proxy)           │
│    ├─ health check results                   │
│    └─ startup/shutdown lifecycle             │
│                                              │
│  Dump triggers:                              │
│    ├─ POST /api/flight-recorder/server-dump  │
│    ├─ Uncaught exception / unhandled reject  │
│    └─ SIGTERM (graceful shutdown)            │
│                                              │
│  Context provider:                           │
│    ├─ git state (branch, HEAD, initialized)  │
│    ├─ copy status (state, progress)          │
│    ├─ process memory (RSS, heap)             │
│    ├─ uptime, active requests count          │
│    └─ env vars (deploy tag, auth mode)       │
└──────────────────────────────────────────────┘
```

## Implementation

### 1. Server recorder initialization (`server.ts`)

```typescript
import { FlightRecorder } from '@lib/flight-recorder/flightRecorder';

const serverRecorder = new FlightRecorder({ capacity: 2000, dumpOnError: false });

// Register known components
serverRecorder.intern('component', 'server');
serverRecorder.intern('component', 'git');
serverRecorder.intern('component', 'data-pull');
serverRecorder.intern('component', 'copy-status');
serverRecorder.intern('component', 'auth');
serverRecorder.intern('component', 'ai-proxy');

// Context provider — server state at dump time
serverRecorder.setContextProvider(() => ({
  server: {
    version: SERVER_VERSION,
    started_at: SERVER_START_TIME,
    uptime_s: Math.round(process.uptime()),
    node_version: process.version,
    platform: process.platform,
    arch: process.arch,
  },
  memory: {
    rss_mb: Math.round(process.memoryUsage().rss / 1048576),
    heap_used_mb: Math.round(process.memoryUsage().heapUsed / 1048576),
    heap_total_mb: Math.round(process.memoryUsage().heapTotal / 1048576),
  },
  git: getGitContextSync(),  // branch, HEAD, initialized, remote URL
  copy_status: getCopyStatusSync(),  // state, progress
  environment: {
    deploy_tag: process.env.DEPLOY_TAG,
    auth_disabled: process.env.AUTH_DISABLED,
    git_sync_enabled: process.env.GIT_SYNC_ENABLED,
    data_root: process.env.AI_TRIAD_DATA_ROOT,
  },
}));
```

### 2. Instrument git operations (`gitRepoStore.ts`)

Replace `console.log('[gitRepoStore]...')` with recorder calls:

```typescript
export function setServerRecorder(r: FlightRecorder) { _recorder = r; }

// In git() helper:
_recorder?.record({ type: 'lifecycle', component: 'git', level: 'debug',
  message: `git ${args.join(' ')}` });
// On success:
_recorder?.record({ type: 'lifecycle', component: 'git', level: 'info',
  message: `git ${args[0]} ok`, duration_ms });
// On error:
_recorder?.record({ type: 'system.error', component: 'git', level: 'error',
  message: `git ${args[0]} failed`, error: { name, message, stack } });
```

### 3. Instrument data-pull endpoint (`server.ts`)

```typescript
// Each step of the pull:
serverRecorder.record({ type: 'lifecycle', component: 'data-pull', level: 'info',
  message: 'pull.start', data: { dataRoot } });
serverRecorder.record({ type: 'lifecycle', component: 'data-pull', level: 'info',
  message: 'pull.fetch_start' });
serverRecorder.record({ type: 'lifecycle', component: 'data-pull', level: 'info',
  message: 'pull.fetch_ok', duration_ms: fetchDuration });
serverRecorder.record({ type: 'lifecycle', component: 'data-pull', level: 'info',
  message: 'pull.reset_ok', duration_ms: resetDuration });
```

### 4. Instrument initDataRepo

```typescript
serverRecorder.record({ type: 'lifecycle', component: 'git', level: 'info',
  message: 'initDataRepo.start' });
serverRecorder.record({ type: 'lifecycle', component: 'git', level: 'info',
  message: 'initDataRepo.clone_to_tmp', duration_ms });
serverRecorder.record({ type: 'lifecycle', component: 'git', level: 'info',
  message: 'initDataRepo.move_git_dir', duration_ms });
serverRecorder.record({ type: 'lifecycle', component: 'git', level: 'info',
  message: 'initDataRepo.ok', duration_ms: totalDuration });
```

### 5. Server dump endpoint

```typescript
post('/api/flight-recorder/server-dump', (_req, res) => {
  const { ndjson } = serverRecorder.buildDump('manual');
  const filename = `server-flight-recorder-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
  const filePath = path.join(dumpDir, filename);
  fs.writeFileSync(filePath, ndjson);
  json(res, { filePath, filename });
});
```

### 6. Auto-dump on errors and shutdown

```typescript
process.on('uncaughtException', (err) => {
  serverRecorder.record({ type: 'system.error', component: 'server', level: 'fatal',
    message: err.message, error: { name: err.name, message: err.message, stack: err.stack } });
  const { ndjson } = serverRecorder.buildDump('uncaught_error', { name: err.name, message: err.message });
  fs.writeFileSync(path.join(dumpDir, `server-crash-${Date.now()}.jsonl`), ndjson);
});

process.on('SIGTERM', () => {
  serverRecorder.record({ type: 'lifecycle', component: 'server', level: 'info', message: 'SIGTERM received' });
  const { ndjson } = serverRecorder.buildDump('shutdown');
  fs.writeFileSync(path.join(dumpDir, `server-shutdown-${Date.now()}.jsonl`), ndjson);
});
```

### 7. Extend /health with recorder stats

```typescript
{
  ...existingHealth,
  flight_recorder: {
    events_recorded: serverRecorder.eventsTotal,
    buffer_retained: serverRecorder.eventsRetained,
    buffer_capacity: 2000,
  }
}
```

## File naming convention

- Client dumps: `flight-recorder-YYYY-MM-DDTHH-mm-ss.jsonl`
- Server dumps: `server-flight-recorder-YYYY-MM-DDTHH-mm-ss.jsonl`
- Server crashes: `server-crash-TIMESTAMP.jsonl`
- Server shutdowns: `server-shutdown-TIMESTAMP.jsonl`

## Viewer integration

The Flight Recorder viewer (`tools/flight-recorder-viewer.html`) already handles any NDJSON file. Server dumps use the same format (header, dictionary, context, events, trigger) and will render without changes.

## Constraints

- Server recorder is synchronous (no async in record path)
- Ring buffer at 2000 events (separate from client's 3000)
- Dumps go to same directory as client dumps
- No cross-process merging — server and client dumps are separate files
- Context provider must be synchronous (process.memoryUsage, fs.readFileSync for copy-status)
