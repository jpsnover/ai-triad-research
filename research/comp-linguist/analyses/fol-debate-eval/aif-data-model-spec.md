# AIF v1 data-model spec (t/3589 / build item B4a)

**Author:** Computational Linguist
**Status:** **cleared Second Opinion with conditions** (e/190; schema / data-model class). Conditions 1/2/4 and both non-blocking recommendations are folded into this spec; condition 3 binds B5 (t/3588#2). B4b (t/3590, DebateTool) proceeds on this amended spec, no second SO pass.
**Governing principle:** *vocabulary over formalism* (CL `docs/ontology-reference.md`). JSON records with a controlled `type` vocabulary; no OWL/RDF, no reasoner. **Model only empirically-validated moves** (t/3587).

## 1. Scope and non-goals

**In scope:** the minimal AIF node/edge JSON shapes the AIF crux-metrics build needs. B3 (t/3591) emits conflict/support edges into these shapes; B5 (t/3588) consumes them for crux identification and the two crux/convergence metrics; B4b (t/3590) implements the structures.

**Out of scope:** production extraction (B3), the metrics themselves (B5), and any change to live prompts or the calibration metric definitions (those route through calibration validation separately).

## 2. Node and edge shapes (v1)

A minimal AIF subset. Each object is a JSON record keyed by a controlled `type`.

**I-node (information / claim):**
```
{ "id": string, "type": "claim", "speaker": SpeakerId, "turn": number, "round": number, "text": string, "held": boolean }
```
**I-nodes are claim-*tokens*, one per utterance, not claim-*types* (SO condition 1).** A claim asserted at turn 2 and reasserted at turn 5 is two I-nodes with distinct `turn` values, not one I-node whose boolean flips. This is what makes the temporal metrics computable: retained-hold *reduction over time* is a count of `held` tokens ordered by `turn`, which a per-claim-type boolean could not express. `held` is therefore a property of a single utterance-token (this reassertion resisted its incoming attack), never a static summary of a claim's whole life.

`speaker` is the `SpeakerId` union from `lib/debate/types/phase.ts`: `"accelerationist"|"safetyist"|"skeptic"|"user"`. `user` is included deliberately: a user-participated debate has user turns that can be attacked or conceded, so they must be able to become I-nodes. (`cc` is a taxonomy POV camp, not a debate speaker, and is correctly absent.)

`turn` is the token's 0-based position in the debate's immutable transcript. It is the single carrier of *fine-grained* temporal order: every time-dependent metric (concession accumulation, retained-hold reduction, and whether a CA-node is *sustained across rounds*) derives from comparing `turn` values. The reference is stable because the transcript is immutable, and it stays in-memory only.

`round` is the token's debate round, structural-by-construction from the same transcript exactly as `turn` is (SO non-blocking rec a). It is carried rather than re-derived so that B5's "sustained across rounds" test does not force every consumer to independently reconstruct the turn→round mapping; "sustained" = a CA-node whose attacker/target tokens fall in different `round` values.

`held` = the `retained_hold` move (the speaker reasserts this claim despite an incoming attack). Applied consistently on the instances present in the t/3587 pilot (2 positive instances, N=10 turns, 1 session); reliability not yet estimated, pending the sized run and B1.5 human adjudication.

**CA-node (conflict / attack):**
```
{ "id": string, "type": "conflict", "attacker": I-id, "target": I-id }
```
A cross-agent attack: the `attacker` I-node conflicts with the `target` I-node. No `status`, no `condition` (see §4). **Cross-agent is a graph invariant, not just prose (SO condition 2):** `speaker(attacker) ≠ speaker(target)`. B4b enforces it at construction and B5 may rely on it; a same-speaker conflict is not representable as a CA-node in v1 (self-revision is not the crux signal). If a later version needs to represent self-conflict, it lifts this invariant explicitly rather than letting one leak in undetected.

**RA-node (support / inference; light):**
```
{ "id": string, "type": "support", "from": I-id, "to": I-id, "concession": boolean }
```
`concession` = the `concession` move (`from` grants `to`, an opponent's I-node). Applied consistently on the instances present in the t/3587 pilot (2 positive instances, N=10 turns, 1 session); reliability not yet estimated, pending the sized run and B1.5 human adjudication. A **non-concession** RA-node (`concession: false`) is a support/inference edge derived structurally from discourse relations, one I-node grounding or providing a reason for another, not from an annotated move; it is produced by B3's edge emission, not by the gold-set annotation.

**`concession` is a move label, not a provenance marker (SO non-blocking rec b).** Today `true` happens to coincide with annotation-backed and `false` with structural, but that is a coincidence of the current sample, not a rule: the moment B3 emits a classifier-detected concession, `concession: true` will hold on a structurally-derived edge. Consumers must read `concession` as *which move this is*, never as *how this edge was established*; provenance lives in §3, not in this flag.

**Graph container:**
```
{ "debateId": string, "nodes": I-node[], "conflicts": CA-node[], "supports": RA-node[] }
```

**Referential integrity:** every `attacker` / `target` / `from` / `to` MUST reference an existing I-node `id` in the same graph. Ids are graph-local (`i-<n>`, `ca-<n>`, `ra-<n>`), assigned per debate; no global registry, since the graph is in-memory and per-debate (§5).

## 3. Field provenance: every field maps to a validated move

| Field | Move | Basis |
|---|---|---|
| `I-node.held` | retained_hold | Annotation, t/3587 pilot: applied consistently on 2 positive instances, N=10 turns, 1 session. Reliability not yet estimated, pending the sized run + B1.5. |
| `RA-node.concession` | concession | Annotation, t/3587 pilot: applied consistently on 2 positive instances, N=10 turns, 1 session. Reliability not yet estimated, pending the sized run + B1.5. |
| `CA-node` (attacker/target) | cross-agent conflict | Classifier: reuses the t/3302 semantic-opposition classifier (via B3). |
| `RA-node` (from/to) | support / grounding | Structural-by-construction, not empirically validated: derived from discourse relations by B3, not from an annotated move. |
| `I-node.turn` | transcript position | Structural-by-construction: the token's 0-based index in the immutable transcript. |
| `I-node.round` | debate round | Structural-by-construction: the token's round, from the same transcript. |

The rows differ in kind, and the table now says so: two are annotation-backed (with counts, and explicitly not yet reliability-estimated), one is classifier-backed, and three are structural-by-construction. No field encodes an unvalidated *interpretive* judgment. That is the core discipline: the schema is exactly as large as the evidence supports, and no larger.

## 4. Deliberately omitted (with rationale)

- **`condition` (latent-CA condition / defeater): OMITTED.** The construct is not reliably annotatable in over-determined debate prose (t/3587 v2–v4: the two thresholds tested fail in opposite directions; debate positions rest on multiple independent supports, so no single condition is *necessary*). Affirmatively correct, not merely conservative.
- **`status` (e.g. active / latent): OMITTED.** "latent" depended on the omitted `condition`; "active" alone is a constant field. The "answered vs unanswered" signal (what `crux_addressed_rate` needs) is computable at metric time from turn-response structure and is not a persisted or annotated node field.
- **PA-nodes (preference), dialogical AIF+ (L-nodes / TA / YA): OMITTED.** No debate signal in the sample; formalism creep.

Every omission is **additive later** (§6) if a reliable operationalization is ever established.

**Why minimality is dominant here, not merely defensible (SO omission economics).** Because the graph is *derived from an immutable transcript and recomputed on demand*, v1 has no stored-artifact one-way door at all: if a reliable `condition` operationalization ever lands, the field is re-added and recomputed **retroactively over every historical debate**. The usual cost of schema omission (migrating persisted data) is therefore zero. The only real cost on the table is *premature inclusion*: an unvalidated interpretive field feeds metrics that then have to be un-defined once cited. With migration cost at zero and inclusion cost non-zero, "exactly as large as the evidence supports" is the dominant choice for a derived artifact, not just the cautious one. (This does not remove the versioning burden; it relocates it to the persisted *numbers* computed from the graph, which is B5's concern, not the schema's, see §7.)

## 5. Persistence

**v1 is in-memory only.** The graph is computed from the debate's *immutable* transcript when a metric needs it, is not persisted, and references only that transcript, not the mutable taxonomy corpus.

> in-memory only; if this graph is ever persisted or crosses a process boundary (including diagnostic dumps / flight-recorder events), ADR-0002's posture applies.

**ADR-0002 does not apply in v1** (no `schemaVersion`, no single-parser requirement, no tolerant read, no snapshot), because the graph is transient and references only immutable per-debate data. The guard line above makes the trigger explicit: the moment the graph is persisted OR crosses a process boundary, ADR-0002's posture (schemaVersion, one parser, tolerant read) is adopted, rather than relitigated. **The diagnostic-serialization clause is deliberate (SO condition 4):** the likeliest *accidental* first persistence is a flight-recorder dump or debug export during B5 troubleshooting, which this workspace does routinely, so that path is named as a trigger rather than left to be discovered as a violation.

## 6. Extensibility

Additive only. New node types, edge types, or fields (a future `condition` or `status`, if ever validated) are added without changing the v1 records, per ADR-0002's posture at the point persistence is introduced. v1 consumers read only the fields they know.

## 7. Consumers and the build seam

- **B3 (t/3591):** emits conflict/support edges. Its detection logic (t/3302 reuse, attribution/coref, paraphrase handling, false-negative measurement) is independent of this shape and builds behind a seam; the shape is applied at the boundary (the t/3578 `runInquiryPipeline` pattern) once this spec clears SO.
- **B5 (t/3588):** crux = a cross-agent CA-node sustained across rounds (its attacker/target tokens fall in different `round` values); `convergence_score` re-specified on the two reliable signals (concession accumulation via `RA.concession`, retained-hold reduction via `I-node.held`), both ordered by `I-node.turn`; `crux_addressed_rate` unchanged (aggregate). Eval = residual paraphrase false-negative rate, not raw crux counts. **SO condition 3 binds B5 (recorded on t/3588#2), not this schema:** because the graph is recomputable but the *numbers* computed from it persist and get cited, each reported metric must carry a definition version (or the schema-basis it was computed against) so cross-time comparisons cannot silently mix definitions; and B5's outputs stay provisional and anchor no threshold until the sized run + B1.5 reliability estimate land.
- **B4b (t/3590):** implements these shapes in `lib/debate/aif/`, in-memory, once SO clears.

## 8. Claims scope (SO point 6)

This data-model models only moves the gold set validated at the **measurement** level (are we labelling them consistently). It does **not** assert **construct** validity (is this the right thing to measure for a crux); that needs evidence from outside the definitional family and is out of scope. Recorded per the Gate Co-Location rule at the point any crux-metric threshold is anchored.

## 9. Second-Opinion package (assembled after TL pre-SO review)

Per the schema / data-model mandatory-SO class, CL (the requesting role) sends the SO: (1) this spec; (2) the alternatives rejected, i.e. the `condition` and `status` fields, with the t/3587 evidence (the bounded negative, over-determination, the κ-provenance and non-degenerate-threshold findings); (3) the persistence posture (in-memory, ADR-0002 not applicable, plus the guard line); (4) the claims-scope note (§8). The TL reviews this spec **before** it goes to the Second Opinion.
