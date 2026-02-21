# POViewer

**Status:** Placeholder — implementation TBD.

POViewer is a public-facing web application that color-codes document elements
by POV camp (Accelerationist / Safetyist / Skeptic / Cross-Cutting) and displays
per-camp interpretations in a side panel.

## Data Contract

POViewer consumes `summaries/<doc-id>.json` files from this repository.
The schema is defined in the organizational blueprint (Section 2.5).

## POV Color Assignments

| Camp              | Color   | Hex       |
|-------------------|---------|-----------|
| Accelerationist   | Green   | `#27AE60` |
| Safetyist         | Red     | `#E74C3C` |
| Skeptic           | Amber   | `#F39C12` |
| Cross-Cutting     | Purple  | `#8E44AD` |

## Implementation Notes

- Planned as a web application (React or similar) for public use by policymakers,
  academics, and the general public.
- Reads JSON/Markdown from this GitHub repo (static or via API).
- Primary input formats: PDFs, web pages, Word documents.

## Getting Started (once implemented)

```bash
cd poviewer
npm install
npm run dev
```
