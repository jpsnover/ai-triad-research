# Shared Debate Library — API Reference

## Overview

`lib/debate/` is a pure TypeScript library that powers the multi-agent debate system. It has **zero UI dependencies** — no React, Zustand, or Electron imports — making it usable from both the Taxonomy Editor's renderer process and a headless CLI.

**Location:** `lib/debate/`
**Files:** 28 TypeScript modules (~410 KB)
**Entry:** `index.ts` barrel export (re-exports all modules except `schemas.ts`)

## Architecture

```
lib/debate/
├── index.ts                 # Barrel export + migration normalizers
├── types.ts                 # Core debate & transcript types
├── taxonomyTypes.ts         # Taxonomy node type definitions
├── debateEngine.ts          # Orchestration engine (70KB)
├── aiAdapter.ts             # Multi-backend AI client
├── prompts.ts               # All prompt generators (73KB)
├── argumentNetwork.ts       # Incremental claim extraction & tracking
├── taxonomyContext.ts        # BDI-structured taxonomy formatting
├── taxonomyLoader.ts        # Filesystem taxonomy loading
├── taxonomyRelevance.ts     # Embedding-based relevance filtering
├── neutralEvaluator.ts      # Persona-free neutral evaluation
├── harvestUtils.ts          # Promote debate findings → taxonomy
├── concessionTracker.ts     # Concession accumulation & classification
├── coverageTracker.ts       # Document claim coverage tracking
├── documentAnalysis.ts      # Document pre-analysis for debates
├── qbaf.ts                  # DF-QuAD strength computation
├── qbafCombinator.ts        # QBAF convergence integration
├── helpers.ts               # ID generation, JSON parsing, utilities
├── formatters.ts            # Markdown export, slug generation
├── debateExport.ts          # Multi-format export (JSON/MD/Text/PDF)
├── validators.ts            # Referential integrity & BDI validation
├── errors.ts                # ActionableError + withRecovery
├── protocols.ts             # Debate protocol definitions
├── topics.ts                # 20 predefined debate topics
├── nodeIdUtils.ts           # Node ID prefix detection
├── repairTranscript.ts      # Transcript repair utilities
├── schemas.ts               # Zod schemas (excluded from barrel)
└── cli.ts                   # Headless CLI entry point
```

## Core Types

### Debate Session

Defined in `types.ts`. The root object for all debate state.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique session ID |
| `title` | `string` | Human-readable title |
| `phase` | `'setup' \| 'clarification' \| 'opening' \| 'debate' \| 'closed'` | Current debate phase |
| `topic` | `{ original, refined, final }` | Topic evolution through clarification |
| `source_type` | `'topic' \| 'document' \| 'url' \| 'situations'` | What triggered the debate |
| `source_content` | `string` | Document text or topic description |
| `active_povers` | `PoverId[]` | Which POVers participate |
| `transcript` | `TranscriptEntry[]` | Full debate transcript |
| `debate_model?` | `string` | Per-debate AI model override |
| `protocol_id?` | `string` | Debate protocol (`structured`, `socratic`, `deliberation`) |
| `argument_network?` | `{ nodes, edges }` | Incremental argument graph |
| `commitments?` | `Record<string, CommitmentStore>` | Per-debater assertion tracking |
| `convergence_tracker?` | `ConvergenceTracker` | Agreement trend data |
| `document_analysis?` | `DocumentAnalysis` | Pre-analysis of attached document |
| `qbaf_timeline?` | `QbafTimelineEntry[]` | QBAF strength over time |
| `claim_coverage?` | `ClaimCoverageEntry[]` | Source claim discussion coverage |
| `neutral_evaluations?` | `NeutralEvaluation[]` | Persona-free assessments |
| `unanswered_claims_ledger?` | `UnansweredClaimEntry[]` | Claims awaiting response |
| `position_drift?` | `DriftSnapshot[]` | Speaker position evolution |
| `missing_arguments?` | `MissingArgument[]` | Arguments not yet raised |
| `taxonomy_suggestions?` | `TaxonomySuggestion[]` | Proposed taxonomy refinements |

### POVer Identities

```typescript
type PoverId = 'prometheus' | 'sentinel' | 'cassandra' | 'user';
```

