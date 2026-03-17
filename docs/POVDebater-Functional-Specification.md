# POVDebater — Functional Specification

**Version:** 1.0 Draft
**Date:** 2026-03-16
**Status:** Awaiting review

---

## 1. Executive Summary

### Product Vision

POVDebater is a structured debate module integrated into the Taxonomy Editor that creates a safe intellectual space for journalists and policy makers to explore contested AI topics through simulated multi-perspective dialogue. Three AI-powered debaters — grounded in the project's pre-built taxonomy of positions — argue organically while surfacing the specific taxonomy nodes that inform their reasoning.

### Core User Value

Users gain a rapid, interactive way to stress-test their understanding of a topic across ideological lines, without needing to find and read multiple sources themselves. The taxonomy grounding transforms abstract debate into navigable knowledge — every argument is traceable to a catalogued position.

### Success Metrics

| Metric | Target |
|--------|--------|
| Time from topic entry to first substantive exchange | < 90 seconds |
| % of POVer statements with at least one taxonomy citation | > 70% |
| Session resumption rate (users who return to a saved debate) | > 30% |
| Taxonomy Editor cross-navigation events per session | > 3 |

---

## 2. User Personas & Jobs-to-be-Done

### Primary Persona: The Policy Analyst

A mid-career professional evaluating AI governance proposals. Needs to quickly understand the strongest arguments for and against a position before writing a brief or recommendation.

**JTBD:** "Help me see the strongest version of each side so I can write a balanced analysis."

### Secondary Persona: The Journalist

A tech reporter preparing for an interview or article. Needs to anticipate counterarguments and understand where experts genuinely disagree vs. where disagreements are semantic.

**JTBD:** "Show me where the real fault lines are so I can ask better questions."

### POVer Names

| POV | Debater Name | Personality |
|-----|-------------|-------------|
| Accelerationist | **Prometheus** | Confident, forward-looking, frames risk as cost-of-inaction |
| Safetyist | **Sentinel** | Methodical, evidence-driven, frames progress as conditional-on-safeguards |
| Skeptic | **Cassandra** | Wry, pragmatic, challenges assumptions from both sides |
| User (optional) | **You** | Freeform, ungrounded, the human wildcard |

---

## 3. Information Architecture

### Integration into Taxonomy Editor

POVDebater lives as a new top-level tab ("Debate") alongside the existing five tabs (Accelerationist, Safetyist, Skeptic, Cross-Cutting, Conflicts).

```
TabBar
├── Accelerationist
├── Safetyist
├── Skeptic
├── Cross-Cutting
├── Conflicts
└── Debate          ← NEW
```

### Debate Tab Layout

The Debate tab uses a two-pane layout:

