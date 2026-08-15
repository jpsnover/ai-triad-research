# Debate/Chat Entity-Extraction Prompt Variant (Phase 2b instrument)

**Ticket:** t/1767 Phase 2b (design of record: `designs/entity-ontology-proposal.md` §5, §8, §9.4); v2 revision under t/2678
**Author:** Computational Linguist
**Status:** v2, revised 2026-08-15 (t/2678). v1 (SHA `bc6653b095dd3a12`) was **NOT VALIDATED** —
precision 0.765 < 0.80, driven by organization/regulatory-agency leakage into `proposals` — see
`analyses/PREREG-t1767-phase2b.md`. v2 sharpens the organization/institution genus-differentia and
adds an `artifact`-type guard (see **v2 revision** below). This file is the authoritative prompt
text; the v2 PREREG (`analyses/PREREG-t2678-phase2b-v2.md`) locks the v2 SHA
(`a33196dc529b28c4`) before its validation run.

## Why a separate instrument

The shipped `enrichment.entity-extraction` instrument was validated on **fact-record claims**
(`source_evidence_index.json`). Phase 0 (`analyses/PREREG-t1767-phase0.md`) established two things
that force a distinct debate/chat variant:

1. **Alias-table detection is structurally insufficient for debate text** — debaters name
   world-knowledge particulars the facts corpus never contained (the 2008 financial crisis was
   invoked from model world-knowledge, not any injected fact). Statement-side extraction is the
   validated fix (v0.3).
2. **On argumentative prose the fact instrument systematically mis-proposes POV camp labels as
   `person` entities.** In debate prose `Safetyist`/`Skeptic`/`Accelerationist` sit in subject
   position ("The Safetyist demands…") and read as proper names. In Phase 0 v0.3 they were
   proposed at confidence 0.18 and only the 0.6 gate declined them. **Relying on a confidence
   threshold to suppress a *systematic* category error is exactly the convention-dependent safety
   the TL rejected for entity vectors (condition 1).** The exclusion belongs in the teaching text,
   not the threshold. This is the concrete Phase 1/2b requirement Phase 0 surfaced.

Two further debate-prose characteristics, addressed by design (each grounded in the existing
ontology rule, **not** in any extractor output — the additions were fixed against the *input*
characteristics of debate prose before the run):

- **Debate statements are dense with cited-source titles** ("According to the study …", arXiv/DOI
  links). A cited document is a *source reference*, not a particular in the world; it is handled by
  the source-evidence layer, never minted as an entity. The variant says so explicitly.
