# Analytics Dashboard Assessment — AI Triad Research

**Author:** Technical Lead
**Date:** 2026-06-23
**Status:** Draft — awaiting review
**Ticket:** t/860

---

## Executive Summary

The analytics dashboard is more capable than it first appears — 15 components across three dashboards cover usage tracking, debate quality calibration, and policy analysis. The main gap isn't missing data collection (the emitter + NDJSON backend are solid), it's **surfacing the right metrics in the right places** and **connecting isolated dashboards into a coherent story**.

The highest-impact improvements don't require a chart library or new infrastructure — they're about assembling existing data into actionable views.

---

## Current State

### Three Dashboards (Disconnected)

| Dashboard | Route / Trigger | Scope | Components |
|---|---|---|---|
| **Usage Analytics** | `#analytics` (chart icon in SaveBar) | User activity: sessions, events, feature usage, per-user drill-down | `AnalyticsDashboard` (1 component, 5 sub-components) |
| **Calibration Dashboard** | Toolbar panel | Debate quality: 18 tracked metrics over time, validation pass/fail | `CalibrationDashboard` + `CalibrationReviewViewer` + `ParameterHistoryPanel` |
| **Policy Dashboard** | Toolbar panel | Policy registry: cross-POV distribution, contradiction hotspots, source tracing | `PolicyDashboard` + `PolicySourcesPanel` |

These three dashboards have **no cross-references**. A user looking at Usage Analytics can't see whether high-activity periods correlate with good debate quality. A user in Calibration can't see which users generated the debates being measured.

### 12 Analytical Panels (Contextual, Well-Designed)

These panels appear in context (toolbar, debate view, node inspector) and are generally well-suited to their purpose:

| Panel | Purpose | Triggered By |
|---|---|---|
| ConvergenceSignals | Debate collaboration vs confrontation metrics | Debate view |
| FallacyPanel | Detected logical fallacies in nodes | Toolbar |
| GroundingPanel | Evidence citations for taxonomy claims | Debate view |
| LineagePanel | Intellectual lineage hierarchy | Toolbar |
| TaxonomyGapPanel | Unmapped arguments and blind spots | Debate view |
| ExtractionTimelinePanel | Claim extraction funnel per turn | Debate view |
| NeutralEvaluationPanel | Persona-free claim evaluation | Debate view |
| FactsPanel | Source evidence per node | Node inspector |
| SummariesTab | Source document summaries | Toolbar |
| AttributeFilterPanel | Controlled vocabulary filters | Toolbar |
| AttributeInfoPanel | Attribute detail cards | Selection |
| AnalysisPanel | AI-powered critique + rationalization | Toolbar |

**Verdict:** The contextual panels are strong. The problem is at the dashboard level, not the panel level.

### Analytics Infrastructure

| Layer | Implementation | Quality |
|---|---|---|
| **Event emitter** | `analyticsEmitter.ts` — Zustand-subscribed, 30s flush, sendBeacon on unload | Good. Tracks 8 event types across 6 categories |
| **Server storage** | `analytics.ts` — dual backend (FS / Azure Append Blob), daily NDJSON | Good. 90-day retention, auto-prune |
| **Query API** | `GET /api/analytics/query` + `GET /api/analytics/events` | Adequate. Aggregation is server-side. No pagination |
| **Visualization** | Hand-coded SVG bar charts and polylines | Functional but limited — no tooltips, axes, or interactivity |

### What the Emitter Tracks

| Category | Event Types | Missing |
|---|---|---|
| navigation | session.start, session.end, tab.switch, panel.open | Page load time, time-on-tab |
| taxonomy | node.select | Node edit, node create, node delete |
| search | search (with query + result count + duration) | Search result click-through |
| debate | debate.* (generic) | Debate start, debate complete, debate abandon, turn count, quality score |
| ai | ai.call (model + duration) | Token count, cost, retry count, fallback used |
| config | config.change (setting + value) | — |

---

## Gaps Analysis

### Gap 1: No Debate Outcome Metrics in Usage Dashboard

