# AI Triad Research — Project History

A narrative record of significant decisions, shifts, and milestones. Not a changelog — read this to understand *why* the project is the way it is.

---

## 2026-04-02 — Orca team stood up; error handling standardized

The project adopted Orca as its AI team management system. Nine profiles were created: four code-owning profiles (Taxonomy Editor, PowerShell, Shared Lib, Orca Support) and five role-based profiles (Technical Lead, SRE, Product Manager, Risk Assessor, Diagnostics, Historian). The team can now communicate via pings and email, with agents waking each other for coordination.

Alongside this, a mandatory error handling standard was established. Two shared utilities — `New-ActionableError` (PowerShell) and `ActionableError` (TypeScript) — enforce structured diagnostics: every unrecoverable error must state its goal, problem, location, and specific next steps. An `error-handling-auditor` subagent was created to enforce compliance incrementally as code is touched.

## 2026-04-02 — BDI terminology migration initiated

The team began migrating the taxonomy's cognitive model terminology to align with the Belief-Desire-Intention (BDI) framework. The old categories (Data/Facts, Goals/Values, Methods/Arguments) will map to Beliefs, Desires, and Intentions respectively. The Product Manager is auditing every surface where the old terms appear — types, UI, schemas, prompts, cmdlets, data files — before the Technical Lead produces an implementation plan reviewed by the SRE for failure modes. No code changes until the plan is approved.
