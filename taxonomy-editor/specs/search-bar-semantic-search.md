# Feature Spec: Persistent Search Bar with Semantic Search Mode

**Author:** Claude Opus 4.6 + jsnov
**Date:** 2026-02-23
**Status:** Draft

---

## 1. Overview

Two changes:

1. **Convert the Find dialog into a persistent search bar** docked at the top of the app (below the tab bar), always visible, replacing the current floating overlay toggled by Ctrl+F.
2. **Add a "Semantic" search mode** alongside the existing Raw/Wildcard/Regex modes. Semantic mode lets users type a natural-language sentence, converts it to an embedding vector, and returns taxonomy entries ranked by cosine similarity.

---

## 2. Search Bar Layout

### Current state

`FindBar` renders as a `position: fixed` overlay (`find-overlay`) floating top-right at `z-index: 90`. It is toggled on/off by Ctrl+F and has no allocated space in the document flow.

### Target state

The search bar becomes a **permanent flex child** in the App layout between `<TabBar />` and `<div className="tab-content">`. It is always visible — no toggle required. Ctrl+F focuses the input field instead of showing/hiding.

```
┌─────────────────────────────────────────────────────┐
│  TabBar (Acc | Saf | Skp | CC | Conflicts | theme)  │
├─────────────────────────────────────────────────────┤
│  SearchBar  [input...] [mode ▾] [scope chips] [n ↑↓] │
├─────────────────────────────────────────────────────┤
│  tab-content (list-panel | detail | pinned-panels)  │
├─────────────────────────────────────────────────────┤
│  SaveBar                                            │
└─────────────────────────────────────────────────────┘
```

### Specific changes

