# Chat Export — PDF, Markdown, Text

**Ticket:** t/1477
**Author:** Design (Orca)
**Status:** Ready for implementation
**Precedent:** debate export already ships (`exportDebateToFile`, bridge `types.ts:212`, web implementation `web-bridge.ts:794-850`) with json/markdown/text/pdf/package formats. Chat export follows the same pattern, same UI grammar, and a parallel bridge method. Consistency with the debate exporter outranks novelty everywhere in this spec.

## 1. Entry point

A new **Export** button in the chat header, immediately left of the existing Share button (`chat-share-btn`, ChatWorkspace.tsx:338).

- Label: "Export" with a download-arrow icon (16px, stroke style matching existing header icons).
- Click opens a small popover menu (existing popover pattern: click-outside close, Escape, focus return):

```
┌─────────────────┐
│ Export as…      │
│  PDF            │
│  Markdown       │
│  Text           │
└─────────────────┘
```

- Menu items are the format names only. No file-size estimates, no descriptions; the formats are self-explanatory to this audience.
- **Disabled state:** when the conversation has no entries, the Export button renders disabled with `title="Nothing to export yet"`.
- **Phone:** the header collapses controls at phone width; Export joins the same overflow the Share button uses (or sits beside it if both fit at 44px hit areas). Never hidden entirely.

## 2. What each format contains

All formats share the same header block and body order. Source of truth is the `ChatEntry` shape (`types/chat.ts:8-15`: id, timestamp, speaker, content, taxonomy_refs, metadata).

**Header block (all formats):**
- Chat topic/title (as shown in the header)
- Perspective (speaker POV) and mode (Brainstorm / Inform / Decide)
- Export date and entry count

**Body (all formats):** entries in order. Per entry: speaker name, timestamp (localized short form), content. System entries are included, labeled "System", and visually muted where the format allows.

| Element | Markdown | Text | PDF |
|---|---|---|---|
| Speaker + timestamp | `### Safetyist — 2:14 PM` | `SAFETYIST (2:14 PM):` | styled heading in camp color |
| Content | verbatim markdown (chat content is already markdown-ish prose) | plain text, markdown syntax stripped is NOT required — export verbatim | rendered prose |
| Taxonomy refs | footnote list per entry: `> refs: saf-beliefs-217 "…label…", …` | omitted | small muted line under the entry |
| Message `metadata` | omitted | omitted | omitted |
| Footer | `Exported from AI Triad Taxonomy Editor · {date}` | same | same, plus page numbers |

Rationale for omissions: `metadata` is internal machinery; text format drops refs because plain text is the "paste it anywhere" format and refs are noise there.

## 3. File naming

`chat-{topic-slug}-{YYYYMMDD}.{md|txt|pdf}`

- Topic slug: lowercase, alphanumeric + hyphens, max 60 chars, from the chat title; fall back to `untitled` for empty titles.
- Same convention family as debate export filenames; if debate export uses a different date format, match debate export exactly.

## 4. Delivery per build target

Bridge method: **`exportChatToFile(entries, format, options)`** added via the `/add-bridge-method` playbook, mirroring `exportDebateToFile`'s signature shape.

- **Web:** Blob + `URL.createObjectURL` + anchor download, exactly the existing debate pattern (web-bridge.ts:794-850). PDF uses the same print-dialog pathway debate export uses (browser print of a print-styled view); do not add a PDF library.
- **Electron:** native save dialog (same handler family as debate export in the main process), default filename from §3.

## 5. PDF specifics

- Reuse the debate export print pathway: a print-styled render of the conversation, `window.print()` to PDF.
- Print CSS: `@page` margins, chat title + date in a running header, page numbers in the footer if the debate exporter already does this (match it; do not build new print infrastructure).
- Page breaks: avoid breaking inside a single message where possible (`break-inside: avoid` on the entry block); long messages may break.
- Camp colors in speaker headings must remain readable in grayscale print: speaker name is bold text first, color second.

## 6. States

| State | Behavior |
|---|---|
| Export in progress | Button shows a spinner in place of the icon; menu closes on selection. Markdown/text are effectively instant; the state exists for PDF |
| Success | No toast needed for web (the browser download/print UI is the feedback). Electron: brief toast "Exported {filename}" matching the debate export behavior |
| Failure | Toast with the ActionableError message; button returns to rest |
| Empty chat | Button disabled (§1) |

## 7. Accessibility

- Export button: `aria-label="Export chat"`, `aria-haspopup="menu"`, `aria-expanded`.
- Menu: arrow-key navigation, Enter selects, Escape closes and returns focus to the button.
- 44px hit areas on phone.

## 8. What NOT to do

- No cloud/share-link export; Share and Export stay separate concepts and separate buttons.
- No format options dialog (page size, include/exclude toggles). Three menu items, zero configuration. Add options only if users ask.
- No new PDF library; the print pathway is the sanctioned pattern.
- No export of drafts/in-flight streaming messages; export captures completed entries only.

## 9. Integration points

| File | Change |
|---|---|
| `ChatWorkspace.tsx` | Export button + menu beside Share (line ~338); disabled/empty logic |
| `bridge/types.ts` | `exportChatToFile` on `AppAPI` (follow `/add-bridge-method`) |
| `bridge/web-bridge.ts` | Web implementation mirroring `exportDebateToFile` |
| `bridge/electron-bridge.ts` + main IPC | Electron implementation (save dialog) |
| Formatters | `chatExportFormatters.ts` (new, renderer util): markdown/text/print-view builders from `ChatEntry[]` — pure functions, unit-testable |
| `styles.css` | Print styles for the chat print view (reuse debate print classes where possible) |
