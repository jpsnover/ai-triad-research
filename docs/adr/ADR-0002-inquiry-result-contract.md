# ADR-0002: Inquiry Result Contract

**Status:** Accepted · **Date:** 2026-09-23 · **Deciders:** Tech Lead, Second Opinion (e/186)
**Context tickets:** t/3571 (feature), t/3574 (contract) · **Design:** `docs/hld-inquiry-ux.md`

## Context

The "Ask a question" inquiry feature produces an `InquiryResult`: a synthesized,
camp-differentiated answer to a research question. Five roles consume it (Shared Lib, DebateTool,
ServerAPI, ElectronMain, Rosetta Stone), it crosses at least two serialization boundaries (job
store, REST, Electron IPC), and it is designed to be persisted and eventually shared.

That combination makes its shape a one-way door. The cost of getting it wrong does not land at
design time; it lands after results are persisted, when a fix means migrating stored user
artifacts. The decisions below are the hinges on that door, made explicit before walking through.

## Decisions

### 1. The contract lives at `lib/inquiry/`, owned by Shared Lib

Not `lib/debate/`. Two reasons. `lib/userPreferencesSchema.ts` already set this precedent. It
went to flat `lib/` because ServerAPI, a non-Electron consumer, needed it, and an
Electron-scoped home would have misfit. The same holds for ServerAPI and the renderer here.
Neither is a debate component.

The second reason is semantic. An inquiry is a product artifact that *wraps* a debate. Homing its
contract inside `lib/debate/` would couple the artifact's identity to one pipeline stage it
deliberately abstracts over. DebateTool's synthesis pass produces the type, so the dependency
points from `lib/debate` into `lib/inquiry` and not the reverse.

### 2. Zod schema is the source of truth; types are inferred

Per the t/3535 convention, the type derives FROM the schema so drift is structurally impossible.

The alternative, bare TypeScript interfaces, means either five hand-rolled validations or five
`as InquiryResult` casts at the deserialization boundaries. A cast promises that the data matches
without checking it. Shipping interfaces first and
retrofitting Zod after five downstream tickets have imported the types is the expensive ordering,
and the version parser (decision 3) needs the schema to exist regardless.

### 3. `schemaVersion: number` plus one shared `parseInquiryResult`

A version integer only protects the artifact if every reader interprets it the same way, and
there are five readers. All version policy therefore lives in a single parser in the contract
module:

| Case | Behaviour |
|---|---|
| Newer major than this build understands | Refuse loudly with `ActionableError`. Never best-effort render an unknown shape. |
| Same major | Tolerant read with unknown-field passthrough. This artifact will grow fields. |
| Older version | Migrate at read time, inside the parser. |

Unknown-field passthrough follows the e/183 `.passthrough()` lesson, already applied in
`lib/userPreferencesSchema.ts`: a strict `z.object` strips unknown keys, so an older build
round-tripping a newer build's field would silently destroy data.

No envelope/payload split was adopted. That is machinery for multi-payload formats; a plain
integer plus the shared parser gives the same protection here. No migration code ships until a v2
exists. This ADR commits to *where* migrations live, not to writing them now.

### 4. The result stamps its resolved derivation

`InquiryResult` records the models actually used, rounds, and budget, not just the `fidelity`
label that produced them.

`deriveDebateConfig` will change as models retire and budgets are tuned, so `'standard'` in June
will not mean what it meant in March. A result carrying only the label has unrecoverable
provenance. Stamping resolved values is also what keeps the `fidelity` enum free to evolve. Once
results carry resolved facts, adding a fourth level or re-tuning `standard` touches nothing
already persisted. The request stays lean; the result carries the receipt.

The `fidelity` enum itself stays closed at `quick | standard | deep`. A parameterized version
re-grows the 40-field `CLIConfig` one option at a time, which is the friction this feature exists
to remove.

### 5. Node references carry an inline display snapshot

The taxonomy is mutable; nodes are retired and renamed as a matter of routine. A persisted result
opened much later must either resolve its POV node references against a corpus that has moved, or
render from its own data.

It does both: the node IDs for live navigation, plus a minimal snapshot (label, camp) inline. An
old result then degrades to stale labels rather than broken references. Retrofitting snapshots
into already-persisted results would itself be a migration, which is why this is decided now.

### 6. `TrustState` carries a reason, and the reason is mandatory

A trust verdict records *why* it was reached. Which gate fired, and which termination reason
drove it, rather than a bare `trust` / `censored` label.

The trust projection encodes a current research judgment, binding censoring to the convergence
metric family only. That binding is expected to evolve alongside the calibration work. A verdict
that carries its reasoning stays interpretable across that change; one that carries only a label
does not.

## Consequences

Shared Lib moves to the head of the critical path, since every other inquiry ticket blocks on
`lib/inquiry/`. An earlier draft of the HLD placed the contract in `lib/debate/` and recorded
Shared Lib as uninvolved; the Second Opinion consult corrected this.

Downstream consumers import the schema and parser rather than hand-rolling validation, and no
consumer may cast an untrusted payload to `InquiryResult`. Migration logic, when it eventually
exists, has one home.

## Alternatives rejected

**No standalone contract**, letting each consumer define its own shape. Five roles independently
modelling one artifact is the duplication the shared-utility rule exists to prevent.

**Reuse `DebateSession` directly.** The inquiry answer is a synthesis *over* a debate, not a
debate. Coupling the UI to the 19 MB session shape is what made the hand-driven pilot
unusable as a user experience.

**Defer `schemaVersion` until sharing ships.** This misidentifies the one-way door. It closes at
first persistence, not at first share. By the time a share surface exists, unversioned results
are already stored.