| Element | Current | Target |
|---------|---------|--------|
| Container | `position: fixed; top: 44px; right: 16px` (overlay) | `position: static` as flex row in App flow |
| Visibility | Toggled by Ctrl+F, hidden by Escape/×  | Always visible; Ctrl+F focuses input |
| Close button (×) | Hides entire bar | Clears the input field only |
| Results panel | Dropdown within overlay | Slides down beneath the search bar, pushing `tab-content` down |
| Height | Auto (floating, doesn't affect layout) | Compact single row (~40px); expands when results panel is open |

### CSS class rename

`find-overlay` → `search-bar`. All child classes keep their `find-` prefix (e.g. `find-row`, `find-input`) to minimize churn. Add:

```css
.search-bar {
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  padding: 6px 16px;
  flex-shrink: 0;
}
```

Remove `position`, `top`, `right`, `z-index`, `border-radius`, `box-shadow`, `min-width` from the old `find-overlay` rule.

### App.tsx render order

```tsx
<div className="app">
  <TabBar />
  <SearchBar />          {/* renamed from FindBar */}
  <div className="tab-content">…</div>
  <SaveBar />
</div>
```

### Keyboard behavior

| Key | Current | Target |
|-----|---------|--------|
| Ctrl+F | Toggle visibility | Focus input (bar always visible) |
| Escape (input focused) | Hide bar + clear query | Blur input + clear query |
| Enter / Shift+Enter | Navigate results | Same |

---

## 3. Semantic Search Mode

### 3.1 Mode selector

The existing `<select>` (Raw / Wildcard / Regex) gains a fourth option:

```
Raw | Wildcard | Regex | Semantic
```

The `SearchMode` type in `useTaxonomyStore.ts` becomes:

```ts
export type SearchMode = 'raw' | 'wildcard' | 'regex' | 'semantic';
```

When Semantic mode is active:
- The **Case sensitive** checkbox is hidden (not applicable).
- The **POV scope** and **Aspect scope** chip filters remain available and work the same way (they pre-filter which taxonomy entries are candidates).
- The input placeholder changes to `"Describe what you're looking for…"`.
- Search is triggered on **Enter** (not on every keystroke) to avoid excessive API calls. A debounced fallback (800ms) also triggers if the user stops typing.
- A small spinner replaces the result count while the embedding call is in-flight.

### 3.2 Embedding model

Use the **Anthropic Voyager embeddings** endpoint via the Claude API:

```
POST https://api.anthropic.com/v1/embeddings
```

Model: `voyage-3` (1024-dimensional output, 32k context).

Reason for choice: the taxonomy editor already lives in an Anthropic-ecosystem project; Voyage models are optimized for retrieval; 1024 dimensions balance quality and storage cost.

### 3.3 API key management

The API key is entered once and stored in Electron's `safeStorage`-encrypted store in the **main process**. A settings dialog (or first-run prompt) lets the user paste their key. The renderer never sees the raw key — all embedding calls go through IPC.

**New IPC channels:**

| Channel | Direction | Payload | Return |
|---------|-----------|---------|--------|
| `set-api-key` | renderer → main | `{ key: string }` | `void` |
| `has-api-key` | renderer → main | — | `boolean` |
| `compute-embeddings` | renderer → main | `{ texts: string[] }` | `{ vectors: number[][] }` |
| `compute-query-embedding` | renderer → main | `{ text: string }` | `{ vector: number[] }` |

**Main process module: `src/main/embeddings.ts`**

- Stores key via `safeStorage.encryptString()` → written to `userData/api-key.enc`.
- On `compute-embeddings`: calls Voyage API with `input_type: "document"`.
- On `compute-query-embedding`: calls Voyage API with `input_type: "query"`.
- Handles HTTP errors, rate limits (429 → retry with backoff), and returns structured errors to renderer.

### 3.4 Turning the taxonomy into embeddings

#### 3.4.1 What gets embedded

Every embeddable element produces **one text string** by concatenating its key fields with labeled separators. The goal is to give the embedding model full semantic context for each entry.

**PovNode** — one embedding per node:

```
[{pov}] {category}
ID: {id}
Label: {label}
Description: {description}
```

Example:
```
[accelerationist] Goals/Values
ID: acc-goals-001
Label: Abundance through AI
Description: The core accelerationist premise that rapid AI development
will create unprecedented abundance and solve scarcity problems...
```

**CrossCuttingNode** — one embedding per node:

```
[cross-cutting]
ID: {id}
Label: {label}
Description: {description}
Accelerationist interpretation: {interpretations.accelerationist}
Safetyist interpretation: {interpretations.safetyist}
Skeptic interpretation: {interpretations.skeptic}
```

**ConflictFile** — one embedding per conflict:

```
[conflict] Status: {status}
ID: {claim_id}
Claim: {claim_label}
Description: {description}
Notes: {human_notes[*].note joined by " | "}
```

Notes are included because they often contain the richest semantic content about the conflict. Instance `doc_id` and `position` are excluded — they are structural references, not semantic content.

#### 3.4.2 When embeddings are computed

Embeddings are computed **lazily on first semantic search** and cached in memory. The flow:

1. User switches to Semantic mode and submits a query.
2. Store checks `embeddingCache` (a `Map<string, number[]>` keyed by element ID).
3. If the cache is empty (first run) or stale, the store:
   a. Builds the text strings for all taxonomy elements (filtered by active scopes).
   b. Sends them to main process via `compute-embeddings` IPC in batches of 64 (Voyage batch limit is 128 but we stay conservative).
   c. Stores returned vectors in `embeddingCache`.
4. The query text is sent via `compute-query-embedding`.
5. Cosine similarity is computed renderer-side (pure math, no IPC needed).
6. Results are sorted by similarity descending.

#### 3.4.3 Cache invalidation

The cache is invalidated when:

- Any taxonomy mutation occurs (any call to `updatePovNode`, `updateCrossCuttingNode`, `updateConflict`, or any create/delete operation). These already go through the Zustand store, so invalidation is a single `set({ embeddingCache: new Map() })` call appended to each mutator.
- The app reloads (`loadAll` clears the cache).

This is intentionally coarse-grained. The taxonomy is small (dozens to low hundreds of entries); recomputing all embeddings after an edit costs one API call and takes 1-2 seconds. Fine-grained per-node invalidation adds complexity for negligible benefit at this scale.

#### 3.4.4 Embedding storage in store

New state fields in `TaxonomyState`:

```ts
embeddingCache: Map<string, number[]>;     // id → vector
embeddingDirty: boolean;                   // true when taxonomy changed since last embed
embeddingLoading: boolean;                 // true while API call in-flight
```

These are **transient** (memory-only). Embeddings are not persisted to disk. At ~1024 floats × ~100 entries × 4 bytes = ~400KB, recomputing on app start is cheaper than managing a persistent cache file and its invalidation.

### 3.5 Similarity search algorithm

Computed entirely in the renderer process (no IPC for the math):

```ts
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

Results display:
- **Threshold:** Only show results with similarity ≥ 0.3 (tunable constant).
- **Max results:** 25.
- **Sort:** Descending by similarity score.
- **Display:** Each result row shows the similarity score as a percentage badge (e.g. `87%`) to the right of the result ID, replacing the field-match snippet used by text modes.
- **Navigation:** Clicking a result still calls `setActiveTab` + `setSelectedNodeId` to navigate to the item.

### 3.6 UI differences by mode

| Feature | Raw/Wildcard/Regex | Semantic |
|---------|-------------------|----------|
| Search trigger | On every keystroke | On Enter or 800ms debounce |
| Case sensitive checkbox | Visible | Hidden |
| Scope chips (POV/Aspect) | Pre-filter results | Pre-filter which entries are embedded & searched |
| Result count text | `"12 found"` | `"8 matches"` (only those above threshold) |
| Result row detail | Field name + highlighted match text | Similarity percentage badge |
| In-field highlighting | Yellow `<mark>` overlays in detail forms | None (not applicable to semantic) |
| Loading state | Instant | Spinner while computing embeddings |

### 3.7 No-API-key state

If the user selects Semantic mode but has no API key configured:

- The input field shows a disabled placeholder: `"API key required for semantic search"`.
- A small "Configure" link appears next to the mode selector, opening the API key dialog.
- The other three modes remain fully functional.

---

## 4. New Files

| File | Purpose |
|------|---------|
| `src/main/embeddings.ts` | API key storage, Voyage API calls, batch embedding |
| `src/main/apiKeyStore.ts` | `safeStorage` encrypt/decrypt for the API key |
| `src/renderer/utils/similarity.ts` | `cosineSimilarity()`, `rankBySimilarity()` |
| `src/renderer/components/ApiKeyDialog.tsx` | Modal for entering/updating the Voyage API key |

## 5. Modified Files

| File | Change |
|------|--------|
| `src/renderer/components/FindBar.tsx` | Rename to `SearchBar.tsx`; convert from overlay to static bar; add semantic mode branch |
| `src/renderer/App.tsx` | Replace `<FindBar />` with `<SearchBar />`; remove conditional rendering |
| `src/renderer/hooks/useTaxonomyStore.ts` | Add `SearchMode: 'semantic'`; add `embeddingCache`, `embeddingDirty`, `embeddingLoading` state; invalidation in mutators |
| `src/renderer/styles.css` | Replace `find-overlay` with `search-bar`; add semantic-specific styles (spinner, score badge) |
| `src/main/ipcHandlers.ts` | Register embedding + API key IPC channels |
| `src/main/preload.ts` | Expose `computeEmbeddings`, `computeQueryEmbedding`, `setApiKey`, `hasApiKey` |

---

## 6. Verification Checklist

### Search bar conversion
- [ ] Bar is visible on app launch without pressing Ctrl+F
- [ ] Ctrl+F focuses the search input
- [ ] Escape blurs input and clears query (does not hide bar)
- [ ] Results panel expands below bar, pushing tab-content down
- [ ] Raw/Wildcard/Regex modes work identically to current behavior
- [ ] POV and Aspect scope chips work as before

### Semantic search
- [ ] Selecting "Semantic" hides the Case sensitive checkbox
- [ ] First semantic query shows a loading spinner while embeddings compute
- [ ] Results are sorted by similarity score descending
- [ ] Results below 0.3 threshold are excluded
- [ ] Clicking a semantic result navigates to the correct tab + node
- [ ] Editing a taxonomy node invalidates the embedding cache
- [ ] Second semantic query (no edits) reuses cached embeddings (no spinner)
- [ ] API key dialog appears when selecting Semantic without a key configured
- [ ] API errors surface as a non-blocking error message in the search bar

### Build
- [ ] `npx tsc --noEmit` — clean
- [ ] `npx vite build` — clean
- [ ] Electron `npm run dev` — launches and renders search bar