```
┌─────────────────────────────────────────────────────┐
│ [Session List]  │  [Debate Workspace]               │
│                 │                                     │
│ + New Debate    │  Phase indicator / topic bar        │
│                 │                                     │
│ Session 1       │  ┌──────────────────────────────┐  │
│ Session 2 (●)   │  │  Debate transcript            │  │
│ Session 3       │  │  (scrollable, selectable)      │  │
│                 │  │                                │  │
│                 │  │  [Statement cards with         │  │
│                 │  │   taxonomy indicators]         │  │
│                 │  │                                │  │
│                 │  └──────────────────────────────┘  │
│                 │                                     │
│                 │  ┌──────────────────────────────┐  │
│                 │  │  Action bar + input field      │  │
│                 │  └──────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

- **Left pane (Session List):** Resizable, lists saved/active debate sessions. 240px default, 180–400px range.
- **Right pane (Debate Workspace):** Flex-1, contains the active debate or a "Start a new debate" empty state.
- **Resize handle:** Same pattern as existing `useResizablePanel` hook.

---

## 4. Phase-by-Phase Feature Specifications

### Phase 1: Setup & Topic Refinement

#### 4.1.1 New Debate Dialog

- **What:** Modal dialog to configure a new debate session.
- **Why:** Lets the user select participants and seed the topic before committing.
- **How:** Triggered by "+ New Debate" button in session list. Fields:
  - **Topic** (required): textarea, placeholder "What should we debate?"
  - **Active POVers** (required): checkboxes for Prometheus, Sentinel, Cassandra. At least 2 must be selected.
  - **Participate as POVer** (optional): checkbox "I want to argue a position too"
  - **Start** button → creates session, enters Phase 1.
- **Edge cases:**
  - Only 1 POVer selected → disable Start, show inline hint "Select at least 2 perspectives"
  - Empty topic → disable Start

#### 4.1.2 Clarifying Questions Round

- **What:** Each active POVer submits 1–3 clarifying questions about the topic.
- **Why:** Sharpens the debate topic to avoid past-each-other arguments.
- **How:**
  1. System sends the topic + POVer persona + relevant taxonomy nodes to the LLM.
  2. Each POVer's questions appear as a card in the transcript, styled with the POVer's color.
  3. Below the questions, a unified answer field appears: "Answer their questions to sharpen the topic."
  4. User types answers (or skips with "Skip — start debating").
  5. System synthesizes a revised topic statement incorporating user's answers.
  6. Revised topic appears in an editable text block at the top. User can modify directly.
  7. User clicks "Let the debate begin" or "Another round of questions."
- **LLM call structure:**
  ```
  For each active POVer (parallel):
    System: You are {name}, the {pov} debater. Given the topic below,
            ask 1-3 clarifying questions that would help you make the
            strongest possible argument from your perspective.
    Context: {relevant taxonomy nodes for this POV}
    User topic: {topic text}
    → Output: JSON { questions: string[] }
  ```
- **Edge cases:**
  - LLM returns 0 questions → skip that POVer's card, proceed
  - User clicks "Let the debate begin" without answering → use original topic as-is
  - API failure → show retry button on the failed POVer's card; others proceed

#### 4.1.3 Topic Synthesis

- **What:** After user answers clarifying questions, system produces a refined topic statement.
- **Why:** Ensures all POVers debate the same precise question.
- **How:**
  ```
  System: Synthesize the original topic and the user's answers into a
          clear, specific debate topic statement. One to three sentences.
  Input: { original_topic, clarifying_questions_and_answers[] }
  → Output: { refined_topic: string }
  ```
  Displayed in an editable block. User can modify text directly before proceeding.

### Phase 2: Opening Statements

#### 4.2.1 Statement Order

- **What:** Each active POVer delivers an opening position statement in a deliberate order.
- **Why:** Order shapes the debate dynamic — letting the most constructive framing go first.
- **How:** Fixed order: Prometheus → Sentinel → Cassandra → You (if participating). Rationale: optimist frames the opportunity, safety responds with conditions, skeptic challenges both. User goes last with full context.
- **LLM call structure:**
  ```
  For each POVer (sequential — each sees prior statements):
    System: You are {name}. Deliver your opening statement on the topic.
            Ground your argument in your taxonomy positions but express
            them in your own voice — never quote taxonomy text directly.
            You have seen the prior opening statements (if any).
    Context: {taxonomy nodes for this POV + cross-cutting nodes}
    Prior statements: {statements so far}
    Topic: {refined topic}
    → Output: JSON {
        statement: string,
        taxonomy_refs: { node_id: string, relevance: string }[]
      }
  ```
- **Edge cases:**
  - User is participating → after AI statements, show input field for user's opening statement. No taxonomy grounding for user.
  - API failure mid-sequence → show error on that card with retry; prior statements remain visible.

### Phase 3: Main Debate Loop

#### 4.3.1 Action Bar

The action bar at the bottom of the debate workspace provides these controls:

| Action | UI Element | Behavior |
|--------|-----------|----------|
| Ask a question | Text input + Send button | User types question; all POVers or a selected one responds |
| Cross-respond | Button: "Respond to each other" | System selects optimal responder(s) and target(s) |
| Synthesis | Button: "Synthesize" | Generates agreement/disagreement summary |
| Probing questions | Button: "Suggest questions" | Generates 3–5 questions to advance debate |
| Fact check | Button (on selected text): "Fact check" | Checks selected statement against taxonomy + known claims |
| Save | Button: "Save" (always visible) | Persists session to disk |

#### 4.3.2 Ask a Question

- **What:** User directs a question to the panel or a specific POVer.
- **Why:** Core interaction — lets the user steer the debate.
- **How:**
  - Default: question goes to all active POVers. Each responds in sequence (Prometheus → Sentinel → Cassandra).
  - User can prefix with a name to target: `@Sentinel, what evidence supports that?` — only Sentinel responds.
  - User can include argumentative statements as part of their question (per requirements).
- **LLM call structure:**
  ```
  For each responding POVer (sequential):
    System: You are {name}. The moderator asks the following question.
            Respond from your perspective. Reference specific points
            from the debate so far. Ground in taxonomy but speak naturally.
    Context: {taxonomy nodes + cross-cutting nodes}
    Debate history: {transcript summary + recent N statements}
    Question: {user input}
    → Output: JSON {
        statement: string,
        taxonomy_refs: { node_id: string, relevance: string }[]
      }
  ```
- **Edge cases:**
  - `@` mention of inactive POVer → show inline hint "Cassandra is not in this debate"
  - `@` mention is ambiguous → show inline hint with autocomplete dropdown
  - Empty input + Send → no-op

#### 4.3.3 Cross-Respond

- **What:** System selects the POVer(s) whose response would most disambiguate the current disagreement.
- **Why:** Keeps the debate productive rather than circular.
- **How:**
  1. System analyzes the last 3–5 statements to identify the sharpest unresolved disagreement.
  2. Selects 1–2 POVers best positioned to clarify.
  3. Those POVers respond, referencing the specific prior statements they're addressing.
- **LLM call structure (selection):**
  ```
  System: Given the recent debate exchange, identify the most productive
          next response. Which debater should respond to whom, and what
          specific point should they address?
  Input: { recent_statements[], active_povers[] }
  → Output: JSON {
      responder: string,        // POVer name
      addressing: string,       // POVer name or "general"
      focus_point: string       // What to address
    }
  ```
  Then the selected POVer generates a response using the standard statement prompt.
- **Edge cases:**
  - All POVers are in agreement → system notes this and suggests a probing question instead
  - Debate is stuck in a loop → system detects repetition and suggests a new angle

#### 4.3.4 Synthesis Summary

- **What:** Structured summary of where POVers agree and disagree.
- **Why:** Helps the user extract actionable understanding from the debate.
- **How:**
  ```
  System: Analyze this debate and produce a structured synthesis.
  Input: { full_transcript }
  → Output: JSON {
      areas_of_agreement: { point: string, povers: string[] }[],
      areas_of_disagreement: {
        point: string,
        positions: { pover: string, stance: string }[]
      }[],
      unresolved_questions: string[],
      taxonomy_coverage: { node_id: string, how_used: string }[]
    }
  ```
  Rendered as a special card in the transcript with sections for agreement, disagreement, and open questions. Taxonomy coverage listed with clickable node indicators.
- **Edge cases:**
  - Called very early (< 3 exchanges) → produce what's available, note "Limited exchanges so far"

#### 4.3.5 Probing Questions

- **What:** 3–5 AI-generated questions designed to deepen or redirect the debate.
- **Why:** Helps users who aren't domain experts push the debate into productive territory.
- **How:**
  ```
  System: Given this debate, suggest 3-5 probing questions that would
          advance the discussion. Prioritize questions that would surface
          genuine disagreement or expose unstated assumptions.
  Input: { transcript, taxonomy_nodes_not_yet_referenced }
  → Output: JSON { questions: { text: string, targets: string[] }[] }
  ```
  Rendered as a card with clickable question buttons. Clicking one inserts it as the user's next question (triggering 4.3.2).
- **Edge cases:**
  - All taxonomy nodes already referenced → questions focus on depth rather than breadth

#### 4.3.6 Fact Check

- **What:** User selects text from any statement and requests a fact check.
- **Why:** POVers can generate plausible-but-wrong claims; users need a safety net.
- **How:**
  1. User selects text in a statement card.
  2. Context menu appears with "Fact check selection" option (alongside Copy and Search Google).
  3. System checks the claim against:
     - Taxonomy factual_claims and conflict data
     - Internal consistency with prior statements in the debate
  4. Result appears as an inline annotation below the statement.
- **LLM call structure:**
  ```
  System: Evaluate whether the following claim is factually accurate.
          Cross-reference against the provided taxonomy data and known
          conflicts. Rate: Supported, Disputed, Unverifiable, or False.
  Input: { selected_text, statement_context, relevant_taxonomy_nodes,
           relevant_conflicts }
  → Output: JSON {
      verdict: "supported" | "disputed" | "unverifiable" | "false",
      explanation: string,
      sources: { node_id?: string, conflict_id?: string }[]
    }
  ```
- **Edge cases:**
  - Selected text is too short (< 10 chars) → "Select a complete claim to fact-check"
  - No relevant taxonomy data → verdict "unverifiable" with explanation

---

## 5. POVer Engine Design

### 5.1 Taxonomy Grounding Approach

Each POVer has access to:
- **Own POV nodes:** All nodes from their taxonomy file (accelerationist.json, etc.)
- **Cross-cutting nodes:** All nodes from cross-cutting.json
- **Conflict data:** Relevant conflicts from conflicts/*.json

Grounding is injected as structured context in every LLM call, not as verbatim text to recite. The system prompt instructs:

> "Your taxonomy positions inform your worldview. Reference them when relevant but express ideas in your own words. Never say 'According to taxonomy node X' — instead, make the argument naturally and tag which nodes you drew from."

### 5.2 Taxonomy Node Selection

Not all nodes are relevant to every topic. Before each POVer call, the system selects relevant nodes:

1. **Embedding similarity:** Compute query embedding for the current topic + recent context. Rank POVer's nodes by cosine similarity. Select top 15.
2. **Cross-cutting inclusion:** Always include cross-cutting nodes that reference the selected POV nodes (via `linked_nodes`).
3. **Conflict awareness:** Include any conflicts involving selected nodes.

This keeps the context window manageable while ensuring relevance.

### 5.3 Context Window Management

As debates grow long, the full transcript will exceed context limits. Strategy:

1. **Always include:** System prompt, topic statement, taxonomy context, last 5 statements.
2. **Summarize the rest:** After every 10 statements, generate a running summary of the debate so far. Use this summary in place of older statements.
3. **Summary generation:**
   ```
   System: Summarize this debate segment, preserving key arguments,
           points of agreement/disagreement, and which POVer said what.
   Input: { statements[0..N] }
   → Output: { summary: string }
   ```
4. Store summaries in the session data so they don't need regeneration on resume.

### 5.4 Response Format

Every POVer LLM call returns:
```typescript
interface PoverResponse {
  statement: string;              // The debate text shown to the user
  taxonomy_refs: TaxonomyRef[];   // Nodes that grounded this statement
  internal_reasoning?: string;    // Optional chain-of-thought (not displayed)
}

