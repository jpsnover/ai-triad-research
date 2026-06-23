# OpenTelemetry Assessment — AI Triad Research

**Author:** Technical Lead
**Date:** 2026-06-23
**Status:** Draft — awaiting review
**Ticket:** t/857

---

## Recommendation: Defer

OpenTelemetry is the right long-term direction, but the project's current scale (~10 users, single ACA container, one admin) does not justify the integration cost. The existing observability stack is more comprehensive than typical for a project this size, and the real gaps can be closed with targeted improvements that don't require OTel.

**Revisit trigger:** When any of these become true:
- Concurrent users exceed ~50 (need latency percentiles to diagnose contention)
- A second service is added (need distributed tracing across service boundaries)
- Azure Monitor is adopted for other reasons (OTel exporter becomes free incremental cost)
- The upstream OTel vulnerability that blocked prior adoption (referenced in `server.ts` line 4, see p/2#12) is resolved

---

## Current Observability Stack

The project already has four layers of instrumentation:

| Layer | Tool | Scope | Strengths | Gaps |
|---|---|---|---|---|
| **Structured logging** | Pino (JSON) | Server | Per-request correlation IDs, component scoping, automatic redaction, configurable levels | No log aggregation beyond container stdout |
| **Flight recorder** | Custom ring buffer | Client + Server | 5000-event ring buffer, type-safe events, context snapshots (heap, debate phase, cache state), NDJSON export, popup IPC forwarding | On-demand only (no automatic export), no time-series retention |
| **AI telemetry** | Custom (stderr JSON + flight recorder) | AI adapter | Per-call latency, token usage, retry counts, fallback chain tracking, backend identification | Not queryable (stderr JSON), no cost calculation, no aggregation |
| **Error reporting** | `/api/admin/errors` + flight recorder | Client → Server | UUID-tagged, timestamped, stored in blob (survives restarts), visible in admin health | Capped at last 5, no deduplication, no alerting thresholds |
| **Health monitoring** | GitHub Actions cron | Production | 15-min checks, auto-issue creation, auto-close on recovery | No latency measurement, no dependency health probes |

**Key finding:** The flight recorder is essentially a custom distributed tracing system optimized for debugging rather than monitoring. It captures the same causal chain that OTel traces would — AI request → retry → fallback → response — just in a ring buffer format rather than a span tree.

---

## What OpenTelemetry Would Add

### Traces
Auto-instrumented spans for Express routes, HTTP client calls (GitHub API, AI backends), and Azure SDK operations. Parent-child span relationships would make it easy to see "this debate turn took 8s because the Gemini call retried 3x then fell back to Groq."

**Delta over current:** The flight recorder already captures this causality via event types (ai.request → ai.retry → ai.fallback → ai.response). OTel adds: visual span waterfall in a trace viewer, automatic timing without manual `performance.now()`, and cross-service correlation if we ever add services.

### Metrics
Histograms for request latency (p50/p95/p99), counters for error rates, gauges for active connections, token usage over time.

**Delta over current:** The AI adapter logs latency per-call to stderr, but there's no aggregation. OTel metrics would let us answer "what's the p95 latency for Gemini calls this week?" Currently impossible without parsing stderr logs manually.

### Logs
OTel Logs API would correlate Pino log entries with traces — click a span, see the related log lines.

**Delta over current:** Pino logs have `requestId` but no trace/span IDs. Correlation is manual (search by requestId). With OTel, it would be automatic.

---

## Why Defer

### 1. Scale doesn't justify the overhead

| Factor | Current | OTel Breakeven |
|---|---|---|
| Concurrent users | ~10 | ~50+ (need percentile analysis) |
| Services | 1 container | 2+ (need cross-service traces) |
| Backend team | 1 admin | 3+ (need shared dashboards) |
| Error volume | ~5/day viewable in admin | 100+/day (need aggregation + alerting) |
| AI call volume | ~100/day | 1000+/day (need cost tracking dashboards) |

At current scale, the admin can read flight recorder dumps and Pino logs directly. OTel's value is in aggregation and visualization — neither is necessary when one person reviews all errors.

### 2. Integration cost is non-trivial

**SDK overhead:**
- `@opentelemetry/sdk-node` + auto-instrumentations: ~15-20 additional dependencies
- Init code: ~50-100 lines (configure providers, exporters, resource attributes)
- Memory: ~10-20 MB additional for SDK + span buffers
- Startup latency: 200-500ms for auto-instrumentation registration

**Electron complications:**
- OTel is server-focused. The `@opentelemetry/sdk-node` assumes Node.js globals (`process`, `fs`) that are partially available in Electron renderer.
- The flight recorder already handles client-side tracing with IPC forwarding between popup windows and the main process — OTel would need custom instrumentation to replicate this.
- Two different telemetry pipelines (OTel for server, flight recorder for client) adds complexity.

**Export destination:**
- Azure Monitor (`@azure/monitor-opentelemetry-exporter`) is the natural choice but adds Azure cost ($2.30/GB ingested after 5 GB free).
- Self-hosted alternatives (Jaeger, Grafana Tempo) require infrastructure we don't have.
- Console/stdout exporter is useful for development but doesn't solve the aggregation gap in production.

**Prior attempt blocked:**
The codebase comment references `p/2#12` — a prior attempt to integrate `@azure/monitor-opentelemetry` that was backed off due to upstream OpenTelemetry vulnerabilities. This hasn't been revisited.

### 3. The real gaps don't require OTel

The gaps in the current stack can be closed with much lighter interventions:

| Gap | OTel Solution | Lighter Alternative |
|---|---|---|
| No aggregated metrics | OTel Metrics → Azure Monitor | Extend `/health` with rolling counters (request count, error rate, avg latency) — ~100 lines |
| No alerting | Azure Monitor alerts on OTel metrics | Health monitor workflow already creates GitHub issues; add latency/error-rate checks — ~30 lines |
| No dependency health | OTel auto-instrumentation spans | Add `/healthz` probes for GitHub API reachability and Azure Blob — ~40 lines |
| Error list capped at 5 | OTel → Azure Monitor error analysis | Increase to 50, add deduplication by error fingerprint — ~60 lines |
| AI cost tracking | Custom OTel metric with token × price | Add cost lookup table to AI telemetry line — ~20 lines |
| No latency histograms | OTel Histogram instrument | Add rolling percentile calculator to health endpoint — ~80 lines |

**Total: ~330 lines of targeted improvements vs. ~2000+ lines of OTel integration + ongoing maintenance.**

---

## If We Adopt Later: Integration Plan

When the revisit triggers fire, here's the recommended approach:

### Phase 1: Server-side traces only
```
@opentelemetry/sdk-node
@opentelemetry/auto-instrumentations-node  (Express, HTTP, dns)
@azure/monitor-opentelemetry-exporter      (or stdout for dev)
```
- Auto-instrument Express routes → one span per request with latency
- Auto-instrument HTTP client → GitHub API, AI backend calls as child spans
- Propagate trace context in Pino logs via `trace_id` field
- Keep flight recorder as-is for client-side (don't try to unify yet)

### Phase 2: Custom AI metrics
```typescript
const aiCallDuration = meter.createHistogram('ai.call.duration_ms');
const aiTokensUsed = meter.createCounter('ai.tokens.total');
```
- Instrument `aiAdapter.ts` with OTel metrics alongside existing stderr telemetry
- Dashboard: latency by backend, token spend by model, retry rate

### Phase 3: Client-side (only if needed)
- Evaluate `@opentelemetry/sdk-trace-web` for browser-side tracing
- Bridge flight recorder events to OTel spans for unified view
- This is the hardest part — likely not worth it unless we have a dedicated observability need

### Estimated effort
- Phase 1: 2-3 days (one developer)
- Phase 2: 1-2 days
- Phase 3: 3-5 days (if ever)

---

## Conclusion

The project's observability is already strong for its scale. The flight recorder, Pino, and AI telemetry together cover debugging, error tracking, and performance measurement. What's missing is aggregation and alerting — but those gaps are cheaper to close with targeted improvements than with a full OTel integration.

**Decision: Defer OTel adoption. Close specific gaps with lightweight improvements. Revisit when scale, multi-service architecture, or Azure Monitor adoption changes the calculus.**
