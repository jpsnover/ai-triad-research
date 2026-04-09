# Debate Observability — Production Diagnosis Proposal

**Date:** 2026-04-09
**Purpose:** Enable remote diagnosis of debate-flow bugs in the cloud-hosted Taxonomy Editor without requiring reproduction, user-side diagnostics mode, or shipping a new build.
**Audience:** Developer / SRE, not end-user. Complements (does not replace) the per-entry `DiagnosticsPanel` work described in `debate-diagnostics-proposal.md`.

---

## Motivating Incident

A debate run against the cloud web app produced a large number of cross-respond turns, but partway through the session the argument network stopped accumulating new I-nodes. Transcript entries continued to be added; claim extraction silently stopped. No evidence of the failure was surfaced — not in the UI, not in Log Analytics, and not in the persisted debate JSON.

The root cause is diagnosable in principle — the code is open, the debate session is saved, the container runs on Azure — but in practice there is no instrumentation that would let a developer answer the question *"at which turn did extraction stop, and what was the error?"* without re-running the scenario.

This proposal closes that gap.

---

## The Three Gaps

### Gap 1: Renderer logs never reach the cloud

All debate-flow logging lives in `taxonomy-editor/src/renderer/hooks/useDebateStore.ts` as `console.warn` / `console.log` calls:

- `[AN] Rejected claim — low overlap …` (line 245)
- `[AN] Skipped reference to nonexistent …` (line 274)
- `[AN] Extracted N claims, M edges from …` (line 320)
- `[AN] Claim extraction failed (non-blocking):` (line 426)
- plus roughly 15 more across `[debate]`, `[Steelman]`, `[Verify]`, `[taxonomy]`, `[factCheck]`, etc.

These messages go to the **renderer process console** — which, for the containerized web build, is the end-user's browser devtools. They are never written to container stdout, so the `appLogsConfiguration: 'log-analytics'` wiring in `deploy/azure/main.bicep:73` never sees them. Log Analytics today contains only the tiny stream of `[server]` messages printed by the main process (`src/server/server.ts`) — nothing about what debates actually did.

**Implication:** Every existing debate-flow log is a silent failure in production, and always has been.

### Gap 2: Claim extraction is fire-and-forget

`extractClaimsAndUpdateAN` (line 191) is called without `await` from three sites in the debate flow:

- `useDebateStore.ts:1510` — opening statement path
- `useDebateStore.ts:1694` — response path
- `useDebateStore.ts:1894` — cross-respond path

The function's own comment at line 189 states: *"Runs in the background after each turn — does not block the debate flow."* If the AI call inside returns unparseable JSON, hits a rate limit, or throws for any reason, control falls through to line 426 (`console.warn('[AN] Claim extraction failed (non-blocking):', err)`) and the debate continues. The transcript grows; the argument network does not.

This is the single most likely mechanism for the incident. It is also, by design, invisible.

### Gap 3: No correlation between transcript growth and AN growth

The debate session JSON records the transcript and a snapshot of `argument_network.nodes` / `argument_network.edges`. There is no per-turn record of whether extraction was even attempted for that turn, how long it took, how many claims the AI returned, how many were accepted vs. rejected, or why rejections happened. After the fact, a reviewer cannot distinguish *"the AI legitimately made no new claims in turn 14"* from *"extraction crashed for turn 14 and we lost the data."*

---

## Proposed Solution: Three Layers of Observability

The strategy is three concentric layers. Each is independently useful; later layers depend on earlier ones.

### Layer A — Trace channel (the foundation)

A small client→server telemetry channel that takes the existing `console.warn` calls and routes them to container stdout, where Log Analytics already ingests them.

- **Client side.** A `trace(eventName, data)` helper in `src/renderer/lib/trace.ts` buffers events in memory and flushes them via `fetch('/debug/events', …)` on a short timer (2s) or when the buffer crosses a threshold (20 events). On page unload, it flushes via `navigator.sendBeacon`. In Electron mode (when `window.electronAPI` is present), it falls back to a structured `console.log` — parity with today's behavior but with machine-readable output.
- **Server side.** A new `POST /debug/events` route in `src/server/server.ts` accepts a batched envelope and emits each event as a single-line JSON to `process.stdout` with a `[trace]` prefix. No new Azure resources, no SDKs. The existing `appLogsConfiguration` wiring delivers these lines to Log Analytics automatically.
- **Cost.** One small file on the client, ~40 lines on the server. No new dependencies.

### Layer B — Structured events with correlation IDs

Every trace event carries a common envelope:

```ts
interface TraceEvent {
  ts: string;           // ISO 8601
  event: string;        // dotted event name, e.g. 'an.extract.failed'
  debate_id?: string;
  turn_id?: string;     // transcript entry ID
  call_id?: string;     // per-AI-call UUID
  speaker?: string;
  data?: Record<string, unknown>;
}
```

Canonical event names for the first wave, focused on the claim-extraction path (the suspected bug site):

| Event | Emitted at | Key fields |
|---|---|---|
| `an.extract.start` | Top of `extractClaimsAndUpdateAN` | `prior_claim_count`, `has_debater_claims` |
| `an.extract.complete` | End of the try block | `accepted`, `rejected`, `edges_added`, `duration_ms` |
| `an.extract.failed` | Catch block | `error`, `duration_ms` |
| `an.extract.rejected_claim` | Inside the claim loop | `reason`, `overlap_pct`, `claim_preview` |
| `ai.call.start` | Before each `api.generateText` | `model`, `purpose`, `prompt_chars` |
| `ai.call.complete` | After the call succeeds | `duration_ms`, `response_chars` |
| `ai.call.failed` | On call throw | `error`, `duration_ms` |