| ID | Label | POV | Personality |
|----|-------|-----|-------------|
| `prometheus` | Prometheus | accelerationist | Confident, forward-looking, frames risk as cost-of-inaction |
| `sentinel` | Sentinel | safetyist | Methodical, evidence-driven, frames progress as conditional-on-safeguards |
| `cassandra` | Cassandra | skeptic | Wry, pragmatic, challenges assumptions from both sides |
| `user` | (human) | — | Human participant in user-is-pover mode |

### Transcript Entry

Each turn in the debate.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique entry ID |
| `timestamp` | `string` | ISO 8601 |
| `type` | `string` | `clarification`, `opening`, `statement`, `synthesis`, `fact-check`, etc. |
| `speaker` | `PoverId \| 'system'` | Who spoke |
| `content` | `string` | Full text |
| `taxonomy_refs` | `TaxonomyRef[]` | Referenced taxonomy nodes |
| `policy_refs?` | `array` | Referenced policy items |
| `addressing?` | `PoverId \| 'all'` | Who this entry responds to |
| `summaries?` | `{ brief, medium }` | AI-generated summaries at two lengths |
| `display_tier?` | `'brief' \| 'medium' \| 'detailed'` | Current display level |

### Argument Network

Incremental claim graph built after each debater turn.

**Nodes:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Claim ID |
| `text` | `string` | Claim text |
| `speaker` | `PoverId \| 'system' \| 'document'` | Who asserted it |
| `source_entry_id` | `string` | Transcript entry this came from |
| `taxonomy_refs` | `string[]` | Linked taxonomy node IDs |
| `turn_number` | `number` | When introduced |
| `base_strength?` | `number` | QBAF intrinsic strength (0–1) |
| `computed_strength?` | `number` | QBAF post-propagation strength |
| `bdi_category?` | `string` | `belief`, `desire`, or `intention` |
| `verification_status?` | `string` | `verified`, `disputed`, `unverifiable`, `pending` |

**Edges:**

| Field | Type | Description |
|-------|------|-------------|
| `source` | `string` | Source claim ID |
| `target` | `string` | Target claim ID |
| `type` | `'supports' \| 'attacks'` | Relationship |
| `attack_type?` | `'rebut' \| 'undercut' \| 'undermine'` | AIF attack classification |
| `scheme?` | `DialecticalScheme` | Move type (DISTINGUISH, COUNTEREXAMPLE, etc.) |
| `argumentation_scheme?` | `ArgumentationScheme` | Walton scheme (ARGUMENT_FROM_EVIDENCE, etc.) |
| `weight?` | `number` | QBAF edge weight (0–1) |

### Commitment Store

Per-debater claim tracking, derived from the argument network.

```typescript
interface CommitmentStore {
  asserted: string[];   // Claim IDs the debater put forward
  conceded: string[];   // Claim IDs the debater accepted from opponents
  challenged: string[]; // Claim IDs the debater disputed
}
```

### Synthesis Result

Generated in the closing phase by the moderator.

| Field | Type | Description |
|-------|------|-------------|
| `areas_of_agreement` | `array` | Points all POVers converged on |
| `areas_of_disagreement` | `array` | Unresolved disputes with `bdi_layer` and `resolvability` |
| `unresolved_questions` | `string[]` | Open questions |
| `taxonomy_coverage` | `array` | Which taxonomy nodes were invoked |
| `argument_map?` | `ArgumentClaim[]` | AIF argument map with `attack_type` and `scheme` |
| `preferences?` | `PreferenceEntry[]` | Resolution analysis per disagreement |
| `policy_implications?` | `PolicyImplication[]` | Policy-relevant conclusions |
| `claim_coverage?` | `ClaimCoverageEntry[]` | Document claim coverage stats |

### Preference Resolution

Each disagreement is evaluated for which argument prevails.

```typescript
interface PreferenceEntry {
  conflict: string;              // Description of the disagreement
  claim_ids?: string[];          // Related argument network claims
  prevails: string;              // Which side's argument is stronger
  criterion: string;             // empirical_evidence | logical_validity | source_authority | specificity | scope
  rationale: string;             // Why this side prevails
  what_would_change_this?: string; // What evidence could reverse the judgment
}
```

---

## Taxonomy Types

Defined in `taxonomyTypes.ts`.

### PovNode

```typescript
interface PovNode {
  id: string;                    // e.g., "acc-beliefs-001"
  category: Category;            // 'Beliefs' | 'Desires' | 'Intentions'
  label: string;
  description: string;           // Genus-differentia format
  parent_id: string | null;
  parent_relationship?: 'is_a' | 'part_of' | 'specializes' | null;
  children: string[];
  situation_refs: string[];
  conflict_ids?: string[];
  graph_attributes?: GraphAttributes;
  debate_refs?: string[];
  concession_history?: ConcessionRecord[];
}
```

