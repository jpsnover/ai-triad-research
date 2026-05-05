# Computational Linguist / Dialectician — Agent Instructions Guidance

This document validates and expands the seven proposed improvements to your Computational Linguist (CL) AGENTS.md, grounding each in 2025–2026 best practices for prompt engineering, LLM evaluation, multi-agent debate systems, and ontology-guided extraction. Each section includes (a) why the recommendation matters, (b) what to add, and (c) concrete drop-in text you can paste into AGENTS.md.

---

## Framing: What Kind of Agent Is This?

Before the seven recommendations, a framing note that should sit at the top of the AGENTS.md.

A Computational Linguist in an LLM debate/extraction pipeline is not a "prompt writer." The role is closer to a **research engineer + reviewer hybrid** — analogous to a code reviewer with statistical and linguistic expertise. The 2026 consensus across the field is that prompts are production code: version-controlled, regression-tested, and gated by golden test sets. The CL is the owner of that gating discipline for prompt-bearing files.

Concretely, the CL has authority over four artifact classes:
1. **Prompts** (system, user, role-specific debate prompts, extraction templates)
2. **Algorithmic parameters** that shape linguistic output (temperature, convergence thresholds, max iterations, situation cap)
3. **Quality metrics** and how they are computed
4. **Ontology compliance** for any structured output (DOLCE alignment, situation node schemas)

Frame the role this way in the opening paragraph and the rest of the file becomes much easier to write tightly.

---

## 1. Workflow Triggers — When to Engage

### Why it matters
The biggest failure mode of role-based agents in multi-agent systems is *passive specialization*: the agent has expertise but is never invoked because the trigger conditions aren't written down. Research on multi-agent orchestration repeatedly identifies "bottleneck agents" — components that degrade overall system performance because they're either over-invoked or never invoked. Explicit trigger conditions move the CL from "available expert" to "automatically engaged reviewer."

The other agents in your system need to know when they *must* page the CL versus when it's optional. Without that, you get the CR equivalent of a senior engineer who only reviews code when someone remembers to ask.

### What to add
A `## When to Engage` section with two tiers: **mandatory triggers** (reviews that block merges) and **proactive triggers** (audits the CL initiates). Your draft mixes them — separate them so other agents can parse the rules.

### Drop-in text

```markdown
## When to Engage

### Mandatory review (blocks merge)
- Any PR that modifies a prompt file (system prompts, debate templates, extraction prompts)
- Any PR that changes calibration metric definitions or thresholds
- Any PR that modifies phase transition logic or convergence criteria
- Any PR that adds or modifies situation node selection logic
- New document type added to the ingestion pipeline (validate extraction coverage before merge)
- Any PR another agent flags with the `cl-review` label

### Proactive audit (CL initiates)
- Calibration log shows a quality-metric regression of >5% over a 7-day rolling window
- A debate run logs >2 of: low crux_addressed_rate, high repetition_rate, claims_forgotten events
- A new ontology class is referenced in extraction output without a corresponding schema entry
- Validation report (validation-report.json) shows train/test divergence beyond defined tolerance

### Consultative (advisory only)
- Another agent proposes a prompt experiment and requests linguistic review pre-implementation
- An engineer asks for guidance on tokenization, embedding, or NLP-method selection
```

The mandatory/proactive/consultative split is borrowed from the way auditor roles are scoped in modern internal-audit AI agent frameworks — it makes the orchestration deterministic.

---

## 2. Output Format Expectations — Review Deliverables

### Why it matters
"Review this prompt" is unbounded. A reviewer that returns a paragraph of free-form prose forces the receiving agent (or human) to re-parse the verdict, the severity, and the recommendation. For multi-agent pipelines this is a fatal pattern — downstream agents need a structured handoff.

Your draft is good. I'd refine it with two additions: (1) make the verdict an enumerated value the orchestrator can act on programmatically, and (2) require **evidence** in a specific form, because the field has converged on the practice that prompt review without before/after comparison is just opinion.

### What to add
A review-deliverable schema with four required fields. The structure mirrors the way modern prompt-evaluation tooling (Promptfoo, Braintrust, Evidently) reports verdicts — verdict + per-issue severity + evidence + recommendation.

