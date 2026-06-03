# Responsive Layout — Design Spec

**Ticket:** t/356
**Author:** Design (Orca)
**Status:** Ready for implementation

## Overview

Adapt the Taxonomy Editor for mobile (phone) and tablet (iPad) viewports. The current layout assumes 1200px+ width with a multi-pane horizontal arrangement. This spec defines breakpoints, a detection mechanism, and per-breakpoint layouts for POV taxonomy browsing (Phase 1) and debates/diagnostics (Phase 2).

## Breakpoints

| Name | Range | Targets | Layout mode |
|---|---|---|---|
| `phone` | 0 – 479px | iPhone SE, standard phones | Single column, stacked |
| `phone-lg` | 480 – 767px | iPhone Pro Max, large phones | Single column, wider cards |
| `tablet` | 768 – 1023px | iPad portrait, small tablets | Two column (list + detail) |
| `tablet-lg` | 1024 – 1199px | iPad landscape, iPad Pro portrait | Near-desktop, narrower panes |
| `desktop` | 1200px+ | Current target | No change — existing layout |

## Detection Mechanism

### Primary: CSS media queries

All layout shifts driven by standard `@media (max-width: ...)` queries. No User-Agent sniffing — it's fragile and unnecessary when the layout is viewport-driven.

```css
/* Phone */
@media (max-width: 479px) { ... }

/* Phone large */
@media (max-width: 767px) { ... }

/* Tablet */
@media (max-width: 1023px) { ... }

/* Tablet large */
@media (max-width: 1199px) { ... }
```

### Secondary: JS hook for behavior changes

A `useBreakpoint()` hook exposes the current breakpoint to React components for conditional rendering (not just styling).

```ts
type Breakpoint = 'phone' | 'phone-lg' | 'tablet' | 'tablet-lg' | 'desktop';

function useBreakpoint(): Breakpoint;
```

**Implementation:** Uses `window.matchMedia` with listeners. Returns the current breakpoint name. Updates on resize. Debounce at 100ms to avoid thrashing during resize.

```ts
const BREAKPOINTS: [Breakpoint, string][] = [
  ['phone',     '(max-width: 479px)'],
  ['phone-lg',  '(max-width: 767px)'],
  ['tablet',    '(max-width: 1023px)'],
  ['tablet-lg', '(max-width: 1199px)'],
];

export function useBreakpoint(): Breakpoint {
  // Match first query that hits; default to 'desktop'
  // Listen to all MediaQueryList change events
  // Return current breakpoint
}
```

**Where to use JS vs CSS:**
- **CSS** for layout, spacing, visibility, grid changes — anything declarative
- **JS** for navigation mode (push vs. side-by-side), conditional component rendering (e.g., render bottom nav only on phone), swipe gesture binding

### Touch detection

Expose a `useIsTouchDevice()` hook alongside breakpoints:

```ts
function useIsTouchDevice(): boolean;
// Uses (pointer: coarse) media query — reliable for touch primary devices
```

Use this for touch-specific behaviors (swipe gestures, larger drag handles) independent of viewport width.

### CSS custom property for breakpoint (optional)

Set `--breakpoint` on `<html>` from JS so CSS can read it. Useful for container-query-like patterns where nested components need breakpoint awareness without media queries:

```css
html[data-breakpoint="phone"] .toolbar { display: none; }
```

This mirrors the existing `data-theme` pattern.

## Phase 1: POV Taxonomy Browsing

### Phone (0 – 767px) — Single column, push navigation

The multi-pane layout collapses to a single full-width column. Navigation uses a stack (push/pop) instead of side-by-side panes.

#### Screen 1: POV List

```
┌──────────────────────────┐
│ ☰  Taxonomy Editor       │  ← hamburger replaces toolbar
├──────────────────────────┤
│ Acc │ *Saf* │ Skp        │  ← POV tabs (full width, scrollable)
├──────────────────────────┤
│  Sort: ID ▾    + New     │  ← compact header row
├──────────────────────────┤
│ ▼ DESIRES (87)           │
│   saf-desires-001        │
│   Ensuring Fiduciary     │
│   Oversight of Auto...   │
│                          │
│   saf-desires-002        │
│   Standardized Trans...  │
│                          │
│ ▶ INTENTIONS (119)       │
│ ▶ BELIEFS (110)          │
├──────────────────────────┤
│  🔍   📋   ⚙️           │  ← bottom nav bar (search, list, settings)
└──────────────────────────┘
```

**Key decisions:**
- Toolbar icons move to a **hamburger menu** (top-left) and a **bottom navigation bar** (3-4 key actions)
- POV tabs remain horizontal — 3 tabs fit on any phone width
- Category groups use the existing accordion/collapsible pattern
- Node items show truncated label (2 lines max) + node ID
- Tapping a node **pushes** the detail view (Screen 2)

#### Screen 2: Node Detail (pushed)