### SituationNode

```typescript
interface SituationNode {
  id: string;                    // e.g., "sit-001"
  label: string;
  description: string;
  interpretations: {
    accelerationist: Interpretation;
    safetyist: Interpretation;
    skeptic: Interpretation;
  };
  linked_nodes: string[];
  conflict_ids: string[];
  graph_attributes?: GraphAttributes;
  disagreement_type?: 'definitional' | 'interpretive' | 'structural';
  debate_refs?: string[];
}
```

### GraphAttributes

```typescript
interface GraphAttributes {
  epistemic_type?: string;
  rhetorical_strategy?: string;
  assumes?: string[];
  falsifiability?: string;
  audience?: string;
  emotional_register?: string;
  policy_actions?: { policy_id?: string; action: string; framing: string }[];
  intellectual_lineage?: string[];
  steelman_vulnerability?: string | {
    from_accelerationist?: string;
    from_safetyist?: string;
    from_skeptic?: string;
  };
  possible_fallacies?: PossibleFallacy[];
  node_scope?: 'claim' | 'scheme' | 'bridging';
}
```

### Edge

7 canonical AIF-aligned edge types: `SUPPORTS`, `CONTRADICTS`, `ASSUMES`, `WEAKENS`, `RESPONDS_TO`, `TENSION_WITH`, `INTERPRETS`.

```typescript
interface Edge {
  source: string;
  target: string;
  type: CanonicalEdgeType | (string & {});  // Accepts any string for backward compat
  bidirectional: boolean;
  confidence: number;
  rationale: string;
  status: 'proposed' | 'approved' | 'rejected';
  strength?: 'strong' | 'moderate' | 'weak';
}
```

### Interpretation

Union type — legacy string or BDI-decomposed object.

```typescript
type Interpretation = string | BdiInterpretation;

interface BdiInterpretation {
  belief: string;
  desire: string;
  intention: string;
  summary: string;
}

// Helpers
function interpretationText(interp?: Interpretation): string;
function isBdiInterpretation(interp?: Interpretation): boolean;
```

### Node ID Utilities

`nodeIdUtils.ts` — single source of truth for ID prefix conventions.

```typescript
const POV_PREFIXES: Record<string, string>;  // 'acc-' → 'accelerationist', etc.
const SITUATION_PREFIX = 'sit-';

function nodePovFromId(id: string): string | null;
function nodeTypeFromId(id: string): 'pov' | 'situation' | null;
function isNodeOfPov(id: string, pov: string): boolean;
```

---

## Debate Engine

`debateEngine.ts` — the core orchestrator. Runs a complete debate from topic to synthesis.

### Constructor

```typescript
class DebateEngine {
  constructor(
    config: DebateConfig,
    adapter: AIAdapter | ExtendedAIAdapter,
    taxonomy: LoadedTaxonomy,
  );

  async run(onProgress?: (p: DebateProgress) => void): Promise<DebateSession>;
}
```

### DebateConfig

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `topic` | `string` | — | Debate proposition or question |
| `name?` | `string` | — | Session title |
| `sourceType` | `DebateSourceType` | — | What initiated the debate |
| `sourceRef?` | `string` | — | File path or URL |
| `sourceContent?` | `string` | — | Pre-loaded document text |
| `activePovers` | `PoverId[]` | — | Which POVers participate |
| `protocolId?` | `string` | `'structured'` | Protocol: `structured`, `socratic`, `deliberation` |
| `model` | `string` | — | AI model ID |
| `rounds` | `number` | — | Cross-respond rounds |
| `responseLength` | `string` | — | `brief`, `medium`, or `detailed` |
| `enableClarification?` | `boolean` | `true` | Run clarification phase |
| `enableProbing?` | `boolean` | `false` | Moderator probing questions |
| `probingInterval?` | `number` | `2` | Rounds between probes |
| `temperature?` | `number` | — | Generation temperature |

### Debate Phases

1. **Clarification** — Moderator refines the topic, confirms scope
2. **Opening Statements** — Each POVer presents initial position grounded in BDI taxonomy
3. **Cross-Respond** — N rounds of structured debate with argument network extraction
4. **Closing** — Final statements from each POVer
5. **Synthesis** — Moderator analyzes agreements, disagreements, preferences, taxonomy coverage