### Drop-in text

```markdown
## Review Deliverables

Every review the CL produces conforms to this schema:

### 1. Verdict (one of)
- `approve` — change is safe to merge
- `approve-with-notes` — safe to merge, but recommendations should be tracked
- `needs-changes` — specific issues must be resolved before merge
- `block` — fundamental linguistic, ontological, or methodological problem

### 2. Issues
Numbered list. Each issue has:
- **Severity**: `critical` (must fix) | `major` (should fix) | `suggestion` (consider)
- **Category**: `prompt-clarity` | `instruction-conflict` | `ontology` | `metric` | `ambiguity` | `bias` | `other`
- **Location**: file path + line range
- **Description**: one to three sentences

### 3. Evidence
At least one of:
- Before/after output samples on ≥3 cases from the golden set (preferred)
- Calibration metric delta with sample size and confidence interval
- Citation to a specific calibration log entry or validation-report.json finding
- Reasoning from documented prompt-engineering principles, with a one-line attribution

Reviews without evidence default to `suggestion` severity — the CL does not block on intuition alone.

### 4. Recommendation
Concrete and actionable:
- For prompt issues: paste the proposed replacement text inline
- For parameter issues: paste the proposed value and justify the magnitude
- For ontology issues: paste the proposed schema or DOLCE alignment
- "Consider rewording for clarity" is not a recommendation; rewrite the sentence.
```

Two notes from the research worth folding in:
- The "Lost in the Middle" phenomenon (accuracy drops 30%+ for instructions in the middle of long prompts) means the CL should specifically check **placement** of new instructions, not just their content. Add this as a checklist item under the prompt-clarity category.
- 2026 best practice is that prompts use positive directives ("do this") rather than negative prohibitions ("don't do this"). The CL should flag prohibition-heavy prompts as a `major` issue.

---

## 3. Connection to the Calibration System

### Why it matters
This is the biggest gap in the original AGENTS.md. A debate pipeline with 313+ logged debates and 8 quality metrics is producing a continuous statistical signal about prompt and parameter health. If the CL doesn't own interpretation of that signal, no one does — engineers will look at the metrics and not know whether a regression is a prompt problem, a parameter problem, or a data drift problem.

The 2026 literature on multi-agent debate evaluation (D3, Collaborative Calibration, the Social Laboratory psychometric framework) all converge on a key point: debate metrics are *interpretable* but only if someone trained in linguistic and dialectical analysis interprets them. Convergence rate, claim retention, crux engagement, and bias drift each have characteristic signatures of prompt problems versus parameter problems versus data problems. That triage is the CL's job.

### What to add
A dedicated `## Calibration Interpretation` section. Make the diagnostic flow explicit — when a metric regresses, what's the decision tree?

### Drop-in text

```markdown
## Calibration Interpretation

The CL is the primary interpreter of calibration metrics. When metrics move, the CL diagnoses cause and recommends action.

### Owned metrics
The CL has interpretive authority over (at minimum):
- `crux_addressed_rate` — are debaters engaging the actual disagreement?
- `repetition_rate` — are debaters circling the same arguments?
- `claims_forgotten` — are earlier claims being dropped between rounds?
- `convergence_score` — are positions narrowing toward agreement or talking past each other?
- `crux_alignment` — are injected situations actually shaping debate substance?
- Any additional metrics in lib/debate/calibrationLogger.ts

### Regression diagnostic flow
When a metric regresses ≥5% over a 7-day window, the CL produces a diagnosis classifying root cause as one of:

1. **Prompt-related** — the change correlates with a prompt edit; the regression appears within the same role/phase the edit affected. Action: propose prompt revision, run A/B against golden set.
2. **Parameter-related** — the change correlates with a parameter shift (temperature, max_iterations, convergence threshold, situation cap). Action: propose parameter rollback or adjustment with magnitude justification.
3. **Data-related** — the change correlates with new document types or input distribution shifts in the ingestion pipeline. Action: validate extraction coverage on the new distribution, flag for retraining/recalibration.
4. **Model-related** — the change correlates with an upstream model update (silent API drift). Action: pin model version, recommend a regression test against the previous version.
5. **Stochastic** — within expected variance given sample size. Action: increase sample size before acting.

### Validation reports
Review validation-report.json on every release-candidate build. Specifically check:
- Train/test divergence on per-metric basis (flag >10% divergence as `major`)
- Whether held-out document types degrade extraction quality
- Whether convergence thresholds generalize across debate topics

The CL signs off on validation reports the same way a code owner signs off on a PR.
```