```
┌──────────────────────────┐
│ ← Back    saf-desires-001│  ← back button + node ID
├──────────────────────────┤
│ Ensuring Fiduciary       │
│ Oversight of Autonomous  │
│ Systems                  │  ← nd-header-label (full width)
├──────────────────────────┤
│ Content │ Attr │ Related │  ← detail tabs (scrollable)
├──────────────────────────┤
│                          │
│ Description:             │
│ A Belief in the intel... │
│                          │
│ (scrollable content)     │
│                          │
│                          │
├──────────────────────────┤
│  🔍   📋   ⚙️           │  ← bottom nav persists
└──────────────────────────┘
```

**Key decisions:**
- **Back button** in header returns to list (pop navigation)
- Detail tabs become horizontally scrollable if they overflow
- Content area gets full viewport width — much more readable than the current narrow pane
- No resize handles on mobile

### Tablet (768 – 1023px) — Two column

```
┌─────────────────────────────────────────┐
│ ☰  Taxonomy Editor                      │
├──────────────┬──────────────────────────┤
│ Acc *Saf* Skp│                          │
├──────────────┤  Node Detail             │
│ Sort ▾ + New │                          │
├──────────────┤  Ensuring Fiduciary      │
│ ▼ DESIRES    │  Oversight of Auto...    │
│  saf-des-001 │                          │
│  saf-des-002 │  Content│Attr│Related    │
│ ▶ INTENTIONS │ ─────────────────────────│
│ ▶ BELIEFS    │  Description:            │
│              │  A Belief in the intel...│
│              │                          │
├──────────────┴──────────────────────────┤
│  🔍   📋   🔬   ⚙️                     │
└─────────────────────────────────────────┘
```

**Key decisions:**
- **Two columns:** list (35% width, min 260px) + detail (65%)
- Toolbar collapses to hamburger — icon rail is too narrow to be useful on touch
- Bottom nav bar provides quick access to key functions
- Resize handle hidden — fixed proportions on tablet
- POV tabs sit above the list column only

### Tablet Landscape (1024 – 1199px) — Near-desktop

Same as current desktop layout but:
- Toolbar narrows to 38px (reuses existing `@media (max-height: 700px)` compact style)
- Default pane widths adjusted: list 280px, detail fills remainder
- No pane 3 by default — opens as overlay/modal instead of inline

## Phase 2: Debates and Diagnostics

### Debate List — Phone

```
┌──────────────────────────┐
│ ← POV   Debates          │
├──────────────────────────┤
│ ┌────────────────────┐   │
│ │ AI Code as Debt    │   │
│ │ DEBATE  May 25     │   │
│ │ Industry Leaders   │   │
│ └────────────────────┘   │
│ ┌────────────────────┐   │
│ │ Alignment Tax      │   │
│ │ CLOSED  May 22     │   │
│ │ Policymakers       │   │
│ └────────────────────┘   │
│                          │
├──────────────────────────┤
│  🔍   📋   ⚙️           │
└──────────────────────────┘
```

**Key decisions:**
- Debate items become **cards** with title, phase badge, date, and audience stacked vertically
- Tap pushes to debate detail (full screen)

### Debate Detail — Phone

```
┌──────────────────────────┐
│ ← Back   AI Code as Debt │
├──────────────────────────┤
│ Topic                    │
│ For an established       │
│ consumer software team...│
├──────────────────────────┤
│ Debaters                 │
│ 🔴 Safetyist  🟢 Accel  │
│ 🟡 Skeptic               │
├──────────────────────────┤
│ Stats                    │
│ 12 Turns  8 Args  6 Rel │
├──────────────────────────┤
│ Conversation             │  ← scrollable
│ ┌ Prometheus ──────────┐ │
│ │ The innovation...    │ │
│ └──────────────────────┘ │
│ ┌ Sentinel ────────────┐ │
│ │ While the speed...   │ │
│ └──────────────────────┘ │
├──────────────────────────┤
│  🔍   💬   📊   ⚙️      │
└──────────────────────────┘
```

**Key decisions:**
- Sections stack vertically (existing 2-column grid already has `@media (max-width: 900px)` → single column)
- Chat-bubble style statement cards work well on narrow viewports — no redesign needed
- Bottom nav adds context-specific actions: conversation, diagnostics toggle

### Debate Detail — Tablet

Two-column: debate session list on left (30%), detail/conversation on right (70%). Same as desktop but without pane 3 inline — diagnostics opens as a bottom drawer.

### Diagnostics — Phone

The CSS grid claim rows (from t/122) cannot fit on a phone-width screen. Reformat as **stacked cards**:

```
┌──────────────────────────┐
│ AN-1                     │
│ Skeptic · Belief         │
│ ● skp-beliefs-030  0.59  │
│ ● Very Weak 0.13  -0.30  │
│ 2 edges                  │
├──────────────────────────┤
│ The innovation-diffusion │
│ lag proves that...       │
└──────────────────────────┘
```

