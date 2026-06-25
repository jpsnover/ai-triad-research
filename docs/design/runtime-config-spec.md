# Runtime Configuration Externalization — Design Spec

**Ticket:** t/905  
**Author:** Technical Lead  
**Status:** Draft — awaiting review  
**Last updated:** 2026-06-24

## 1. Problem Statement

The taxonomy-editor server has 56+ hardcoded configuration parameters scattered across 11 source files. Changing any value — a rate limit, a cache TTL, a circuit breaker threshold — requires a code change, a container rebuild, and a redeployment. This is a 20-minute cycle for a 2-second config tweak.

**Goal:** Extract these parameters into a single `admin/runtime-config.json` file on the data volume, editable via an admin web UI or PowerShell cmdlets, with hot-reload (no container restart).

## 2. Parameter Audit

### 2.1 Network & Resilience (`src/renderer/bridge/resilience.ts`)

| Parameter | Line | Current Value | Type | Hot-Reload? |
|-----------|------|---------------|------|-------------|
| `CIRCUIT_THRESHOLD` | 27 | `5` | integer | Yes |
| `CIRCUIT_COOLDOWN_MS` | 28 | `60000` | duration-ms | Yes |
| `RETRY_BASE_DELAY_MS` | 30 | `1000` | duration-ms | Yes |
| `RETRY_MAX_DELAY_MS` | 31 | `30000` | duration-ms | Yes |
| `RETRY_JITTER_MAX_MS` | 32 | `500` | duration-ms | Yes |
| `MAX_RETRY_AFTER_MS` | 33 | `30000` | duration-ms | Yes |
| `THROTTLE_WINDOW_SIZE` | 35 | `20` | integer | Yes |
| `THROTTLE_BASELINE_COUNT` | 36 | `10` | integer | Yes |
| `THROTTLE_ENTER_FACTOR` | 37 | `2.0` | float | Yes |
| `THROTTLE_EXIT_FACTOR` | 38 | `1.5` | float | Yes |
| `THROTTLE_DELAY_MS` | 39 | `2000` | duration-ms | Yes |

**Note:** These constants live in the *renderer* bundle. They are externalized as client-fetchable defaults via `GET /api/config/client` (see §5.2). The renderer fetches them once at startup and on explicit reload.

### 2.2 Rate Limiting (`src/server/rateLimiter.ts`)

| Parameter | Line | Current Value | Type | Hot-Reload? |
|-----------|------|---------------|------|-------------|
| Rate window | 17 | `60000` | duration-ms | Yes |
| Cleanup cutoff | 104 | `120000` | duration-ms | Yes |
| Cleanup interval | 118 | `600000` | duration-ms | **No** (timer) |

### 2.3 Proxy Tiers (`src/server/proxyTiers.ts`)

| Parameter | Line | Current Value | Type | Hot-Reload? |
|-----------|------|---------------|------|-------------|
| Platform RPM | 52 | `60` | integer | Yes |
| Platform tokens/day | 52 | `2000000` | integer | Yes |
| Platform backends | 52 | `['gemini','claude','groq']` | string[] | Yes |
| BYOK RPM | 53 | `30` | integer | Yes |
| BYOK tokens/day | 53 | `500000` | integer | Yes |
| BYOK backends | 53 | `['gemini','claude','groq']` | string[] | Yes |
| Anonymous RPM | 54 | `10` | integer | Yes |
| Anonymous tokens/day | 54 | `100000` | integer | Yes |
| Anonymous backends | 54 | `['gemini','claude','groq']` | string[] | Yes |
| Free tier RPM | 121 | `6` | integer | Yes |
| Free tier tokens/day | 121 | `50000` | integer | Yes |
| Free tier backends | 122 | `['gemini']` | string[] | Yes |
| Free tier pinned model | 124 | `'gemini-flash-lite-latest'` | string | Yes |
| Cache TTL | 63 | `30000` | duration-ms | Yes |

**Note:** `proxyTiers.ts` already loads `proxy-tiers.json` from the data volume for user-level overrides. This spec promotes the *default* tier values into `runtime-config.json` so they are editable without code changes. The per-user override mechanism in `proxy-tiers.json` remains unchanged.