### Progress Callback

```typescript
interface DebateProgress {
  phase: string;
  speaker?: string;
  round?: number;
  totalRounds?: number;
  message: string;
}
```

### Background Processing

After each debater turn, the engine runs in parallel:
- **Argument network extraction** — claims and relationships added to `argument_network`
- **Commitment updates** — `commitments` store refreshed
- **QBAF propagation** — strength scores recomputed
- **Unanswered claims ledger** — updated for moderator hints

---

## AI Adapter

`aiAdapter.ts` — pluggable multi-backend AI client.

### Interfaces

```typescript
interface AIAdapter {
  generateText(prompt: string, model: string, options?: GenerateOptions): Promise<string>;
}

interface ExtendedAIAdapter extends AIAdapter {
  generateTextWithSearch?(prompt: string, model?: string): Promise<{ text: string; searchQueries?: string[] }>;
  nliClassify?(pairs: { text_a: string; text_b: string }[]): Promise<{ results: { nli_label: string; nli_entailment: number }[] }>;
  computeQueryEmbedding?(text: string): Promise<{ vector: number[] }>;
}

interface GenerateOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}
```

### CLI Adapter Factory

```typescript
function createCLIAdapter(repoRoot: string, explicitKey?: string): AIAdapter;
```

Creates an adapter that resolves models from `ai-models.json` and API keys from environment variables (backend-specific → `AI_API_KEY` fallback).

---

## Taxonomy Context

`taxonomyContext.ts` — formats taxonomy data into BDI-structured prompt sections.

### Core Function

```typescript
function formatTaxonomyContext(
  ctx: TaxonomyContext,
  pov: string,
  maxNodes?: number,
  config?: FormatContextConfig,
): string;
```

Produces text with three BDI sections:

| Section | Header | Content |
|---------|--------|---------|
| Beliefs | `YOUR EMPIRICAL GROUNDING` | Factual claims and observations |
| Desires | `YOUR NORMATIVE COMMITMENTS` | Goals and principles |
| Intentions | `YOUR REASONING APPROACH` | Methods and argumentative strategies |

Plus optional sections for vulnerabilities, situation concerns, and policy references.

### Configuration

```typescript
interface FormatContextConfig {
  maxNodes?: number;         // Total node cap
  primaryCount?: number;     // Top-scored nodes to include fully
  vulnMax?: number;          // Max vulnerability entries
  vulnEnabled?: boolean;     // Include steelman vulnerabilities
  fallacyConfidence?: string;// 'likely' or 'all'
  fallacyEnabled?: boolean;  // Include possible fallacies
  policyMax?: number;        // Max policy references
  policyEnabled?: boolean;   // Include policy context
  sitPrimary?: number;       // Primary situation count
  relevantBranches?: Set<string>; // CHESS: deep injection for these branches only
}
```

### Injection Manifest

```typescript
function computeInjectionManifest(
  ctx: TaxonomyContext,
  pov: string,
): ContextInjectionManifest;
```

Returns counts and IDs of what was injected — useful for diagnostics and testing.

---

## Taxonomy Loading

`taxonomyLoader.ts` — reads taxonomy files from the filesystem.

### Functions

```typescript
function resolveRepoRoot(startDir: string): string;
function resolveDataRoot(repoRoot: string): string;
function loadTaxonomy(repoRoot: string): LoadedTaxonomy;
function loadConflicts(repoRoot: string): ConflictFile[];
async function loadSourceContent(filePath: string): Promise<string>;
async function fetchUrlContent(url: string): Promise<string>;
async function convertToMarkdown(filePath: string): Promise<string>;
```

### LoadedTaxonomy

```typescript
interface LoadedTaxonomy {
  accelerationist: { nodes: PovNode[] };
  safetyist: { nodes: PovNode[] };
  skeptic: { nodes: PovNode[] };
  situations: { nodes: SituationNode[] };
  edges: EdgesFile | null;
  embeddings: Record<string, { pov: string; vector: number[] }>;
  policyRegistry: PolicyRef[];
}
```

Data path resolution: `$env:AI_TRIAD_DATA_ROOT` → `.aitriad.json` → monorepo fallback.

---

## Taxonomy Relevance

`taxonomyRelevance.ts` — embedding-based filtering for CHESS context injection.