**Key decisions:**
- Each claim becomes a vertical card instead of a grid row
- ID is the card header, metadata stacks below
- Colored dots (from the desktop design) still convey strength/confidence
- Claim text shown below metadata
- Expand/collapse for attack/support details works the same

### Diagnostics — Tablet

Use the desktop grid layout but with narrower columns and horizontal scroll if needed. The grid already handles this reasonably at 768px+.

## Touch Targets and Accessibility

| Element | Current size | Mobile minimum | Change needed |
|---|---|---|---|
| Toolbar icons | 36x36px | 44x44px | Yes — enlarge on touch devices |
| Tab bar buttons | ~36px height | 44px | Yes — increase padding |
| Node list items | ~40px height | 48px | Yes — increase padding |
| Sort select | ~24px height | 44px | Yes — larger on mobile |
| Collapse arrows | ~20px | 44px | Yes — larger tap target |
| Bottom nav items | N/A (new) | 48x48px | New component |

Apply touch target increases only inside `@media (pointer: coarse)` so desktop mouse users retain compact sizing.

## Bottom Navigation Bar

New component for phone/tablet viewports. Replaces the toolbar icon rail.

```
┌─────────────────────────────────────────┐
│  🔍 Search   📋 List   🔬 Diag   ⚙️   │
│              (active)                   │
└─────────────────────────────────────────┘
```

- Fixed to viewport bottom
- 48px height, safe-area-inset-bottom padding for notched devices
- 3-4 icons with labels
- Active state: POV accent color
- Context-sensitive: different items on debate tab vs. taxonomy tab

**CSS:**
```css
.bottom-nav {
  display: none; /* hidden on desktop */
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 48px;
  padding-bottom: env(safe-area-inset-bottom);
  background: var(--bg-secondary);
  border-top: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-around;
  z-index: 100;
}

@media (max-width: 1023px) {
  .bottom-nav { display: flex; }
  .toolbar { display: none; }
  .app-body { padding-bottom: calc(48px + env(safe-area-inset-bottom)); }
}
```

## Hamburger Menu

On phone/tablet, the toolbar icon rail hides. A hamburger button (top-left) opens a slide-out drawer containing all toolbar actions:

```
┌────────────────┐
│ ✕ Close        │
├────────────────┤
│ 🔍 Search      │
│ 🗺️ Graph View  │
│ ✂️ Cross-Cut   │
│ ⚠️ Warnings    │
│ ⊕ Enrich       │
│ 📄 Documents   │
│ 🏛️ Lineage     │
│ 📌 Pinned      │
│ ⋯ More         │
├────────────────┤
│ ⚙️ Settings    │
└────────────────┘
```

- Slide-in from left, 280px width
- Overlay with semi-transparent backdrop
- Swipe-left to dismiss (touch devices)

## Navigation Model

### Desktop (current)
Side-by-side panes. Click list item → detail appears in adjacent pane.

### Phone
**Push/pop stack.** Tap list item → full-screen detail pushes onto stack. Back button pops. This mirrors native mobile app patterns.

Implementation: a `useMobileNav()` hook managing a view stack:
```ts
type ViewStack = Array<{ view: 'list' | 'detail' | 'debate' | 'diagnostics'; id?: string }>;

function useMobileNav(): {
  stack: ViewStack;
  push: (view: ViewStackEntry) => void;
  pop: () => void;
  current: ViewStackEntry;
};
```

Active only when `useBreakpoint()` returns `phone` or `phone-lg`. On tablet+, the existing side-by-side rendering is used.

### Swipe Gestures (phone only)

- **Swipe right** on detail view → pop back to list
- **Swipe left/right** on POV tabs → switch POV

Use `(pointer: coarse)` media query to enable touch listeners. Threshold: 50px horizontal, <30px vertical to distinguish from scroll.

## Integration Points

| File | Change |
|---|---|
| `styles.css` | Add `@media` blocks for each breakpoint; bottom nav styles; hamburger menu styles |
| New: `hooks/useBreakpoint.ts` | Breakpoint detection hook |
| New: `hooks/useMobileNav.ts` | Push/pop navigation stack for phone |
| New: `hooks/useIsTouchDevice.ts` | Touch device detection |
| New: `components/BottomNav.tsx` | Bottom navigation bar |
| New: `components/HamburgerMenu.tsx` | Slide-out toolbar replacement |
| `App.tsx` | Set `data-breakpoint` attribute; conditionally render bottom nav and hamburger |
| `PovTab.tsx` | Use `useMobileNav()` for list→detail navigation on phone |
| `DebateTab.tsx` | Same push/pop navigation |
| `DiagnosticsWindow.tsx` | Stacked card layout for phone breakpoint |

## What NOT to do

- No CSS framework (Tailwind, Bootstrap) — use existing custom properties + media queries
- No separate mobile build — single codebase, responsive
- No User-Agent detection — media queries are the source of truth
- No mobile-only features — same functionality, adapted layout
- Don't break existing desktop layout — all changes gated behind media queries or breakpoint checks