### 2.4 Quotas (`src/server/quotas.ts`)

| Parameter | Line | Current Value | Type | Hot-Reload? |
|-----------|------|---------------|------|-------------|
| Default max chats | 28 | `25` | integer | Yes |
| Default max debates | 28 | `15` | integer | Yes |
| Cache TTL | 36 | `30000` | duration-ms | Yes |

**Note:** Same as proxy tiers — `quotas.json` handles per-user overrides; defaults move into `runtime-config.json`.

### 2.5 Session Management

**anonymousSessionStore.ts** (`src/server/anonymousSessionStore.ts`)

| Parameter | Line | Current Value | Type | Hot-Reload? |
|-----------|------|---------------|------|-------------|
| Session TTL | 40 | `14400000` (4h) | duration-ms | Yes |
| Max sessions | 41 | `100` | integer | Yes |
| Max size per session | 42 | `10485760` (10 MB) | integer | Yes |
| Cleanup interval | 43 | `300000` (5 min) | duration-ms | **No** (timer) |

**sessionBranchManager.ts** (`src/server/sessionBranchManager.ts`)

| Parameter | Line | Current Value | Type | Hot-Reload? |
|-----------|------|---------------|------|-------------|
| Branch prefix | 27 | `'api-session/'` | string | **No** (restart) |
| Max branch name length | 28 | `100` | integer | **No** (restart) |
| Token freshness threshold | 29 | `60000` | duration-ms | Yes |
| Lock acquire timeout | 32 | `10000` | duration-ms | Yes |
| Lock hold TTL | 33 | `30000` | duration-ms | Yes |

### 2.6 Analytics

**analytics.ts** (`src/server/analytics.ts`)

| Parameter | Line | Current Value | Type | Hot-Reload? |
|-----------|------|---------------|------|-------------|
| Retention days | 134 | `90` | integer | Yes |

**analyticsEmitter.ts** (`src/renderer/lib/analyticsEmitter.ts`)

| Parameter | Line | Current Value | Type | Hot-Reload? |
|-----------|------|---------------|------|-------------|
| Flush interval | 107 | `30000` | duration-ms | **No** (client timer) |
| Buffer requeue limit | 65 | `500` | integer | Yes (via client config) |

### 2.7 Flight Recorder (`src/renderer/lib/flightRecorderInit.ts`, `src/server/server.ts`)

| Parameter | Line | File | Current Value | Type | Hot-Reload? |
|-----------|------|------|---------------|------|-------------|
| Min dump interval | 65 | flightRecorderInit.ts | `10000` | duration-ms | Yes (via client config) |
| Max dumps per window | 66 | flightRecorderInit.ts | `5` | integer | Yes (via client config) |
| Dump window | 67 | flightRecorderInit.ts | `60000` | duration-ms | Yes (via client config) |
| Recorder capacity | 276 | flightRecorderInit.ts | `5000` | integer | **No** (client init) |
| Max retained dumps | 1342 | server.ts | `20` | integer | Yes |
| Max total dump size | 1345 | server.ts | `52428800` (50 MB) | integer | Yes |

### 2.8 Community (`src/server/community.ts`)

| Parameter | Line | Current Value | Type | Hot-Reload? |
|-----------|------|---------------|------|-------------|
| Max pending per user | 204 | `20` | integer | Yes |
| Global pending cap | 210 | `500` | integer | Yes |

### 2.9 Feedback (`src/server/feedbackStore.ts`)

| Parameter | Line | Current Value | Type | Hot-Reload? |
|-----------|------|---------------|------|-------------|
| Default page limit | 37 | `50` | integer | Yes |
| Max page limit | 38 | `200` | integer | Yes |

### 2.10 Server Infra (`src/server/server.ts`, `src/server/config.ts`)

