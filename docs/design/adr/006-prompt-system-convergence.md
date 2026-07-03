# ADR-006: Prompt-System Convergence — UsageID Scope Definition

**Status:** proposed
**Date:** 2026-07-03
**Author:** Technical Lead

## Context

Two prompt/AI-call systems coexist (repo review F-020):

1. **TS prompt builders** — `lib/debate/prompts.ts`: 65 exported builder functions containing the actual prompt text, called throughout the debate engine. Analogous: `scripts/AITriad/Prompts/*.prompt` files on the PowerShell side.
2. **UsageID registry** — `ai-usages.json` (19 entries) with `callByUsage`/`generateTextByUsage`/`Invoke-AIByUsage` entry points (t/1259–t/1263). Of the spot-checked entries, most are `"{{prompt}}"` passthroughs: the registry holds model/temperature/token/timeout config while the prompt text stays in code.

The ambiguity — "is UsageID supposed to *replace* the prompt builders?" — forces every agent touching AI calls to understand both systems and guess the migration intent. Full migration of 65 builders (many with complex conditional assembly, loops, and typed inputs) into `{{var}}` templates would be a large, low-value rewrite and would make prompts *harder* to maintain (no type checking, no composition).

## Decision

**UsageID is the routing-and-parameters layer, not the prompt-content layer.** Explicitly:

1. **Every AI call site must have a UsageID** — that's what enables per-usage model swapping and cost accounting. New AI calls register an entry in `ai-usages.json` and dispatch through the UsageID entry point for their stack.
2. **Prompt text stays in code** (prompts.ts builders / `.prompt` files) and is passed via the `{{prompt}}` template variable. This is the sanctioned pattern, not a stopgap.
3. **Full-template entries** (like `enrichment.metadata-extraction`, where the whole message lives in config) remain valid for *simple, static* prompts — use them when a prompt has no conditional assembly. Do not convert complex builders.
4. The remaining migration work is therefore bounded and mechanical: wire the ~46 debate-engine call sites that still call the adapter directly through `generateViaUsage` with new registry entries (config-only, no prompt rewriting). This proceeds incrementally as files are touched — no big-bang ticket.

## Consequences

- **Easier:** one mental model ("UsageID = which model/params; code = what we say"); per-usage cost tracking becomes complete as call sites are wired; model experiments need only config edits; agents stop wondering whether to move prompt text.
- **Harder / accepted costs:** prompt text is not hot-swappable via config (accepted — prompt changes need review anyway); two artifacts per call site (registry entry + builder), mitigated by the entry being ~6 lines of config.
- AGENTS.md's UsageID section will state this scope explicitly once accepted.
