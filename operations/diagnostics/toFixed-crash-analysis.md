# Diagnostics Window `toFixed` Crash — Architecture & Root Cause Analysis

## Problem Statement

When viewing a debate in the Diagnostics Window and navigating from early transcript entries to later rounds, the app crashes with:

```
Cannot read properties of undefined (reading 'toFixed')
```

Early rounds and Moderator entries work fine. Later rounds crash consistently. The crash occurs in `TurnValidationSection` at `DiagnosticsWindow.tsx:386` (source-mapped line 175).

## Architecture: How Diagnostics Data Flows

### Three-Window Architecture

```
┌─────────────────┐     IPC: debate state      ┌─────────────────────┐
│   Main Window    │ ──────────────────────────> │  Diagnostics Window │
│   (DebateTab)    │                             │  (DiagnosticsWindow)│
│                  │     IPC: flight events      │                     │
│  useTaxonomy     │ <────────────────────────── │  Popup shim         │
│  useDebateStore  │                             │  (capacity=1)       │
└────────┬─────────┘                             └─────────────────────┘
         │
         │  IPC: debate state
         ▼
┌─────────────────┐
│  Debate Popup   │
│  (DebateWork-   │
│   space)        │
│  useDebateStore │
│  (independent)  │
└─────────────────┘
```

### Per-Turn Data Model

Each transcript entry can carry a `diagnostics` object:

```typescript
interface TranscriptEntry {
  id: string;
  speaker: SpeakerId;
  type: string;
  content: string;
  diagnostics?: EntryDiagnostics;
}

interface EntryDiagnostics {
  turn_validation_trail?: TurnValidationTrail;
  convergence_signals?: ConvergenceSignals;
  process_reward?: ProcessRewardEntry;
  // ... other per-turn diagnostics
}

interface TurnValidationTrail {
  final: TurnValidation;        // ← crash site: final.score.toFixed(2)
  attempts: TurnAttempt[];
}

interface TurnValidation {
  outcome: string;
  score: number;                // ← CAN BE undefined at runtime
  dimensions: {
    schema: { pass: boolean; issues: string[] };
    grounding: { pass: boolean; issues: string[] };
    advancement: { pass: boolean; signals: string[] };
    clarifies: { pass: boolean; signals: string[] };
  };
  repairHints: string[];
  judge_used?: boolean;
  judge_model?: string;
}
```

### Data Lifecycle During a Debate

1. **Debate engine** (useDebateStore) runs turns sequentially
2. After each AI response, the **turn validator** (turnValidator.ts) scores the response
3. Validator produces `TurnValidationTrail` with `final.score`, `dimensions`, etc.
4. Trail is attached to the transcript entry's `diagnostics` object
5. Transcript is saved to disk periodically via `saveDebateSession`
6. **Diagnostics Window** receives the full debate state via IPC and renders per-entry data

### Where the Crash Happens

```
DiagnosticsWindow
  └─ Transcript tab (user selects an entry)
       └─ Section "Turn Validation"
            └─ TurnValidationSection({ trail })
                 ├─ f.score.toFixed(2)           ← LINE 175: CRASH
                 ├─ f.dimensions.schema.pass     ← LINE 184: potential crash
                 ├─ f.dimensions.grounding.pass  ← LINE 185: potential crash
                 ├─ f.dimensions.advancement.pass← LINE 186: potential crash
                 └─ f.dimensions.clarifies.pass  ← LINE 187: potential crash
```

## Root Cause Hypothesis

### Primary: HMR-Induced Schema Drift

The user was making code changes while the debate was running. This triggers Vite's Hot Module Replacement (HMR), which reloads renderer modules mid-session. The likely failure sequence:

1. **Debate starts** — turn validator v1 produces `TurnValidation` objects with all fields populated
2. **Early turns complete** — diagnostics data is well-formed (score, dimensions all present)
3. **User edits code** — HMR reloads `turnValidator.ts` or related modules
4. **Turn validator v2** may have different schema expectations:
   - New fields added that older turns don't have
   - Field computation logic changed, producing `undefined` where a number was expected
   - Validator might partially fail and produce an incomplete trail
5. **Later turns** are validated by v2 — their trails have `score: undefined` or missing `dimensions`
6. **User views diagnostics** — early entries render fine (v1 data), later entries crash (v2 data)

### Supporting Evidence

| Evidence | Implication |
|----------|-------------|
| Early rounds work, later rounds crash | Data schema changed mid-session |
| 4 identical crash events in flight recorder (seq 281, 407, 533, 678) | User tried multiple later entries, all crash |
| Gemini API timeout at seq 668 (105s) | AI backend instability during session — validator may have received partial/empty responses |
| `diagnostics` field absent from on-disk debate file | Validation trails are in-memory only (never persisted for this debate) |
| Build fingerprint `1778431655343` | App was rebuilt mid-session (HMR) |

### Secondary: AI Backend Failure

