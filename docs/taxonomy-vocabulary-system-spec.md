# Taxonomy Vocabulary System: Specification

**Project:** AI Triad Taxonomy Editor + `ai-triad-research` ingestion pipeline
**Status:** Draft for review
**Supersedes:** The dictionary section of the term-ambiguity detection spec
**Depends on:** `taxonomy.embeddings.json` from the context-rot mitigation spec
**Estimated effort:** 8 weeks across four phases, with ~1 additional week for the rendering and quotation implementation work in Phase 3.
**Translation strategy:** Hybrid — local fuzzy ensemble (embedding similarity + token-sort phrase matching) as the default path, LLM-assisted fallback for low-confidence cases. See §4.3 and §4.7.
**Standardization criteria:** Four-criterion bar combining camp count, cross-camp Shannon entropy, embedding spread, and reviewer judgment. See §6.
**Rendering strategy:** Context-aware transformation between canonical and display forms with explicit quotation handling. See §4.8 and §4.9.
**Rollout strategy:** Feature-flagged, per-consumer enablement with staged enforcement and explicit rollback playbook. See §10.
**Deferred refinements:** Proposals considered but not adopted in v1, with reasoning and reconsideration conditions, are recorded in §12.

---

## 1. What This Is

The Taxonomy Vocabulary System is a controlled-vocabulary layer that sits underneath the AI Triad taxonomy and the debate engine. It exists to solve a specific analytical failure: cross-camp terms that look the same but mean different things, and cross-camp terms that look different but mean similar things. Both failure modes corrupt downstream analysis — document mapping, debate synthesis, evaluator judgments — in ways that are invisible without explicit vocabulary discipline.

The system has two artifact types and two display conventions:

**Standardized terms** are the canonical vocabulary used internally by the taxonomy and the tooling. They are compound coinages: `safety_alignment`, `commercial_alignment`, `alignment_compliance`, `documented_present_harm`, `speculative_future_harm`. They are unambiguous on their face and are the only terms that appear in node IDs, `characteristic_language` fields, persona prompt vocabularies, and JSON keys.

**Colloquial terms** are the bare terms that exist in the wild — `alignment`, `safety`, `harm`, `governance`. They are tracked by the system specifically so it knows they are *not to be used* as primary vocabulary in nodes or outputs. Each colloquial term entry maps to one or more standardized terms with translation rules.

**Canonical form** is the standardized term as written in code, JSON, and identifiers: `safety_alignment`. It is a stable, citable, mechanically-checkable string.

**Display form** is how the standardized term renders in human-facing prose: `alignment (safety)`. It is generated from the canonical form by a rendering pass that respects markdown structure, code contexts, URLs, and quotation markers — see §4.8 for the full transformation specification. Human readers see display forms; tooling operates on canonical forms.

The system is *prescriptive*, not descriptive. The taxonomy and tooling commit to using only standardized terms. CI enforces this. The colloquial dictionary exists to handle ingestion (translating documents into standardized vocabulary) and to record what the standardized terms are *not* — so a reader can trace why the project chose to coin a term rather than use the bare colloquial form.

## 2. Goals and Non-Goals

### Goals

- Eliminate cross-camp homonymy and synonymy from the taxonomy and from system-generated outputs (debate transcripts, syntheses, document analyses).
- Provide a citable, durable vocabulary artifact that other researchers can adopt or critique.
- Make vocabulary discipline mechanically enforceable so it doesn't erode over time.
- Surface the political work that bare colloquial terms do, by making every translation step visible and auditable.
- Preserve readability: human-facing outputs use display forms that read like ordinary scholarly prose.

### Non-Goals

- Standardizing every term in the taxonomy. Only terms that meet the ambiguity bar (defined in §6) get standardized. Most terms remain as ordinary words.
- Changing what the camps believe. The system records and disambiguates positions; it does not adjudicate them.
- Multilingual support. English-only for v1.
- Real-time vocabulary editing during debates or analyses. Vocabulary is edited in dedicated review sessions; runtime tools are read-only consumers.
- Auto-coinage. Every standardized term is coined by a human reviewer; detection produces candidates, not entries.

## 3. Artifacts Produced

### 3.1 The dictionary directory

A new top-level directory `dictionary/` parallel to `taxonomy/`:

```
dictionary/
├── schema/
│   ├── standardized_term.schema.json
│   ├── colloquial_term.schema.json
│   └── version.json                  # current schema version
├── standardized/
│   ├── safety_alignment.json
│   ├── commercial_alignment.json
│   ├── alignment_compliance.json
│   ├── documented_present_harm.json
│   └── ...                           # one file per standardized term
├── colloquial/
│   ├── alignment.json
│   ├── harm.json
│   ├── safety.json
│   └── ...                           # one file per colloquial term
├── coinage_log.md                    # append-only record of every coining decision
└── README.md
```

Files are committed to the repo. The dictionary is version-controlled alongside the taxonomy.

### 3.2 Standardized term entry

```json
{
  "$schema_version": "1.0.0",
  "canonical_form": "safety_alignment",
  "display_form": "alignment (safety)",
  "definition": "Ensuring advanced AI systems robustly pursue intended goals under distribution shift, including goals not explicitly specified at training time",
  "coined_for_taxonomy": true,
  "primary_camp_origin": "safetyist",
  "rationale_for_coinage": "The bare term 'alignment' is used by all three camps with substantively different referents. This standardized term names the technical-safety sense specifically so the taxonomy can discuss it without depending on context for disambiguation.",
  "characteristic_phrases": [
    "alignment problem",
    "inner alignment",
    "outer alignment",
    "mesa-optimizer",
    "deceptive alignment"
  ],
  "used_by_nodes": ["saf-cross-003", "saf-data-012"],
  "translates_from_colloquial": ["alignment"],
  "see_also": ["commercial_alignment", "alignment_compliance"],
  "do_not_confuse_with": [
    {
      "term": "commercial_alignment",
      "note": "A product being aligned with user intent in the commercial sense is unrelated to safety_alignment in the technical sense. Conflating these is a common discourse failure mode."
    }
  ],
  "contested_aspects": [
    "Whether this is a real problem distinct from alignment_compliance (Skeptics argue not)",
    "Whether current systems exhibit it (Accelerationists argue largely not)",
    "Whether it can be solved at all (positions vary within Safetyism)"
  ],
  "coinage_status": "accepted",
  "coined_at": "2026-05-15",
  "coined_by": "<reviewer-id>",
  "coinage_log_ref": "log-entry-007"
}
```

`coinage_status` values: `provisional` (newly coined, may change), `accepted` (settled, downstream tools can rely on it), `contested` (in active dispute, downstream tools should treat with care), `deprecated` (replaced; entry retained for reference, see `replaced_by`).

**Sense embeddings.** Each standardized term has an associated embedding computed from `definition + characteristic_phrases`, used by the translation pipeline (§4.3). These embeddings are stored separately in `dictionary/sense_embeddings.json` rather than inline in the term entry, both because they are large (1024-dim float arrays per sense) and because they are regenerated automatically rather than hand-edited. The build script invalidates a sense embedding when its source fields change, using the same hash mechanism as the taxonomy embedding index.

### 3.3 Colloquial term entry

```json
{
  "$schema_version": "1.0.0",
  "colloquial_term": "alignment",
  "status": "do_not_use_bare",
  "translation_required": true,
  "resolves_to": [
    {
      "standardized_term": "safety_alignment",
      "when": "Used in technical AI safety contexts; co-occurs with phrases like 'alignment problem,' references to RLHF or training objectives, mesa-optimizers",
      "default_for_camp": "safetyist",
      "confidence_typical": "high"
    },
    {
      "standardized_term": "commercial_alignment",
      "when": "Used in product/business contexts; co-occurs with product-market fit, user intent, customer needs",
      "default_for_camp": "accelerationist",
      "confidence_typical": "high"
    },
    {
      "standardized_term": "alignment_compliance",
      "when": "Used to mean compliance of behavior with stated values, especially with critique about whose values",
      "default_for_camp": "skeptic",
      "confidence_typical": "medium"
    }
  ],
  "translation_ambiguous_when": [
    "Author appears to deliberately conflate senses",
    "No contextual signal disambiguates",
    "Author is critiquing the conflation itself (in which case preserve the bare term in quotation)"
  ],
  "first_added": "2026-05-15",
  "last_reviewed": "2026-05-15"
}
```

