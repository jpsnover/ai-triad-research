# Prompt Diff Viewer — Feature Spec

**Status:** Spec ready for implementation
**Owner:** Design
**Implementer:** Taxonomy Editor + Technical Lead

## Problem

When debugging debate behavior, users need to compare the **actual raw prompts sent to the AI backend** — the fully-rendered, context-injected prompts that the model received, not the prompt templates or template functions in `prompts.ts`. These rendered prompts include the injected taxonomy context, transcript history, argument network state, moderator directives, and all other dynamic content that varies per turn. Currently, these rendered prompts are only viewable one at a time in collapsed `<details>` sections. There's no way to see what changed between the rendered Plan prompt for S7 vs S8, or between the rendered Brief and Draft prompts within the same step. Understanding how the fully-rendered prompts evolve across turns is critical for diagnosing unexpected debate behavior.

## Feature Overview

A **popout window** (like Debate Diagnostics) that displays a tree of all **rendered prompts** (as stored in `stage_diagnostics[n].prompt` — the complete text sent to the AI backend) for a selected transcript entry, organized by stage and attempt. Users select prompts from the tree to display them in side-by-side panes with **WinDiff-style line-level diff visualization**.

**Important distinction:** This feature operates on the **rendered prompts** captured in diagnostics — the actual strings sent to the AI model at runtime. These contain fully-expanded taxonomy context, transcript history, and per-turn state. They are NOT the prompt template functions in `lib/debate/prompts.ts`.

## Entry Point

**"Prompt Diff" button** in the Debate Diagnostics entry detail header (next to Prev/Next navigation). Only enabled when the selected entry has `stage_diagnostics` with at least one stage that has a `prompt` field.

Clicking opens a **new popout window** (Electron: `BrowserWindow`; Web: `window.open` or new tab) that can be fullscreened independently. Same pattern as the existing Diagnostics popout.

## Window Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Prompt Diff — S7 Accelerationist (statement)              [─] [□] [×] │
├────────────┬────────────────────────────────────────────────────────────┤
│            │                                                            │
│  TREE      │  PROMPT PANES (1-4 side by side)                          │
│  (left)    │                                                            │
│            │  ┌─ Pane 1 ──────┐ ┌─ Pane 2 ──────┐ ┌─ Pane 3 ─────┐   │
│  ▼ S7      │  │ BRIEF Turn 1  │ │ PLAN Turn 1   │ │ DRAFT Turn 1 │   │
│    BRIEF   │  │ [×]           │ │ [×]           │ │ [×]          │   │
│      Turn 1│  │               │ │               │ │              │   │
│    PLAN    │  │ White = same  │ │ Red = deleted │ │ Red = del    │   │
│      Turn 1│  │               │ │ Yellow = added│ │ Yellow = add │   │
│    DRAFT   │  │               │ │               │ │              │   │
│      Turn 1│  │               │ │               │ │              │   │
│      Turn 2│  │               │ │               │ │              │   │
│    CITE    │  │               │ │               │ │              │   │
│      Turn 1│  │               │ │               │ │              │   │
│            │  │               │ │               │ │              │   │
│  ▶ S8      │  └───────────────┘ └───────────────┘ └──────────────┘   │
│  ▶ S9      │                                                            │
│            │                                                            │
├────────────┴────────────────────────────────────────────────────────────┤
│  Status: 3 prompts loaded │ Diff: Pane 2 vs Pane 1, Pane 3 vs Pane 2  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Tree View (Left Pane)

### Structure

```
▼ S7 Accelerationist (statement)
    BRIEF
      Turn 1  (gemini-3.1, 0.15, 1.9s)
    PLAN
      Turn 1  (gemini-3.1, 0.4, 2.9s)
    DRAFT
      Turn 1  (gemini-3.1, 0.7, 4.4s)  ✗ Fail
      Turn 2  (gemini-3.1, 0.7, 3.8s)  ✓ Pass
    CITE
      Turn 1  (gemini-3.1, 0.15, 1.9s)
▶ S8 System
▶ S9 Moderator
▶ S10 Safetyist (statement)
    BRIEF
      Turn 1
    PLAN
      Turn 1
    ...
```

### Tree Hierarchy

- **Level 0:** Transcript entries (S7, S8, S9...) — collapsible, shows speaker + type
- **Level 1:** Stage phases (BRIEF, PLAN, DRAFT, CITE) — grouped by stage name, ordered by pipeline sequence: BRIEF → PLAN → DRAFT → CITE
- **Level 2:** Turns/attempts within each stage — labeled "Turn 1", "Turn 2", etc. Shows model, temperature, response time, and validation pass/fail badge

