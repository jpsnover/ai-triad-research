# ADR-003: Flight recorder in every catch block

**Status:** accepted
**Date:** 2026-05-06
**Author:** Technical Lead

## Context

Production errors are intermittent and hard to reproduce. By the time a user reports an issue, the server logs have rotated and the client state is gone. Traditional logging is either too verbose (fills disk, slows performance) or too sparse (misses the error context).

## Decision

The flight recorder (ring-buffer event recorder) must capture every error at the point of occurrence:

1. Every `catch` block in `taxonomy-editor/src/server/`, `taxonomy-editor/src/renderer/`, and `lib/debate/` must call `getGlobalRecorder()?.record()` before throwing or returning
2. The `error` object must include `stack: (err as Error).stack`
3. Expected errors (404, ENOENT) record at level `warn`, then return null/empty
4. An ESLint rule (`require-flight-recorder-in-catch`) enforces this at lint time

Only exceptions: `fileExists()` returning false (with `/* telemetry — silent by design */` comment) and test files.

## Consequences

- Any flight recorder dump contains the full error history for the session — no "I can't reproduce it"
- Ring buffer bounds memory usage (default 5000 events renderer, 2000 server)
- Every catch block is ~3 lines longer — enforced by ESLint, so it's not optional
- Must be careful not to record PII or secrets in error messages (see ADR for flight recorder PII controls when adopted)
- NDJSON dump format is grep-friendly for post-mortem analysis