The flight recorder shows a 105-second Gemini API timeout (seq 668). If the turn validator calls the AI for judge-based validation and the API fails, the validator may return an incomplete `TurnValidation` with `score: undefined`:

```typescript
// Hypothetical failure path:
const judgeResult = await generateText(...); // throws on timeout
// catch handler returns partial result:
return { outcome: 'error', score: undefined, dimensions: {} };
```

## Crash Sites to Fix (t/404 / t/409)

### In `TurnValidationSection` (DiagnosticsWindow.tsx:169-201)

```typescript
// Line 175 — CRASH: score can be undefined
f.score.toFixed(2)
// Fix:
(f.score ?? 0).toFixed(2)

// Lines 184-187 — potential crash: dimensions can be incomplete
f.dimensions.schema.pass
f.dimensions.grounding.pass
f.dimensions.advancement.pass
f.dimensions.clarifies.pass
// Fix: guard each dimension
f.dimensions?.schema?.pass
f.dimensions?.grounding?.pass
f.dimensions?.advancement?.pass
f.dimensions?.clarifies?.pass
```

### In the Section title (DiagnosticsWindow.tsx:3447)

```typescript
// Already fixed with ?? 0:
(turnValTrail.final.score ?? 0).toFixed(2)
```

### Broader Pattern (40+ unguarded `.toFixed()` calls)

See t/404 for the full audit. The same null-guard pattern is needed across:
- `QbafOverlay.tsx` — `computed.toFixed()`, `delta.toFixed()`, `edge.weight.toFixed()`
- `ConflictDetail.tsx` — `resolution.prevailing_strength.toFixed()`
- `DiagnosticsPanel.tsx` — `base.toFixed()`, `computed.toFixed()`
- `DiagnosticsChatSidebar.tsx` — convergence signal ratios
- `ParameterHistoryPanel.tsx` — parameter values

## Recommended Fix Strategy

### 1. Immediate: Guard `TurnValidationSection` (5 minutes)

Add null guards to lines 175, 184-187. This is the specific crash the user is hitting.

### 2. Short-term: Complete t/404 audit (1-2 hours)

Find-and-replace all unguarded `.toFixed()` calls and unguarded property access on debate data objects. The pattern is always the same:

```typescript
// Before (crashes on undefined):
value.toFixed(2)
obj.property.subfield

// After (safe):
(value ?? 0).toFixed(2)
obj?.property?.subfield ?? defaultValue
```

### 3. Medium-term: Defensive validation layer

Add a `sanitizeDiagnostics()` function that normalizes diagnostic data before rendering:

```typescript
function sanitizeTurnValidation(trail: TurnValidationTrail): TurnValidationTrail {
  return {
    final: {
      ...trail.final,
      score: trail.final.score ?? 0,
      dimensions: {
        schema: trail.final.dimensions?.schema ?? { pass: true, issues: [] },
        grounding: trail.final.dimensions?.grounding ?? { pass: true, issues: [] },
        advancement: trail.final.dimensions?.advancement ?? { pass: true, signals: [] },
        clarifies: trail.final.dimensions?.clarifies ?? { pass: true, signals: [] },
      },
      repairHints: trail.final.repairHints ?? [],
    },
    attempts: trail.attempts ?? [],
  };
}
```

### 4. Long-term: Persist diagnostics to disk

Currently, `turn_validation_trail` and other per-turn diagnostics are in-memory only — they're lost on restart or when the debate is reloaded. Persisting them to the debate JSON file would:
- Survive HMR reloads
- Allow post-hoc analysis of completed debates
- Eliminate the "early rounds work, later rounds don't" pattern caused by schema drift

## Flight Recorder Analysis

```
Session: flight-recorder-2026-05-10T16-51-34.260Z.jsonl
Events:  679 total (98 main, 237 debate popup, 344 diagnostics)
Errors:  5 (4x toFixed crash in diagnostics, 1x Gemini API timeout in debate)

Timeline:
  seq 0-97    App startup, taxonomy load, debate session load
  seq 98-280  Debate running, diagnostics loading taxonomy
  seq 281     *** CRASH: TurnValidationSection toFixed (user selected later round)
  seq 282-406 User tries again (Try Again), diagnostics reloads
  seq 407     *** CRASH: same (user selected another later round)
  seq 408-532 Try Again
  seq 533     *** CRASH: same
  seq 534-667 Try Again, debate continues
  seq 668     Gemini API timeout (105s) during debate turn
  seq 678     *** CRASH: same toFixed after debate resumed
```

## Related Tickets

| Ticket | Description | Priority |
|--------|-------------|----------|
| t/404 | `.toFixed()` null-guard audit | Medium |
| t/409 | Convergence signal `.ratio` null guards | High |
| t/403 | Error boundary dump cooldown bypass | High |
| t/452 | Debate phase stuck at "opening" | High |
| t/453 | UI condition for action bar visibility | Medium |
