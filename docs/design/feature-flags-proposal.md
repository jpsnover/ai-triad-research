# Feature Flags Proposal — AI Triad Research

**Author:** Technical Lead  
**Date:** 2026-06-23  
**Status:** Implemented (t/898 — all 6 sub-tickets completed 2026-06-24)

---

## Problem Statement

The codebase has accumulated several ad-hoc feature gating mechanisms that each solve a narrow problem but don't compose into a coherent system:

| Current Pattern | Location | Mechanism | Limitation |
|---|---|---|---|
| Proxy tier gating | `proxyTiers.ts` | Tier object with limits, backends, model pins | AI-specific only; can't gate arbitrary features |
| Admin feature gates | `community.ts`, components | `isAdmin(userId)` check | Binary (admin/not); no gradual rollout |
| Build-time flags | `vite.config.ts` | `VITE_TARGET=web\|electron` | Requires rebuild to change; two values only |
| Electron mode detection | `isElectronMode()` | `!!window.electronAPI` | Scattered across 15+ components; not configurable |
| Env var toggles | `config.ts`, `accessControl.ts` | `STORAGE_MODE`, `AUTH_DISABLED` | Requires container restart; no targeting; no audit trail |
| Model catalog | `ai-models.json` | JSON config with capabilities | Domain-specific; not a general feature gate |

**What's missing:**
- No way to roll out a feature to 10% of users, watch metrics, then ramp to 100%
- No way to enable a beta feature for specific users without a redeploy
- No operational kill switches (disable a feature under load without restarting)
- No audit trail of flag changes
- No lifecycle management (flags accumulate, never cleaned up)
- No consistent API — each pattern requires different code to check

---

## Requirements

### Must Have
1. **Runtime toggles** — change flag state without redeployment or restart
2. **User targeting** — enable features for specific users or user segments (admin, beta testers, tier)
3. **Typed evaluation API** — `getFlag('flag-name', defaultValue)` with TypeScript types
4. **Works in both Electron and web** — same evaluation API, different storage backends
5. **Zero additional infrastructure** — no database, no separate service (we run a single ACA container scaling 0–1)
6. **Audit trail** — who changed what flag when
7. **Lifecycle metadata** — flag type, owner, expiration date at creation

### Nice to Have
8. **Gradual rollout** — percentage-based rollout with deterministic bucketing
9. **OpenFeature compatibility** — standard API so we could swap backends later
10. **Flag management UI** — admin panel to view/toggle flags (could extend existing admin panel)
11. **Stale flag alerts** — warn when flags exceed their expiration date

### Explicitly Not Needed
- A/B testing with statistical engines (this is a research tool, not a consumer product)
- Multi-environment sync (we have one production environment)
- Team-based RBAC for flag management (single admin)
- High-throughput evaluation (our peak is ~10 concurrent users)

---

## Options Evaluated

### Option A: Heavyweight Self-Hosted (Unleash / GrowthBook / Flagsmith)

**What:** Run a full feature flag server alongside our app.

| System | License | Requires | Standout Feature |
|---|---|---|---|
| Unleash | Apache 2.0 | PostgreSQL | Governance, 40-day staleness alerts |
| GrowthBook | MIT | MongoDB | A/B testing, warehouse-native experiments |
| Flagsmith | BSD 3-Clause | PostgreSQL | Remote config (key-value, not just booleans) |

**Pros:** Full management UI, gradual rollouts, user targeting, OpenFeature providers, mature ecosystems.

**Cons:** Each requires a separate database and service. Our ACA container runs a single Node.js process scaling 0–1. Adding PostgreSQL/MongoDB means either a managed database ($30–50/month) or a sidecar (doubles container memory). Operational overhead is disproportionate to our scale (~10 users, ~20 flags).

**Verdict:** Overkill for our scale. The infrastructure cost and operational burden outweigh the benefits when we have a single admin managing a small flag set.

### Option B: Lightweight Daemon (GO Feature Flag / flagd)

**What:** Run a small Go binary (sidecar or embedded) that evaluates flags from YAML/JSON config files.

| System | License | Architecture | OpenFeature |
|---|---|---|---|
| GO Feature Flag | MIT | Single Go binary, YAML config, no DB | Native OFREP |
| flagd | Apache 2.0 | CNCF reference daemon, JSON config | Native |

**Pros:** No database. Config files in Git (GitOps). OpenFeature native. Gradual rollouts and targeting built in.