The Usage Dashboard tracks that debates *happen* but not their *quality*. The CalibrationDashboard has rich quality data (18 metrics!), but it's siloed. The admin can't answer "are debates getting better over time?" from a single view.

**What's needed:** A "Debate Health" card on the Usage Dashboard showing: completion rate, average quality score (from calibration), and trend direction.

**Effort:** ~80 lines (server: aggregate calibration data into a summary endpoint; client: one card component).

### Gap 2: No AI Cost Visibility

The emitter tracks `ai.call` events with model and duration, but **not token count or cost**. The AI adapter logs tokens to stderr, but that data never reaches the analytics pipeline. At ~100 AI calls/day and ~$0-5/month, this isn't urgent — but as usage grows, understanding per-debate AI cost becomes critical for BYOK users.

**What's needed:** Extend the AI telemetry event to include `tokens_in`, `tokens_out`, and `estimated_cost_usd`. Add an "AI Spend" card to the Usage Dashboard.

**Effort:** ~60 lines (emitter extension + one new summary card).

### Gap 3: Usage Dashboard Lacks Context

The current dashboard shows raw activity (events, sessions, users) but provides no context for *what users are doing*. Specifically:

- **No debate lifecycle funnel**: started → turns completed → taxonomy changes → debate finished
- **No taxonomy coverage trend**: how many nodes are enriched over time
- **No retention metric**: how many users return week-over-week

**What's needed:** Three new cards — Debate Funnel, Taxonomy Progress, User Retention.

**Effort:** ~120 lines (server: 3 new aggregation queries; client: 3 card components).

### Gap 4: No Comparative View

There's no way to compare periods (this week vs last week) or compare users. The date preset selector (1d/7d/30d/90d) shows one window at a time.

**What's needed:** A "vs. previous period" toggle that shows delta percentages on summary cards (e.g., "Sessions: 42 ↑12%").

**Effort:** ~40 lines (client-side: fetch two periods, compute deltas, render arrows).

### Gap 5: Chart Interactivity

All charts are hand-coded SVG with no tooltips, hover states, or drill-down. The bar chart in `ActivityChart` has `title` attributes (native browser tooltips) but no rich hover cards. The `MetricChart` in CalibrationDashboard has the same limitation.

**What's needed:** Two options:
1. **Minimal: Enhance existing SVG** — add a hover-activated tooltip div positioned over the chart. ~60 lines per chart.
2. **Adopt a chart library** — add a lightweight charting library for proper tooltips, axes, and responsive sizing.

**Recommendation:** Option 1 for now. The project has no chart library, and adding one for 3-4 charts isn't worth the dependency. If we later build more complex visualizations (correlation plots, heatmaps), revisit.

### Gap 6: Dashboard Unification

Three separate dashboards means three separate mental contexts. The admin must navigate between usage, calibration, and policy views to get a system-wide picture.

**What's needed:** A unified "System Overview" section at the top of the Usage Dashboard with one-line summaries from each domain:
- Usage: "42 sessions this week (↑12%)"
- Debates: "8 completed, avg quality 0.82"
- Taxonomy: "1,247 nodes, 94% enriched"
- Calibration: "Last run: 14/16 metrics passing"

Each summary links to the detailed dashboard.

**Effort:** ~100 lines (client: cross-domain summary component pulling from existing stores/endpoints).

### Gap 7: Missing Emitter Events

Key user actions aren't tracked:

| Action | Impact |
|---|---|
| Debate completion (with turn count, duration, quality score) | Critical for outcome tracking |
| Node edit/create/delete | Critical for taxonomy activity measurement |
| Export actions (PDF, JSON) | Useful for understanding output usage |
| Error encounters (user-facing errors) | Useful for reliability metrics |
| Search result click-through | Useful for search quality |

**Effort:** ~40 lines (add emit calls at each action site).

---

## Recommendations (Prioritized)

### P0 — High Impact, Low Effort

