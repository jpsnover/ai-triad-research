# Analytics Dashboard — Reporting UX Spec

**Status:** Spec ready for implementation
**Owner:** Design
**Implementer:** Taxonomy Editor
**Depends on:** Analytics instrumentation & pipeline (Tech Lead architecture, e/27)

## Context

The Azure-deployed Taxonomy Editor needs a reporting dashboard so Jeff can understand who is using the app and what features they engage with. The data pipeline (designed by Tech Lead) stores events as daily NDJSON files on Azure Files, queryable via `GET /api/analytics/query`.

**Data available per event:**
```typescript
interface AnalyticsEvent {
  user: string;
  session_id: string;
  timestamp: string;       // ISO 8601
  event_type: string;      // 'tab.switch' | 'node.select' | 'feature.use' | 'search' | 'debate.start' | etc.
  category: string;        // 'navigation' | 'taxonomy' | 'debate' | 'search' | 'ai' | 'config'
  detail: Record<string, unknown>;
  duration_ms?: number;
}
```

## Access Point

**Separate route: `/analytics`** — not a toolbar panel or tab in the main editor.

Rationale:
- Analytics is an admin/owner concern, not a day-to-day editing feature
- Keeps the main editing UI uncluttered
- Can have its own full-page layout without competing for pane space
- Natural URL to share or bookmark

**Entry point:** Add a small chart icon button to the SaveBar right section (next to the new flight recorder dump button and sync diagnostics gear). Tooltip: "Usage Analytics". Click navigates to `/analytics` route. Only visible in web mode (`VITE_TARGET === 'web'`).

**Back navigation:** The analytics page has a "Back to Editor" link/button in the top-left that returns to the main app.

## Page Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  [< Back to Editor]     Usage Analytics     [date range picker] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐              │
│  │ Active  │ │Sessions │ │  Total  │ │  Avg    │              │
│  │ Users   │ │  Today  │ │ Events  │ │Session  │              │
│  │   12    │ │    8    │ │  1,247  │ │ 14 min  │              │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘              │
│                                                                 │
│  ┌─ Activity Over Time ──────────────────────────────────────┐ │
│  │  ▁▃▅▇█▇▅▃▁▂▄▆█▇▅▃  (bar chart, daily sessions/events)   │ │
│  │  ── sessions  ── unique users                              │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ Feature Usage ────────────┐ ┌─ Active Users ─────────────┐ │
│  │                            │ │                             │ │
│  │  navigation  ████████ 312  │ │  User         Last    Sess │ │
│  │  taxonomy    ██████   245  │ │  jsnover      2m ago    12 │ │
│  │  debate      █████    198  │ │  alice@g..    1h ago     8 │ │
│  │  search      ████     156  │ │  bob@git..    3h ago     5 │ │
│  │  ai          ███      112  │ │  carol@g..    1d ago     3 │ │
│  │  config      █         34  │ │                             │ │
│  │                            │ │                             │ │
│  └────────────────────────────┘ └─────────────────────────────┘ │
│                                                                 │
│  ┌─ Session Explorer ────────────────────────────────────────┐ │
│  │  [user dropdown] [date dropdown]                           │ │
│  │                                                            │ │
│  │  14:23:01  tab.switch        → Accelerationist            │ │
│  │  14:23:05  node.select       → acc-B-012                  │ │
│  │  14:23:18  feature.use       → lineage panel              │ │
│  │  14:23:42  search            → "omega point"              │ │
│  │  14:24:01  node.select       → acc-I-007                  │ │
│  │  14:24:15  debate.start      → debate-2026-05-06-1        │ │
│  │  ...                                                       │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Sections

### 1. Summary Cards (top row)

Four metric cards showing headline numbers for the selected date range.

| Card | Metric | Computation |
|------|--------|-------------|
| **Active Users** | Distinct `user` values | Count unique users in range |
| **Sessions** | Distinct `session_id` values | Count unique sessions in range |
| **Total Events** | Raw event count | Sum of all events in range |
| **Avg Session Duration** | Mean session length | Last event timestamp minus first, per session, then average |

**Styling:** Cards in a horizontal row, each with a large number, small label below, and optional delta vs. previous period (e.g., "+3 vs last week") in green/red.

### 2. Activity Over Time (bar chart)

Dual-series bar/line chart showing daily activity over the selected date range.

- **X-axis:** Dates
- **Y-axis (bars):** Total events per day
- **Y-axis (line overlay):** Unique users per day
- **Hover tooltip:** Date, event count, user count, session count
- **Implementation:** Pure CSS/SVG bars — no charting library needed for this scale. Each bar is a `div` with percentage height. Keeps the bundle light.