| Parameter | Line | File | Current Value | Type | Hot-Reload? |
|-----------|------|------|---------------|------|-------------|
| Conflicts cache TTL | 520 | server.ts | `300000` (5 min) | duration-ms | Yes |
| Git clone timeout | 767 | server.ts | `300000` (5 min) | duration-ms | Yes |
| Git fetch timeout | 897 | server.ts | `600000` (10 min) | duration-ms | Yes |
| Git default timeout | 847 | server.ts | `120000` (2 min) | duration-ms | Yes |
| Git buffer limit | 848 | server.ts | `10485760` (10 MB) | integer | Yes |
| Heartbeat interval | 841 | server.ts | `15000` | duration-ms | **No** (timer) |
| API key mask length | 1000 | server.ts | `4` | integer | Yes |

### 2.11 Provider Binding (`src/server/providerBinding.ts`)

| Parameter | Line | Current Value | Type | Hot-Reload? |
|-----------|------|---------------|------|-------------|
| Cache TTL | 28 | `30000` | duration-ms | Yes |

### 2.12 Summary: Restart-Required Parameters

These parameters configure timers or initializers that cannot be swapped at runtime:

| Parameter | File | Reason |
|-----------|------|--------|
| Rate limiter cleanup interval | rateLimiter.ts | `setInterval` created at module load |
| Anonymous session cleanup interval | anonymousSessionStore.ts | `setInterval` created at init |
| Session branch prefix | sessionBranchManager.ts | Existing branches use old prefix |
| Max branch name length | sessionBranchManager.ts | Existing branches may violate new limit |
| Heartbeat interval | server.ts | `setInterval` in streaming handler |
| Analytics flush interval | analyticsEmitter.ts | Client-side `setInterval` |
| Flight recorder capacity | flightRecorderInit.ts | Ring buffer allocated at init |

All other parameters (~45) are hot-reloadable.

## 3. Config File Schema

**Location:** `{dataRoot}/admin/runtime-config.json`

The file is optional. Every field has a hardcoded default that applies when the file is missing or a section is absent. This is the fail-safe: delete the config file and the app runs with the same behavior it has today.

```jsonc
{
  "$schema": "./runtime-config.schema.json",
  "_meta": {
    "version": 1,
    "updatedAt": "2026-06-24T12:00:00Z",
    "updatedBy": "jpsnover"
  },

  "resilience": {
    "circuitThreshold": 5,
    "circuitCooldownMs": 60000,
    "retryBaseDelayMs": 1000,
    "retryMaxDelayMs": 30000,
    "retryJitterMaxMs": 500,
    "maxRetryAfterMs": 30000,
    "throttleWindowSize": 20,
    "throttleBaselineCount": 10,
    "throttleEnterFactor": 2.0,
    "throttleExitFactor": 1.5,
    "throttleDelayMs": 2000
  },

  "rateLimiting": {
    "windowMs": 60000,
    "cleanupCutoffMs": 120000
  },

  "tiers": {
    "platform": {
      "requestsPerMinute": 60,
      "tokensPerDay": 2000000,
      "allowedBackends": ["gemini", "claude", "groq"]
    },
    "byok": {
      "requestsPerMinute": 30,
      "tokensPerDay": 500000,
      "allowedBackends": ["gemini", "claude", "groq"]
    },
    "anonymous": {
      "requestsPerMinute": 10,
      "tokensPerDay": 100000,
      "allowedBackends": ["gemini", "claude", "groq"]
    },
    "free": {
      "requestsPerMinute": 6,
      "tokensPerDay": 50000,
      "allowedBackends": ["gemini"],
      "pinnedModel": "gemini-flash-lite-latest"
    }
  },

  "quotas": {
    "defaultMaxChats": 25,
    "defaultMaxDebates": 15
  },

  "sessions": {
    "anonymousTtlMs": 14400000,
    "anonymousMaxSessions": 100,
    "anonymousMaxSizeBytes": 10485760,
    "tokenFreshnessThresholdMs": 60000,
    "lockAcquireTimeoutMs": 10000,
    "lockHoldTtlMs": 30000
  },

  "analytics": {
    "retentionDays": 90,
    "bufferRequeueLimit": 500
  },

  "flightRecorder": {
    "minDumpIntervalMs": 10000,
    "maxDumpsPerWindow": 5,
    "dumpWindowMs": 60000,
    "maxRetainedDumps": 20,
    "maxTotalDumpSizeBytes": 52428800
  },

  "community": {
    "maxPendingPerUser": 20,
    "globalPendingCap": 500
  },

  "feedback": {
    "defaultPageLimit": 50,
    "maxPageLimit": 200
  },

  "server": {
    "conflictsCacheTtlMs": 300000,
    "gitCloneTimeoutMs": 300000,
    "gitFetchTimeoutMs": 600000,
    "gitDefaultTimeoutMs": 120000,
    "gitBufferLimitBytes": 10485760,
    "apiKeyMaskLength": 4
  },

  "cache": {
    "defaultTtlMs": 30000
  }
}
```

