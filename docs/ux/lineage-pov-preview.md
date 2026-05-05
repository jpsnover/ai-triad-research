# Lineage View — POV Node Preview

**Status:** Spec ready for implementation
**Owner:** Design
**Implementer:** Taxonomy Editor

## Problem

In the Intellectual Lineage view, clicking a POV item in "Referenced By" calls `navigateToNode()`, which switches tabs entirely. The user loses their lineage research context with no way to peek at a POV node's details without leaving the view.

## Solution

Add an inline POV preview panel that follows the existing "See Also" secondary preview pattern — toggle on click, collapse on re-click, stay in the lineage view.

## Interaction

1. User clicks a POV item in "Referenced By" — toggles a **POV preview panel** below the existing sections
2. Clicked button gets active/selected style (solid background, matching See Also toggle)
3. Clicking the same button again collapses the preview
4. Clicking a different POV item switches the preview to that node

## POV Preview Panel Layout

```
┌──────────────────────────────────────────────────┐
│  Referenced By                        [Go to] [x]│
│  ┌─[ACC]─ Beliefs ─────────────────────────────┐ │
│  │ Teleological Progression of Complexity       │ │
│  └──────────────────────────────────────────────┘ │
│  acc-beliefs-042                                  │
│                                                   │
│  DESCRIPTION                                      │
│  The belief that technological evolution...       │
│                                                   │
│  STEELMAN VULNERABILITY                           │
│  While the teleological framing may...            │
│                                                   │
│  INTELLECTUAL LINEAGE                             │
│  Omega Point, Cosmic Evolution, ...               │
└───────────────────────────────────────────────────┘
```

### Panel Elements

| Element | Details |
|---------|---------|
| **Eyebrow** | "Referenced By" — muted, small text (matches See Also eyebrow) |
| **Header row** | POV badge (`pov-badge pov-badge-{pov}`) + Category badge + right-aligned action buttons |
| **Title** | `node.label` as h3 (matches `lineage-detail-secondary-title`) |
| **Node ID** | Muted text below title (e.g., `acc-beliefs-042`) |
| **Description** | Full `node.description` text |
| **Steelman Vulnerability** | Only render if `node.graph_attributes?.steelman_vulnerability` exists |
| **Intellectual Lineage** | Comma-separated values from `node.graph_attributes?.intellectual_lineage`. Each is a button — clicking one calls `setLineagePreviewValue()` to navigate the lineage graph |
| **"Go to" button** | Calls `navigateToNode(pov, id)` for full navigation |
| **"Close" button** | Collapses preview (`setRefPreviewNodeId(null)`) |

## State

```tsx
const [refPreviewNodeId, setRefPreviewNodeId] = useState<string | null>(null);
```

### Button toggle logic

```tsx
// Referenced By button onClick:
setRefPreviewNodeId(refPreviewNodeId === ref.id ? null : ref.id);

// Button class (active = solid, inactive = ghost):
className={`btn btn-sm${refPreviewNodeId === ref.id ? '' : ' btn-ghost'} lineage-ref-item`}
```

### Node lookup

```tsx
// Find node data from store by refPreviewNodeId
const refNode = refPreviewNodeId
  ? (() => {
      const state = useTaxonomyStore.getState();
      for (const p of POV_KEYS) {
        const found = state[p]?.nodes.find(n => n.id === refPreviewNodeId);
        if (found) return { ...found, pov: p };
      }
      return null;
    })()
  : null;
```

## Styling

- Reuse `lineage-detail-secondary` class (border-top separator, subtle background tint)
- Reuse `lineage-detail-section`, `lineage-detail-label`, `lineage-detail-text` for content sections
- POV badge: existing `pov-badge pov-badge-{pov}` classes
- Category badge: match existing category styling in NodeDetail header
- No new CSS required beyond minor additions

## Placement

Render the POV preview panel **after** `renderSeeAlso()` and `renderSecondary()` in the `renderLineagePreview()` function (PovTab.tsx ~line 401 and ~line 435).

## File Changes

- `taxonomy-editor/src/renderer/components/PovTab.tsx` — add `refPreviewNodeId` state, modify `renderReferencedBy()` button onClick, add `renderRefPreview()` function, call it in return JSX
