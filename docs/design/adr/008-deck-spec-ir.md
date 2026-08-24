# ADR-0001: Debate Brief Intermediate Representation — Schema Strategy and Contract

**Status:** Accepted  
**Date:** 2026-08-19  
**Ticket:** t/2799  
**Discussion:** e/109  

## Context

The Debate Brief Export pipeline (`Export-TriadBrief`) produces three JSON artifacts per run: `deck_spec.json` (the structured debate IR), `narration.json` (LLM-generated slide narration), and `audit-manifest.json` (run metadata and integrity hashes). These artifacts are consumed by multiple subsystems — the server, renderer, PowerShell cmdlets, and downstream tools — and the format is a one-way door: once consumers exist, breaking changes require coordinated migration.

Three design questions needed answers before consumers could be built:

1. **Validation model** — strict everywhere, or split write vs. read?
2. **Version discriminator** — how do consumers identify the format major line?
3. **Traceability** — how do narration entries reference their source node in `deck_spec`?

A secondary concern was coverage scope: the `trace_coverage_pct` field records how many narration entries carry a resolvable trace, but whether "100%" should be enforced by the schema or a downstream gate was an open question.

## Decision

### Model B — Strict write, lenient read (derived mechanically)

The write path validates against a **strict schema** (`*.write.json`) with `additionalProperties: false` throughout. The read path validates against a **derived schema** produced mechanically by stripping all `additionalProperties: false` nodes from the strict schema (`deriveReadSchema()` in `lib/brief/schemaUtils.ts`). No hand-maintained second schema file exists — the strict schema is the single source of truth.

**Rationale:** Strict-on-write catches producer bugs early (the worst time to find a shape error is at the consumer). Lenient-on-read lets consumers survive non-breaking additive changes (new optional fields) without coordinated upgrades. Mechanical derivation eliminates the drift risk that comes from maintaining two files in sync.

**Alternative considered (Model A — strict everywhere):** Rejected because it forces all consumers to upgrade in lockstep for any additive field, making iterative development across T2–T8 brittle.

### Version discriminator — `pattern: "^1\\.\\d+$"`, not `const`

The `deck_spec_version` field in all three schemas uses a regex pattern (`^1\.\d+$`) rather than a `const` value. Writers emit the exact version they produce (e.g., `"1.0"`); readers accept any 1.x string.

**Minor bump rule:** Adding an optional field, relaxing a constraint, or expanding an enum is a minor bump (1.x → 1.x+1). Removing a required field, tightening a constraint, or renaming a field is a major bump (1.x → 2.0) and requires a new schema file and migration plan.

**Rationale:** A `const: "1.0"` discriminator would require a schema change every time a compatible field is added, producing false breaking-change signals. The pattern approach lets readers state their intent ("I accept any 1.x document") without coupling to a specific patch version.

### Traceability — RFC 6901 JSON Pointer

`narration.json` entries carry a `trace` field (RFC 6901 JSON Pointer, e.g. `/cruxes/1`, `/resolution_analysis/stronger_camp_findings/0`) that resolves into `deck_spec.json`. The `audit-manifest.json` records `trace_coverage_pct` (0–100) — the percentage of narration entries with a resolvable trace.

**Single resolver:** All trace resolution must go through one module, `lib/brief/traceResolver.ts` (T3). No consumer resolves traces ad-hoc. This ensures consistent error handling and makes the resolver the single place to add caching, validation, or format evolution.

**Rationale:** JSON Pointer is an IETF standard (RFC 6901), already used in JSON Schema itself, with unambiguous semantics and no parsing ambiguity. Alternatives considered (dot-notation paths, custom IDs) introduced either ambiguity (arrays) or required a separate ID registry.

### Coverage enforcement — T5 gate, not schema `const`

`trace_coverage_pct` is typed as `number` with `minimum: 0, maximum: 100`. The `const: 100` constraint was **explicitly rejected** for the schema. For `narration_mode: "narrated"` runs, the requirement that `trace_coverage_pct == 100` is enforced by the T5 verify gate (t/2803), not by JSON Schema.

**Rationale:** JSON Schema `const` enforces the constraint at parse time for all reads, including intermediate states during generation and for `deterministic` mode runs where coverage is not expected to be 100%. Moving enforcement to T5 keeps the schema honest about what it actually represents (a recorded number) and places the business rule where it can carry context (which mode, which run phase).

### Record-vs-policy coverage distinction

The schema records facts; policy rules live in gates. Fields like `trace_coverage_pct`, `within_tolerance`, and `checker_passed` are recorded observations — the schema validates their type and range. Whether a run should be accepted, retried, or flagged is a policy enforced by the verify stage, not by schema validation. This distinction is intentional and should be preserved as new fields are added.

## Consequences

**Positive:**
- Consumers can be built against a stable, frozen 1.x contract (t/2799 ships T2–T8 fanned out from `main`)
- Additive schema evolution does not require consumer upgrades
- Single source of truth eliminates write/read schema drift
- Trace coverage enforcement is testable independently of schema validation

**Negative:**
- `deriveReadSchema()` must be called explicitly — a consumer that imports the `.write.json` directly for read-time validation will be overly strict (a lint rule or hook should catch this; see t/2808)
- Minor/major bump determination is a human judgment call — the schema-diff CI guard (t/2808) will flag any structural change for review but cannot auto-classify bump type

## Files

| File | Role |
|------|------|
| `lib/brief/schemas/deck_spec.write.json` | Strict write schema, deck_spec v1.x |
| `lib/brief/schemas/narration.write.json` | Strict write schema, narration v1.x |
| `lib/brief/schemas/audit-manifest.write.json` | Strict write schema, audit-manifest v1.x |
| `lib/brief/schemaUtils.ts` | `deriveReadSchema()`, `hasAdditionalPropertiesFalse()` |
| `lib/brief/types.ts` | Canonical TypeScript types for all three artifacts |
| `lib/brief/schemas.test.ts` | Invariant tests: strict-on-write, lenient-on-read, version pattern, trace pattern |