interface TaxonomyRef {
  node_id: string;       // e.g., "acc-goals-002"
  relevance: string;     // Brief note on how this node informed the statement
}
```

### 5.5 LLM Configuration

Uses the same `generateText` IPC as the existing taxonomy editor. The backend model is user-configurable via Settings (same dropdown as current Gemini model selector). All POVer calls use the same model within a session.

Temperature: 0.7 for debate statements (more creative), 0.3 for synthesis/fact-check (more precise).

---

## 6. Taxonomy Integration & Inter-app Communication

### 6.1 Taxonomy Indicators

Every POVer statement card displays small, colored pill badges for each referenced taxonomy node:

```
┌────────────────────────────────────────────┐
│ 🔴 Prometheus                               │
│                                              │
│ "The economic evidence is clear — every      │
│ major technological transition has created    │
│ more jobs than it destroyed, and AI will be   │
│ no different..."                             │
│                                              │
│ [acc-goals-002] [acc-data-005] [cc-003]     │
└────────────────────────────────────────────┘
```

- Pills are always visible (per requirements).
- Color matches the POV: red for accelerationist (`acc-`), blue for safetyist (`saf-`), green for skeptic (`skp-`), purple for cross-cutting (`cc-`).
- Tooltip on hover shows the node's label.

### 6.2 Cross-Navigation to Taxonomy Editor

Clicking a taxonomy pill navigates to that node in the Taxonomy Editor:

1. Determine which tab the node belongs to (parse prefix: `acc-` → accelerationist tab, etc.).
2. Call `useTaxonomyStore.navigateToNode(tab, nodeId)` — this switches the active tab and selects the node.
3. Since Debate is a tab within the same app, this is a direct store call, not an IPC or HTTP request.
4. The tab bar switches to the relevant POV tab. The user can navigate back to the Debate tab to continue.

**Important:** Switching tabs does NOT destroy the Debate component state. The Debate tab must preserve its full state (transcript, input, phase) when the user navigates away and back. This requires either:
- Keeping the Debate component mounted but hidden (CSS `display: none` when inactive), OR
- Storing all debate state in Zustand (preferred — consistent with existing architecture)

### 6.3 Reverse Navigation: Taxonomy → Debate

Not in scope for v1. The taxonomy indicator on debate statements is the primary integration point.

---

## 7. Data Model

### 7.1 Key Entities

```typescript
/** A saved debate session */
interface DebateSession {
  id: string;                        // UUID
  title: string;                     // Auto-generated from topic, user-editable
  created_at: string;                // ISO 8601
  updated_at: string;                // ISO 8601
  phase: 'setup' | 'clarification' | 'opening' | 'debate' | 'closed';
  topic: {
    original: string;                // User's initial input
    refined: string | null;          // Post-clarification synthesis
    final: string;                   // What's actually being debated (edited or refined)
  };
  active_povers: PoverId[];          // Which POVers are participating
  user_is_pover: boolean;            // Whether user participates as a debater
  transcript: TranscriptEntry[];     // Ordered list of all entries
  context_summaries: ContextSummary[]; // Rolling summaries for context management
}