### 3.1 JSON Schema

A companion `runtime-config.schema.json` (JSON Schema draft 2020-12) is generated from the TypeScript interface and shipped alongside the config file. It provides:
- Type constraints (`integer`, `number`, `string`, `array`)
- Range constraints: all `*Ms` fields ≥ 0, all `*Factor` fields > 0, `requestsPerMinute` ≥ 1
- Enum constraints: `allowedBackends` items in `['gemini', 'claude', 'groq']`
- `additionalProperties: false` per section to catch typos
- `description` on every field (used by the admin UI as help text)

### 3.2 Validation Rules

| Rule | Constraint |
|------|-----------|
| Duration fields | ≥ 0, ≤ 86400000 (24h) except git timeouts ≤ 3600000 (1h) |
| Rate limits (RPM) | ≥ 1, ≤ 1000 |
| Token limits | ≥ 0, ≤ 100000000 |
| Throttle factors | > 1.0; `exitFactor` < `enterFactor` |
| Quota limits | ≥ 1, ≤ 10000 |
| Buffer/size limits | ≥ 0, ≤ 1073741824 (1 GB) |
| `allowedBackends` | Non-empty array, items from known set |
| `_meta.version` | Must equal `1` (for forward compat) |

## 4. Server Module Design

### 4.1 `runtimeConfig.ts` — Config Reader

Follows the established mtime-cache pattern (quotas.ts, proxyTiers.ts, providerBinding.ts):

```typescript
// src/server/runtimeConfig.ts

export interface RuntimeConfig { /* mirrors §3 schema */ }

const DEFAULTS: RuntimeConfig = { /* all current hardcoded values */ };

let _cache: RuntimeConfig | null = null;
let _cacheMtime = 0;
let _lastLoadTime = 0;
const CACHE_TTL = 5_000; // 5s — tighter than quotas.ts because this backs everything

function loadConfig(): RuntimeConfig {
  const configPath = path.join(getDataRoot(), 'admin', 'runtime-config.json');
  try {
    const stat = fs.statSync(configPath);
    if (_cache && stat.mtimeMs === _cacheMtime) return _cache;
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const validated = validateAndMerge(raw, DEFAULTS);
    _cache = validated;
    _cacheMtime = stat.mtimeMs;
    return _cache;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      getGlobalRecorder()?.record({ /* ... */ });
      log.server.warn({ err }, 'Invalid runtime config — using defaults');
    }
    return DEFAULTS;
  }
}

export function getConfig(): RuntimeConfig {
  const now = Date.now();
  if (now - _lastLoadTime > CACHE_TTL) {
    _lastLoadTime = now;
    return loadConfig();
  }
  return _cache ?? loadConfig();
}

export function forceReload(): { ok: boolean; errors?: string[] } {
  _cache = null;
  _cacheMtime = 0;
  _lastLoadTime = 0;
  try {
    const config = loadConfig();
    return { ok: config !== DEFAULTS };
  } catch (err) {
    return { ok: false, errors: [String(err)] };
  }
}

export function getDefaults(): RuntimeConfig {
  return structuredClone(DEFAULTS);
}
```

### 4.2 `validateAndMerge()`

Deep-merges user config over defaults, field by field. For each field:
1. If absent in user config → use default
2. If present but wrong type → log warning, use default for that field
3. If present but out of range → clamp to nearest valid value, log warning
4. Cross-field rules: if `throttleExitFactor >= throttleEnterFactor`, reject with error

Returns the merged config plus an `errors: string[]` array (empty if clean). The admin UI displays errors inline per field.