### 3. Feature Usage (horizontal bar chart)

Horizontal bar chart showing event counts grouped by `category`.

- Bars sorted by count descending
- Each bar labeled with category name and count
- Color-coded by category (reuse existing POV/category color patterns)
- Clicking a category filters the Session Explorer below to that category

**Drill-down option:** Toggle between `category` grouping and `event_type` grouping for finer granularity (e.g., see `tab.switch` vs `node.select` vs `feature.use` within `navigation`).

### 4. Active Users (table)

Sortable table of all users in the date range.

| Column | Content |
|--------|---------|
| **User** | Username or email (truncated with tooltip for full value) |
| **Last Active** | Relative time ("2m ago", "1d ago") with absolute timestamp tooltip |
| **Sessions** | Session count in range |
| **Events** | Total events in range |
| **Top Feature** | Most-used category for this user |

- Sortable by any column (click header)
- Clicking a user row filters the Session Explorer to that user

### 5. Session Explorer (event timeline)

Chronological event log for a selected user + session.

**Controls:**
- **User dropdown** — filter by user (pre-selected if clicked from Active Users table)
- **Session dropdown** — shows sessions for selected user, labeled by date + start time + duration
- **Category filter** — checkbox toggles per category (pre-selected if clicked from Feature Usage)

**Event rows:**

```
┌──────────┬─────────────────┬────────────────────────────────┐
│ 14:23:01 │ tab.switch      │ → Accelerationist              │
│ 14:23:05 │ node.select     │ → acc-B-012 "Teleological..."  │
│ 14:23:18 │ feature.use     │ → lineage panel                │
│ 14:23:42 │ search          │ → "omega point" (384ms)        │
└──────────┴─────────────────┴────────────────────────────────┘
```

| Column | Content |
|--------|---------|
| **Time** | `HH:mm:ss` from timestamp |
| **Event Type** | `event_type` value, color-coded pill badge by category |
| **Detail** | Human-readable summary from `detail` object. E.g., tab name, node ID + label, search query, debate ID |
| **Duration** | If `duration_ms` present, shown in parentheses |

- Scrollable list, most recent at bottom (chat-like chronological order)
- Light alternating row backgrounds for readability
- Max 500 events shown; "Load more" button if session is larger

## Date Range Picker

Top-right of the page. Preset options + custom range.

**Presets:** Today | Last 7 days | Last 30 days | Last 90 days
**Custom:** Two date inputs (from/to)

Default: **Last 7 days**

Changing the date range refreshes all sections. The query endpoint supports date range filtering.

## Data Loading

- On page load: single call to `GET /api/analytics/query?from=YYYY-MM-DD&to=YYYY-MM-DD`
- Returns aggregated data for Summary Cards, Activity chart, Feature Usage, and Active Users
- Session Explorer makes a separate call: `GET /api/analytics/query?user=X&session_id=Y` for the detailed event list
- Loading state: skeleton placeholders for each section while data loads

## Responsive Behavior

- Summary cards: 4-across on wide screens, 2x2 grid on narrow
- Feature Usage + Active Users: side-by-side on wide, stacked on narrow
- Activity chart and Session Explorer: full width always

## Web-Only

The entire analytics route and SaveBar button are gated on `VITE_TARGET === 'web'`. Not rendered in Electron builds — there's no multi-user analytics to show in desktop mode.

## File Changes

| File | Change |
|------|--------|
| `taxonomy-editor/src/renderer/components/AnalyticsDashboard.tsx` | New component — full analytics page |
| `taxonomy-editor/src/renderer/components/SaveBar.tsx` | Add analytics button (web-only, next to flight recorder dump button) |
| `taxonomy-editor/src/renderer/App.tsx` | Add `/analytics` route |
| `taxonomy-editor/src/renderer/hooks/useAnalytics.ts` | Hook for fetching/caching analytics query results |

## Edge Cases

- **No data yet:** Show friendly empty state: "No analytics data available. Events will appear as users interact with the app."
- **Single user:** Dashboard still works — just shows one user row. Activity chart shows their pattern.
- **Large date range:** The query endpoint should handle aggregation server-side to keep response size manageable. Client requests raw events only for Session Explorer (single session at a time).
- **Privacy:** Display usernames as-is (they're authenticated users Jeff has explicitly allowlisted). No PII beyond what Easy Auth provides.