With `debate_id` + `turn_id` + `call_id`, a single KQL query in Log Analytics yields a complete per-debate timeline:

```kql
ContainerAppConsoleLogs_CL
| where Log_s startswith "[trace]"
| extend ev = parse_json(substring(Log_s, 8))
| where ev.debate_id == "debate-b052404b-..."
| project TimeGenerated, event=ev.event, turn=ev.turn_id, data=ev.data
| order by TimeGenerated asc
```

### Layer C — Persistent trace sidecar (follow-up)

In parallel with the stdout emit, the server writes every trace event to `/data/debates/<debate_id>.trace.jsonl` on the Azure File share. Two benefits:

1. **Access without KQL.** The trace file is readable the same way source metadata is read today — directly by anyone (human or AI assistant) with access to the data repo.
2. **Replay.** The debate JSON + trace file together form a complete black-box recorder. Failed runs can be analyzed offline.

This is deferred to a follow-up phase. Layer A + Layer B already close the diagnosis gap for the known incident class.

---

## What NOT To Build (Yet)

1. **Application Insights SDK.** Once structured events flow through stdout, App Insights adds query/alerting polish but does not change the diagnostic ceiling. Re-evaluate if distributed tracing or browser RUM becomes a priority.
2. **OpenTelemetry.** Same reasoning. Worth it if the system grows past one container; overkill for a single Container App with no fan-out.
3. **Per-entry extraction_status metadata on the debate JSON.** This is a high-value follow-up (it answers *"did this turn attempt extraction?"* at a glance from the saved debate) but is independent of the trace channel and belongs in a separate change.
4. **Automatic alerting.** Log Analytics alert rules should wait until we see a week of baseline data. Alerting on events you don't understand produces noise, not signal.

---

## Implementation Plan

### Phase O1 — Trace channel (this change)

- **O1.1** Add `/debug/events` POST route to `src/server/server.ts`. Accept `{ events: TraceEvent[] }`, emit each as `console.log('[trace] ' + JSON.stringify(ev))`, return `{ received: N }`. Inherits existing CORS + auth middleware.
- **O1.2** Create `src/renderer/lib/trace.ts`: `TraceEvent` type, `trace(event, data)` function, in-memory buffer, timer-based + size-based flush, `sendBeacon` fallback on unload, Electron-mode console fallback.
- **O1.3** Wire the trace helper into `extractClaimsAndUpdateAN`:
  - `an.extract.start` at line 210 (top of the try)
  - `an.extract.rejected_claim` at line 245 (existing reject branch)
  - `an.extract.complete` at line 320 (where the `[AN] Extracted …` log is today)
  - `an.extract.failed` at line 426 (existing catch)
- **O1.4** Wire `ai.call.*` around the `api.generateText` call at line 216 inside `extractClaimsAndUpdateAN`. Other AI call sites (opening statements, cross-respond, synthesis) are follow-ups.

**Verification — V-O1:** After deploy, run a debate against the cloud app, then:
```kql
ContainerAppConsoleLogs_CL
| where Log_s startswith "[trace]" and TimeGenerated > ago(1h)
| project TimeGenerated, Log_s
| order by TimeGenerated desc
```
Expect one `an.extract.start` / `an.extract.complete` pair per transcript turn, with `accepted` + `rejected` counts that sum sensibly.

### Phase O2 — Broader event coverage (follow-up)

Extend the `ai.call.*` wrapping to the remaining AI call sites (`openingStatementPrompt`, `debateResponsePrompt`, `crossRespondPrompt`, `debateSynthesisPrompt`, `probingQuestionsPrompt`, `factCheckPrompt`). Add `debate.*` lifecycle events: `debate.start`, `debate.turn.start`, `debate.turn.complete`, `debate.complete`, `debate.aborted`.

### Phase O3 — Persistent trace sidecar (follow-up)

Add server-side `/data/debates/<debate_id>.trace.jsonl` write alongside the stdout emit. Requires write permission to the `taxonomy-data` Azure File share (already mounted). Add a small retention policy: keep traces for completed debates, delete when the parent debate session is deleted.

### Phase O4 — Deep health endpoint (follow-up)

Add `GET /health/deep` returning:
- Active debate count
- Last successful AI call timestamp per backend
- Rolling 5-minute extraction failure counter
- Current AI backend config summary

Kept separate from `/health` (used by Azure liveness probes) so a deep-health query cannot affect probe behavior.

---

## Dependencies

```
O1 (Trace channel) → foundation, no prerequisites
  ├── O2 (Broader coverage) → needs O1 infrastructure
  └── O3 (Sidecar file) → independent of O2
O4 (Deep health) → independent of all above
```

O1 is shippable on its own and closes the motivating incident's diagnosis gap.

---

## Summary

| Phase | What | Effort | Value |
|---|---|---|---|
| O1 | Trace channel + claim-extraction events | Small | Foundation — makes the bug diagnosable |
| O2 | Wrap all AI call sites with `ai.call.*` | Small | Full per-call visibility |
| O3 | Persistent trace sidecar on Azure Files | Small | Replay + no-KQL access |
| O4 | Deep health endpoint | Small | At-a-glance "is it sick?" check |

The one-line takeaway: the instrumentation gap isn't *"there's no logging"* — it's that **the logs that exist are trapped in the user's browser and the failure mode we care about is explicitly fire-and-forget.** Fixing both in O1 turns future bugs in this path into KQL queries and JSON reads instead of reproduction hunts.