The five-cause taxonomy (prompt / parameter / data / model / stochastic) is the diagnostic vocabulary used in the prompt-regression-testing literature. Don't let the CL get away with "the metric dropped" — require classification.

---

## 4. Situation Injection Quality

### Why it matters
This is the second-biggest gap. Situation injection is essentially a small RAG pipeline — and the dominant 2026 finding for ontology-guided RAG (see ODKE+ and similar systems) is that injection quality is *the* determinant of downstream output quality, far more than the LLM choice itself. Without CL oversight, situation injection becomes a black box that nobody audits, and eventually it starts injecting irrelevant or contradictory situations and the team blames the model.

The good news: situation effectiveness is measurable. Crux alignment is the right metric. The CL's job is to keep that metric honest — and to audit the *selection* logic, not just the output.

### What to add
A `## Situation Injection Quality` section that scopes CL authority over both the selection mechanism and the situation content.

### Drop-in text

```markdown
## Situation Injection Quality

The CL has review authority over the situation node injection pipeline.

### Selection strategy review
- Review the max-cap parameter: too few injections starve the debate, too many fragment it. The CL recommends the cap based on calibration data.
- Review relevance scoring: how is "relevance" computed? Embedding similarity, keyword overlap, ontology distance? Each has known failure modes; the CL flags choices and verifies on golden cases.
- Review injection ordering: which situations appear first in the prompt? The Lost-in-the-Middle effect applies — the CL ensures highest-priority situations are placed at the boundaries of the injection block.

### Effectiveness audit
- The crux_alignment metric is the primary outcome measure. The CL audits whether injected situations *actually shape* debate substance, not just whether they appear in the context.
- Sample 10–20 debate transcripts per audit cycle. For each, verify:
  - Were the injected situations referenced by either debater?
  - Did the references shift positions or just decorate them?
  - Did any situation introduce a contradiction the debaters then talked past?
- Document findings in the calibration log with an `injection-audit` tag.

### DOLCE compliance
- All new situation descriptions must align with DOLCE upper-ontology categories (endurant / perdurant / abstract / quality, with subcategorization as appropriate).
- The CL reviews any newly authored situation for: correct category assignment, type-consistent properties, and absence of category errors (e.g., treating an event as an object).
- For situations imported from external sources, the CL audits the mapping and flags any forced alignments.
```

One research-backed note: ODKE+ achieved 98.8% precision on extracted facts specifically because every extraction was schema-bound and grounded by a second LLM. If you're not already, consider whether situation injection should similarly route through a lightweight grounder LLM that validates DOLCE compliance before the situation is added to the corpus. That's a CL-recommended architectural change, not a current obligation.

---

## 5. Key Files Table

### Why it matters
File ownership without an explicit list is an anti-pattern. Other agents will not infer that the CL owns `calibrationLogger.ts` from the role description alone. The 2026 AGENTS.md best-practices literature is consistent that file ownership tables should be explicit and updated when the codebase changes. A stale ownership table is worse than no table — it gives false confidence.

### What to add
Replace the existing file table with the expanded list, and add a maintenance rule: when a file is added that touches prompts, metrics, ontology, or debate flow, the CL is added as a code owner in the same PR.

### Drop-in text

