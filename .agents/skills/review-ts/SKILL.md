---
name: review-ts
description: Self-review TypeScript/Electron code against the project's TypeScript Stack Code Review Guide. Run before reporting work as done.
---

Review your recent TypeScript/Electron changes against the project's code review guide.

1. Read `docs/CodeReview/TypeScript Stack Code Review Guide.md`
2. Identify which files you changed in this session
3. For each changed file, check against all applicable sections of the guide:
   - Electron security (IPC, context isolation, sandbox)
   - WebSocket security (wss://, origin validation, backpressure)
   - Azure identity (no DefaultAzureCredential in production)
   - GenAI integration (@google/genai, streaming, safety settings)
   - React/Zustand (typed stores, IPC listener cleanup)
   - Markdown rendering (react-markdown, sanitization)
   - PDF.js (Web Worker, version matching)
   - jszip (Uint8Array over strings, worker offloading)
   - xterm/node-pty (env scrubbing, shell path)
   - Network resilience (fetch routing through web-bridge, timeouts, retry safety, error feedback)
   - Testing (mock cleanup, user-event)
4. Report any findings with severity (CRITICAL/WARNING/INFO), file:line, and specific fix
5. Fix any CRITICAL issues before reporting done