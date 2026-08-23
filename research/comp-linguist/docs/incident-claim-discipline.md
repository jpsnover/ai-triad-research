# Incident Claim Discipline (CL scope)

**Ticket:** t/2961 · **Incident anchor:** t/2945 · **Thread:** e/120

**Provenance class:** `derived`. It comes from observed incident behavior on the e/120 thread (the authorship oscillation plus two duplicate filing pairs), not from stipulation and not from human validation. No metric, threshold, weight, or lexicon is introduced, so `metric-provenance-register.md` needs no entry.

## The rule

> **During a live incident, claim on the incident anchor before you write and before you file, as a named instance.**

Three parts, all load-bearing.

### 1. It binds per-actor (per instance, per background job), not per role

A peer background job **in your own role** counts as a different actor for claiming purposes. It has its own context. It cannot see your writes, your filings, or your in-flight intentions.

That changes how you speak and how you check.

- **State authorship at instance scope.** Say "CL Main, this job, did not write that, and I cannot speak for concurrent CL Main jobs." Do not say "CL did not write that." A denial that holds at job scope and fails at role scope does more damage than silence, because readers take it as a role-level exclusion and go looking for a third party who does not exist.
- **Check for peer claims at instance scope.** "No peer has claimed it" has to mean that no *instance* has a claim on the anchor, including another job of your own role. Role-level reasoning does not discharge the check. Being CL, working on CL work, is not evidence that the work is unclaimed.
- **Sign claims with your instance identity**, so a reader of the anchor can tell two same-role actors apart.

### 2. It covers two claim classes, not one

| Class | Trigger | Claim before |
|---|---|---|
| **Claim-before-write** | Any shared-tree mutation during a live incident, including repo write, data-repo write, merge, restore, `git` amend, and file regeneration | the mutation |
| **Claim-before-file** | Any ticket creation for incident follow-up | `create_ticket` |

The pre-existing root rule ("Live incident: claim follow-ups before filing") covers only the second class. The write class is the addition. This incident's most expensive failure was a write nobody could attribute, not a filing.

### 3. The anchor is the single serialization point

Both claim classes land as comments on the incident anchor ticket, so any actor can read the complete set of in-flight claims in one place. Claims scattered across email threads, pings, and per-role tickets do not serialize. They only look like they do.

## Evidence base

All three symptoms below occurred **inside a single role** (CL Main), which is why the role-scoped rule could not catch any of them. They share one root cause. Multiple concurrent CL-Main background jobs ran with disjoint context, none aware of the others' writes or filings.

1. **Authorship oscillation** on the 11:22:17 edge-rationale write. e/120 **#75** and **#86** said "not by me"; **#74**, **#87**, and **#88** said otherwise. #75's denial held at job scope and failed at role scope. It cost an escalation toward an unknown-writer forensic, stood down at **#96** once `b8de7c50` was shown to have produced the sha256-identical re-merge 80 s before the write. One actor, CL Main, no third party.
2. **Duplicate filing:** t/2954 and t/2956. Same follow-up, two jobs, same role.
3. **Duplicate filing:** t/2959 and t/2960. Same shape.

Two of the three cost a duplicate ticket apiece. The first cost an escalation, and the rule is priced by the first.

## Scope and status

- **CL adopts this rule for its own incident work now.** It waits on nothing.
- **The root `AGENTS.md` edit belongs to TL, not CL.** TL is drafting a per-instance claim-discipline addition to the root Incident Response section and taking it to the PI for approval (e/120#96), citing this incident's oscillation and the two duplicates as evidence. This document is the evidence base that edit cites. It does not gate on it.
- **If the PI declines the root addition**, this CL-scope statement stands alone and still governs CL incident work. Nothing here is conditional on the root edit landing.

Filed under prevention-per-incident (t/2379) as the **prevention** half for t/2945. Failure class: process/coordination, concurrent same-role actors with disjoint context.