`status` values: `do_not_use_bare` (must always be translated), `acceptable_in_quotation` (may appear when quoting a source), `safe` (term is unambiguous; appears here only because detection considered it but it didn't meet the ambiguity bar — entry retained for transparency).

### 3.4 The coinage log

`dictionary/coinage_log.md` is an append-only Markdown file that records every coining decision with rationale. Each entry includes the date, the reviewer, the candidate that triggered the coining, the alternatives considered, and the reason the chosen form won. This is the artifact that makes the project's vocabulary choices auditable by external readers.

### 3.5 The review queue

`dictionary/review_queue.json` is a generated artifact (regenerated on each detection run) that surfaces candidates for human review. It contains items in three categories:

- `candidate_homonym`: a colloquial term used across camps with high cross-camp entropy AND high embedding spread → may need to coin two or more standardized terms. Both signals are required to fire; neither alone is sufficient (see §6).
- `candidate_synonym`: two or more nodes across camps with high embedding similarity but low lexical overlap → may need to coin a single standardized term that all of them translate from.
- `candidate_drift`: a node currently using vocabulary that recent edits have moved away from the original sense → the standardized term may need its definition refined or the node may need a different standardized term.

The schema for review queue items is unchanged from the term-ambiguity detection spec, with one addition: each item includes `suggested_action` (`coin_new_terms`, `link_to_existing_terms`, `refine_definition`, `dismiss`) populated by the detection script.

### 3.6 The vocabulary lint report

`dictionary/lint_report.json` is regenerated on every CI run. It catalogs every place where a colloquial term with `status: do_not_use_bare` appears in a node's `name`, `description`, or `characteristic_language`, or in a persona prompt template, or in a generated synthesis. Empty report = green build. Non-empty report = build fails until the violations are translated to standardized terms or explicitly marked as quotations.

### 3.7 Translation records

Every colloquial-term occurrence translated by the pipeline produces a translation record. Records are stored in `summaries/<doc-id>.translations.json` (one file per document) and are the primary diagnostic artifact for evaluating translation quality.

```json
{
  "occurrence_id": "doc-042-occ-007",
  "document_id": "doc-042",
  "original_text": "the alignment problem remains the central challenge",
  "context_window": "...preceding 100 tokens... the alignment problem remains the central challenge ...following 100 tokens...",
  "colloquial_term": "alignment",
  "char_offset": 4521,
  "resolved_to": "safety_alignment",
  "confidence": "high",
  "method": "local_ensemble",
  "signals": {
    "safety_alignment": {
      "embedding_similarity": 0.74,
      "phrase_signal": 0.91,
      "phrase_matches": [
        {"phrase": "alignment problem", "score": 0.95},
        {"phrase": "central challenge", "score": 0.62}
      ],
      "combined_score": 0.766
    },
    "alignment_compliance": {
      "embedding_similarity": 0.45,
      "phrase_signal": 0.0,
      "phrase_matches": [],
      "combined_score": 0.383
    },
    "commercial_alignment": {
      "embedding_similarity": 0.32,
      "phrase_signal": 0.0,
      "phrase_matches": [],
      "combined_score": 0.272
    }
  },
  "weights": {"w_e": 0.85, "w_p": 0.15},
  "margin": 0.383,
  "rationale": null,
  "fallback_invoked": false,
  "model": null,
  "translated_at": "2026-06-20T14:33:00Z",
  "dictionary_version": "1.2.0"
}
```

Field semantics:

- `confidence` is one of `high`, `medium`, `ambiguous`. `high` means a confident commitment by the local ensemble; `medium` is the LLM-fallback resolution; `ambiguous` means the system declined to commit (the document analysis treats the occurrence as untranslated and surfaces it as an analytical observation).
- `method` is one of `local_ensemble`, `llm_assisted`. Always populated.
- `signals` records, per candidate sense, all the ensemble's component scores: the embedding similarity, the aggregated phrase signal, the individual phrase matches that contributed to the phrase signal (after noise-floor filtering), and the combined weighted score. Recording all signals — not just the winner — is what makes calibration and post-hoc review tractable.
- `weights` records the `w_e` and `w_p` values used for this translation. Recording them per-record means historical translations remain interpretable even if weights are re-tuned.
- `margin` is the difference between the top combined score and the runner-up.
- `rationale` is populated only when `method == "llm_assisted"`. It captures the model's stated reasoning for the resolution.
- `model` records which LLM was used for fallback calls (e.g., `claude-opus-4-7`, `ollama/llama3.1:8b`). Null for local-only translations.
- `dictionary_version` lets future re-translations detect when the dictionary has changed since this translation was made.

## 4. How Artifacts Are Used

### 4.1 By the taxonomy editor

The taxonomy editor's node detail view shows the canonical forms when editing (because that's what gets stored) and the display forms when previewing (because that's what readers see). Autocomplete in the `characteristic_language` editor pulls from the standardized term registry; typing a colloquial term that has `do_not_use_bare` status produces an inline warning with a one-click fix that opens a translation picker.

A new "Vocabulary" panel surfaces:
- The dictionary as a browsable list (filterable by camp, by status, by recency).
- The review queue with the existing review actions (now extended to dictionary-editing actions).
- The lint report, with each violation linked to the file and line where it occurs.

### 4.2 By the debate engine

**Persona prompts.** Each persona's system prompt includes the standardized terms relevant to that persona's camp (filtered by `primary_camp_origin` plus cross-camp terms the persona is likely to engage with). A new instruction:

> Use only standardized terms from the provided vocabulary. When you mean alignment in the safety sense, write `safety_alignment`. Do not use the bare term `alignment` — it is ambiguous across camps and the system will reject ambiguous outputs. The display form will be substituted for the canonical form when this output is shown to readers.

**Stage 3 extraction validation.** The Stage 3 extractor checks each persona output against the lint rules. Any occurrence of a `do_not_use_bare` colloquial term (outside of quotations) triggers a re-prompt of Stage 2 with the violation pointed out. After two failed attempts, the turn is logged as a vocabulary failure and proceeds with the violation flagged in the session record.

**Moderator.** The moderator gains a new signal: when two debaters appear to disagree on a topic but are using *different* standardized terms that translate from the same colloquial term, the moderator flags this as a possible cross-sense pseudo-disagreement. The synthesis later examines flagged turns specifically.

**Synthesis.** The synthesis prompt is instructed to write in display forms for readability while preserving the disambiguation. Output passes through a rendering step that substitutes display forms for canonical forms before the user sees it. The raw synthesis (in canonical forms) is preserved in the session record for audit.

### 4.3 By document analysis (hybrid translation pipeline)

Document analysis gains a translation pass that runs *before* taxonomy mapping. The pipeline is hybrid: a fast local embedding pass handles the majority of occurrences, and an LLM-assisted fallback handles the cases the local pass can't resolve confidently. This gives the cost profile of local processing with the quality of LLM-assisted disambiguation on the cases that need it.

#### Stage 1: Locate colloquial term occurrences

Scan the document for every colloquial term in the dictionary with `status: do_not_use_bare`. For each occurrence, capture a context window of approximately 100 tokens before and after, the character offset, and any structural metadata (section heading, paragraph index). Output: an unresolved occurrence list.

#### Stage 2: Local fuzzy-ensemble resolution (default path)

Stage 2 combines two complementary signals: an *embedding similarity* score that captures semantic relatedness between the occurrence's context and each candidate sense, and a *phrase signal* that captures specific characteristic-phrase matches with tolerance for natural language variation (morphology, word order, minor edits). Embedding similarity is good at "is this about the same thing"; phrase signal is good at "does this contain the exact lexical markers this sense is known for." Combining them recovers signal that pure embedding similarity dilutes and that pure phrase matching misses.

For each occurrence:

1. **Embed the context window** (~100 tokens around the occurrence) using the configured embedding model.

2. **Compute embedding similarity** to every candidate sense's pre-computed embedding. This produces `Sim_cos[sense]` for each candidate.

3. **Compute the phrase signal** for each candidate sense:
   a. For each characteristic phrase `P` in the sense's `characteristic_phrases` list, compute `FuzzyMatch(P, W_context)` using token-sort ratio (via `rapidfuzz.fuzz.token_sort_ratio` or equivalent), normalized to `[0, 1]`. Token-sort handles morphological variation ("alignment problems" vs "alignment problem") and word-order variation ("the problem of alignment" vs "alignment problem"), which are the most frequent sources of false-negative phrase matches in real documents.
   b. Apply a noise floor: scores below `phrase_noise_floor` (default 0.50) are treated as 0. Below this floor, matches are typically coincidental token overlap rather than real phrase matches.
   c. Aggregate via *sum of top-3 surviving scores*, bounded at 1.0. This rewards documents that hit multiple phrases without being dominated by a single high match — multi-phrase matches are a much stronger signal than single-phrase matches, which `Max()` aggregation would discard.

   The result is `Phrase_signal[sense] ∈ [0, 1]`.

4. **Compute the combined score** for each candidate:
   ```
   Score[sense] = w_e · Sim_cos[sense] + w_p · Phrase_signal[sense]
   ```
   With default weights `w_e = 0.85` and `w_p = 0.15`. The weights are exposed as configuration parameters and are primary calibration targets in Phase 4.

5. **Record all signals in the translation record**, not just the winner. The record includes per-sense `Sim_cos`, `Phrase_signal`, and combined `Score`. This is what makes calibration possible: a reviewer examining the record can see whether the embedding signal or the phrase signal drove the decision, and whether the two signals agreed or disagreed.

6. **Compute the margin**: difference between the top combined score and the runner-up.

7. **Apply the routing rule**:
   - **Top score ≥ `top_score_threshold` AND margin ≥ `margin_threshold`** → commit translation with `confidence: high`. Skip Stage 3.
   - **Otherwise** → mark the occurrence for Stage 3.

The thresholds and weights (default `top_score_threshold = 0.55`, `margin_threshold = 0.10`, `w_e = 0.85`, `w_p = 0.15`, `phrase_noise_floor = 0.50`) are *starting values*. Because the scoring function is now a weighted ensemble rather than pure embedding similarity, the routing thresholds will need re-calibration in Phase 4 — they cannot be inherited from the pre-ensemble version. Phase 4's calibration step explicitly tunes the weights and thresholds together against the hand-labeled validation set, since they interact: changing `w_p` shifts the distribution of combined scores, which changes which thresholds correspond to a given precision/recall point.

#### Stage 3: LLM-assisted fallback

For occurrences that didn't clear the Stage 2 thresholds:

1. Construct a prompt containing:
   - The occurrence with a larger context window (~500 tokens).
   - The candidate sense entries — but only the top 2–3 from Stage 2 scores, not all of them. This is where context-rot discipline matters: stuffing the full dictionary into every fallback call would reintroduce the long-context degradation the system is trying to eliminate.
   - An instruction to return one of: a confident translation with rationale, an ambiguity flag with explanation, or a "deliberate conflation" flag for cases where the document appears to be sliding between senses on purpose.
2. Call the configured LLM (see §4.7).
3. Record the result with `method: "llm_assisted"`. Confidence becomes `medium` for confident translations or `ambiguous` for flagged cases.

#### Stage 4: Map to nodes using translated vocabulary

The mapping step (already exists in the pipeline) now operates on the standardized-term-translated text rather than the raw document. Every colloquial term in the document body has been replaced (in the analytical view, not the original) with its standardized form, with original language preserved alongside.

This is the step that previously suffered from cross-camp homonymy. With translation in place, a document's mention of "alignment" no longer maps ambiguously to multiple cross-camp nodes — it has been resolved to a specific standardized term, and the mapping uses that.

#### Stage 5: Output

The output of analysis includes:

- The original document text, unmodified.
- The translation records for every colloquial-term occurrence (Stage 1–3 output).
- The standardized-vocabulary view of the document (original text with translation annotations inline).
- The taxonomy node mapping (Stage 4 output) that operates on the standardized view.
- A summary of ambiguous and deliberate-conflation flags, surfaced as analytical observations rather than translation failures.

The flags from Stage 3 are themselves valuable diagnostic output. They often indicate where the document is doing rhetorical work — places where the author is sliding between senses, deliberately or otherwise. A document analysis that reports "the author uses 'alignment' in three different senses across the introduction without distinguishing them" is more useful than one that picks one sense and proceeds.

### 4.4 By the ingestion pipeline

`scripts/batch_summarize.py` invokes the translation pass per document before invoking the existing summarization logic. Translation records are stored in `summaries/<doc-id>.translations.json`. When `TAXONOMY_VERSION` or dictionary version bumps trigger reprocessing, translations are re-run alongside summaries.

### 4.5 By external readers

The published taxonomy includes the dictionary as a sibling artifact. A taxonomy node referenced in a paper or blog post is automatically associated with the standardized terms it uses, which a reader can look up. The coinage log gives readers the rationale for every term they encounter. The colloquial dictionary entries explain why the project chose to coin terms rather than use the bare forms — a meta-commentary on the discourse that's valuable independent of the taxonomy.

### 4.6 By detection and review

Detection scripts (homonym, synonym, drift) run against the current taxonomy and dictionary state. Their output is the review queue. A reviewer working through the queue can take five actions, now reframed for the dictionary-centric world:

| Action | Effect |
|---|---|
| `coin_terms` | Open the standardized term editor with a draft populated from the candidate. Reviewer fills in definition, rationale, characteristic phrases. On save, the entry is committed and any nodes pointed at the candidate get updated. |
| `link_to_existing` | Add a `translates_from_colloquial` link rather than coining a new term. Used when a candidate is really an existing standardized term in disguise. |
| `refine_definition` | Edit an existing standardized term's definition or characteristic phrases. Used for drift cases. |
| `mark_safe` | The candidate doesn't actually need standardization. Records a `mark_safe` decision so the same candidate doesn't keep resurfacing. |
| `dismiss` | Same as before. 90-day suppression, resurface on text change. |

### 4.7 Translation pipeline configuration

The translation pipeline (§4.3) accepts configuration that controls cost, latency, and where compute happens. These settings live in `config/translation.yml`:

```yaml
embedding:
  provider: voyage          # voyage | openai | local
  model: voyage-3-large     # must match the embedding model used for the taxonomy index
  cache_dir: .cache/embeddings

ensemble:
  # Weights for combining embedding similarity and phrase signal
  # Combined score = w_e * embedding_similarity + w_p * phrase_signal
  w_e: 0.85
  w_p: 0.15

  # Phrase-matching configuration
  phrase_match_function: token_sort_ratio  # token_sort_ratio | jaccard | levenshtein
  phrase_noise_floor: 0.50                 # phrase scores below this are zeroed
  phrase_aggregation: top_k_sum            # top_k_sum | mean | max
  phrase_top_k: 3                          # top-K matches summed (capped at 1.0)

routing:
  top_score_threshold: 0.55
  margin_threshold: 0.10
  context_window_tokens: 100

llm_fallback:
  enabled: true
  provider: anthropic       # anthropic | openai | ollama | none
  model: claude-opus-4-7    # provider-specific model identifier
  endpoint: null            # required when provider == "ollama"
  fallback_context_tokens: 500
  max_retries: 2
  timeout_seconds: 30

  # Sense candidate filtering for the fallback prompt
  max_candidate_senses: 3   # passed to the LLM, not all senses

review:
  spot_check_first_n: 50    # first N translations on a new corpus get hand-flagged for review
  log_all_fallback_calls: true
```

The `ensemble` block is the primary tuning surface for translation quality. Defaults reflect the proposal in [Deferred Refinements §12.A]: a weighted sum with `w_e = 0.85` and `w_p = 0.15`, token-sort ratio for fuzzy matching, a noise floor at 0.50, and sum-of-top-3 aggregation rather than max. These defaults are starting points; Phase 4 calibration tunes all five `ensemble` parameters together against the validation set.

The `phrase_match_function` is configurable but token-sort ratio is the recommended default. It handles the failure modes that occur most frequently in well-edited documents (morphological variation like "alignment problems" vs "alignment problem", word-order variation like "the problem of alignment" vs "alignment problem"). Jaccard works similarly. Levenshtein is included as an option but is not recommended for this use case — it handles typos that are rare in published documents while failing on word-order variation that is common.

The configuration is intentionally explicit about which provider does what. Users running the pipeline without API access can set `embedding.provider: local` (using a local sentence-transformer) and `llm_fallback.provider: ollama` (using a local Llama model). Users with API budgets can use cloud providers for both. The pipeline behavior is otherwise identical.

**LLM-disabled mode.** Setting `llm_fallback.enabled: false` causes the pipeline to skip Stage 3 entirely. Occurrences that would have been routed to the LLM are committed with `confidence: ambiguous` and `method: local_ensemble`. This is the appropriate setting when running offline or when budget is constrained — the system still functions, but with more occurrences flagged for human review.

**Cost expectations.** With `voyage-3-large` for embeddings and `claude-opus-4-7` for fallback, on a corpus of ~200 documents averaging 10 colloquial term occurrences each, expected per-batch cost is approximately $5–15: most occurrences resolve locally at fractions of a cent, and only the ~10–15% that hit the fallback incur a model call. The exact ratio depends on the dictionary's characteristic-phrases quality; better characteristic phrases mean more local resolutions and lower cost.

**Latency expectations.** Local embedding resolution is ~5–20ms per occurrence. LLM fallback is ~2–5 seconds per occurrence. A typical document of 10K tokens with 10 colloquial occurrences takes ~5 seconds total when most resolve locally; ~30 seconds if all hit the fallback. Batch processing 200 documents is dominated by the fallback rate.

### 4.8 Rendering specification

The rendering layer transforms canonical forms (used internally) into display forms (shown to readers) and back. This is the system's most error-prone surface: a sloppy renderer can corrupt code samples, file references, URLs, and quoted text. The specification below is intentionally precise.

#### Definitions

A **canonical form** is a string matching the regex `[a-z][a-z0-9_]*` that is registered as the `canonical_form` field of some standardized term entry in the dictionary. The set of registered canonical forms is fixed per dictionary version.

A **protected boundary** is one of: start-of-input, end-of-input, ASCII whitespace, or a punctuation character from the set `. , ; : ! ? ( ) [ ] { } " ' ` < > / \`. Notably, underscore (`_`) and hyphen (`-`) are NOT protected boundaries — they are permitted within canonical forms and must not split tokens.

A **rendering context** is one of: `prose` (default), `code_inline` (between single backticks), `code_block` (between triple backticks), `url` (inside a markdown link target or autolinked URL), `quotation` (inside an explicit quotation marker — see §4.9), `escape` (immediately after the escape sequence `@@`).

#### Forward rendering (canonical → display)

The forward renderer walks the input as a token stream with explicit context tracking. Pseudocode:

```
for each token in input:
  update context based on markdown structure
  if context in {code_inline, code_block, url, escape}:
    emit token unchanged
  elif token is a registered canonical form AND
       previous character is a protected boundary AND
       next character is a protected boundary:
    emit display form for that canonical form
    record substitution (offset, canonical_form, display_form) in render log
  else:
    emit token unchanged
```

The escape context lets a writer refer to a canonical form *as a string* without rendering: `@@safety_alignment` renders as the literal text `safety_alignment`. The `@@` itself is consumed by the renderer.

#### Reverse rendering (display → canonical)

Reverse rendering is used when a writer types a display form in the editor and the system stores the canonical form. It is intentionally narrower than forward rendering — only exact display-form matches at protected boundaries trigger replacement. Partial matches, capitalization variants, and synonymic phrasings (e.g., "alignment in the safety sense") are NOT auto-canonicalized; they produce an editor warning offering a one-click conversion. This conservatism is deliberate: implicit canonicalization of writer input is exactly the kind of magic that erodes trust in the tooling.

#### Annotated output

Every rendering pass produces, alongside the rendered string, a render log: a list of `{offset, canonical_form, display_form, context}` records. The render log is preserved in session records and synthesis outputs. This serves three purposes: editor highlighting (rendered terms display differently from raw prose), debugging (when something looks wrong, the log shows what was substituted), and audit (a reader can verify what the system did to produce a given output).

#### Test requirements

The rendering implementation requires a test suite of at least 30 fixtures covering:

- Basic substitution: `safety_alignment` in plain prose → `alignment (safety)`.
- Boundary cases: `non_safety_alignment`, `safety_alignment_research`, `presafety_alignment` — none should match.
- File and URL contexts: `safety_alignment.json`, `[link](https://example.com/safety_alignment)` — no substitution.
- Code contexts: `` `safety_alignment` ``, fenced code blocks containing canonical forms — no substitution.
- Escape: `@@safety_alignment` → literal `safety_alignment`.
- Quotation: handled by §4.9 fixtures.
- Adjacent canonical forms: `safety_alignment commercial_alignment` — both substitute.
- Canonical forms in headings, lists, tables: substitute normally.
- Mixed: a paragraph with canonical forms in prose, code, URLs, and quotations all in close proximity.

Test fixtures live in `lib/dictionary/__tests__/render_fixtures/` with paired `input.md` and `expected.md` files. CI fails on any divergence.

#### Failure modes the renderer must NOT exhibit

These are explicit non-behaviors that the test suite must verify:

1. Rendering inside code blocks or inline code spans.
2. Rendering inside URLs or markdown link targets.
3. Substring matches (rendering `safety_alignment` inside `non_safety_alignment`).
4. Case-insensitive matches (rendering `Safety_Alignment` or `SAFETY_ALIGNMENT`).
5. Rendering canonical forms that are not registered in the current dictionary version.
6. Modifying input in `escape` context.
7. Rendering inside `<q canonical-bypass>` quotation markers (see §4.9).

### 4.9 Quotation handling

Quotations are the rendering case most likely to corrupt content if mishandled. A document being quoted should preserve its original language even when that language uses bare colloquial terms; the surrounding non-quoted prose should still have canonical forms rendered. This requires explicit quotation marking and a small recursive grammar.

#### Marker convention

Quoted spans are wrapped in `<q canonical-bypass>...</q>` markers. The marker is intentionally HTML-style rather than markdown-native because:

- Markdown blockquotes (`>`) are commonly used for callouts, asides, and notes — overloading them as canonical-form bypass is too implicit.
- Inline quotes (`"..."` or `"..."`) appear constantly in prose for non-quotation purposes.
- The HTML-style marker forces the writer (or the emitting tool) to be deliberate about marking quotation.
- The `canonical-bypass` attribute makes the marker's effect on rendering explicit and self-documenting.

#### Editor integration

The taxonomy editor and any writing surface in the system provides a one-click "mark as quotation" action that wraps the selection in markers. Writers should not be expected to type the markers by hand. The editor displays marked quotations with a subtle background tint so writers can see what's been marked.

#### Recursive nesting

Quotation markers nest. A `<q>` inside a `<q>` is valid, and the inner content remains in bypass context. This handles the case where a synthesis quotes a debate turn that quotes a document. The renderer maintains a depth counter rather than a boolean — entering `<q>` increments, leaving decrements, and bypass applies whenever depth > 0.

#### Auto-marking by emitting tools

Tools that emit content with embedded quotation should auto-wrap the quoted spans:

- **Document analysis** wraps verbatim document quotations with `<q canonical-bypass>` when including them in summaries or evidence fields.
- **Debate engine** wraps debater turn quotations when the synthesis references them.
- **Synthesis** wraps any verbatim text it quotes from transcripts or documents.

This means writers using the editor manually need to mark quotations, but the automated pipelines do not require post-hoc marking — they emit correct content from the start.

#### Grammar

A simplified BNF for the quotation-aware text format:

```
text       := segment*
segment    := plain | quoted | code | escape
quoted     := "<q canonical-bypass>" text "</q>"
code       := inline_code | code_block
inline_code:= "`" non-backtick-text "`"
code_block := "```" lang? newline non-fence-text "```"
escape     := "@@" canonical_form
plain      := any-text-not-matching-above
```

Note that `text` recurses into `quoted`, which is what enables nesting. The grammar is small enough to implement with a hand-written recursive-descent parser; no external parsing library is needed.

#### Test corpus

A specific test corpus of 20 fixtures in `lib/dictionary/__tests__/quotation_fixtures/`:

1. Empty quotation: `<q canonical-bypass></q>` — passes through unchanged.
2. Quotation containing a bare colloquial term: bare term preserved.
3. Quotation containing a canonical form: canonical form preserved (NOT rendered).
4. Quotation surrounded by prose with canonical forms: prose renders, quotation doesn't.
5. Multi-paragraph quotation: bypass applies across paragraph breaks.
6. Nested quotation, two levels deep: inner content stays in bypass.
7. Nested quotation, three levels deep: same.
8. Quotation inside a code block: code-block context wins (everything bypassed; quotation marker treated as text).
9. Code inside a quotation: both contexts apply; nothing renders.
10. Quotation containing a URL: URL not rendered as canonical form, URL displayed as URL.
11. Unterminated quotation (`<q canonical-bypass>` without closing `</q>`): renderer reports a parse error rather than silently extending bypass to end-of-document.
12. Mismatched closing marker (closing `</q>` without opening): renderer reports a parse error.
13. Quotation with only whitespace: handled like empty.
14. Quotation containing escape sequences: escapes still work inside quotation (though they're redundant — bypass already prevents rendering).
15. Quotation immediately adjacent to canonical form: `<q canonical-bypass>...</q>safety_alignment` — quoted content preserved, canonical form after the closing marker renders.
16. Quotation with markdown formatting inside: bold, italic, lists inside quotation render normally as markdown, but canonical forms within don't substitute.
17. Long quotation (>10K characters): performance test, must complete in reasonable time.
18. Quotation with HTML-like content that isn't a quotation marker: only `<q canonical-bypass>` and `</q>` are recognized; other HTML-like tags are treated as plain text.
19. Quotation inside a list item: list rendering still works, content inside is bypassed.
20. Adversarial: deliberately malformed nesting and edge cases designed to break naive parsers.

#### Storage and round-tripping

Stored content (in node fields, summaries, debate transcripts, syntheses) preserves the quotation markers verbatim. The markers are part of the content's source-of-truth representation. They are stripped only at the final rendering step before display to a human reader, and the stripping is logged so it can be reversed.

This means a debate transcript stored in a session record contains `<q canonical-bypass>...</q>` markers. Loading and re-rendering the transcript should produce identical output. Round-tripping (load → render → reverse-render → save) must be a no-op for any valid stored content; CI verifies this on a sample of stored artifacts.

## 5. Constraints and Invariants

These are CI-enforced. Violations fail the build (subject to the enforcement ramp described in §10.3).

1. Every standardized term has a unique `canonical_form` and `display_form`.
2. Every node ID referenced by `used_by_nodes` exists in the taxonomy.
3. Every standardized term referenced by a colloquial entry's `resolves_to` exists.
4. No node `name`, `description`, or `characteristic_language` field contains a colloquial term with `status: do_not_use_bare` outside of `<q canonical-bypass>` quotation markers (see §4.9).
5. No persona prompt template contains a `do_not_use_bare` colloquial term outside quotation markers.
6. No stored synthesis output (canonical-form version) contains a `do_not_use_bare` colloquial term outside quotation markers.
7. Every standardized term with `coinage_status: accepted` has a coinage log entry referenced in `coinage_log_ref`.
8. The dictionary schema version recorded in entries matches the current schema version, or a migration script has been run.
9. Round-tripping (load stored content → render → reverse-render → save) produces output identical to the original. Verified on a sample of stored artifacts on every CI run.
10. All quotation markers in stored content are well-formed: every opening `<q canonical-bypass>` has a matching closing `</q>`, and depth never goes negative. Malformed markers fail the build.

## 6. Standardization Bar

Not every term that varies across camps gets standardized. The bar:

A colloquial term is standardized iff it meets all four:

1. **Used by nodes in two or more camps.** Cross-cutting alone doesn't count.
2. **Cross-camp Shannon entropy ≥ 0.6 (normalized to [0, 1]).** Measures how evenly the term is distributed across camps. Maximum entropy (1.0) corresponds to perfectly equal usage across all camps; minimum (0.0) to one camp using the term exclusively. The 0.6 threshold corresponds approximately to "the smallest camp using the term has at least ~15% of total usages." A term concentrated in one camp doesn't cause cross-camp confusion regardless of how its embedding looks, because there are no cross-camp usages to confuse.
3. **Embedding spread across containing nodes ≥ 0.40.** Same threshold as the homonymy detector. Captures whether the cross-camp usages actually diverge in meaning, not merely in syntax.
4. **Reviewer judgment that the variation is analytically meaningful.** This is the load-bearing criterion. The first three are necessary; the fourth is what makes standardization worthwhile.

The entropy threshold and the embedding spread threshold are complementary and both required: entropy measures distributional imbalance, spread measures semantic divergence. A term can have high entropy (used evenly across camps) but low spread (every camp means the same thing by it — boring, not standardized), or low entropy (one camp dominates) but high spread (the rare cross-camp usages disagree — possibly worth a sense_distinction note rather than full standardization). Only when both signals fire does standardization pay off.

Terms that fail any criterion are recorded in the colloquial dictionary with `status: safe`, with a note explaining which criterion they failed and why. This makes the standardization decisions auditable: a reader can ask "why isn't 'governance' a standardized term?" and the entry will explain — for example, "governance has cross-camp entropy 0.71 but embedding spread 0.22; all three camps use the term to mean substantively the same thing, so disambiguation isn't needed."

The expected output: 15–30 standardized term families in v1, growing to perhaps 40–50 over a year of operation. Many more than that and the system becomes unreadable; fewer and it isn't doing its job.

## 7. Phased Implementation Plan

### Phase 1 — Foundations (Weeks 1–2)

**Deliverables:**
- Dictionary schemas (`standardized_term.schema.json`, `colloquial_term.schema.json`).
- Empty `dictionary/` directory structure committed.
- Dictionary loader library (`lib/dictionary/`) with read-only API: `getStandardized(canonical_form)`, `getColloquial(term)`, `renderDisplay(text_with_canonical_forms)`, `lintText(text)`.
- Sense embedding builder script (`scripts/build_sense_embeddings.py`) that computes embeddings for every standardized term's `definition + characteristic_phrases` and writes them to `dictionary/sense_embeddings.json`. Uses incremental rebuild (hash-based) like the taxonomy embedding builder.
- Translation configuration schema (`config/translation.yml`) with documented defaults.
- CI lint script for constraints 1–3 only (referential integrity within the dictionary). Constraints 4–8 deferred to Phase 3 to avoid blocking Phase 2 work.
- Test suite covering loader, lint script, and sense embedding builder.
- `coinage_log.md` template.

**Goal:** Infrastructure ready. No behavioral change to taxonomy or tools yet. This phase has no risk of breaking anything because nothing consumes the dictionary yet.

**Exit criteria:**
- Loader passes test suite.
- Empty dictionary lints clean.
- Schema versioning works: `version.json` is read at load time, schema mismatch produces a clear error.
- Sense embedding builder runs cleanly against an empty dictionary (produces empty `sense_embeddings.json`).

### Phase 2 — Initial Vocabulary (Weeks 3–4)

**Deliverables:**
- Run the term-ambiguity detection scripts against the existing taxonomy. Produce the first review queue.
- Hand-process the queue. Coin the first batch of standardized terms (target: 15–25 entries) and create the corresponding colloquial entries.
- Populate `coinage_log.md` for each coined term.
- Run `build_sense_embeddings.py` to produce the sense embedding index for the newly coined terms. This is what Phase 3's translation pipeline will consume; it must exist before Phase 3 starts.
- Update affected taxonomy nodes to use canonical forms in `name`, `description`, `characteristic_language`. This is a real edit pass, not a mechanical rewrite — many nodes will need rephrasing to read naturally with standardized terms.
- **POV item revision pass.** Walk every POV item field — assumptions, steelmans, vulnerabilities, examples, characteristic language — and revise any prose containing `do_not_use_bare` colloquial terms. This is structured as three sub-passes:
  - *Pass 1 (surgical):* lint the POV fields as a report. For each violation where the sense is unambiguous from context, do the substitution. Track ambiguous cases for Pass 2.
  - *Pass 2 (analytical, per-POV):* read each POV's content as a coherent set with the dictionary in hand. Rewrite passages where the original prose was sliding between senses; substitution alone won't fix these.
  - *Pass 3 (cross-POV coherence):* read all three POVs together. Verify that places where camps appear to disagree are now genuinely disagreeing, and that places where they appear to agree are now using the same standardized term rather than different ones for the same referent.

**Goal:** A real vocabulary exists, and all existing POV content has been migrated to use it. The taxonomy still works for downstream consumers, but now with internally consistent vocabulary throughout.

**Exit criteria:**
- Lint constraint 4 (no bare colloquial terms in nodes) passes for all curated content, not only node names.
- Every standardized term has a coinage log entry.
- Sense embedding index covers every standardized term.
- A sample of 5 nodes and 3 POV items manually reviewed for readability with the new vocabulary.

This is the human-judgment-heavy phase. Detection produces candidates; humans coin terms and revise prose. Expect this phase to expose schema gaps that prompt v1.1 schema revisions — that's normal and is why Phase 1 includes schema versioning. Expect also to find places where the original POV prose was relying on cross-camp ambiguity to feel sharp; rewriting those passages is the highest-value work in this phase.

### Phase 3 — Enforcement and Translation (Weeks 5–6)

**Deliverables:**
- CI lint constraints 4–8 enabled and enforcing.
- **Translation pipeline implementation** (`lib/translation/`):
  - Stage 1: occurrence locator. String-scanning against the colloquial dictionary.
  - Stage 2: local embedding resolver. Uses the embedding model from `config/translation.yml` and the sense embedding index from Phase 1.
  - Stage 3: LLM-assisted fallback. Provider-agnostic implementation supporting Anthropic, OpenAI, and Ollama via a thin abstraction (`litellm` or equivalent). Configurable via `config/translation.yml`.
  - Stage 4–5: integration with existing mapping and output stages.
  - Routing logic with thresholds from configuration.
  - Translation record schema and persistence to `summaries/<doc-id>.translations.json`.
- Document analysis integration. Both `scripts/batch_summarize.py` and the manual analysis prompt invoke the pipeline.
- Persona prompt templates updated to include relevant standardized terms and the vocabulary instruction. Stage 3 extraction validation against the lint rules.
- Display-form rendering step in the synthesis output pipeline.
- The taxonomy editor's "Vocabulary" panel: dictionary browser, review queue UI, lint report viewer, translation record viewer for sample documents.

**Goal:** The system enforces and uses the vocabulary at every consumption point. Outputs are in standardized canonical forms internally and display forms externally. Documents are translated through the hybrid pipeline before mapping.

**Exit criteria:**
- A full end-to-end debate session runs to completion using only standardized terms in canonical form, with display-form rendering applied for output.
- A document analysis run on three sample documents produces translation records that pass spot-check. At least one document should exercise the LLM fallback path; at least one should resolve entirely locally.
- Lint runs clean across the repo.
- Translation pipeline runs in both LLM-enabled and LLM-disabled modes successfully (the disabled mode produces more `confidence: ambiguous` records, which is expected).

This phase is where things might break. The persona prompts are real prompt-engineering work — forcing the personas to use specific vocabulary will sharpen their disagreements but may also make them sound stilted at first. Expect prompt iteration. The display-form rendering step is also tricky: it must distinguish canonical forms from coincidental string matches in user-provided content. Plan for at least one round of bug-fixing after first deployment. The translation pipeline's threshold tuning (Stage 2 routing) is also likely to need adjustment after Phase 3; Phase 4 includes a calibration step.

### Phase 4 — Operations and Iteration (Weeks 7–8)

**Deliverables:**
- Detection scripts re-run against the now-standardized taxonomy. Identify remaining unstandardized cases.
- Second review pass to coin additional terms. Target: bring total to 25–35 entries.
- **Translation calibration with five-dimensional evaluation.** Hand-label a validation set of 100 colloquial-term occurrences across 10 documents — a deliberately small but carefully labeled set, sized to the project's actual scale. Run the pipeline against it and compute:

  1. **Per-term precision and recall.** For each standardized term that appears in the validation set ≥10 times, report precision and recall separately. Flag any term where precision drops below 0.85 or recall drops below 0.70 — those entries need attention (better characteristic phrases, refined definition, or possibly a structural rethink). Aggregate-only metrics hide per-term failures and are insufficient.

  2. **Per-camp confusion matrix.** A 3×3 matrix where rows are the hand-labeled "intended camp" of each occurrence and columns are the pipeline's "resolved-to camp." The diagonal should dominate. Any off-diagonal cell with ≥10% of its row's mass indicates systematic cross-camp confusion — the most analytically-damaging failure mode, because it represents the system silently taking sides.

  3. **Ambiguity rate.** The percentage of validation occurrences flagged as `confidence: ambiguous`. Operational metric, not a precision/recall number. Target band: 5–15%. Below 5% suggests the system is committing too readily on edge cases (false confidence). Above 15% suggests the dictionary's characteristic phrases are too weak (the local pass can't distinguish senses). Either is a signal for action.

  4. **Fallback accuracy spot-check.** Hand-review at least 50 fallback (`method: llm_assisted`) translations. Look specifically for: (a) systematic preference for one sense over another, (b) hallucinated rationales that don't match the rationale's own logic, (c) cases where the LLM disagreed with the local pass's runner-up and was wrong, (d) cases where the LLM disagreed with the local pass's winner and was right. The last category is the most informative — it suggests where the local pass's threshold should be lowered to route more cases to the fallback.

  5. **Downstream impact comparison.** Take 5 documents that were analyzed pre-vocabulary and 5 that were analyzed post-vocabulary. Read both side-by-side and rate which mapping is more accurate. This is intentionally informal — the project's scale doesn't support a controlled experiment, but the side-by-side comparison catches regressions that the upstream metrics miss.

  Calibration script (`scripts/calibrate_translation.py`) runs the pipeline against the validation set, computes all five dimensions, and recommends adjustments to the ensemble weights (`w_e`, `w_p`), the routing thresholds (`top_score_threshold`, `margin_threshold`), and the phrase-signal parameters (`phrase_noise_floor`, `phrase_top_k`). The recommendations are advisory — actual changes require a reviewer's confirmation, because the parameters interact (lowering `w_p` reduces phrase signal influence, which changes which thresholds correspond to a given precision/recall point; lowering `phrase_noise_floor` admits more weak matches, which changes the same thing). A separate calibration step tunes the standardization-bar entropy threshold (default 0.6) against hand-labeled examples of correctly-standardized vs. correctly-unstandardized terms.

  Target precision on `confidence: high` translations: ≥0.90. This is the minimum bar; the per-term and per-camp metrics above are the diagnostic tools used to reach and maintain it.

- Audit script that compares pre-vocabulary debate sessions (if any are preserved) against post-vocabulary sessions for synthesis quality. Hand-review of 10 sessions.
- `dictionary/README.md` written for external readers, explaining the system and how to read the artifacts. Includes a section on the translation pipeline so external users running the tooling understand what it does and what its limits are. Includes the rendering and quotation specifications (§4.8 and §4.9) in a form accessible to writers, not just implementers.
- Backfill: run translation pipeline against existing summaries in `summaries/_inbox/` so the corpus has consistent vocabulary.

**Goal:** Operational tooling settled. Vocabulary at sustainable steady-state. Translation pipeline calibrated against a multi-dimensional evaluation surface. External-facing documentation in place.

**Exit criteria:**
- Quarterly detection cadence established with calendar reminder.
- Lint passes consistently across recent commits.
- Translation pipeline meets the per-term, per-camp, and aggregate precision targets on the validation set.
- Synthesis hand-review shows no regression in readability and a measurable improvement in disambiguation (reviewer can identify cases where the new system surfaced disagreements that the old system would have hidden).
- README is reviewed by someone outside the project as a comprehension test.

### Beyond Phase 4

The vocabulary system is a living artifact. New terms get coined as the discourse evolves. New ambiguities are detected on each taxonomy version bump. Periodic reviews (quarterly) walk the review queue and decide what to coin, link, refine, or dismiss. The coinage log grows over time and becomes a record of the project's intellectual development.

A v2 question worth flagging now but not solving: should standardized terms migrate from `provisional` to `accepted` based on usage, or only by explicit reviewer action? Usage-based promotion is convenient but lets the system drift without anyone noticing. Explicit promotion is more conservative but adds friction. Defer to v2 once you've seen how `provisional` terms behave in practice.

## 8. Risks and Open Questions

**Risk: Forcing personas to use standardized vocabulary makes their outputs read awkwardly at first.** Mitigated by Phase 3 prompt iteration. Worst case, the system records vocabulary failures and the synthesis surfaces them as data — even an awkward output is more analytically useful than a fluent one that hides cross-sense ambiguity.

**Risk: Translation pass introduces errors that propagate downstream.** Mitigated by preserving original language alongside translations, so a reader can verify. Mitigated also by ambiguity flagging — low-confidence translations are surfaced rather than silently committed.

**Risk: Local embedding pass commits confidently to wrong senses.** This is a precision risk: the local pass scores above threshold but is wrong. Mitigated by Phase 4 calibration on a hand-labeled validation set, by the spot-check requirement on the first 50 translations of any new corpus, and by the structural choice to record all candidate scores (not just the winner) so post-hoc review can catch systematic errors. The validation set should be refreshed annually because the dictionary's characteristic phrases may evolve.

**Risk: LLM fallback is expensive at scale.** With a corpus of thousands of documents, fallback costs could grow substantially. Mitigated by the threshold-based routing (most occurrences resolve locally) and by the configuration option to disable LLM fallback entirely for batch runs where budget is constrained. Worth monitoring: the percentage of occurrences hitting the fallback. If it rises above ~25%, that's a signal that the dictionary's characteristic phrases need strengthening — the local pass should be doing more of the work.

**Risk: LLM fallback reintroduces context-rot problems.** The fallback prompt is deliberately small (one occurrence + 2–3 candidate senses + ~500 tokens of context), so it shouldn't trigger long-context degradation. But if an implementer accidentally passes the full dictionary or the full document, the system would be back to the original failure mode. Mitigated by code review and by an integration test that asserts fallback prompt size stays under 4K tokens.

**Risk: Local-vs-remote LLM choice produces inconsistent translations.** Two batches translated with different `llm_fallback.provider` settings might produce different translations on borderline cases. Mitigated by recording `model` in every translation record, so divergent translations are diagnosable. For published corpora, recommend committing to one provider per release.

**Risk: Rendering layer corrupts user content.** A canonical form that appears coincidentally inside a code sample, file path, URL, or user-entered prose could be mangled by an over-eager renderer. Mitigated by the explicit context tracking in §4.8, the test corpus (≥30 fixtures including adversarial inputs), and the round-tripping invariant (constraint 9) that fails CI if any stored artifact fails to round-trip cleanly. The render log preserved alongside output makes any erroneous substitution diagnosable after the fact.

**Risk: Quotation markers break or get stripped by intermediate tools.** Some markdown processors might strip unknown HTML tags, including `<q canonical-bypass>`. If the quotation markers disappear between storage and rendering, bypass stops working and quoted bare terms get rendered. Mitigated by treating the markers as part of the source-of-truth content (never stripped in storage or transmission), and by the well-formedness lint (constraint 10) that catches missing markers. For systems that genuinely cannot preserve the markers (e.g., if the output is published to a platform that strips HTML), the rendering pass converts to display forms before publication and embeds the original quotation context in a footnote or alt text.

**Risk: The display-form layer fails to render in some output path.** Concretely: a synthesis is generated, display forms are substituted, but somewhere downstream the canonical form leaks into a published artifact. Mitigated by a final rendering check before any external output that fails the build if canonical forms appear in user-facing strings.

**Risk: Vocabulary review becomes a bottleneck.** If detection produces 50 candidates per quarter and each takes 30 minutes to review, that's 25 hours per quarter — meaningful but tractable. If it produces 200 candidates, that's unsustainable. Mitigated by aggressive `dismiss` on candidates that don't meet the third standardization criterion (analytically meaningful variation). The first review pass is large; subsequent ones should be small.

**Open question: How are standardized term *changes* handled?** If `safety_alignment`'s definition is refined a year in, do downstream artifacts (existing summaries, debate sessions) get retroactively updated? My recommendation: no automatic retroactive update — old artifacts retain their original meaning, but a `definition_changed_at` field is added to the standardized term entry, and tooling can flag artifacts that predate the change for re-review if needed. This avoids invisible rewriting of historical analyses.

**Open question: Who has authority to coin terms?** Captured in `coined_by`. For v1, single-author project — this is straightforward. If the project gains contributors, a `coining_status: provisional` → `accepted` workflow with reviewer sign-off becomes valuable. Defer the formal governance to when it's needed.

**Open question: Should colloquial terms with `status: safe` be displayed in the dictionary at all?** Argument for: transparency about what was considered. Argument against: clutter that obscures the terms that actually matter. My recommendation: keep them, but in a separate section of the UI ("considered and not standardized") rather than mixed in with active entries.

## 9. Files Touched

| File | Change |
|---|---|
| `dictionary/schema/*.json` | New. Schemas for the two entry types and the version file. |
| `dictionary/standardized/*.json` | New. One file per standardized term, populated in Phase 2. |
| `dictionary/colloquial/*.json` | New. One file per colloquial term, populated in Phase 2. |
| `dictionary/sense_embeddings.json` | New. Generated artifact: pre-computed embeddings of standardized term senses. Built by `build_sense_embeddings.py`. |
| `dictionary/coinage_log.md` | New. Append-only log. |
| `dictionary/review_queue.json` | New. Generated artifact. |
| `dictionary/lint_report.json` | New. Generated artifact. |
| `dictionary/README.md` | New. External-reader documentation. |
| `config/translation.yml` | New. Translation pipeline configuration (embedding provider, LLM fallback provider, thresholds). |
| `config/feature_flags.yml` | New. Feature flags per §10.1, controlling which consumers of the vocabulary system are active. |
| `lib/dictionary/loader.ts` | New. Read-only dictionary API. |
| `lib/dictionary/lint.ts` | New. Lint logic for all 8 constraints. Implements the warning/soft_fail/enforcing modes. |
| `lib/dictionary/render.ts` | New. Forward and reverse rendering per §4.8. Includes context-tracking parser, render log emission, and round-tripping verification. |
| `lib/dictionary/quotation.ts` | New. Quotation marker parser and grammar implementation per §4.9. Handles recursive nesting, malformed input, auto-marking helpers. |
| `lib/dictionary/__tests__/render_fixtures/` | New. ≥30 paired input/expected fixtures for the renderer. |
| `lib/dictionary/__tests__/quotation_fixtures/` | New. 20 fixtures covering quotation cases including nesting, malformed input, and adversarial cases. |
| `lib/dictionary/__tests__/` | New. Test suite covering loader, lint, render, quotation. |
| `lib/translation/locator.ts` | New. Stage 1: scans documents for colloquial-term occurrences. |
| `lib/translation/local_resolver.ts` | New. Stage 2: local embedding-based sense resolution. |
| `lib/translation/llm_fallback.ts` | New. Stage 3: provider-agnostic LLM-assisted fallback. |
| `lib/translation/pipeline.ts` | New. Orchestrates stages 1–5; produces translation records. |
| `lib/translation/__tests__/` | New. Test suite including local-only and fallback-required fixtures. |
| `scripts/build_sense_embeddings.py` | New. Builds `dictionary/sense_embeddings.json` from standardized term entries. Incremental rebuild via hashing. |
| `scripts/detect_homonyms.py` | Modified. Computes cross-camp Shannon entropy alongside embedding spread; both must clear thresholds for a candidate to enter the review queue. Output adapted for dictionary-centric review queue. |
| `scripts/detect_synonyms.py` | Modified. Same. |
| `scripts/build_review_queue.py` | New. Orchestrates detection and writes the queue. |
| `scripts/lint_vocabulary.py` | New. CI script invoking `lib/dictionary/lint.ts` against the repo. Supports warning/soft_fail/enforcing modes with base-branch diff for soft_fail. |
| `scripts/calibrate_translation.py` | New. Phase 4 deliverable: takes a hand-labeled validation set and computes the five-dimensional evaluation (per-term P/R, per-camp confusion matrix, ambiguity rate, fallback accuracy, downstream impact). Recommends threshold adjustments. |
| `scripts/batch_summarize.py` | Modified. Adds translation pipeline invocation before summarization. |
| `scripts/translate_document.py` | New. Standalone translation pipeline runner for the manual workflow. |
| `summaries/<doc-id>.translations.json` | New. Generated artifact per document. |
| `taxonomy-editor/src/renderer/VocabularyPanel.tsx` | New. Dictionary browser, review queue, lint report, translation record viewer. |
| `taxonomy-editor/src/renderer/NodeEditor.tsx` | Modified. Autocomplete from standardized terms; warnings on bare colloquial terms; display-form preview. |
| `lib/debate/prompts.ts` | Modified. Inject standardized-term vocabulary into persona prompts. |
| `lib/debate/debateEngine.ts` | Modified. Stage 3 extraction validates against lint rules. |
| `lib/debate/synthesis.ts` | Modified. Apply display-form rendering to output. |
| `taxonomy/*.json` | Modified incrementally in Phase 2 as nodes adopt standardized terms. |
| `.github/workflows/lint.yml` | New or modified. Runs vocabulary lint on every PR. |
| `.github/workflows/taxonomy-version-bump.yml` | Modified. Runs detection scripts and rebuilds sense embeddings on version bump. |

## 10. Compatibility, Flagging, and Rollback

The vocabulary system touches the taxonomy editor, debate engine, batch summarization, synthesis, persona prompts, CI, and review tooling. Vocabulary systems tend to fail at seams, not in the center. The four-phase plan ships changes in a sensible order, but ordered changes alone do not handle: partial migration during a multi-week phase, enforcement turning on with violations in the repo, dictionary version mismatches across stored content, and the need to roll forward and back at the granularity of consumers rather than the entire system.

This section specifies the compatibility, flagging, and rollback behaviors that make the rollout safe.

### 10.1 Feature flags

Each consumer of the vocabulary system has its own feature flag. Flags live in `config/feature_flags.yml` and are read at startup by every consumer. Defaults are set to safe values (everything off) so that adding the dictionary to the repo doesn't change behavior until consumers are explicitly opted in.

| Flag | Controls | Default | Enabled in phase |
|---|---|---|---|
| `dictionary.loader_enabled` | Whether the dictionary loader runs at all. When false, all other vocabulary behavior is off regardless of other flags. | `false` | Phase 1 |
| `dictionary.lint.referential` | Constraints 1–3 (referential integrity within the dictionary). | `false` | Phase 1 |
| `dictionary.lint.content` | Constraints 4–8 (no bare colloquial terms in content). | `false` | Phase 3 |
| `dictionary.lint.mode` | `warning` (lint reports violations but PRs merge) or `enforcing` (violations fail the build). | `warning` | Ramp from `warning` to `enforcing` during Phase 3 |
| `translation.pipeline_enabled` | Whether document analysis runs the translation pipeline. When false, mapping operates on raw document text as it does today. | `false` | Phase 3 |
| `translation.llm_fallback_enabled` | Whether Stage 3 fallback runs. When false, low-confidence cases commit as `confidence: ambiguous`. | `true` (when pipeline is enabled) | Phase 3 |
| `debate.persona_vocabulary_enforcement` | Whether persona Stage 3 extraction validates against lint rules. | `false` | Phase 3 |
| `synthesis.display_form_rendering` | Whether synthesis output passes through the canonical-to-display renderer. | `false` | Phase 3 |
| `editor.vocabulary_panel_enabled` | Whether the taxonomy editor surfaces the Vocabulary panel. | `false` | Phase 3 |

Each flag flips independently. A team can enable translation but not display-form rendering, or enable lint in warning mode but not enforcing mode. This granularity is what makes rollback tractable: a problem in display-form rendering doesn't require disabling the entire vocabulary system, only that one flag.

Flags also support per-environment overrides — staging can enable a flag before production. For this project's scale, the relevant environments are "developer-local," "CI," and "deployed batch pipeline."

### 10.2 Compatibility table for partial migration

During Phase 2 (which takes weeks), the dictionary exists but is incomplete. Some standardized terms are coined, others aren't. Some nodes have been migrated, others haven't. The `summaries/` directory contains documents analyzed under the pre-vocabulary system. The system must continue to function during this period.

| Component | Behavior during Phase 2 |
|---|---|
| Taxonomy editor | Shows canonical forms for migrated nodes, raw text for unmigrated nodes. Vocabulary panel shows partial dictionary. Lint runs in warning mode and surfaces violations in the editor as info-level annotations rather than errors. |
| Debate engine | Persona prompts include the standardized terms that exist so far. Personas may use canonical forms when relevant or fall through to bare terms when no standardized term exists yet. Stage 3 extraction logs vocabulary failures but does not re-prompt. |
| Document analysis | Translation pipeline is off. Mapping operates on raw text. Existing pre-vocabulary summaries remain valid. |
| Synthesis | Display-form rendering is off. Output uses whatever vocabulary the personas produced, which during Phase 2 is a mix. |
| CI | Referential lint runs and enforces. Content lint runs in warning mode and reports but does not fail. |

The principle: during Phase 2, the system runs as it did before the vocabulary system was introduced, with the addition that the dictionary exists and can be browsed. Nothing the vocabulary system adds is enforced until Phase 3.

### 10.3 Enforcement ramp

Phase 3's lint constraints 4–8 cannot turn on as a binary switch — flipping them on with even one violation in the repo blocks every PR. The ramp:

| Stage | `dictionary.lint.mode` | Behavior | Duration |
|---|---|---|---|
| Ramp 1 | `warning` | Lint runs, violations reported in PR comments and in `lint_report.json`, no build failure. | 2 weeks from Phase 3 start |
| Ramp 2 | `soft_fail` | New violations in modified files fail the build. Pre-existing violations in unmodified files are allowed. | 2 weeks |
| Ramp 3 | `enforcing` | All violations fail the build regardless of file modification status. | Permanent |

The two-week durations are minimums, not maximums. If Ramp 1 surfaces too many violations to clean up in two weeks, Ramp 2 starts later. The reviewer running the migration moves the ramp forward; it is not automatic.

The `soft_fail` mode requires a CI helper that compares the violation set in the PR against the violation set on the base branch. New violations fail the build; pre-existing violations are reported but allowed. This avoids the cliff where Ramp 1 ends and suddenly every PR fails.

### 10.4 Dictionary version mismatch policy

Translation records carry `dictionary_version`. Stored content (taxonomy nodes, summaries, debate sessions) implicitly depends on the dictionary version that was current when it was written. The policy for handling mismatches:

**Translation records older than the current dictionary version are valid but flagged for re-review.** Specifically: tooling that consumes a translation record checks its `dictionary_version` against the current. If they match, the translation is treated as authoritative. If they don't match, the translation is still used (it represents the system's best understanding at the time it was made) but the consumer adds a `re_review_recommended: true` annotation to its output. The Phase 4 backfill step is what actually re-translates these.

**Stored canonical forms in taxonomy nodes are valid at any dictionary version where they remain registered.** A canonical form that has been deprecated in a newer dictionary version triggers a lint warning when the node is loaded; the node's content remains intact. Editing the node requires resolving the deprecation (replacing the deprecated form with its replacement, or marking the node for review).

**Stored content that uses canonical forms which no longer exist in the dictionary** (e.g., a node was migrated under a provisional term that was later renamed) triggers a lint error. The taxonomy editor offers a one-click migration: the editor reads the deprecated entry's `replaced_by` field and substitutes throughout the node.

**Synthesis and debate session records are immutable.** They are never retroactively edited even if the dictionary changes. Their canonical forms are interpreted against the dictionary version they record. Display-form rendering of an old session uses the dictionary as it existed when the session was written, not the current dictionary, to preserve the meaning the session originally conveyed. This requires keeping a history of dictionary versions accessible to the renderer — for this project's scale, committing the dictionary to the repo means the history is already in version control and can be retrieved by `dictionary_version` reference.

### 10.5 Rollback playbook

For each phase, an explicit list of what to revert if the phase's changes prove problematic. Rollback is by feature flag where possible (cheap, instant) and by commit revert where flags are insufficient (more involved).

**Phase 1 rollback.** Set `dictionary.loader_enabled` to false. The dictionary remains in the repo but has no effect. No data migration is needed — Phase 1 produces no consumer-visible output.

**Phase 2 rollback.** Phase 2 produces dictionary entries and edited node prose. These are content changes, not behavioral changes. Rollback options:
- *Light:* Leave the changes in place. Phase 2 content is valid even if Phase 3 never ships, because no consumer is enforcing the vocabulary yet (flags from Phase 1 keep behavior unchanged).
- *Full:* Revert the commits that added dictionary entries and edited nodes. The taxonomy returns to its pre-Phase-2 state. This is more invasive than light rollback and should only be done if the Phase 2 vocabulary work is judged actively wrong, not merely incomplete.

**Phase 3 rollback.** Phase 3 introduces enforcement. Each consumer flag can be flipped independently:
- `translation.pipeline_enabled: false` — document analysis returns to raw-text mapping. Existing translation records remain in `summaries/` but are not consumed.
- `debate.persona_vocabulary_enforcement: false` — personas no longer get their outputs validated against the lint rules. Stilted personas relax to whatever they were saying before.
- `synthesis.display_form_rendering: false` — synthesis emits canonical forms directly. Readers see `safety_alignment` rather than `alignment (safety)`. Ugly but functional.
- `dictionary.lint.mode: warning` — content lint stops failing builds.

The hardest Phase 3 rollback is for committed translation records. If the translation pipeline shipped translations that turn out to be systematically wrong, those records exist in `summaries/`. The mitigation: translation records are *additive*, not destructive. The original document text is preserved alongside translations. Rolling back translation means ignoring the translation records and using the original text — no data is lost.

**Phase 4 rollback.** Phase 4 changes are calibration adjustments and documentation. Rollback is straightforward: revert threshold changes in `config/translation.yml`, revert documentation commits.

### 10.6 What this section does not provide

This compatibility, flagging, and rollback strategy is sized to the project's actual scale: a single-author research project with periodic batch processing and a small contributor base. It does not include:

- A/B testing infrastructure for comparing dictionary versions in production.
- Automated rollback triggers based on quality metrics.
- Multi-region deployment coordination.
- Real-time feature flag systems with per-user targeting.

If the project grows to a scale where any of these become relevant, this section will need a successor. For v1, manual flag flipping by the maintainer is the appropriate level of mechanism.

## 11. What This Spec Does Not Cover

- **Building the embedding index** — covered by the context-rot mitigation spec, which this depends on.
- **Per-document recency-bias mitigation in debate transcripts** — covered by the unanswered-claims ledger spec (separate).
- **Fact-checking of empirical claims within the debate** — separate concern.
- **Multilingual vocabulary** — out of scope.
- **External governance of the vocabulary** — deferred until the project has multiple contributors.
- **Versioned releases of the dictionary** — the dictionary is versioned with the taxonomy via `TAXONOMY_VERSION`; whether to give it independent versioning is a v2 question.

## 12. Deferred Refinements

This section records refinements that have been considered, evaluated, and deferred, along with the reasoning. Recording these in the spec rather than in scattered comments serves two purposes: it prevents the same proposals from being re-considered from scratch, and it makes the reasoning available to future maintainers who may revisit the decisions when project conditions change.

Each entry includes the proposal, the substantive case for it, the case for deferring, and the conditions under which it should be reconsidered.

### 12.A — Fuzzy ensemble for the local resolver (ADOPTED in Phase 3)

This refinement was *adopted* and is now part of §4.3 Stage 2 and §4.7 configuration. It is recorded here because the decision process is informative for similar future decisions.

**The proposal.** Replace pure cosine similarity in the local resolver with a weighted ensemble: `Score = w_e · Sim_cos + w_p · Phrase_signal`, where `Phrase_signal` is computed by token-sort fuzzy matching against characteristic phrases, with a noise floor and sum-of-top-k aggregation.

**Why adopted.** The proposal correctly identified that pure embedding similarity dilutes the high-precision phrase-matching signal. Characteristic phrases are author-curated discriminative markers; embedding them into a single vector with the definition loses information. A weighted ensemble preserves both signals. The single-weight tuning surface (`w_p`) is small enough not to inflate calibration burden meaningfully.

**Modifications from the original proposal.** The original used `Max()` aggregation over phrases, which discards multi-phrase-match signal. Adopted version uses sum-of-top-3 with a noise floor at 0.50, which rewards documents matching multiple phrases without being dominated by a single high match. The original named "Fuzzy Jaccard Coefficient" but specified Levenshtein or token-sort as the implementation; adopted version commits to token-sort ratio because it handles morphological and word-order variation, which are the failure modes that occur in well-edited documents.

**What this teaches.** Refinements that increase signal richness with small tuning-surface increase are usually worth adopting. The pattern (substituting a sharper, more explicit signal for a weaker, more diluted one) is one to watch for in future proposals.

### 12.B — Cross-camp Shannon entropy in the standardization bar (ADOPTED in Phase 2)

This refinement was *adopted* and is now part of §6 Standardization Bar.

**The proposal.** Add Shannon entropy of cross-camp distribution as a third necessary criterion alongside camp count and embedding spread. The bar becomes: term used by 2+ camps AND cross-camp entropy ≥ 0.6 AND embedding spread ≥ 0.40 AND reviewer judgment.

**Why adopted.** The previous bar conflated two distinct properties — distributional balance and semantic divergence — into a single embedding-spread test. A term concentrated in one camp doesn't cause cross-camp confusion regardless of its embedding properties; a term that all camps mean the same thing by doesn't need standardization regardless of how evenly distributed it is. Entropy and spread are complementary measures that together capture when standardization actually pays off.

**Conditions for tightening.** The 0.6 threshold is provisional. Phase 4 calibration on the existing taxonomy will produce a more grounded value. If post-Phase-4 reviewer time is dominated by reviewing terms that turn out not to need standardization, raise the threshold; if real cross-camp confusion is being missed, lower it.

### 12.C — Semantic Shift drift alerts (DEFERRED to v1.1)

**The proposal.** Add a `candidate_drift` category to the review queue that flags when a camp's usage of a standardized term migrates over time toward another camp's embedding space. Computationally: compare each node's current embedding against (a) its embedding at last review and (b) the centroid of each camp's nodes. Flag when the trajectory crosses a threshold.

**The substantive case.** Drift is a real and analytically interesting phenomenon. The AI Triad project's purpose includes tracking how AI policy discourse evolves. A drift detector is the kind of instrument that makes that evolution legible — which is itself a deliverable. The technical implementation is feasible: node embeddings exist, sense embeddings exist, taking the diff over time is straightforward.

**Why deferred.** Drift requires history to detect. At v1, the project has no edit history of the kind that would feed the detector. Building the detector now produces an instrument with no signal. At least 6 months of production usage with the standardized vocabulary in place is needed before drift becomes detectable — possibly longer for sluggishly-evolving terms. Building speculatively risks over-engineering against assumed drift patterns that don't match the actual ones.

The current detection pipeline already catches the *static* version of this concern: the synonymy detector flags nodes whose embeddings no longer match the sense they claim to use. The dynamic version (drift over time) is genuinely additive but lower priority.

**Conditions for adoption.** Reconsider once: (a) the standardized vocabulary has been in production use for 6+ months with at least one full re-detection cycle, (b) at least 50 nodes have edit history under the standardized vocabulary, and (c) Phase 4 audits reveal cases of subtle cross-camp shift that the static synonymy detector missed. Until all three conditions are met, the static detection in v1 is sufficient.

**Schema readiness.** The review queue schema already includes `candidate_drift` as a category (mentioned in §3.5). v1.1 only needs to populate it, not redesign around it.

### 12.D — Pure BM25 phrase scoring (REJECTED — superseded by 12.A)

**The proposal.** Use BM25 (with standard k1 and b parameters) for the phrase-match feature in the local resolver, weighting characteristic-phrase relevance against the context window.

**Why rejected.** BM25 is well-understood and has good library support, but it's not at its best in this regime. BM25 is designed for retrieval — large queries against large documents — and tuning its parameters meaningfully requires more documents and more queries than this project has. Against a query of 5 phrases on a context window of 100 tokens, BM25's behavior is approximately equivalent to a thresholded boolean match with a more elaborate tuning surface.

The fuzzy ensemble in 12.A captures the same insight (use phrase matching as a distinct signal alongside embeddings) with less tuning complexity and clearer interpretation. Token-sort fuzzy matching directly addresses the failure mode that motivated the BM25 proposal in the first place: morphological and word-order variation that exact phrase matching misses.

**Conditions for reconsideration.** If the corpus grows to thousands of documents and the project is running enough translation queries that BM25's parameters become genuinely tunable, BM25 might become viable. At the project's current and projected scale (200–1000 documents), it is overkill. Reconsider only if the corpus exceeds 5000 documents.

### 12.E — Translation result caching (DEFERRED to v2)

**The proposal.** Cache translation results keyed by `(occurrence_text_hash, dictionary_version, model_version, ensemble_config_hash)`. When re-running translation on the same content with the same parameters, reuse cached results rather than re-computing.

**The substantive case.** Re-running translations on the same document during reprocessing should be deterministic for the local pass. Caching avoids redundant LLM-fallback calls on subsequent runs. At scale this saves real money.

**Why deferred.** Caching introduces invalidation complexity. The cache key has to include every parameter that affects output: dictionary version, ensemble weights, thresholds, phrase noise floor, embedding model, fallback model. Any one of these changing must invalidate the relevant cache entries. Getting this wrong silently serves stale translations under new configurations, which is the opposite of what the calibration pipeline needs.

At the project's current scale (200 documents, occasional reprocessing on `TAXONOMY_VERSION` bumps), the fallback rate is low enough (~10–15%) that the actual savings are modest. The complexity cost exceeds the benefit.

**Conditions for adoption.** Reconsider when: (a) the corpus exceeds 1000 documents AND (b) reprocessing happens frequently enough (e.g., monthly) that fallback costs become a noticeable line item AND (c) the ensemble configuration has been stable for 3+ months (so cache invalidation events are rare).

### 12.F — A/B testing infrastructure for dictionary versions (REJECTED at current scale)

**The proposal.** Build infrastructure to run two dictionary versions in parallel against the same documents, comparing outputs to evaluate whether a candidate revision improves quality.

**The substantive case.** Dictionary changes are substantive interpretive decisions; their effects on downstream analysis are not always predictable. A/B testing would let revisions be evaluated empirically rather than judged a priori.

**Why rejected at current scale.** A/B testing assumes a corpus large enough that statistical comparisons are meaningful and a usage volume high enough that "before/after" comparisons reflect real signal rather than noise. At 200 documents and a handful of users, neither holds. The five-dimensional evaluation in Phase 4 is a more appropriately-sized substitute: it provides empirical evaluation against a hand-labeled set, which is the kind of evidence the project's scale supports.

**Conditions for reconsideration.** A research project at the current scale should not build A/B infrastructure. If the project transitions into a production system serving many users (which is not currently planned), the calculation changes.

### 12.G — Real-time vocabulary editing during debates (REJECTED by design)

**The proposal.** Allow the dictionary to be edited live during a debate session, with edits applying retroactively to translations and persona prompts.

**Why rejected.** This conflicts with the explicit Non-Goal in §2: "Real-time vocabulary editing during debates or analyses. Vocabulary is edited in dedicated review sessions; runtime tools are read-only consumers." The reasoning is unchanged: live editing during a session means session results are non-reproducible (re-running a session would produce different output if vocabulary edits had been made in the interim). Reproducibility of debate sessions is a stronger value than the convenience of live editing.

**No conditions for reconsideration.** This is a design choice, not a deferred capability.

### 12.H — Per-camp namespace embeddings (DEFERRED, conditionally interesting)

**The proposal.** Compute sense embeddings as `embed(camp_name + " " + definition + characteristic_phrases)` rather than just `embed(definition + characteristic_phrases)`. The intuition: camp identity is itself a strong signal, and folding it into the embedding lets the local resolver leverage it directly rather than treating it as a separate weighting.

**The substantive case.** A document discussing AI safety produces an embedding similar to all senses that mention safety — which is multiple senses across camps. Adding camp prefix to the sense embedding may help disambiguate by introducing camp-specific embedding neighborhoods.

**Why deferred.** This is a fix to a problem that may not occur. Phase 4 calibration's per-camp confusion matrix will reveal whether cross-camp confusion is happening systematically. If it is, namespace embeddings are worth trying. If it isn't, this adds complexity without benefit.

**Conditions for adoption.** Reconsider if Phase 4 evaluation reveals systematic per-camp confusion (off-diagonal cells in the confusion matrix with ≥10% mass) that the ensemble's phrase signal does not catch.

