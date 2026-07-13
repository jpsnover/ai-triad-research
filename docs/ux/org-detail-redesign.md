# Organization Detail: Readability Redesign

**Last updated:** 2026-07-13
**Author:** Design
**Status:** Spec, ready for implementation
**Component:** `taxonomy-editor/src/renderer/components/organizations/OrganizationDetail.tsx`
**Types:** `lib/organizations/types.ts`

## Problem

The top half of the page (header, About, POV Alignment, Topic/Policy Engagement) reads
well. The bottom half degrades into raw data:

| Section | Today | Root cause |
|---|---|---|
| Key Figures | Raw JSON strings on screen: `{"name":"Sam Altman","role":"CEO",...}` | `OrganizationDetail.tsx:356` renders `JSON.stringify(kf)` for object entries |
| External Links | Bare URLs as link text | Component reads `link.label`, but production data uses `title` (present on only 10/36 links) and `type` — `label` never exists, so every link falls back to the raw URL. The `type` field (website, position_paper, report, legislation, wikipedia) is never shown |
| Sources | Non-clickable monospace chips holding full URLs, visually clipped | `source_refs` was assumed to be doc IDs; in production all 7 values are URLs. Several duplicate an entry in External Links |
| Relationships | Long undifferentiated list; peer ID prints inline after every name | No visual grouping container; IDs compete with names |

Verified data shapes (`ai-triad-data/taxonomy/Origin/organizations.json`, 25 orgs):

```jsonc
key_figures:    [{ "name": "Dario Amodei", "role": "CEO", "relevance": "Leading voice on …" }]
external_links: [{ "type": "position_paper", "url": "https://…", "title": "Responsible Scaling Policy" }]  // title optional
source_refs:    ["https://www.anthropic.com/news/…"]   // URLs today; treat doc-ids as possible future values
```

## Design principles

1. **Never show a raw URL or raw JSON as primary text.** URLs are metadata; people,
   titles, and hostnames are content.
2. **One row component for anything clickable-external** (links and URL sources) so the
   bottom of the page stops changing texture every section.
3. Research-tool density means no cards for the sake of cards. Rows stay at the
   existing type scale (0.78rem primary / 0.72rem secondary).

## 1. Key Figures

Person rows, one per figure. Two-column grid ≥560px panel width, single column below.

```
┌──────────────────────────────────────┬──────────────────────────────────────┐
│ (SA)  Sam Altman · CEO               │ (GB)  Greg Brockman · President      │
│       Public face of frontier        │       Infrastructure and scaling     │
│       deployment strategy            │       strategy                       │
└──────────────────────────────────────┴──────────────────────────────────────┘
```

- **Avatar:** 24px **circle** with initials. Reuse the `OrgLogo` initials fallback
  (same palette + `hashName`), but `borderRadius: 50%` to distinguish people from
  org logos (4px radius squares). No favicon lookup for people.
- **Name:** 0.78rem, weight 500, `--text-primary`.
- **Role:** same line, after ` · ` separator, `--text-secondary`, weight 400. Omit the
  separator when role is absent.
- **Relevance:** second line, 0.72rem, `--text-muted`, `lineHeight 1.4`, max 2 lines
  (`-webkit-line-clamp: 2`), full text via `title` attribute.
- **Fallbacks:** string entries render as a name-only row; object without `name`
  renders nothing (skip, don't stringify). Never `JSON.stringify` in UI.

## 2. Shared external-link row (used by §3 and §4)

```
┌ ▢ Responsible Scaling Policy   [position paper]        anthropic.com ↗ ┐
```

- **Favicon:** 16px, existing Google favicon pattern from `OrgLogo` (domain from URL);
  fall back to a neutral globe/link glyph on error, not initials (these are pages,
  not orgs).
- **Primary label** (0.78rem, weight 500, `--color-info`, underline on hover only):
  `title` if present, else humanized hostname + first path segment
  (`futureoflife.org / open-letter`), never the full URL. Strip `www.`.
- **Type chip:** existing badge style (`--bg-hover`, `--text-secondary`, 0.72rem
  equivalent, `_` → space). Omit for `website` when the URL is the org's own `url`
  (redundant with header Website action).
- **Domain:** right-aligned or trailing, 0.72rem `--text-muted`, with a small ↗
  external-link indicator. Skip domain text when the primary label already is the
  hostname.
- **Interaction:** whole row is one button (`api.openExternal`), hover `--bg-hover`,
  visible focus ring (`--focus-ring`). `aria-label` = `"{label}, opens {domain} in
  browser"`. Full URL in `title` attribute.
- **Invalid URL** (extractDomain returns null): render label + chip, no favicon, row
  disabled with muted color.

## 3. External Links

Header stays "External Links". Rows per §2, 2px vertical gap. Keep data order
(curation order is meaningful).

## 4. Sources

Header stays "Sources". Provenance is semantically distinct from curated links, so the
sections stay separate, but they share the §2 row component:

- If a `source_refs` entry is a URL: §2 row. If the same URL exists in
  `external_links` with a `title`, reuse that title as the label (dedupe the *label
  lookup*, not the row; the source list must stay complete as evidence).
- If a future entry is a doc-id (non-URL string): keep today's monospace chip, but make
  it `userSelect: all` and give it `title` with the full ref.
- Drop the clipped fixed-width chips for URLs entirely.

## 5. Relationships (light touch)

Keep grouping and rationale lines. Two changes only:

- Peer ID moves out of the name line and into `title` (hover). Names stay, monospace
  clutter goes. (Matches the ID-demotion direction of the de-engineering pass,
  `de-engineering-pass.md` §4.)
- Group label gets a count, e.g. `Competitors (6)`, keeping the current 0.72rem,
  weight 600, `--text-muted` styling.

## 6. Footer

Unchanged (ID + timestamps row is already correct). Tags row unchanged.

## Type follow-up (coordination required)

`lib/organizations/types.ts:19-20` declares `key_figures?: unknown[]` and
`external_links?: unknown[]`. Implementer should propose:

```ts
export interface KeyFigure { name: string; role?: string; relevance?: string }
export interface ExternalLink { type?: string; url: string; title?: string }
key_figures?: (KeyFigure | string)[];
external_links?: (ExternalLink | string)[];
```

Normalize at fetch/props boundary (coerce strings + missing fields once), not at each
render site. `lib/` is outside taxonomy-editor scope, so confirm the owner via
`resolve_owner` before the type change lands.

## Accessibility

- Every external-open control: `aria-label` naming destination + "opens in browser".
- Row focus ring ≥ 2px `--focus-ring`; rows reachable in DOM order.
- Line-clamped relevance text must expose full text (`title` attr).
- Favicon `<img>` keeps `alt=""` (decorative).
- Type chips are supplementary and never the only distinction between link kinds
  (label + domain remain).

## Edge cases

- `key_figures` entry lacking `name` → skip silently (flight-record at load if
  normalization drops entries).
- Duplicate URLs within `external_links` → render both (data issue, not a UI issue);
  do not dedupe silently.
- 0-length sections are already hidden; unchanged.
- Very long titles: single line, ellipsis, full text in `title`.

## Verify

- `npm run verify` in taxonomy-editor.
- Visual check in all 4 themes (light / dark / bkc / harvard). Favicon rows and chips
  sit on `--bg-primary`; confirm chip contrast in harvard.
- Screenshot the OpenAI and Anthropic orgs (richest key_figures/links data) for design
  review.