### 4.3 Migration Path for Existing Modules

Each module currently using hardcoded constants gets a one-line change:

```typescript
// Before (resilience.ts)
const CIRCUIT_THRESHOLD = 5;

// After
import { getConfig } from '../server/runtimeConfig.js';
// ... inside the function that uses it:
const { circuitThreshold } = getConfig().resilience;
```

**For renderer-side constants** (resilience.ts, flightRecorderInit.ts, analyticsEmitter.ts): these run in the browser, not the server. They cannot call `getConfig()` directly. Instead:
- A new endpoint `GET /api/config/client` returns the subset of config relevant to the client (`resilience`, `flightRecorder`, `analytics` sections)
- The renderer fetches this once at startup and caches it in a Zustand slice
- The admin reload endpoint sends an SSE event or the UI polls `/api/config/client` after a manual reload

### 4.4 REST Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/api/admin/config` | Admin | Full config (current values + defaults + errors) |
| `PUT` | `/api/admin/config` | Admin | Write new config (validated before save) |
| `POST` | `/api/admin/config/reload` | Admin | Force cache invalidation + re-read |
| `GET` | `/api/admin/config/diff` | Admin | Diff current config vs defaults (changed values only) |
| `GET` | `/api/config/client` | Any | Client-relevant config subset (resilience, flight recorder, analytics) |

**`GET /api/admin/config` response:**
```json
{
  "config": { /* current merged config */ },
  "defaults": { /* hardcoded defaults */ },
  "errors": [],
  "fileExists": true,
  "lastModified": "2026-06-24T12:00:00Z"
}
```

**`PUT /api/admin/config` request:**
```json
{
  "config": { /* full or partial config — deep-merged over current */ }
}
```
The server validates before writing. On validation failure: returns 400 with `{ errors: [...] }`, config file unchanged.

**`POST /api/admin/config/reload` response:**
```json
{
  "ok": true,
  "reloadedAt": "2026-06-24T12:01:00Z",
  "errors": []
}
```

## 5. Admin Web UI

### 5.1 Integration Point

New tab "Config" in `AdminReviewPanel` alongside Reviews, Feedback, and Feature Flags:

```
┌─────────────────────────────────────────────────────┐
│  ← Back    Admin Review           4 pending         │
│  ┌─────────┬──────────┬───────────────┬────────┐    │
│  │ Reviews │ Feedback │ Feature Flags │ Config │    │
│  └─────────┴──────────┴───────────────┴────────┘    │
```

### 5.2 Config Tab Layout