### Tree Behavior

- Click a turn node → adds its prompt to the next available pane (up to 4)
- If 4 panes are already open, clicking replaces the rightmost pane
- Current entry (from Diagnostics) is auto-expanded on open
- Other entries are collapsed but expandable for cross-entry comparison
- Entries without stage_diagnostics are shown greyed out (not clickable)

### Tree Metadata (inline)

Each turn node shows compact metadata:
- Model name (abbreviated: "gemini-3.1" not full model ID)
- Temperature
- Response time
- Validation badge: ✓ green / ✗ red (if `stage_validation` exists)

## Prompt Panes (Right Area)

### Pane Layout

Up to **4 panes** displayed side by side, each taking equal width (100%/N where N = number of open panes).

Each pane:
```
┌─ PLAN Turn 1 (S7 Accelerationist) ──────────── [×] ─┐
│                                                       │
│  [line-numbered, scrollable prompt text]              │
│                                                       │
│  White background = identical to left neighbor        │
│  Red background   = deleted (in left, not in this)    │
│  Yellow background = added (in this, not in left)     │
│                                                       │
└───────────────────────────────────────────────────────┘
```

### Pane Header

- Stage name + Turn number + entry ID + speaker (e.g., "PLAN Turn 1 (S7 Accelerationist)")
- Close button [×] — removes this pane, remaining panes expand to fill space
- Stage badge color matches diagnostics (BRIEF = blue, PLAN = purple, DRAFT = green, CITE = orange)

### Pane Content

- Monospace font, line-numbered
- Scrollable vertically and horizontally (independent per pane for horizontal)
- Text is the rendered prompt string from `stage_diagnostics[n].prompt`

## Diff Visualization (WinDiff Style)

### Rules

- **Pane 1 (leftmost):** No diff coloring — this is the reference/base. Plain white background.
- **Pane 2:** Diff computed against Pane 1
- **Pane 3:** Diff computed against Pane 2
- **Pane 4:** Diff computed against Pane 3

Each pane diffs against its **left neighbor**, creating a chain: Base → Δ1 → Δ2 → Δ3.

### Line-Level Colors