type PoverId = 'prometheus' | 'sentinel' | 'cassandra' | 'user';

/** A single entry in the debate transcript */
interface TranscriptEntry {
  id: string;                        // UUID
  timestamp: string;                 // ISO 8601
  type: 'clarification' | 'answer' | 'opening' | 'statement'
      | 'question' | 'synthesis' | 'probing' | 'fact-check' | 'system';
  speaker: PoverId | 'system';
  content: string;                   // The displayed text
  taxonomy_refs: TaxonomyRef[];      // Grounding references
  metadata?: Record<string, unknown>; // Type-specific data (e.g., fact-check verdict)
  addressing?: PoverId | 'all';      // Who this entry responds to
}

interface TaxonomyRef {
  node_id: string;
  relevance: string;
}

interface ContextSummary {
  up_to_entry_id: string;           // Last transcript entry covered
  summary: string;                   // Compressed debate history
}

/** Fact-check result stored in metadata */
interface FactCheckResult {
  verdict: 'supported' | 'disputed' | 'unverifiable' | 'false';
  explanation: string;
  sources: { node_id?: string; conflict_id?: string }[];
  checked_text: string;
}

/** Synthesis result stored in metadata */
interface SynthesisResult {
  areas_of_agreement: { point: string; povers: PoverId[] }[];
  areas_of_disagreement: {
    point: string;
    positions: { pover: PoverId; stance: string }[];
  }[];
  unresolved_questions: string[];
  taxonomy_coverage: { node_id: string; how_used: string }[];
}
```

### 7.2 Storage

Sessions are stored as individual JSON files in `debates/` at the project root:

```
ai-triad-research/
└── debates/
    ├── debate-<uuid>.json
    ├── debate-<uuid>.json
    └── ...