- **Debate prose is dense with role nouns** ("the deployer", "regulators", "policymakers", "the
  other side"). These are roles, not particulars, and share the camp-label failure shape.

## The variant (proposed `enrichment.entity-extraction-debate` UsageID)

Everything except `systemMessage` and `messageTemplate` mirrors `enrichment.entity-extraction`
verbatim: `model: claude-sonnet-4-6`, `temperature: 0.1`, `maxTokens: 2000`, `timeoutMs: 60000`,
`jsonMode: true`, and the **identical** `responseSchema` (`proposals[]` + `org_mentions[]`). Keeping
the schema identical is deliberate: the two instruments feed one resolution/curation pipeline.

### systemMessage

```
You extract named entities from a single statement in an AI-policy debate or chat. Propose the entities the statement mentions.

An entity is a PARTICULAR: a specific person, a specific named AI system or tool (artifact), a specific named event, a specific law or regulation or executive order (legislation), or a specific named framework-institution such as a named treaty regime (institution). Type every proposal as exactly one of: person | artifact | event | legislation | institution. The test: a particular is one identifiable thing you could point at; a universal is a category many things instantiate.

TYPE GUARD FOR artifact (mandatory). The type `artifact` is reserved for a named TECHNOLOGICAL artifact — an AI system, model, tool, or engineered product (o1, GPT-4o, a Boeing 737 MAX, MCAS). A named policy, plan, act, bill, strategy, framework, or executive order is NEVER an `artifact`. If the named thing is a law, regulation, act, or order, type it `legislation` (e.g. 'CHIPS Act', 'AI Action Plan', a December-2025 executive order → legislation). If it is a non-agentive governance framework or regime, type it `institution`. When a proper-name policy document reads like a "plan" or "act", ask what KIND of thing it is: a governing instrument (legislation) or an engineered product (artifact) — a plan/act/order is the former, never the latter.

EXCLUDE POV CAMP LABELS AND SPEAKER ROLES (mandatory — this is the most common error on debate prose). This corpus stages a structured debate between three POV camps: the Accelerationist, the Safetyist, and the Skeptic. In argumentative prose these labels sit in subject position ("The Safetyist demands mandatory audits", "As the Accelerationist argued") and look exactly like proper names. They are CAMPS in our ontology, never persons and never entities of any type. Never propose 'Safetyist', 'Skeptic', 'Accelerationist', 'the Safetyist', or any debate-role label as an entity. The same holds for generic role nouns used as actors — 'the deployer', 'regulators', 'policymakers', 'technology executives', 'the other side'. These are roles, not particulars.

Do NOT propose UNIVERSALS. Concepts, ideas, fields, technologies-in-general, and contested vocabulary such as 'alignment', 'risk', 'oversight', 'safety', 'governance', 'model weights', 'compliance' are senses of words, not things in the world. They belong to the project's vocabulary dictionary, not here.

Do NOT propose organizations, companies, or government agencies as entities — list every one under org_mentions, never under proposals. They already exist in a separate registry. This includes named regulators and commissions. Use this genus-differentia test to keep the boundary sharp: an ORGANIZATION is an AGENTIVE body — a group of people that acts, decides, investigates, enforces, issues, or fines (a company, a ministry, a central bank, a regulator, a data-protection commission). Reserve the entity type `institution` ONLY for a NON-AGENTIVE social framework or regime that has no staff and takes no actions of its own — a named treaty regime, a body of law such as 'common law', a constitutional order. Worked negative example: a *data-protection commission* investigates complaints and levies fines — it ACTS — so it is an organization and belongs in org_mentions, and must NOT be proposed as an `institution` entity (this exact mis-type is the error this instrument was revised to fix). TIE-BREAK: if you are unsure whether a named body is an organization or an institution, route it to org_mentions.

Do NOT propose a cited source as an entity. A study, paper, report, book, or article named in the text ("According to the study …", an arXiv or DOI or URL citation) is a document reference handled by the source-evidence layer, not a particular in the world. Do not propose its title.

PERSON EXCEPTION (mandatory). For entity_type 'person', propose ONLY the name, aliases, and supporting quote. Never write a description or characterize the person's views, however well attested. Person records are completed by a human author, and a wrong inferred view about a named living individual is a far worse failure than a missing entity.

RESOLUTION HAPPENS DOWNSTREAM. Every proposal is matched against existing entities, the organization registry, policy actions, taxonomy labels, and the vocabulary dictionary before anything is created. So do not attempt to deduplicate against the wider corpus, and do not suppress a proposal because it might already exist. Propose what the text says and let resolution decide.

CALIBRATE CONFIDENCE HONESTLY. Confidence is the probability that the item is a real, correctly-typed particular. Emit every candidate you see, including borderline ones, at your honest confidence rather than self-censoring; a downstream gate drops low-confidence items, and an over-confident wrong proposal is more damaging than a low-confidence right one.
```

### messageTemplate

```
Speaker camp: {{speaker}}

Statement to extract entities from:
{{statement}}
```

The `Speaker camp` line is load-bearing twice over: it gives the model the camp context it needs to
resolve pronouns, and it names the current speaker's own camp so the model is less likely to reify
it as a proper name.

## v2 revision (t/2678) — what changed and why

v1 passed coverage (1.00), vocabulary boundary (0), gated camp-labels (0), and resolution (0 wrong
links) but **failed precision at 0.765 (13/17)**. Three of the four errors were the same boundary:
a named regulator (Ireland's Data Protection Commission, twice) typed `institution` instead of
routed to `org_mentions`, plus `Stripe` double-channelled into `proposals` and `AI Action Plan`
mis-typed `artifact`. All four are type/channel-boundary errors, not coverage or camp errors.

v2 makes exactly the two teaching-text changes the v1 failure disposition prescribed — nothing else
moves (single-variable revision; the camp-label, universals, cited-source, person, resolution, and
confidence paragraphs are byte-identical to v1):

1. **Organization/institution genus-differentia sharpened.** The one-line v1 rule ("a named
   government agency that acts … is an organization") did not carry against the surface pull of a
   commission's proper-noun phrase, and failed *consistently* (both DPC occurrences). v2 gives the
   agentive-vs-non-agentive test explicitly, names the DPC as a worked negative example, reserves
   `institution` for non-agentive frameworks/regimes only, and adds the tie-break **route to
   org_mentions when unsure** — moving the decision off the surface noun and onto "does it act?".
2. **`artifact`-type guard added.** A named policy/plan/act/order is never `artifact` → `legislation`
   (or `institution` for a non-agentive framework). Same type-boundary error class the facts
   instrument logged at t/1878; guarding it here pre-empts the `AI Action Plan` mis-type.

**Rule 4b confound removed in the v2 run.** v1's value-demonstration clause was *inconclusive*
because the shared `Speaker camp:` user line plausibly primed BOTH arms away from reifying camps as
persons (control emitted 0 raw camp labels). v2's validation adds a clean no-hint arm-pair (variant
and control, both with the camp line stripped) so the system-prompt camp exclusion is the only camp
signal — Rule 4b is judged on that pair. Precision/coverage stay on the production-faithful hinted
variant arm (the `Speaker camp` line is load-bearing by design and ships in production). See
`analyses/PREREG-t2678-phase2b-v2.md`.

## Landing plan (post-validation, cross-scope)

`ai-usages.json` is root-owned. This variant is **not** landed there until its preregistered
validation passes; landing it, plus the async entry-add wiring, the debate container reconstruction
geometry, and proposals-per-debate reporting, are the Phase 2b implementation tickets (routed to
DebateTool / Shared Lib / renderer) that this instrument gates. The validation run itself is
out-of-band (no production change), exactly as Phase 0 ran.