```
┌─────────────────────────────────────────────────────┐
│  Runtime Configuration                              │
│  Last reloaded: 2 minutes ago    [Reload Config]    │
│                                                     │
│  ┌─ Filter ──────────────────────────────────────┐  │
│  │ [All sections ▾]  [Modified only ☐]           │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ▼ Resilience                                       │
│  ┌───────────────────────────────────────────────┐  │
│  │ Circuit Threshold          [  5  ] (default 5)│  │
│  │ Circuit Cooldown           [ 60s ] (default …)│  │
│  │ Throttle Enter Factor      [ 2.0 ] (default …)│  │
│  │ Throttle Exit Factor       [ 1.5 ] (default …)│  │
│  │ …                                             │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ▼ Rate Limiting                                    │
│  ┌───────────────────────────────────────────────┐  │
│  │ Window                     [ 60s ]            │  │
│  │ Cleanup Cutoff             [120s ]            │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ▼ Tiers                                            │
│  ┌───────────────────────────────────────────────┐  │
│  │  Platform │ BYOK │ Anonymous │ Free            │  │
│  │  RPM:              [ 60 ]                     │  │
│  │  Tokens/day:       [2000000]                  │  │
│  │  Backends:         [☑gemini ☑claude ☑groq]    │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ▶ Quotas                                           │
│  ▶ Sessions                                         │
│  ▶ Analytics                                        │
│  ▶ Flight Recorder                                  │
│  ▶ Community                                        │
│  ▶ Feedback                                         │
│  ▶ Server                                           │
│  ▶ Cache                                            │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │ 3 fields modified          [Reset All] [Save] │  │
│  │ ⚠ throttleExitFactor must be < enterFactor    │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### 5.3 Field Input Types

| Config Type | Input Control | Validation |
|------------|---------------|------------|
| `integer` | Number input with stepper | min/max from schema |
| `float` | Number input, step=0.1 | min/max from schema |
| `duration-ms` | Number input + unit selector (ms/s/min) | Auto-converts to ms |
| `string` | Text input | Pattern from schema |
| `string[]` | Checkbox group (known set) or tag input | Enum from schema |

### 5.4 UX Behaviors

- **Dirty tracking:** Fields edited but not saved show a blue dot. "N fields modified" counter in footer.
- **Default indicator:** Each field shows "(default: X)" in muted text. Fields matching their default are unstyled; modified fields are highlighted.
- **"Modified only" filter:** Checkbox filters to show only fields that differ from defaults.
- **Inline validation:** Real-time validation as the user types. Cross-field errors (e.g., exit factor ≥ enter factor) appear at section level.
- **Save flow:** Save button → confirm dialog ("Apply N changes? Server will reload config.") → `PUT /api/admin/config` → auto-calls `POST /api/admin/config/reload` → success toast.
- **Reset All:** Reverts the form to defaults (does not save — user must click Save to persist).
- **Reset single field:** Right-click or secondary action on a field → "Reset to default."
- **Reload Config:** Forces the server to re-read the file (useful after PowerShell `Set-TriadConfig`). Does not change the form — re-fetches and refreshes.

### 5.5 Component Structure

```
AdminReviewPanel.tsx (existing)
  └── RuntimeConfigPanel.tsx (new — the Config tab)
        ├── ConfigSection.tsx (collapsible section, maps schema section → form fields)
        ├── ConfigField.tsx (individual field: label, input, default hint, validation)
        ├── TierEditor.tsx (special component for the 4-tier sub-tabs)
        └── useRuntimeConfigStore.ts (Zustand — fetches, dirty tracking, save)
```

## 6. PowerShell Cmdlets

### 6.1 `Get-TriadConfig`

Downloads the runtime config from the deployed app to a local file.

```powershell
Get-TriadConfig
  [-OutputPath <string>]     # Default: ./runtime-config.json
  [-BaseUrl <string>]        # Default: from $env:TAXONOMY_EDITOR_URL or stored config
  [-IncludeDefaults]         # Also write defaults to runtime-config.defaults.json
  [-Format <'json'|'table'>] # 'table' prints to console instead of file

# Examples:
Get-TriadConfig -OutputPath ./config-backup.json
Get-TriadConfig -Format table                       # quick inspection
Get-TriadConfig -IncludeDefaults                    # get defaults for diffing
```

**Implementation:** Calls `GET /api/admin/config` via `Invoke-RemoteCheck` (existing HTTP wrapper). Auth via the app's OAuth token (passed as `-Headers @{ Authorization = "Bearer $token" }`).

**Authentication:** Uses the same `GITHUB_TOKEN` env var pattern as existing cmdlets. The server's `/api/admin/config` endpoint checks admin status via the token.

### 6.2 `Set-TriadConfig`

Uploads a local config file to the deployed app.

```powershell
Set-TriadConfig
  [-InputPath <string>]      # Default: ./runtime-config.json
  [-BaseUrl <string>]
  [-Confirm]                 # Prompt before overwriting (default: $true)
  [-DiffFirst]               # Show diff against current server config before uploading
  [-Reload]                  # Auto-call Invoke-TriadConfigReload after upload

# Examples:
Set-TriadConfig -InputPath ./config-tuned.json -DiffFirst -Reload
Set-TriadConfig -Reload                             # upload + reload in one step
```

**Implementation:** Reads local JSON, validates locally (schema check), calls `PUT /api/admin/config`. If `-Reload` is specified, follows up with `POST /api/admin/config/reload`.

**Validation:** The cmdlet performs local schema validation before uploading. If the JSON is malformed or has unknown keys, it errors before hitting the network.

### 6.3 `Invoke-TriadConfigReload`

Tells the deployed app to re-read its config file from disk.

```powershell
Invoke-TriadConfigReload
  [-BaseUrl <string>]
  [-PassThru]                # Return the reload response object