```

File naming: `debate-{id}.json`. The session list is built by reading the directory.

### 7.3 IPC Additions

New IPC handlers needed in the main process:

```typescript
// Session persistence
'list-debate-sessions'   → () => Promise<DebateSessionSummary[]>
'load-debate-session'    → (id: string) => Promise<DebateSession>
'save-debate-session'    → (session: DebateSession) => Promise<void>
'delete-debate-session'  → (id: string) => Promise<void>
```

`DebateSessionSummary` is a lightweight projection (id, title, created_at, updated_at, phase) used for the session list without loading full transcripts.

### 7.4 Zustand Store Extensions

New slice added to `useTaxonomyStore` (or a separate `useDebateStore` — see Assumptions):

```typescript
// Debate state
debateSessions: DebateSessionSummary[];
activeDebateId: string | null;
activeDebate: DebateSession | null;
debateLoading: boolean;
debateGenerating: PoverId | null;  // Which POVer is currently generating
debateError: string | null;

// Actions
loadDebateSessions(): Promise<void>;
createDebate(topic: string, povers: PoverId[], userIsPover: boolean): Promise<void>;
loadDebate(id: string): Promise<void>;
deleteDebate(id: string): Promise<void>;
addTranscriptEntry(entry: TranscriptEntry): void;
updateDebatePhase(phase: DebateSession['phase']): void;
saveDebate(): Promise<void>;
```

---

## 8. Non-Functional Requirements

### 8.1 Performance

| Metric | Target |
|--------|--------|
| Session list load | < 500ms for 100 sessions |
| POVer statement generation | < 15s per statement |
| Clarification questions (parallel) | < 10s for all 3 POVers |
| Synthesis generation | < 20s |
| Fact check | < 10s |
| Tab switch (Debate ↔ POV tabs) | < 100ms (no visible flash) |

### 8.2 Persistence

- Auto-save after every new transcript entry (debounced 2s).
- Session files are human-readable JSON (pretty-printed).
- No data loss on app crash — worst case is loss of the in-flight statement.

### 8.3 Accessibility

- All text is selectable (per requirements).
- Context menu on selection: Copy, Search Google for '...', Fact Check (on POVer statements).
- Keyboard navigation: Tab through action buttons, Enter to send, Escape to cancel dialogs.
- POVer colors must meet WCAG AA contrast in all themes (Light, Dark, BKC).
- Screen reader: statement cards use `role="article"` with `aria-label` identifying the speaker.

### 8.4 Text Selection & Context Menu

- **What:** All debate text is selectable. On selection, a custom context menu appears.
- **Why:** User requirement — copy, search, fact-check directly from text.
- **How:** Use the `contextmenu` event on statement cards. Menu items:
  1. **Copy** — copies selected text to clipboard
  2. **Search Google for '{selection}'** — calls `window.electronAPI.openExternal(url)` with the Google search URL. Selection truncated to 100 chars in the menu label.
  3. **Fact check** (only on POVer statements, not user input) — triggers fact-check flow (4.3.6).
- **Edge cases:**
  - No text selected → show default browser context menu
  - Selection spans multiple statement cards → Copy works, Fact Check disabled (must be within one statement)

---

## 9. Open Questions & Assumptions Log

### Assumptions (will use unless told otherwise)

| # | Assumption | Rationale |
|---|-----------|-----------|
| A1 | POVer personas are fixed — no user-adjustable intensity or angle | User did not answer Q7; simpler design, taxonomy provides sufficient variety |
| A2 | Debate tab uses a dedicated Zustand store (`useDebateStore`) rather than extending `useTaxonomyStore` | Separation of concerns — debate state is large and independent |
| A3 | Session list is stored in `debates/` at the project root (alongside `sources/`, `summaries/`) | Consistent with existing project data layout |
| A4 | Tab switch preserves Debate state via Zustand (component unmounts but state persists in store) | Consistent with how the app already works — PovTab reads from store on mount |
| A5 | Context window management uses rolling summaries after every 10 statements | Balances quality with API cost; summary threshold is tunable |
| A6 | Opening statement order is fixed: Prometheus → Sentinel → Cassandra → User | Provides consistent narrative arc; could be randomized later |
| A7 | Fact checking is user-triggered only (not automatic) | Automatic checking adds latency and cost to every statement; user-triggered is more practical |
| A8 | All POVers use the same LLM model (configurable in Settings) | Simpler; per-POVer model selection is over-engineering for v1 |
| A9 | POVDebater reuses the existing `generateText` IPC with different temperature values | Avoids new API integration; temperature can be passed as a parameter or set in the prompt |
| A10 | The "Search Google" context menu item opens the system browser via `openExternal` | Consistent with existing `openExternal` IPC pattern |

### Open Questions

| # | Question | Impact |
|---|---------|--------|
| Q1 | Should the `generateText` IPC be extended to accept a `temperature` parameter, or should we use prompt-level instructions to control creativity? | Affects API layer; prompt-level is simpler but less precise |
| Q2 | Should debate sessions be exportable to Markdown or PDF for sharing? | Nice-to-have but adds scope; archival JSON is sufficient for v1 |
| Q3 | Should the Debate tab be visible before any sessions exist, or hidden until the user first creates one? | UX question — recommend always visible with an onboarding empty state |
| Q4 | How should the "Search Google" URL be constructed? `https://www.google.com/search?q={encodeURIComponent(text)}` is standard but locale-sensitive. | Minor; use standard Google URL |
| Q5 | Should the session list show a "last message preview" like a chat app, or just title + date? | UX refinement; title + date is sufficient for v1 |

