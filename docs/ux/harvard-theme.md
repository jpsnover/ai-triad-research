# Harvard Theme — Design Spec

**Last updated:** 2026-05-23
**Author:** Design (Orca)
**Status:** Ready for implementation

## Overview

A theme inspired by the Harvard Business School Baker Library visual identity. The palette centers on **Harvard Crimson** as the accent color, with warm ivory and cream surfaces replacing the cool blue-grays of the default light theme. The result is an academic, high-contrast, warm-toned theme suited to a research tool.

**Reference:** https://www.library.hbs.edu/

## Design Rationale

| Decision | Rationale |
|---|---|
| Crimson accent (#A51C30) | Official Harvard crimson — used for links, focus rings, and primary interactive elements |
| Warm ivory surfaces (#FAF8F5, #F3F0EB) | Matches the cream/parchment feel of Baker Library; reduces eye strain during long research sessions |
| Charcoal text (#1C1C1C) | High contrast on warm backgrounds; avoids pure black which feels harsh on ivory |
| Muted gold highlight (#D4A843) | Complements crimson; evokes Harvard's secondary gold identity color |
| Restrained palette | Academic tools prioritize readability — only crimson and gold add color; everything else is neutral |

## Color Palette

### Brand Colors
| Token | Hex | Usage |
|---|---|---|
| Harvard Crimson | `#A51C30` | Primary accent, links, focus ring |
| Crimson Dark | `#8C1A28` | Hover states, active elements |
| Crimson Light | `#C53B4A` | Lighter variant for secondary accents |
| Harvard Gold | `#D4A843` | Search highlights, secondary accent |
| Harvard Black | `#1C1C1C` | Primary text |

### POV Colors (adjusted for warm-surface contrast)
| POV | Hex | Notes |
|---|---|---|
| Accelerationist | `#2D6A4F` | Deep forest green — good contrast on ivory |
| Safetyist | `#A51C30` | Harvard crimson — natural fit |
| Skeptic | `#B8860B` | Dark goldenrod — warm, distinct from gold highlights |
| Situationist | `#5B2C87` | Deep purple — high contrast on warm tones |
| Conflicts | `#6B705C` | Warm gray-olive — neutral but warm |

### Category Accents
| Category | Hex |
|---|---|
| Desires | `#1B7A6D` |
| Beliefs | `#2B5797` |
| Intentions | `#7B3F9E` |

### Surfaces
| Token | Hex | Usage |
|---|---|---|
| `--bg-primary` | `#FAF8F5` | Main background — warm ivory |
| `--bg-secondary` | `#F3F0EB` | Secondary panels — slightly darker cream |
| `--bg-panel` | `#E5DFD6` | Panel headers, sidebar backgrounds |
| `--bg-input` | `#FFFFFF` | Input fields — white for clarity |
| `--bg-hover` | `#EDE8E0` | Hover state on rows/items |

### Text
| Token | Hex | Usage |
|---|---|---|
| `--text-primary` | `#1C1C1C` | Body text, headings |
| `--text-secondary` | `#4A4541` | Secondary text, labels |
| `--text-muted` | `#8A8278` | Placeholder text, disabled items |
| `--border-color` | `#D6CFC5` | Borders, dividers |

### Category Detail Backgrounds
| Token | Hex |
|---|---|
| `--bg-detail-desires` | `#F0F7F5` |
| `--bg-detail-beliefs` | `#EFF3FA` |
| `--bg-detail-intentions` | `#F5F0F8` |

### Semantic
| Token | Hex |
|---|---|
| `--danger` | `#C53B4A` |
| `--success` | `#2D6A4F` |
| `--focus-ring` | `#A51C30` |

### Search Highlight
| Token | Value |
|---|---|
| `--hl-mark-bg` | `rgba(212, 168, 67, 0.35)` |
| `--hl-mark-color` | `#6B4E0A` |

### Scrollbar
| Token | Hex |
|---|---|
| `--scrollbar-track` | `#F3F0EB` |
| `--scrollbar-thumb` | `#C9C1B5` |
| `--scrollbar-thumb-hover` | `#8A8278` |

### Dialog & Chip
| Token | Value |
|---|---|
| `--dialog-shadow` | `rgba(28, 28, 28, 0.18)` |
| `--chip-bg` | `#E5DFD6` |

## Typography Notes

No font changes — the theme inherits the existing system font stack. The warm surface colors and crimson accents carry the Harvard identity without requiring a custom typeface. If a future iteration adds serif headings (e.g., for a more classical academic feel), Georgia or a similar serif would be appropriate.

## Accessibility

- All text colors meet WCAG AA contrast on their respective backgrounds:
  - `#1C1C1C` on `#FAF8F5` → ratio ~16.5:1 (AAA)
  - `#4A4541` on `#FAF8F5` → ratio ~8.2:1 (AAA)
  - `#8A8278` on `#FAF8F5` → ratio ~3.8:1 (AA for large text)
- Crimson accent `#A51C30` on ivory → ~5.8:1 (AA)
- Focus ring uses full crimson for clear visibility

## CSS Variable Block

```css
[data-theme="harvard"] {
  /* POV colors */
  --color-acc: #2D6A4F;
  --color-saf: #A51C30;
  --color-skp: #B8860B;
  --color-sit: #5B2C87;
  --color-conflicts: #6B705C;

  /* Category accent colors */
  --cat-desires: #1B7A6D;
  --cat-beliefs: #2B5797;
  --cat-intentions: #7B3F9E;

  /* Surfaces */
  --bg-primary: #FAF8F5;
  --bg-secondary: #F3F0EB;
  --bg-panel: #E5DFD6;
  --bg-input: #FFFFFF;
  --bg-hover: #EDE8E0;

  /* Text */
  --text-primary: #1C1C1C;
  --text-secondary: #4A4541;
  --text-muted: #8A8278;
  --border-color: #D6CFC5;

  /* Category detail backgrounds */
  --bg-detail-desires: #F0F7F5;
  --bg-detail-beliefs: #EFF3FA;
  --bg-detail-intentions: #F5F0F8;

  /* Search highlight */
  --hl-mark-bg: rgba(212, 168, 67, 0.35);
  --hl-mark-color: #6B4E0A;

  /* Semantic */
  --danger: #C53B4A;
  --success: #2D6A4F;
  --focus-ring: #A51C30;

  /* Scrollbar */
  --scrollbar-track: #F3F0EB;
  --scrollbar-thumb: #C9C1B5;
  --scrollbar-thumb-hover: #8A8278;

  /* Dialog overlay */
  --dialog-shadow: rgba(28, 28, 28, 0.18);

  /* Chip */
  --chip-bg: #E5DFD6;
}
```

## Integration Points

The following files need changes to wire up the theme (work for **Taxonomy Editor** coding agent):

1. **`taxonomy-editor/src/renderer/styles.css`** — Add the `[data-theme="harvard"]` block above (after the `[data-theme="bkc"]` block, before the `*` reset rule)

2. **`taxonomy-editor/src/renderer/hooks/useTaxonomyStore.ts`**
   - Line 55: Update `ColorScheme` type to include `'harvard'`:
     ```ts
     export type ColorScheme = 'light' | 'dark' | 'bkc' | 'harvard' | 'system';
     ```
   - Line 241: Update `getStoredTheme()` validation:
     ```ts
     if (stored === 'light' || stored === 'dark' || stored === 'bkc' || stored === 'harvard' || stored === 'system') return stored;
     ```

3. **`taxonomy-editor/src/renderer/components/SettingsDialog.tsx`**
   - Line 257: Add option after BKC:
     ```tsx
     <option value="harvard">Harvard</option>
     ```

No other files require changes — the popout windows (DebatePopoutWindow, PovProgressionWindow, DiagnosticsWindow) only handle `system` fallback to light/dark, which is unaffected.