# Example:
Invoke-TriadConfigReload -PassThru
# Output: @{ ok = $true; reloadedAt = '2026-06-24T12:01:00Z'; errors = @() }
```

**Implementation:** Calls `POST /api/admin/config/reload` via `Invoke-RemoteCheck`.

### 6.4 Common Parameters

All three cmdlets share:
- `-BaseUrl` — defaults to `$env:TAXONOMY_EDITOR_URL` or reads from `~/.aitriad-env`
- Authentication via `$env:GITHUB_TOKEN` (existing pattern from `Invoke-GitHubApi.ps1`)
- Error handling: all failures use `New-ActionableError` with Goal/Problem/Location/NextSteps
- Verbose output for debugging: `-Verbose` shows HTTP request/response details

### 6.5 Typical Workflow

```powershell
# 1. Pull current config
Get-TriadConfig -OutputPath ./config.json -IncludeDefaults

# 2. Edit locally (or diff with defaults)
code ./config.json

# 3. Upload and reload in one step
Set-TriadConfig -InputPath ./config.json -DiffFirst -Reload

# 4. Verify
Get-TriadConfig -Format table
```

## 7. Rollback & Recovery

### 7.1 Invalid Config

| Scenario | Behavior |
|----------|----------|
| Missing file | Defaults apply — the app behaves as it does today |
| Malformed JSON | `loadConfig()` catches parse error, logs warning, returns defaults |
| Valid JSON, invalid values | `validateAndMerge()` clamps out-of-range values and logs warnings; partially valid config is usable |
| Valid JSON, schema violation | Unknown keys ignored (logged); missing sections use defaults |
| Cross-field constraint violation | Specific section reverts to defaults; other sections unaffected |

### 7.2 Rollback Procedure

**Via admin UI:**
1. Click "Reset All" in the Config tab → Save → Reload
2. This writes the default config, effectively restoring factory settings

**Via PowerShell:**
```powershell
# Option A: Restore defaults
Get-TriadConfig -IncludeDefaults
Copy-Item ./runtime-config.defaults.json ./runtime-config.json
Set-TriadConfig -Reload

