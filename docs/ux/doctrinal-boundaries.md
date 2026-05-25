# Doctrinal Boundaries — UX Spec

**Ticket:** t/123
**Author:** Design (Orca)
**Status:** Ready for implementation

## Overview

Surface each POV's "must not concede" doctrinal boundaries in the taxonomy list panel (pane 2) so users can see each perspective's non-negotiable commitments without running a debate.

## Data Source

`POVER_INFO` in `lib/debate/types.ts:1366-1409`. Each POV has exactly 4 `REJECT:` statements in `doctrinal_boundaries[]`.

## Design

### Placement: collapsible section at top of list panel

Add a collapsible "Doctrinal Boundaries" section between the `.list-panel-header` and `.list-panel-items` (NodeTree). It sits above the B/D/I category groups.

```
┌─────────────────────────────────────────┐
│  SAFETYIST          Sort: ID ▾  + New   │  ← existing header
├─────────────────────────────────────────┤
│  ▸ Doctrinal Boundaries (4)             │  ← new section, collapsed by default
├─────────────────────────────────────────┤
│  ▼ DESIRES (87)                         │  ← existing NodeTree
│    saf-desires-001 ...                  │
```

When expanded:

```
┌─────────────────────────────────────────┐
│  SAFETYIST          Sort: ID ▾  + New   │
├─────────────────────────────────────────┤
│  ▾ Doctrinal Boundaries (4)             │
│    ✕ Dismissing existential risk as     │
│      speculative                        │
│    ✕ Speed-over-safety framing of       │
│      development timelines              │
│    ✕ Market self-regulation as          │
│      sufficient governance              │
│    ✕ Competitive pressure as            │
│      justification for deploying        │
│      unverified systems                 │
├─────────────────────────────────────────┤
│  ▼ DESIRES (87)                         │
```

### Visual treatment

- **Section header:** Same style as category headers (`.node-tree-parent-header`) — uppercase, `0.78rem`, muted text, collapsible arrow
- **Boundary items:** Each item uses a `✕` prefix (in the POV's accent color) instead of the `REJECT:` text prefix. The rest of the statement follows in `--text-secondary`, `0.78rem`
- **Left indent:** 18px (same as node items under a category)
- **Spacing:** `4px` vertical gap between items, `6px` padding top/bottom on the section
- **Divider:** `1px solid var(--border-color)` below the section (whether collapsed or expanded)
- **Collapsed by default** — boundaries are reference material, not the primary workflow. Persist collapsed state in localStorage alongside other UI prefs

### Mapping POV to data

The PovTab component receives the `pov` prop (e.g., `"safetyist"`). Map to `POVER_INFO`:
- `safetyist` → `Safetyist`
- `accelerationist` → `Accelerationist`
- `skeptic` → `Skeptic`

Import `POVER_INFO` from `lib/debate/types.ts` (already exported).

## What NOT to do

- No tooltip-only approach — the data is too important to hide behind hover
- No separate tab — 4 short items don't warrant a tab
- No editable UI — these are fixed debater principles, not user-configurable
- No icons beyond the `✕` prefix — keep it minimal

## Integration Points

| File | Change |
|---|---|
| `PovTab.tsx:547-567` | Add collapsible section between `.list-panel-header` and `.list-panel-items` |
| `styles.css` | Add `.doctrinal-boundaries` section styles (reuse existing category header patterns) |
| `PovTab.tsx` (imports) | Import `POVER_INFO` from `lib/debate/types` |

## Accessibility

- Collapsible section uses `<button>` with `aria-expanded`
- `✕` prefix is decorative — use `aria-hidden="true"` on it
- Items are read as plain text by screen readers (the `REJECT:` prefix is replaced visually but the full text is in the DOM or `aria-label`)