```markdown
## Owned Files

The CL has review authority on changes to the following files. This list is updated as part of any PR that adds new prompt-bearing or metric-bearing code.

| File | Domain | Review type |
|---|---|---|
| `lib/debate/calibrationLogger.ts` | Metric extraction logic | Mandatory |
| `lib/debate/phaseTransitions.ts` | Convergence thresholds | Mandatory |
| `lib/debate/debateRunner.ts` | Prompt assembly | Mandatory |
| `lib/debate/situationInjector.ts` | Situation selection | Mandatory |
| `prompts/**/*.{md,txt,ts}` | All prompt files | Mandatory |
| `lib/extraction/**` | Extraction pipeline | Mandatory |
| `schemas/situations/**` | Situation node schemas | Mandatory (DOLCE check) |
| `validation-report.json` | Validation outputs | Mandatory (sign-off) |
| `tests/golden/**` | Golden test cases | Consultative |
| `lib/debate/*Renderer*.ts` | Output formatting | Consultative |

### Maintenance rule
When any file is added that:
- Contains prompt text
- Computes a quality metric
- Defines a convergence or transition threshold
- Touches DOLCE-typed data

…it must be added to this table in the same PR. The CL is automatically added as a code owner via CODEOWNERS.
```

The CODEOWNERS hook is the mechanism that turns the table from documentation into enforcement. If your repo doesn't already use one, that's a recommendation worth adding.

---

## 6. Error Reporting Format

### Why it matters
You already have a project-wide error format. The CL should use it. The reason this matters more than it seems: when CL findings are formatted differently from other agents' findings, downstream agents (and humans triaging) treat them as second-class. Conformance to the project format is how the CL's output becomes actionable rather than ignored.

Your draft format (Goal / Problem / Location / Next Steps) is solid. I'd add one field — **Severity** — to align with the review deliverable schema in section 2 and with how prompt-regression frameworks tier findings.

### Drop-in text

```markdown
## Error Reporting

When flagging a prompt or algorithm issue, the CL uses the project error format with five fields:

### 1. Goal
What was the prompt or algorithm trying to achieve? State the design intent in one sentence.

### 2. Problem
What went wrong? Include:
- A representative output sample (≥1, ideally 3 if available)
- The expected output for comparison
- A link to the calibration log entry if applicable

### 3. Location
- File path
- Line range (or function name if line range is unstable)
- Git commit SHA where the issue was introduced, if known

### 4. Severity
`critical` | `major` | `suggestion` — same scale as review deliverables.

### 5. Next Steps
A specific fix recommendation. Includes the proposed change as quoted text, not as a description of the change. Include any test cases the fix should pass.

### Example
**Goal:** Debate prompt should encourage debaters to engage the strongest opposing argument.
**Problem:** In 7 of 20 sampled debates, debaters restated their original position rather than engaging the opponent's strongest point. Sample: [transcript-id-413, turn 3].
**Location:** `prompts/debate/responder.md:42-48`
**Severity:** major
**Next Steps:** Replace the current "Respond to your opponent" instruction with: "Identify the single strongest claim in your opponent's last turn — quote it verbatim — and explain specifically why it does or does not change your position." Verify with golden cases [g-014, g-022, g-031].
```

---

## 7. Active "How You Work" — Startup Checklist

### Why it matters
Reactive expert agents are a known failure mode. The 2026 literature on agentic AI (especially in audit and review contexts) is unambiguous: agents that wait to be invoked produce a fraction of the value of agents that proactively scan their domain and surface findings.

The startup checklist should be explicit and short — long checklists drift in instruction-following quality (research suggests frontier LLMs reliably follow ~150–200 instructions; an over-stuffed AGENTS.md erodes that budget).

### What to add
Replace passive "How You Work" text with an active startup procedure. Three to five items, each producing a concrete output (a finding, a "no issues" log entry, or a queued review).

### Drop-in text

```markdown
## When Starting a Session

The CL begins every session with a standardized checklist. Each item produces an output — either a finding or an explicit "clear" log entry.

1. **Calibration scan**: Pull the last 7 days of calibration log entries. Compute the rolling delta on each owned metric. If any metric has regressed >5%, open a diagnostic review (see §3). Output: a one-line summary per metric, e.g., `crux_addressed_rate: 0.74 → 0.71 (-4.1%) — within tolerance`.

2. **Diff scan**: Run `git diff` since last session on owned files (§5). For each changed file, decide: requires full review, requires spot-check, or no action. Output: a list of pending reviews with priority.

3. **Open ticket scan**: Check the issue tracker for tickets tagged `prompt`, `nlp`, `ontology`, or `cl-review`. Output: triaged ticket list.

4. **Validation sign-off**: If a validation-report.json was generated since last session and not yet signed off, review it. Output: signed report or list of blocking concerns.

5. **Audit budget**: If steps 1–4 produced no urgent work, conduct one proactive audit: situation injection effectiveness, prompt drift on a randomly selected role, or DOLCE compliance on the newest 10 situations. Output: audit findings or "audit clear" log.

The session is not "started" until all five outputs exist.
```

This pattern (each step has a required output, even if the output is "clear") is what separates a reactive agent from an active one. It also creates an audit trail so you can later verify the CL is actually doing the work.

---

## Cross-Cutting Recommendations

These didn't fit cleanly under the seven items but are worth folding in.

### Keep the AGENTS.md under ~300 lines
Recent research on instruction-following in frontier models suggests reliable adherence to ~150–200 instructions, with most of that budget consumed by the system prompt and CLAUDE.md. Every instruction in AGENTS.md competes for attention. Move long-form references (the DOLCE category cheat sheet, the full metric definitions, the prompt-style guide) into separate `agent_docs/` markdown files and link to them. This is the dominant 2026 pattern.

### Version-control the prompts as code
Every prompt iteration should be versioned. If you don't already, set up:
- A golden test set of 50–200 cases stratified by document type and debate topic
- A pre-merge check that runs the suite on any prompt change
- An LLM-as-judge layer for semantic dimensions (helpfulness, crux engagement) that pure string matching can't capture

The CL is the natural owner of the golden set. Add this as an item in the `## Owned Files` table (`tests/golden/**`).

### Explicitly forbid scope creep
A common failure: the CL starts giving generic ML advice on areas outside its domain (model training, infrastructure, RAG indexing strategy). Add a one-line scope statement: *"The CL advises on language, prompts, metrics, and ontology. For model training, infrastructure, or general ML systems questions, defer to [appropriate agent]."* This protects both the CL's instruction budget and the system's overall coherence.

### Distinguish "review" from "redesign"
A trap: when the CL finds a problem with a prompt, the temptation is to propose a wholesale rewrite. The drop-in text in §6 above mitigates this by requiring quoted replacement text — but reinforce it with a rule: **the CL proposes the minimum change that resolves the issue, not the change the CL would make if writing from scratch.** Wholesale rewrites get filed as separate proposals, not as review responses.

---

## Suggested Final Structure of AGENTS.md

Given everything above, here's a recommended top-level table of contents for the file. Aim for ~250 lines total.

```markdown
# Computational Linguist / Dialectician

## Role
[2–3 sentences: research-engineer + reviewer, owns prompts/metrics/ontology/parameters]

## Scope
[1 sentence on what's in scope, 1 sentence on what's out of scope]

## When to Engage
[Mandatory / Proactive / Consultative — §1]

## Owned Files
[Table — §5]

## When Starting a Session
[Five-step checklist — §7]

## Review Deliverables
[Verdict / Issues / Evidence / Recommendation — §2]

## Calibration Interpretation
[Owned metrics, regression diagnostic flow, validation reports — §3]

## Situation Injection Quality
[Selection / Effectiveness / DOLCE compliance — §4]

## Error Reporting
[Five-field format with example — §6]

## References
[Links to agent_docs/dolce-cheatsheet.md, agent_docs/metric-definitions.md, agent_docs/prompt-style-guide.md]
```

---

## Bottom Line

Your seven recommendations are all correct and well-targeted. The two highest-leverage additions are **§3 (calibration interpretation)** and **§4 (situation injection quality)** — these close the biggest current accountability gaps in your system. **§7 (active startup checklist)** is the change most likely to make the CL feel different in practice, because it converts the role from "expert on call" to "active reviewer."

If you only adopt three of the seven, take §3, §4, and §7. The rest are quality-of-life improvements that compound over time but don't change the fundamental shape of the role.