| # | Improvement | Effort | Impact |
|---|---|---|---|
| 1 | **Add debate outcome events to emitter** — track debate.complete with turn count, duration, quality score + node.edit/create/delete events | ~40 lines | Unlocks all debate analytics |
| 2 | **Period comparison on summary cards** — "vs. previous period" deltas with ↑↓ arrows | ~40 lines | Makes trends immediately visible |
| 3 | **Cross-domain summary row** — one-line status from Usage + Debates + Taxonomy + Calibration at top of analytics page | ~100 lines | Unifies the three dashboards |

### P1 — High Impact, Medium Effort

| # | Improvement | Effort | Impact |
|---|---|---|---|
| 4 | **Debate health card** — completion rate, avg quality trend, pulled from calibration data | ~80 lines | Connects usage to outcomes |
| 5 | **AI cost tracking** — extend emitter with token counts, add spend card to dashboard | ~60 lines | Critical for BYOK cost awareness |
| 6 | **Debate funnel visualization** — started → turns → extractions → taxonomy changes → completed | ~80 lines | Shows where debates stall |
| 7 | **Chart tooltips** — hover div positioned over SVG charts with data details | ~60 lines/chart | Makes existing charts interactive |

### P2 — Useful, Lower Priority

| # | Improvement | Effort | Impact |
|---|---|---|---|
| 8 | **User retention metric** — week-over-week returning users | ~40 lines | Engagement measurement |
| 9 | **Taxonomy coverage trend** — enriched/total nodes over time | ~60 lines | Progress tracking |
| 10 | **Export to CSV** — download raw events or aggregated data | ~40 lines | Admin data portability |
| 11 | **Auto-refresh** — 60s polling on the analytics dashboard | ~20 lines | Live monitoring during demos |

### Not Recommended

| Idea | Why Not |
|---|---|
| Adopt a chart library (recharts, d3, plotly) | Only 4 charts exist. Hand-coded SVG is fine for bar + line. Revisit if we need heatmaps, scatter plots, or >8 charts |
| Real-time WebSocket analytics | ~10 users. Polling every 60s is sufficient |
| Custom analytics backend (ClickHouse, Druid) | NDJSON + server-side aggregation handles current scale. Revisit at 1000+ events/day |
| Merge all panels into one mega-dashboard | The contextual panels are well-placed. The gap is at the *summary* level, not the *detail* level |

---

## Implementation Approach

The improvements are modular and can be implemented independently. Suggested order:

1. **Emitter extensions** (P0.1) — must ship first because everything else depends on richer event data
2. **Summary cards + comparison** (P0.2, P0.3) — quick wins that transform the dashboard's usefulness
3. **Debate health + AI cost** (P1.4, P1.5) — cross-domain insights
4. **Funnel + tooltips** (P1.6, P1.7) — visualization quality
5. **P2 items** — as time allows

Total estimated effort for P0 + P1: ~460 lines across emitter, server analytics, and dashboard components. No new dependencies. No infrastructure changes. No architectural decisions.

---

## Comparable Platforms

For reference, research/analysis platforms with similar scope typically surface:

| Platform Type | Key Analytics Pattern |
|---|---|
| **Deliberation tools** (Polis, Kialo) | Participation rate, opinion clustering, convergence velocity |
| **Annotation platforms** (Hypothesis, Prodigy) | Inter-annotator agreement, coverage, throughput per session |
| **LLM playgrounds** (OpenAI, Anthropic) | Token usage, cost per session, model performance comparison |
| **Knowledge management** (Notion, Obsidian) | Content growth, link density, stale-page detection |

The AI Triad project uniquely combines elements from all four categories. The recommended improvements draw from each:
- **Debate funnel** ← deliberation tools (where do discussions stall?)
- **Quality trend** ← annotation platforms (is output quality improving?)
- **AI cost cards** ← LLM playgrounds (what does usage actually cost?)
- **Taxonomy coverage** ← knowledge management (how complete is the graph?)

---

## Decision

This assessment does not require an ADR — all improvements are incremental enhancements to existing components. No new infrastructure, dependencies, or architectural patterns are introduced.