**Cons:** Still a separate process — needs a sidecar in our container or a second ACA service. Adds ~50MB memory and a process to monitor. flagd has no management UI. Adds Go binary to a pure Node.js/TypeScript stack (build pipeline complexity).

**Verdict:** Good architecture for Kubernetes-native apps with sidecars. Awkward fit for our single-container ACA deployment. The operational simplicity we'd gain from YAML config is offset by the deployment complexity of running a second process.

### Option C: Pure GitOps (Featurevisor)

**What:** Define flags as YAML files. CI compiles them to static JSON datafiles. SDKs evaluate in-memory from the compiled JSON (served from CDN or bundled).

| Attribute | Detail |
|---|---|
| License | MIT |
| Infrastructure | None — CI pipeline + static JSON file |
| Runtime overhead | Zero — in-memory evaluation from precompiled JSON |
| TypeScript/React | Native |
| Targeting | Yes — segments, gradual rollouts |

**Pros:** Truly zero infrastructure. Flags are code — versioned, reviewed, auditable via Git history. TypeScript-native. Deterministic bucketing for gradual rollouts.

**Cons:** No runtime toggle — changing a flag requires a Git commit + CI build + deploy. Latency from change to effect is minutes, not seconds. No management UI (flags are YAML files). Smaller community (~780 stars).