```typescript
function cosineSimilarity(a: number[], b: number[]): number;

function scoreNodeRelevance(
  queryVector: number[],
  embeddings: Record<string, EmbeddingEntry>,
): Map<string, number>;

function selectRelevantNodes(
  nodes: PovNode[],
  scores: Map<string, number>,
  threshold: number,
  minPerPov: number,
  maxTotal: number,
): Array<{ node: PovNode; score: number }>;

function buildRelevanceQuery(topic: string, recentTranscript: string): string;
```

---

## Argument Network

`argumentNetwork.ts` — extracts claims from each turn and maps relationships.

### Prompt Generators

```typescript
function extractClaimsPrompt(
  statement: string,
  speaker: string,
  priorClaims: PriorClaim[],
): string;

function classifyClaimsPrompt(
  statement: string,
  speaker: string,
  debaterClaims: { claim: string; targets: string[] }[],
): string;
```

### Context Formatters

```typescript
function formatArgumentNetworkContext(anNodes: ArgumentNetworkNode[], maxClaims?: number): string;
function formatCommitments(commitments: CommitmentStore, an?: ArgumentNetworkNode[]): string;
function formatEstablishedPoints(anNodes: ArgumentNetworkNode[], maxPoints?: number): string;
function formatUnansweredClaimsHint(ledger: UnansweredClaimEntry[]): string;
function formatSpecifyHint(anNodes: ArgumentNetworkNode[]): string;
```

### Ledger Management

```typescript
function updateUnansweredLedger(
  ledger: UnansweredClaimEntry[],
  newNodes: ArgumentNetworkNode[],
  currentRound: number,
): UnansweredClaimEntry[];
```

---

## QBAF

`qbaf.ts` — DF-QuAD bipolar argumentation framework for claim strength scoring.

### Core Function

```typescript
function computeQbafStrengths(
  nodes: QbafNode[],
  edges: QbafEdge[],
  options?: QbafOptions,
): QbafResult;
```

**Update rule (DF-QuAD):**
```
σ(v) = τ(v) × (1 - aggAtt) × (1 + aggSup), clamped to [0, 1]

where:
  τ(v)    = base strength
  aggAtt  = Σ(σ(attacker) × edge_weight × attack_type_multiplier)
  aggSup  = Σ(σ(supporter) × edge_weight)
```

**Attack type multipliers** (configurable via `options.attackWeights`):
- `rebut`: 1.0 — direct contradiction
- `undercut`: 0.75 — attacks the inference
- `undermine`: 0.5 — attacks a premise

### Additional Functions

```typescript
function computeQbafConvergence(
  claimIds: string[],
  strengths: Map<string, number>,
): number | undefined;

function computeFactCheckStrength(
  claimBaseStrength: number,
  evidence: WebEvidenceItem[],
): FactCheckQbafResult;
```

### Types

```typescript
interface QbafNode { id: string; base_strength: number; }
interface QbafEdge { source: string; target: string; type: 'supports' | 'attacks'; weight: number; attack_type?: string; }
interface QbafResult { strengths: Map<string, number>; iterations: number; converged: boolean; }
```

---

## Neutral Evaluator

`neutralEvaluator.ts` — persona-free evaluation at three checkpoints (baseline, midpoint, final).

### Speaker Anonymization

```typescript
function buildSpeakerMapping(activePovers: PoverId[]): SpeakerMapping;
// Maps PoverId → 'Speaker A/B/C' to prevent label bias
```

### Evaluation Function

```typescript
async function runNeutralEvaluation(
  adapter: AIAdapter,
  session: DebateSession,
  checkpoint: NeutralCheckpoint,  // 'baseline' | 'midpoint' | 'final'
  speakerMapping: SpeakerMapping,
  model: string,
  temperature: number,
): Promise<NeutralEvaluation>;
```

### Output Structure

| Field | Description |
|-------|-------------|
| `cruxes` | Core disagreements with type (empirical/values/definitional) and status |
| `claims` | Per-claim assessment: well_supported, plausible_but_underdefended, contested_unresolved, refuted, off_topic |
| `overall_assessment` | Strongest unaddressed claim, whether debate engages real disagreement |

---

## Harvest Utilities

`harvestUtils.ts` — promotes debate findings into the taxonomy.

### Five Harvest Item Types

