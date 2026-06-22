# ADR-001: Use ActionableError for all unrecoverable errors

**Status:** accepted
**Date:** 2026-04-07
**Author:** Technical Lead

## Context

Bare `throw "message"` and generic `new Error("something broke")` provide no guidance to the developer or operator encountering the error. In a multi-agent codebase where different agents encounter each other's errors, the error itself needs to answer: what were you trying to do, what went wrong, where, and what should I do next?

## Decision

All unrecoverable errors must use `ActionableError` (TypeScript) or `New-ActionableError` (PowerShell) with four mandatory fields:

- **Goal** — what the code was trying to accomplish
- **Problem** — what went wrong
- **Location** — `file:line — function`
- **Next Steps** — concrete actions the developer/operator should take

No bare `throw "message"`. No `throw new Error("message")` without the four fields.

Every `catch` block must call `getGlobalRecorder()?.record()` before throwing or returning, so the flight recorder captures the error context even if the error is swallowed upstream.

## Consequences

- Errors become self-documenting — any agent or human encountering one knows what to do
- Flight recorder always has error context for post-mortem analysis
- Slightly more verbose error handling code, but the ESLint rule (`require-flight-recorder-in-catch`) enforces it automatically
- See `docs/error-handling.md` for the full standard
