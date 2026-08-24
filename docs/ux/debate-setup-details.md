# Debate Setup Details — drill-in

**Author:** Design (Orca) · **Status:** Proposed · **Date:** 2026-08-17

## Problem

The debate window header (t/2293, `DebateHeader.tsx`) surfaces a **2-line clamped** topic
(`.debate-hdr-title`, `-webkit-line-clamp: 2`) and a compact metadata row. For a real
resolution like *"Congress should mandate that AI developers utilize siloed datasets,
defined as restricted access tiers where models train on specific information without the
ability to cross-…"* the motion is cut off, and there is **no way to see**:

- the **full topic** text (and how it was refined from the user's original phrasing),
- the **source pointer** — the URL or document the debate was seeded from,
- **background / supporting context** the user supplied,
- the **setup configuration** (audience, models, protocol) that produced this run.

A partial mechanism exists — the toolbar **Details** button opens `CrossCuttingDialog`
(`DebateWorkspace.tsx:543`) — but it renders **only** for situations/cross-cutting debates
and shows **only** raw `source_content`. Topic-, URL-, and document-sourced debates have no
drill-in at all. This spec generalizes that into one **Debate Setup** panel for every debate.

## Data available (already on `DebateSession`, `lib/debate/types/session.ts`)

| Section | Fields |
|---|---|
| **Topic** | `topic.final` (full), `topic.original`, `topic.refined`, `topic.clauses[]`, `topic.background`, `topic.scope` (`core_proposition`, `domain`, `risk_level`, `time_horizon`, `key_tensions[]`, `excluded_scenarios[]`, `explicit_qualifiers[]`) |
| **Source** | `source_type` (`topic`\|`document`\|`url`\|`situations`\|`other`), `source_ref` (URL or file path), `source_content` (loaded text), `doc_meta` |
| **Setup** | `audience`, `debate_model`, `evaluator_model`, `speaker_models`, `stage_models`, `model_tier`, `protocol_id`, `moderator_mode`, `debate_temperature`, `origin` (cli/gui + command), `app_version`, `created_at` / `updated_at` |
| **Identity** | `id`, `run_id` |

No new backend/schema work — this is a **read-only presentation** of fields that already exist.

## Interaction — recommended

**Trigger (two affordances, one target):**

1. A **`Setup`** button in the header action cluster (Band 1, alongside `Diagnostics` /
   `Comments`). Always visible, discoverable, works for every debate. This **replaces** the
   conditional `Details` button (which becomes one section of the new panel).
2. The **clamped title itself is clickable** (cursor `pointer`, `role="button"`,
   `aria-label="Show full topic and setup"`) as a secondary, in-context affordance — the
   truncation *is* the signal that more exists.

**Surface: centered modal dialog** (reuses the app's `.dialog-overlay` / `.dialog`
convention — same as `CrossCuttingDialog`, `DeleteConfirmDialog`). Rationale: setup details
are a *check-and-dismiss* reference action, not something kept open beside the transcript, so
a modal beats a persistent drawer. It also lets `source_content` use full width.

> Alternative considered — right **slide-in drawer** (`DiagnosticsDrawer` pattern): better if
> users want setup visible *while* reading turns. Rejected as the default because setup is
> consulted once, not continuously; offered as a fallback if usage shows otherwise.

## Panel content & layout

Title: **Debate Setup**. Sections top-to-bottom, each a labeled block; omit any section whose
data is absent (never render an empty shell).

```
┌─ Debate Setup ───────────────────────────────────────── × ┐
│                                                            │
│  TOPIC                                                     │
│  Congress should mandate that AI developers utilize        │
│  siloed datasets, defined as restricted access tiers      │
│  where models train on specific information without the   │
│  ability to cross-reference … (full, no clamp)   [Copy]   │
│                                                            │
│  ▸ Topic evolution        (only if original ≠ final)      │
│      Original  "…user's raw phrasing…"                     │
│      Refined   "…refined restatement…"                     │
│  ▸ Clauses (3)            (topic.clauses, if present)     │
│  ▸ Scope                  (domain · risk · horizon · …)   │
│                                                            │
│  SOURCE                                                    │
│  [url] https://example.org/report            [Open][Copy] │
│  ▸ View source content    (source_content, lazy expander) │
│                                                            │
│  BACKGROUND               (topic.background, if present)  │
│  User-supplied supporting context, rendered as prose.     │
│                                                            │
│  SETUP                                                     │
│  Audience    Policymakers                                 │
│  Model       claude-opus-4   (+ evaluator/stage if set)  │
│  Protocol    standard-6-round · moderator: talmudic      │
│  Temp        0.7 · Tier medium                            │
│  Created     Jun 22, 2026 · 05:49 AM                      │
│  Origin      gui · New-Debate -Topic …                   │
│                                                            │
│  IDENTIFIERS                                              │
│  id      5ff58b8b-…-6e0573f7e022                  [Copy]  │
│  run_id  …                                        [Copy]  │
└────────────────────────────────────────────────────────────┘
```

**Section rules**

- **Topic** — always shown; full `topic.final`, no clamp, selectable, `[Copy]` action.
- **Topic evolution** — collapsible (`<details>`), shown **only when** `topic.original` or
  `topic.refined` differ from `final`. Original / Refined / Final as a labeled diff-style list.
- **Clauses / Scope** — collapsible; only when present. Scope renders as key→value chips.
- **Source** — `source_type` as a small badge; `source_ref` as a **link** when it's a URL
  (external-open icon → opens via the app's existing external-link handler, never a bare
  `window.open` to an unvalidated href) or a monospace file path when it's a document; `[Copy]`
  always. `source_content` behind a **lazy** `▸ View source content` expander that mounts
  `DebateSourceViewer` (the same component `CrossCuttingDialog` uses) — keeps the dialog light
  for long documents.
- **Background** — `topic.background` as prose; omit block if empty.
- **Setup** — definition-list rows; show a model row only if the value exists; collapse
  `stage_models` behind a `▸ Per-stage models` expander when it differs from `debate_model`.
- **Identifiers** — `id` and `run_id` as monospace with `[Copy]`; moves the header's UUID
  detail here so Band 2 can stay uncluttered.

## Accessibility

- `role="dialog"`, `aria-modal="true"`, `aria-labelledby` → the "Debate Setup" heading.
- **Focus trap**; focus moves to the close button (or first heading) on open; **Esc closes**;
  focus **returns to the trigger** on close (Setup button or title).
- Overlay click-to-close (matches existing dialogs), but content click `stopPropagation`.
- Copy buttons announce success via `aria-live="polite"` ("Copied").
- Collapsible sections use native `<details>/<summary>` for free keyboard + SR semantics.
- Source link: descriptive `aria-label` ("Open source URL in browser"), not just an icon.
- Contrast: section labels use `--text-secondary` at ≥ the design-system body minimum; never
  rely on color alone for the `source_type` badge (include the text).

## Edge cases

- **Bare-URL topic** (`topic.final` is a raw URL, e.g. `"Discuss: https://…"`): Topic section
  shows the humanized title (reuse `deriveHeaderTitle`/`humanizeUrl`), and the Source section
  carries the actual link — avoid showing the same URL twice.
- **No source** (`source_type: 'topic'`): omit the Source section entirely; do not render an
  empty "Source: none" row.
- **No refinement**: hide Topic-evolution; Topic section still shows `final`.
- **Very long `source_content`**: lazy-mounted + scrolls inside its own container; never
  expands the dialog past the viewport (dialog body `max-height` + `overflow:auto`).
- **Situations/cross-cutting debate**: same panel; the Source section's "View source content"
  covers what `CrossCuttingDialog` did today, so that dialog is **retired** and its `Details`
  button folds into this one (no two overlapping mechanisms).

## Implementation notes (for the Taxonomy Editor agent)

- New component `DebateSetupDialog.tsx` under `components/debate-workspace/`, following the
  `.dialog-overlay`/`.dialog` pattern; reuse `DebateSourceViewer`, `deriveHeaderTitle`,
  `humanizeUrl`, and `DEBATE_AUDIENCES`/`POVER_INFO` label maps already in the header module.
- Add the `Setup` button to the `DebateToolbar` action cluster; make `.debate-hdr-title`
  clickable (both call one `onShowSetup` handler / store flag).
- Remove the conditional `Details` button + `CrossCuttingDialog`; migrate the situations path
  into the Source section.
- Route external URL opens through the app's existing safe external-link mechanism.
- No changes to `DebateSession` or any backend — presentation only.

## Related specs

- `debate-header-redesign.md` (t/2293) — the header this drill-in extends.
- `debate-action-bar-redesign.md` (t/2279) — action-cluster conventions.
