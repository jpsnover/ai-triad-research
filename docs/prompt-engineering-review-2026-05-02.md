# AI Prompt Engineering Review Report: AI Triad Research Platform

**Review Date:** May 2, 2026  
**Reviewer:** Gemini CLI (Prompt Engineer)  
**Scope:** `lib/debate/prompts.ts`, `scripts/AITriad/Prompts/*.prompt`, `prompts/*.md`

---

## Executive Summary

The prompt engineering in this project is exceptionally sophisticated, utilizing advanced techniques such as **Recap Sections** to mitigate "Lost-in-the-Middle" issues, **Dialectical Moves** to control multi-agent conversation flow, and **Genus-Differentia** logic for structured taxonomy expansion. The decoupling of prompts from implementation logic (PS and TS) is a major architectural strength. However, there are opportunities to improve cross-platform consistency and enhance the "few-shot" calibration of the taxonomy expansion pipeline.

---

## 1. Debate System & Multi-Agent Persona Audit

### Strengths:
*   **[STRENGTH] Audience-Specific Calibration:** The `AUDIENCE_DIRECTIVES` in `lib/debate/prompts.ts` are high-quality, providing distinct "Reading Level," "Detail Instruction," and "Moderator Bias" settings that significantly shift model behavior based on the target persona (e.g., Policymakers vs. Academic Community).
*   **[STRENGTH] Structured Dialectics:** The use of explicit `move_types` (DISTINGUISH, REFRAME, etc.) prevents generic AI chitchat and ensures the debate advances toward cruxes.
*   **[STRENGTH] Context Salience:** The `buildRecapSection` function is an expert-level implementation of "Recency Bias" exploitation, ensuring starred nodes and phase objectives stay in the model's active attention window.

### Recommendations:
1.  **[MEDIUM] Standardize Audience Blocks:** The PowerShell implementation (`triad-dialogue-turn.prompt`) lacks the rich audience-specific directives found in the TypeScript implementation. Port the `AUDIENCE_DIRECTIVES` logic to the PS module to ensure consistent tone across CLI and Web versions.
2.  **[LOW] Calibrate Concession Frequency:** The "AIM for at least one genuine concession every 2-3 turns" instruction is excellent but may need a dynamic "concession counter" in the prompt context to prevent the model from conceding on its own instruction without actual reasoning.

---

## 2. Taxonomy Expansion & Metadata Pipeline

### Strengths:
*   **[STRENGTH] Genus-Differentia Constraints:** The 3-line description format (`Genus`, `Encompasses`, `Excludes`) in `pov-summary-system.prompt` is an outstanding example of using structural constraints to force conceptual precision.
*   **[STRENGTH] Output Density Guards:** The `REQUIRED OUTPUT DENSITY` block with non-negotiable minimums (KP_MIN, FC_MIN) is an effective pattern for preventing "lazy" summaries from models.

### Recommendations:
1.  **[HIGH] Few-Shot Calibration for "Unmapped Concepts":** The current prompt relies heavily on zero-shot instructions for identifying gaps. Adding 3-5 few-shot examples of "Near-Miss" vs. "Genuine Gap" would significantly improve the quality of `suggested_label` and `rationale` fields.
2.  **[MEDIUM] Standardized Vocabulary Enforcement:** The `TaxonomyRefiner.md` mentions a controlled vocabulary, but it is not consistently enforced in the `pov-summary-schema.prompt`. Ensure the `vocabulary_terms` array is a required field in all metadata extraction schemas.

---

## 3. General Prompt Safety & Performance

### Findings:
*   **[STRENGTH] JSON-Only Enforcement:** Consistent use of "Respond ONLY with a JSON object (no markdown, no code fences)" across all prompts ensures reliable parsing.
*   **[STRENGTH] Prompt Isolation:** The 27+ prompt templates are correctly isolated, allowing for iterative prompt refinement without modifying binary or script logic.

### Remediation:
1.  **[MEDIUM] Handle Truncation Explicitly:** While `prompts.ts` has a `truncationNotice` helper, several PowerShell prompts lack explicit instructions on how to handle truncated source documents. This can lead to "hallucinated endings" when the model hits context limits.

---

## Final Recommendation
The prompt system is the "engine" of the AI Triad platform and is highly mature. The primary next step should be **Few-Shot Optimization** for the taxonomy expansion pipeline. By providing clear examples of how to distinguish between a "Sub-type of an existing node" and a "Genuinely new concept," the system will achieve much higher precision in its automated taxonomy growth suggestions.