| Type | Target | Description |
|------|--------|-------------|
| **Conflicts** | `conflicts/*.json` | Disagreements → formal conflict files |
| **Steelman refinements** | node `steelman_vulnerability` | Better vulnerability descriptions per POV |
| **Debate refs** | node `debate_refs` | Record which debates referenced a node |
| **Verdicts** | conflict `verdict` field | Resolution analysis from synthesis preferences |
| **New concepts** | new taxonomy nodes | Novel concepts mentioned but not in taxonomy |

### Extractors

```typescript
function extractConflictCandidates(debate: DebateSession): HarvestConflictItem[];
function extractSteelmanCandidates(debate: DebateSession, getNodeLabel: (id: string) => string | null): HarvestSteelmanItem[];
function extractDebateRefCandidates(debate: DebateSession, getNodeLabel: (id: string) => string | null): HarvestDebateRefItem[];
function extractVerdictCandidates(debate: DebateSession): HarvestVerdictItem[];
function extractConceptCandidates(debate: DebateSession, allNodeIds: Set<string>): HarvestConceptItem[];
```

### Manifest

```typescript
interface HarvestManifest {
  debate_id: string;
  debate_title: string;
  harvested_at: string;
  items: HarvestManifestItem[];
}
```

Manifests are saved to `ai-triad-data/harvests/`.

---

## Concession Tracker

`concessionTracker.ts` — tracks when debaters concede points, with taxonomy impact.

### Types

```typescript
type ConcessionType = 'full' | 'conditional' | 'tactical';

interface ClassifiedConcession {
  index: number;
  concession_type: ConcessionType;
  affected_node: string | null;
  bdi_impact: 'belief' | 'desire' | 'intention';
}

interface NodeConcessionSummary {
  node_id: string;
  concessions: ConcessionRecord[];
  weighted_score: number;
  distinct_debates: number;
  meets_threshold: boolean;
}
```

### Functions

```typescript
function extractConcessions(debate: DebateSession): ConcessionEntry[];
function buildConcessionRecords(debateId: string, concessions: ConcessionEntry[], classifications: ClassifiedConcession[]): Map<string, ConcessionRecord[]>;
function summarizeNodeConcessions(existingHistory: ConcessionRecord[], newRecords: ConcessionRecord[], threshold?: number, minDebates?: number): NodeConcessionSummary & { allRecords: ConcessionRecord[] };
```

---

## Coverage Tracker

`coverageTracker.ts` — measures how much of a source document the debate actually addressed.

### Functions

```typescript
function computeCoverage(
  sourceClaims: DocumentINode[],
  anNodes: ArgumentNetworkNode[],
  sourceVectors: Map<string, number[]>,
  anVectors: Map<string, number[]>,
  options?: CoverageOptions,
): CoverageResult;

function computeCoverageByTextOverlap(
  sourceClaims: DocumentINode[],
  anNodes: ArgumentNetworkNode[],
  options?: CoverageOptions,
): CoverageResult;

function computeCoverageMap(
  anNodes: ArgumentNetworkNode[],
  documentClaims: Array<{ id: string; text: string }>,
  options?: CoverageMapOptions,
): CoverageMap;
```

### CoverageResult

```typescript
interface CoverageResult {
  entries: ClaimCoverageEntry[];
  coverage_ratio: number;      // 0–1
  discussed_count: number;
  total_count: number;
}
```

---

## Document Analysis

`documentAnalysis.ts` — pre-analyzes a document before the debate begins.

```typescript
function documentAnalysisPrompt(
  sourceContent: string,
  refinedTopic: string,
  activePovers: string[],
  taxonomySample: string,
): string;

function documentAnalysisContext(analysis: DocumentAnalysis): string;

function buildTaxonomySample(
  taxonomy: TaxonomySampleInput,
  nodeScores?: Map<string, number>,
): string;
```

---

## Validators

`validators.ts` — structural and semantic validation.

### Functions

```typescript
function checkReferentialIntegrity(data: TaxonomyData): ValidationResult;
function checkEdgeDomainRange(edges: Edge[], allNodeIds: Set<string>, situationIds: Set<string>): ValidationResult;
function checkBdiConsistency(disagreements: { point: string; bdi_layer?: string; resolvability?: string }[]): ValidationResult;
function validateTaxonomy(data: TaxonomyData): ValidationResult;
```

### ValidationResult

```typescript
interface ValidationIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  entityId: string;
  fix: string;     // Actionable fix description
}
```

---

## Error Handling