---

## 10. Out of Scope

| Exclusion | Rationale |
|-----------|-----------|
| Multi-user / collaborative debates | Single-user desktop app; network features add major complexity |
| Custom POVer creation | Users cannot define new perspectives beyond the 3 built-in + self; custom POVs require new taxonomy files |
| Real-time streaming of POVer responses | Token-by-token streaming is nice-to-have but not required; complete-block responses are acceptable for v1 |
| Debate branching / rewind | "What if Sentinel had said X instead" is compelling but complex; defer to v2 |
| Audio / voice input | Text-only for v1 |
| Reverse navigation (Taxonomy → Debate) | Debate → Taxonomy is sufficient; reverse adds state coupling |
| Export to Markdown / PDF | JSON archival is sufficient for v1 |
| Automatic fact-checking of every statement | User-triggered only per Assumption A7 |
| POVer personality tuning | Fixed personas per Assumption A1 |
| Integration with PowerShell pipeline (AIEnrich, Invoke-POVSummary) | Debate engine uses the Electron generateText IPC directly |

---

## 11. Phased Implementation Plan

| Phase | Scope | Key Deliverables | Status |
|-------|-------|-----------------|--------|
| **1. Foundation** | Tab, types, IPC, store, shell UI | Debate tab visible, sessions CRUD, empty two-pane layout | Done |
| **2. New Debate + Clarification** | Setup dialog, LLM clarification questions, topic synthesis | User can create a debate and refine a topic | Done |
| **3. Opening Statements** | Sequential POVer statements with taxonomy grounding | POVers deliver grounded opening positions | Done |
| **4. Main Debate Loop** | Ask questions, cross-respond, @-mentions | Core debate interaction | Done |
| **5. Synthesis & Probing** | Synthesis summaries, AI-generated questions | Analytical debate tools | Done |
| **6. Taxonomy Integration** | Taxonomy pills, cross-nav to POV tabs | Clickable node indicators on statements | Done |
| **7. Context Menu & Fact Check** | Copy, Search Google, fact-check flow | Text selection actions | Done |
| **8. Polish** | Auto-save, context window mgmt, session resume | Production readiness | Done |