**Verdict:** Elegant for teams committed to GitOps. The deployment latency is acceptable for release flags and permission flags but problematic for operational kill switches (you can't disable a failing feature in 30 seconds).

### Option D: Custom Lightweight Module (Recommended)

**What:** Build a thin `FeatureFlags` module that:
1. Reads flag definitions from a `feature-flags.json` config file (shipped with the app)
2. Supports runtime overrides via an admin REST API (persisted to the data store)
3. Evaluates flags in-process with zero latency
4. Exposes the OpenFeature evaluation API shape so we could adopt a real provider later

**Architecture:**

```
┌─────────────────────────────────────────────────┐
│  feature-flags.json (defaults, shipped with app) │
│  {                                               │
│    "new-debate-ui": {                            │
│      "type": "release",                          │
│      "default": false,                           │
│      "targeting": {                              │
│        "users": ["jpsnover"],                    │
│        "tiers": ["platform"]                     │
│      },                                          │
│      "rollout": 0,                               │
│      "owner": "tech-lead",                       │
│      "expires": "2026-09-01"                     │
│    }                                             │
│  }                                               │
└──────────────────────┬──────────────────────────┘
                       │ defaults
                       ▼
┌─────────────────────────────────────────────────┐
│         FeatureFlagService (in-process)          │
│                                                  │
│  evaluate(flag, context) → boolean | string      │
│  1. Check runtime overrides (admin-set)          │
│  2. Check user targeting (userId, tier)          │
│  3. Check rollout percentage (deterministic hash)│
│  4. Return default                               │
└──────────────────────┬──────────────────────────┘
                       │ runtime overrides
                       ▼
┌─────────────────────────────────────────────────┐
│  Runtime override store                          │
│  - Web: admin/feature-overrides.json (persisted) │
│  - Electron: local settings file                 │
│  - Audit log: timestamped change records         │
└─────────────────────────────────────────────────┘
```

**Evaluation precedence:**
1. Runtime override (admin toggled via API) — highest priority
2. User targeting rule (specific user or tier match)
3. Percentage rollout (deterministic hash of userId + flagName)
4. Default value from config

**API surface:**

```typescript
// Server-side
import { flags } from './featureFlags';

if (flags.isEnabled('new-debate-ui', { userId, tier })) {
  // new code path
}

const variant = flags.getString('debate-model-tier', { userId, tier });
// Returns 'basic' | 'advanced' based on targeting rules

// Admin API
POST /api/admin/flags/:name/override   { enabled: true }
DELETE /api/admin/flags/:name/override
GET /api/admin/flags                    // list all flags + current state
GET /api/admin/flags/stale              // flags past expiration date

// Client-side (via bridge)
const { isEnabled } = useFeatureFlags();
if (isEnabled('new-debate-ui')) { ... }
```

**Pros:**
- Zero additional infrastructure — runs in the existing Node.js process
- Sub-millisecond evaluation (in-memory, no network calls)
- Runtime overrides without redeployment (admin API persists to data store)
- Git-versioned defaults (flag definitions ship with the code)
- Typed API with TypeScript
- Audit trail built in (override changes logged with timestamp + admin)
- Lifecycle management (expiration dates, staleness queries)
- Follows the OpenFeature evaluation shape — could swap to a real provider later
- Works in both Electron (local file) and web (REST API) via existing bridge pattern
- Consolidates existing ad-hoc patterns under one API

**Cons:**
- Custom code to build and maintain (~300–400 lines)
- No management UI beyond what we build in the admin panel
- No community ecosystem (SDKs, integrations)
- Rollout percentage is basic (deterministic hash, not the sophisticated bucketing of Unleash/GrowthBook)

**Verdict:** Best fit for our constraints. We get the 80% of feature flag value (runtime toggles, user targeting, lifecycle management, audit trail) with 0% infrastructure overhead. The ~400 lines of custom code is less maintenance burden than operating a PostgreSQL instance for Unleash.

---

## Recommendation: Option D — Custom Lightweight Module

### Why Not Just Use Env Vars?

Environment variables require a container restart (and on ACA, a new revision deployment) to change. When a feature is causing errors in production, you need a kill switch that works in seconds, not minutes. Runtime overrides via an admin API solve this.

### Why Not OpenFeature + flagd?

flagd is the "correct" cloud-native answer, but it assumes Kubernetes with sidecars. Our single-container ACA deployment doesn't have a natural place for a Go sidecar without adding deployment complexity. If we move to a multi-service architecture later, we can swap the custom module's evaluation logic for an OpenFeature provider backed by flagd — the API shape is designed to make this migration straightforward.

### Migration Path

The custom module is designed as a stepping stone, not a dead end:

1. **Now:** Custom module with JSON config + admin API
2. **If we outgrow it:** Swap the evaluation backend for an OpenFeature provider (Unleash, Flagsmith, GOFF) — application code stays the same because we follow the OpenFeature evaluation shape
3. **What triggers the upgrade:** >50 flags, >3 team members managing flags, need for A/B testing, or multi-service architecture

### Consolidating Existing Patterns

The feature flag module doesn't replace domain-specific config (`ai-models.json`, `proxy-tiers.json`). Those remain as they are — they're data catalogs, not feature gates. What it replaces:

| Current Pattern | Migration |
|---|---|
| `isAdmin()` UI gates | `flags.isEnabled('admin-panel', { userId })` — targeting rule: `users: [adminList]` |
| Scattered `isElectronMode()` | `flags.isEnabled('electron-only-feature')` — default by build target |
| `AUTH_DISABLED` env var | `flags.isEnabled('auth-bypass')` — ops flag, dev-only |
| Hardcoded route allowlists | `flags.isEnabled('anon-access-route-X')` — permission flags |
| Future beta features | `flags.isEnabled('beta-feature', { userId, tier })` — release flag with targeting |

### Flag Naming Convention

```
{type}-{feature}-{detail}
```

- `release-debate-streaming` — temporary, removed after full rollout
- `ops-ai-generate-killswitch` — permanent operational toggle
- `permission-community-submit` — tier/user gating
- `exp-debate-model-selection` — experiment variant (if we ever need it)

### Flag Definition Schema

```typescript
interface FlagDefinition {
  type: 'release' | 'ops' | 'permission' | 'experiment';
  description: string;
  default: boolean | string | number;
  owner: string;                    // who owns cleanup
  expires?: string;                 // ISO date — required for release/experiment
  targeting?: {
    users?: string[];               // specific userIds
    tiers?: string[];               // platform, byok, free, anonymous
    percentRollout?: number;        // 0-100, deterministic hash
  };
}
```

### User Experience

#### For Regular Users

**No visible change.** Flags are invisible to non-admin users. Features either appear or they don't. There is no "Labs" or "Experimental" settings panel — the admin controls what's enabled for whom.

#### For Admins: Feature Flags Tab

Access: `/#admin` → new "Feature Flags" tab in the `AdminReviewPanel` header alongside existing Submissions / Feedback / Review tabs.

```
┌───────────────────────────────────────────────────────────────┐
│ ← Back   Admin   [Submissions] [Feedback] [Feature Flags]    │
│                                                [+ New Flag]   │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─ release-debate-streaming ─────────────────── [ON] ────┐  │
│  │  Stream debate responses token-by-token                 │  │
│  │  Scope: ● Global         Owner: ServerAPI               │  │
│  │  Created: Jun 23         Expires: Sep 1                 │  │
│  └──────────────────────────────────── [Edit] [Delete] ────┘  │
│                                                               │
│  ┌─ ops-verbose-flight-recorder ──────────────── [OFF] ───┐  │
│  │  Emit full debug payloads in flight recorder events     │  │
│  │  Scope: ● Admin only     Owner: Diagnostics             │  │
│  │  Created: Jun 20                                        │  │
│  └──────────────────────────────────── [Edit] [Delete] ────┘  │
│                                                               │
│  ┌─ exp-embeddings-v2 ────────────────────────── [OFF] ───┐  │
│  │  Use v2 embedding model for similarity search           │  │
│  │  Scope: ● jpsnover       Owner: ElectronMain            │  │
│  │  Created: Jun 23         Expires: Jul 15                │  │
│  │  ⚠ Expires in 22 days                                   │  │
│  └──────────────────────────────────── [Edit] [Delete] ────┘  │
│                                                               │
│  ── Stale Flags (> 90 days) ────────────────────────────────  │
│  ⚠ No stale flags found.                                     │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

**Card elements:**
- **Toggle switch** — instant on/off, optimistic UI with rollback on error. Calls `PUT /api/admin/flags/:name/override`.
- **Scope badge** — colored dot + label: green = Global, blue = Admin only, purple = Specific users, orange = Environment-specific.
- **Expiry warning** — yellow highlight + countdown when flag expires within 30 days.
- **Stale section** — bottom area lists flags older than 90 days with no `expires` date, nudging cleanup.

#### Create / Edit Dialog

Triggered by "+ New Flag" button or "Edit" on an existing flag card.

```
┌─ New Feature Flag ──────────────────────────────┐
│                                                  │
│  Name:  [release-debate-streaming          ]     │
│         kebab-case, prefix with type             │
│                                                  │
│  Type:  (•) Release  ( ) Ops  ( ) Permission     │
│         ( ) Experiment                           │
│                                                  │
│  Description:                                    │
│  [Stream debate responses token-by-token    ]    │
│                                                  │
│  Enabled:  (•) On   ( ) Off                      │
│                                                  │
│  Scope:    [Global              ▾]               │
│            ┌────────────────────┐                │
│            │ Global             │                │
│            │ Admin only         │                │
│            │ Specific users     │                │
│            │ Specific tier      │                │
│            │ Web only           │                │
│            │ Electron only      │                │
│            └────────────────────┘                │
│                                                  │
│  Users:    [jpsnover, alice            ]         │
│            (visible when Scope = Specific users) │
│                                                  │
│  Tier:     [platform           ▾]               │
│            (visible when Scope = Specific tier)  │
│                                                  │
│  Rollout:  [  100  ] %                           │
│            Deterministic — same user always gets │
│            the same result. 0 = off, 100 = on.   │
│                                                  │
│  Expires:  [2026-09-01         ] [Clear]         │
│            Required for Release and Experiment   │
│            types. Ops flags may omit.            │
│                                                  │
│  Owner:    [ServerAPI           ▾]               │
│            Team responsible for cleanup          │
│                                                  │
│              [Cancel]          [Save]            │
└──────────────────────────────────────────────────┘
```

**Validation rules:**
- Name must be kebab-case, 3–50 characters, unique
- Release and Experiment flags require an `expires` date
- Scope "Specific users" requires at least one user ID
- Percentage rollout must be 0–100

#### Setting and Clearing Flags

Three distinct operations:

| Action | What happens | When to use |
|---|---|---|
| **Toggle on/off** | Flips the flag's `enabled` state. The flag definition remains. | Temporarily disable a misbehaving feature, or re-enable after a fix. |
| **Edit scope** | Changes who sees the flag. E.g., widen from "Admin only" to "Global" for a phased rollout. | Gradually expand a feature's audience. |
| **Delete** | Removes the flag definition from `feature-flags.json`. Confirmation dialog: "Delete flag 'X'? Code that checks this flag will see it as disabled (fail-closed)." | When a feature is fully shipped (remove flag + remove code check) or abandoned. |

**Phased rollout workflow** (using scope changes):
1. Create flag with `Scope: Specific users → [jpsnover]` — dogfood on admin account
2. Edit scope → `Admin only` — expand to all admins
3. Edit scope → `Global` — ship to everyone
4. Once stable: delete flag, remove `useFlag()` check from code

**Kill switch workflow** (using toggle):
1. Feature is live with flag enabled, scope Global
2. Problem detected → toggle OFF in admin panel (instant, no redeploy)
3. Fix deployed → toggle ON to restore
4. Remove flag when the root cause is permanently resolved

#### Audit Trail

Every flag change is logged. Visible at the bottom of the Feature Flags tab as an expandable "Recent Changes" section:

```
▸ Recent Changes (last 7 days)
  Jun 23 14:30  jpsnover  toggled release-debate-streaming ON
  Jun 23 12:00  jpsnover  created release-debate-streaming (scope: Global)
  Jun 22 09:15  jpsnover  deleted exp-old-search
```

Persisted to `admin/feature-flags-audit.ndjson` — same NDJSON append pattern as analytics.

#### Electron vs Web

| Aspect | Web (Azure Container Apps) | Electron (Desktop) |
|---|---|---|
| Flag storage | `admin/feature-flags.json` on Azure Files mount | Local `feature-flags.json` in data directory |
| Admin UI | `/#admin` → Feature Flags tab | Settings panel (admin section not exposed in Electron — single-user, you ARE the admin) |
| Flag evaluation | Server-side in middleware, sent to client via `/api/flags` | Client-side from local file |
| Runtime override | Admin REST API | Direct file edit or future Settings UI toggle |

In Electron, all flags default to their `default` value. User targeting and percentage rollout don't apply (single user). The admin panel is web-only. Electron users who want to toggle experimental features can edit `feature-flags.json` directly or use a future "Experimental Features" section in the Settings dialog.

### Migration: Existing Ad-Hoc Patterns

The first concrete migration is `qbafEnabled`:

| Step | Change |
|---|---|
| 1. Add flag | `"release-qbaf-analysis": { "default": true, "type": "release", ... }` in `feature-flags.json` |
| 2. Replace reads | All 12 `useTaxonomyStore(s => s.qbafEnabled)` call sites → `useFlag('release-qbaf-analysis')` |
| 3. Remove old code | Delete `qbafEnabled` / `setQbafEnabled` from `settingsSlice.ts`, remove `localStorage` key |
| 4. Affected files | `ConflictDetail.tsx`, `QbafOverlay.tsx` (×4), `StatementCard.tsx`, `HarvestDialog.tsx`, `EntryView.tsx`, `OverviewView.tsx`, `WhatIfSection.tsx`, `settingsSlice.ts` |

This serves as the template for migrating any future ad-hoc boolean that is really a feature gate.

### Implementation Scope

| Component | File | Effort |
|---|---|---|
| Flag evaluation engine | `src/server/featureFlags.ts` | ~200 lines |
| Override persistence | `src/server/featureFlagStore.ts` | ~100 lines |
| Admin REST endpoints | `src/server/server.ts` (4 routes) | ~80 lines |
| Client-side hook | `src/renderer/hooks/useFeatureFlags.ts` | ~50 lines |
| Bridge additions | `types.ts`, `web-bridge.ts`, `electron-bridge.ts` | ~40 lines |
| Admin panel UI | `src/renderer/components/settings/FeatureFlagsPanel.tsx` | ~150 lines |
| Flag config file | `feature-flags.json` | ~30 lines (initial flags) |
| **Total** | | **~650 lines** |

---

## Appendix: Open-Source Landscape Summary

For reference, here's the full comparison of systems evaluated:

| System | License | Requires | Stars | OpenFeature | Best For |
|---|---|---|---|---|---|
| Unleash | Apache 2.0 | PostgreSQL | ~13,300 | Provider | Enterprise governance |
| GrowthBook | MIT | MongoDB | ~7,800 | Provider | A/B testing |
| Flagsmith | BSD 3-Clause | PostgreSQL | ~6,300 | Provider | Flags + remote config |
| PostHog | MIT | ClickHouse+PG+Redis | ~35,100 | Provider | Full analytics platform |
| Flipt v2 | Fair Core (FCL) | None (Git) | ~4,800 | Provider | Git-native flags |
| GO Feature Flag | MIT | None (YAML files) | Active | Native OFREP | Lightweight + OpenFeature |
| flagd | Apache 2.0 | None (files) | Active | Native | K8s sidecar |
| Featurevisor | MIT | None (CI + CDN) | ~780 | No | Pure GitOps |
| FeatBit | MIT | Optional PG | Modest | No | Full-featured, no per-seat cost |

### Key Industry Trends (Mid-2026)
- **OpenFeature** (CNCF Incubating) is the emerging standard — Node.js SDK at v1.20.2, 30+ providers
- **DevCycle acquired by Dynatrace** (Jan 2026) — no longer independent open-source
- **Flipt v2 relicensed** to Fair Core License (not OSI-approved) — verify legal acceptability before adopting
- **Flag lifecycle management** is the #1 operational risk across all systems — stale flags accumulate regardless of tooling sophistication