`errors.ts` — project-standard error handling.

### ActionableError

```typescript
class ActionableError extends Error {
  readonly goal: string;       // What was being attempted
  readonly problem: string;    // What went wrong
  readonly location: string;   // Where in the code
  readonly nextSteps: string[];// Specific resolution steps
  readonly innerError?: Error;
}
```

### withRecovery

Retry + fallback wrapper.

```typescript
async function withRecovery<T>(opts: {
  goal: string;
  location: string;
  action: () => Promise<T>;
  fallback?: () => Promise<T>;
  maxRetries?: number;         // Default: 2
  retryDelayMs?: number;       // Default: 1000
  isRetryable?: (err: unknown) => boolean;
  nextSteps: string[];
}): Promise<T>;
```

### Error Message Extractor

```typescript
function errorMessage(err: unknown): string;
```

---

## Helpers

`helpers.ts` — shared utilities.

### ID & Time

```typescript
function generateId(): string;   // Unique ID
function nowISO(): string;       // Current ISO 8601 timestamp
```

### JSON Parsing (AI-tolerant)

```typescript
function stripCodeFences(text: string): string;
function parseAIJson<T>(text: string): T | null;
function parseJsonRobust(text: string): unknown;
function extractArraysFromPartialJson(json: string): Record<string, unknown[]>;
```

### Debate Utilities

```typescript
function parseAtMention(input: string): { targets: PoverId[]; cleanedInput: string };
function formatRecentTranscript(transcript: TranscriptEntry[], maxEntries?: number, contextSummaries?: ContextSummary[]): string;
function parsePoverResponse(text: string): { statement: string; taxonomyRefs: TaxonomyRef[]; meta: PoverResponseMeta };
```

---

## Formatters

`formatters.ts` — output generation.

```typescript
function generateSlug(text: string, maxLength?: number): string;
function formatDebateMarkdown(session: DebateSession): string;
function buildDiagnosticsOutput(session: DebateSession): object;
function buildHarvestOutput(session: DebateSession, getNodeLabel: (id: string) => string | null, allNodeIds: Set<string>): object;
```

---

## Debate Export

`debateExport.ts` — multi-format export.

Supported formats: `json`, `markdown`, `text`, `pdf`.

---

## Protocols

`protocols.ts` — three debate protocols.

| Protocol | Description | Default Rounds |
|----------|-------------|----------------|
| `structured` | Standard format: opening → cross-respond → closing | Configurable |
| `socratic` | Question-driven: moderator asks probing questions | Configurable |
| `deliberation` | Consensus-seeking: emphasis on finding common ground | Configurable |

```typescript
function getProtocol(id: string): DebateProtocol;
```

---

## Topics

`topics.ts` — 20 predefined debate topics.

```typescript
interface DebateTopic {
  id: number;
  theme: string;
  type: 'Assertion' | 'Question' | 'Issue';
  proposition: string;
}

const DEBATE_TOPICS: DebateTopic[];
```

---

## Migration Normalizers

Exported from `index.ts` for backward compatibility with legacy data.

```typescript
function normalizeNodeProperties<T>(node: T): T;     // cross_cutting_refs → situation_refs
function normalizePov(pov: string): string;           // 'cross-cutting' → 'situations'
function normalizeNodeId(id: string): string;         // cc-* → sit-*, old BDI slugs
function normalizeBdiLayer(layer: string): string;    // legacy value/conceptual → belief/desire/intention
function normalizeCategory(category: string): string; // legacy Data/Facts/Goals → Beliefs/Desires/Intentions
```

---

## CLI Usage

`cli.ts` — run headless debates from the command line.

```bash
npx tsx lib/debate/cli.ts --config debate-config.json
npx tsx lib/debate/cli.ts --stdin
```

### Config Schema

```json
{
  "topic": "Should AI development be paused?",
  "activePovers": ["prometheus", "sentinel", "cassandra"],
  "model": "gemini-2.5-flash",
  "rounds": 3,
  "responseLength": "medium",
  "protocolId": "structured",
  "enableClarification": true,
  "outputDir": "debates",
  "outputFormat": "markdown"
}
```

### Outputs

| File | Content |
|------|---------|
| `debates/<slug>.json` | Full debate session |
| `debates/<slug>.md` | Markdown export |
| `debates/<slug>.diagnostics.json` | Timing and AI call diagnostics |
| `debates/<slug>.harvest.json` | Harvest manifest |