# Option B: Delete the config file (server falls back to hardcoded defaults)
# Requires Azure CLI or SSH access to the container
```

**Via container restart:**
If the config file is deleted or moved, the server starts cleanly with hardcoded defaults on next boot. No manual intervention needed.

### 7.3 Audit Trail

Every `PUT /api/admin/config` updates `_meta.updatedAt` and `_meta.updatedBy` in the config file. The flight recorder logs config reload events. For full history, the config file lives on the Azure Files data volume — Azure Files supports soft delete with a retention period.

## 8. Client Config Delivery

### 8.1 Problem

The renderer bundle runs in the browser. It cannot read `admin/runtime-config.json` from disk. Parameters in `resilience.ts`, `flightRecorderInit.ts`, and `analyticsEmitter.ts` need a delivery mechanism.

### 8.2 Solution: `GET /api/config/client`

The server exposes a public endpoint that returns the client-relevant subset:

```json
{
  "resilience": { /* full resilience section */ },
  "flightRecorder": {
    "minDumpIntervalMs": 10000,
    "maxDumpsPerWindow": 5,
    "dumpWindowMs": 60000
  },
  "analytics": {
    "bufferRequeueLimit": 500
  }
}
```

- **Caching:** Response includes `Cache-Control: max-age=60` (1 minute). The renderer fetches once at startup and re-fetches after the admin clicks "Reload Config" (which triggers a Zustand store refresh).
- **No auth required:** Client config contains no secrets. It's the same values that are hardcoded in the current shipped bundle.

### 8.3 Renderer Integration

A new `useClientConfig()` hook fetches from `/api/config/client` at mount time and exposes the values. Modules that currently use hardcoded constants switch to reading from this hook (or from a module-level cache for non-React code like `resilience.ts`).

For `resilience.ts` (plain TypeScript, not a React component): a `clientConfig` module exports a `getClientConfig()` function that returns cached values, initialized by a one-time fetch at app startup.

## 9. Implementation Plan

### Phase 1: Core Config Module + Server Endpoints
**Effort:** 3-4 days

- Create `src/server/runtimeConfig.ts` with typed config, defaults, mtime-cache reader, validation
- Create `runtime-config.schema.json`
- Add REST endpoints: `GET/PUT /api/admin/config`, `POST /api/admin/config/reload`, `GET /api/admin/config/diff`, `GET /api/config/client`
- Unit tests for validateAndMerge, forceReload, default fallback, malformed file recovery
- Integration tests for REST endpoints (auth checks, validation errors, reload)

### Phase 2: Admin UI
**Effort:** 3-4 days

- Create `RuntimeConfigPanel.tsx`, `ConfigSection.tsx`, `ConfigField.tsx`, `TierEditor.tsx`
- Create `useRuntimeConfigStore.ts` (fetch, dirty tracking, save, reload)
- Add "Config" tab to `AdminReviewPanel`
- Wire save → PUT → reload flow with confirmation dialog
- Inline validation and cross-field constraint checks
- CSS following existing admin panel patterns

### Phase 3: Migrate Server Modules
**Effort:** 2-3 days

- Migrate each server module to read from `getConfig()` instead of hardcoded constants:
  - `rateLimiter.ts` — windowMs, cleanupCutoff
  - `proxyTiers.ts` — default tier limits (preserve user-override mechanism)
  - `quotas.ts` — default limits (preserve user-override mechanism)
  - `anonymousSessionStore.ts` — TTL, max sessions, max size
  - `sessionBranchManager.ts` — token freshness, lock timeouts
  - `analytics.ts` — retention days
  - `community.ts` — pending caps
  - `feedbackStore.ts` — page limits
  - `server.ts` — conflict cache TTL, git timeouts, dump retention, key mask length
  - `providerBinding.ts` — cache TTL
- Verify each module's test suite still passes after migration

### Phase 4: Client Config Delivery + Renderer Migration
**Effort:** 2-3 days

- Create `useClientConfig()` hook + `clientConfig.ts` module-level cache
- Migrate `resilience.ts` constants → `clientConfig.getClientConfig().resilience.*`
- Migrate `flightRecorderInit.ts` constants → client config
- Migrate `analyticsEmitter.ts` constants → client config
- Startup fetch + reload-on-admin-action flow

### Phase 5: PowerShell Cmdlets
**Effort:** 2 days

- Create `Public/Get-TriadConfig.ps1`, `Public/Set-TriadConfig.ps1`, `Public/Invoke-TriadConfigReload.ps1`
- Local JSON schema validation in `Set-TriadConfig`
- `-DiffFirst` diff display
- Update module manifest (AITriad.psd1) with new exported cmdlets
- Pester tests for each cmdlet (mocked HTTP calls)

### Phase 6: Verify Gate + Documentation
**Effort:** 1 day

- Run full verify gate (`npm run verify` + `Invoke-Pester`)
- Update `CLAUDE.md` with config file documentation
- Add `admin/runtime-config.json` to the data volume initialization script
- Update error handling docs with config validation error patterns

### Total Effort Estimate: ~13-17 days across phases

### Suggested Ticket Breakdown

| Ticket | Phase | Title | Assignee |
|--------|-------|-------|----------|
| t/905-1 | 1 | Core runtimeConfig.ts module + validation + schema | ServerAPI |
| t/905-2 | 1 | Config REST endpoints (GET/PUT/reload/diff/client) | ServerAPI |
| t/905-3 | 2 | RuntimeConfigPanel admin UI (form, sections, tiers) | UI |
| t/905-4 | 2 | useRuntimeConfigStore + save/reload/dirty tracking | UI |
| t/905-5 | 3 | Migrate server modules to getConfig() | ServerAPI |
| t/905-6 | 4 | Client config delivery + renderer migration | UI |
| t/905-7 | 5 | PowerShell cmdlets (Get/Set/Invoke-TriadConfig) | PowerShell |
| t/905-8 | 6 | Verify gate + docs update | TL (review) |

Each ticket blocks the next phase. Phases 3 and 4 can run in parallel after Phase 1+2 complete.