| Background Color | Meaning | CSS |
|-----------------|---------|-----|
| **White** | Identical line (exists in both) | `background: transparent` |
| **Red** (#fee2e2) | Left file only — this line was in the left neighbor but removed/missing here | `background: rgba(239,68,68,0.15)` |
| **Yellow** (#fef9c3) | Right file only — this line was added in this pane, not in left neighbor | `background: rgba(234,179,8,0.15)` |

### Diff Algorithm

Use a standard line-level diff (LCS-based). The existing `diffWords()` function in `ReflectionsPanel.tsx` provides a word-level diff — for prompts, **line-level** is more appropriate due to length. Split by `\n`, compute LCS, classify each line as same/added/removed.

### Diff Statistics

Each pane header shows a compact diff summary when diffing is active:
```
PLAN Turn 1 (S7)  +12 / -8 / 156 lines
```
(12 lines added, 8 removed, 156 total)

## Scrolling Behavior

### Synchronized Vertical Scrolling

All open panes scroll **vertically in lockstep**. When the user scrolls any pane (mouse wheel, scrollbar drag, or keyboard), all other panes move together by the same amount. This keeps corresponding lines visually aligned across panes.

Synchronized scrolling can be toggled off via `Ctrl+S` or the status bar toggle — when off, each pane scrolls independently.

### Visual Line Alignment (Ghost Lines)

When one prompt contains a block of text that the other lacks (red or yellow regions), the diff renderer inserts **blank placeholder lines (ghost lines)** in the opposing pane. This padding ensures that the next set of identical (white) lines aligns perfectly at the same vertical position across all panes.

```
Pane 1 (reference)              Pane 2 (diff)
─────────────────               ─────────────────
Line A  [white]                 Line A  [white]
Line B  [white]                 Line B  [white]
Line C  [red - deleted]         [ghost - blank]
Line D  [red - deleted]         [ghost - blank]
Line E  [white]                 Line E  [white]
[ghost - blank]                 Line F  [yellow - added]
[ghost - blank]                 Line G  [yellow - added]
Line H  [white]                 Line H  [white]
```

Ghost lines have a subtle background (`rgba(128,128,128,0.04)`) and no line number — they are visual padding only.

### Horizontal Scrolling

Horizontal scrolling is **independent per pane**. If a line exceeds the pane's visible width, the user can scroll that pane horizontally without affecting other panes. Vertical alignment remains strictly locked regardless of horizontal scroll position.

### Outline Sidebar (Diff Map)

A narrow vertical strip (~20px) on the **far right edge of the window** provides a minimap-style overview of all diffs across the full prompt length:

```
┌──┐
│  │  ← white (identical)
│  │
│██│  ← red block (deleted chunk)
│  │
│▓▓│  ← yellow block (added chunk)
│  │
│  │  ← white
│██│  ← red block
│  │
└──┘
```

- Red blocks represent deleted regions, yellow blocks represent added regions
- Block height is proportional to the number of diff lines relative to total prompt length
- **Clicking a block** performs a **global jump** — instantly scrolls all panes to that point of divergence
- The current viewport position is shown as a semi-transparent overlay rectangle on the sidebar
- The sidebar reflects the diff between the **last two panes** (rightmost pair). If only one pane is open, the sidebar is hidden.

## Cross-Entry Comparison

The tree includes **all transcript entries** from the current debate (not just the selected one). This enables comparing:

- **Same stage, different entries:** How did the PLAN prompt change from S7 to S10?
- **Different stages, same entry:** How does BRIEF differ from DRAFT within S7?
- **Retry comparison:** How did DRAFT Turn 1 differ from DRAFT Turn 2 after validation failure?

## Window Behavior

### Popout Window

- **Electron:** New `BrowserWindow` via IPC (`openPromptDiffWindow`). Resizable, can be fullscreened (F11 or title bar button). Minimum size: 900×600.
- **Web:** `window.open()` with toolbar=no. Falls back to a full-page route (`#prompt-diff`) if popups blocked.

### State

- Window receives the debate ID and initially selected entry ID
- Loads debate data independently (from store or IPC)
- Closing the window has no effect on the main Diagnostics view

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `1-4` | Focus pane N |
| `Ctrl+W` | Close focused pane |
| `F11` | Toggle fullscreen |
| `Ctrl+S` | Toggle synchronized vertical scrolling |
| `↑/↓` | Navigate tree (when tree focused) / Scroll vertically (when pane focused) |
| `Enter` | Add selected tree node to next pane |
| `Ctrl+G` | Jump to next diff block (scrolls all panes) |
| `Ctrl+Shift+G` | Jump to previous diff block |

## Status Bar (Bottom)

Shows:
- Number of prompts loaded
- Diff chain description: "Pane 2 vs Pane 1, Pane 3 vs Pane 2"
- Sync scroll indicator: "Scroll sync: ON/OFF"

## Data Source

```typescript
// Per transcript entry, get all stage prompts:
const stages = debate.diagnostics?.entries[entryId]?.stage_diagnostics ?? [];

// Group by stage, ordered by pipeline sequence:
const stageOrder = ['brief', 'plan', 'evidence', 'draft', 'cite'];
const grouped = stageOrder.map(stage => ({
  stage,
  attempts: stages.filter(s => s.stage === stage),
})).filter(g => g.attempts.length > 0);

// Each attempt has:
// - attempt.prompt: string (the raw prompt)
// - attempt.raw_response: string
// - attempt.model: string
// - attempt.temperature: number
// - attempt.response_time_ms: number
// - attempt.stage_validation?: { pass: boolean; hints: string[] }
```

## File Changes

| File | Change |
|------|--------|
| `taxonomy-editor/src/renderer/components/PromptDiffWindow.tsx` | New component — the popout window content |
| `taxonomy-editor/src/renderer/components/PromptDiffTree.tsx` | New component — tree view |
| `taxonomy-editor/src/renderer/components/PromptDiffPane.tsx` | New component — individual prompt pane with diff rendering |
| `taxonomy-editor/src/renderer/lib/lineDiff.ts` | New utility — line-level LCS diff algorithm |
| `taxonomy-editor/src/renderer/components/DiagnosticsWindow.tsx` | Add "Prompt Diff" button to entry detail header |
| `taxonomy-editor/src/main/ipcHandlers.ts` | Add `open-prompt-diff-window` IPC handler (Electron) |
| `taxonomy-editor/src/main/preload.ts` | Expose `openPromptDiffWindow` bridge method |

## Edge Cases

- **No stage_diagnostics:** Entry shows in tree but greyed out, not expandable
- **Single prompt:** No diff coloring (only one pane, it's the reference)
- **Very long prompts (>5000 lines):** Virtual scrolling for performance. Only render visible lines.
- **Identical prompts:** All lines white, diff stats show "+0 / -0"
- **Closing middle pane:** Panes to the right re-diff against their new left neighbor
- **4 panes open + click new:** Replaces rightmost pane, re-diffs
