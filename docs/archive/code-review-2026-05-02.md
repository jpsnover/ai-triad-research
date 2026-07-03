# TypeScript Stack Code Review Report: AI Triad Research Platform

**Review Date:** May 2, 2026  
**Reviewer:** Gemini CLI (Tech Lead)  
**Scope:** `lib/`, `taxonomy-editor/`, `poviewer/`, `summary-viewer/`  
**Reference Document:** `docs/CodeReview/TypeScript Stack Code Review Guide.md`

---

## Executive Summary

The codebase exhibits a strong foundation in modern TypeScript and React patterns, particularly in `taxonomy-editor`. However, there are significant security and architectural inconsistencies between the primary application (`taxonomy-editor`) and the secondary viewer applications (`poviewer`, `summary-viewer`). Several "Critical" and "High" priority issues were identified regarding Electron hardening, IPC validation, and AI integration standards.

---

## 1. Electron Application Security (CRITICAL)

### Findings:
*   **[CRITICAL] Inconsistent Hardening:** While `taxonomy-editor` implements robust window hardening (blocking `will-navigate`, denying `setWindowOpenHandler`), `poviewer` and `summary-viewer` lack these protections entirely.
*   **[CRITICAL] Sandbox Disabled:** `poviewer` and `summary-viewer` fail to enable the `sandbox: true` webPreference, violating the principle of least privilege.
*   **[HIGH] IPC Payload Validation:** The guide mandates `zod` validation for all IPC payloads. `poviewer` lacks this entirely, and `taxonomy-editor` has only partial coverage (e.g., `save-taxonomy-file` validates the POV but not the `data` payload).

### Remediation:
1.  Enable `sandbox: true` in all `BrowserWindow` configurations.
2.  Port the `hardenWindow` utility from `taxonomy-editor/src/main/main.ts` to `poviewer` and `summary-viewer`.
3.  Implement comprehensive Zod schemas for every `ipcMain.handle` in `lib/electron-shared` or per-app `ipcHandlers.ts`.

---

## 2. Native Subprocesses and Terminal Security (HIGH)

### Findings:
*   **[HIGH] Environment Leakage:** `taxonomy-editor/src/main/terminal.ts` passes the full parent `process.env` to `pty.spawn`. This leaks AI API keys, system credentials, and path info to the child shell.
*   **[MEDIUM] Flow Control/Backpressure:** Terminal output is streamed to the renderer via IPC without flow control (`handleFlowControl: true` is missing). High-throughput commands could exhaust IPC buffers or cause UI lag.

### Remediation:
1.  Define a whitelist of required environment variables for the shell (e.g., `PATH`, `TERM`, `USER`) and pass only those to `pty.spawn`.
2.  Enable `handleFlowControl: true` in `node-pty` and implement a push-back mechanism if the IPC channel is congested.

---

## 3. AI Integration and API Standards (HIGH)

### Findings:
*   **[HIGH] Non-Compliant SDK Usage:** The codebase uses direct `fetch` (or Electron `net.fetch`) for Gemini API calls in `lib/ai-client`. The guide explicitly mandates the `@google/genai` unified library.
*   **[MEDIUM] Incomplete Safety Settings:** `GEMINI_SAFETY_SETTINGS` lacks the `HARM_CATEGORY_CIVIC_INTEGRITY` category, which is recommended for 2026-era applications.
*   **[MEDIUM] Manual SSE Parsing:** Streaming responses are parsed manually in `embeddings.ts`. This logic is brittle compared to the SDK's built-in streaming support.

### Remediation:
1.  Refactor `lib/ai-client/providers/gemini.ts` to use `@google/genai` (GoogleGenerativeAI).
2.  Update `GEMINI_SAFETY_SETTINGS` to include all modern harm categories.
3.  Replace manual SSE string slicing with the SDK's `response.stream` iterator.

---

## 4. Frontend Rendering and Memory Management (MEDIUM)

### Findings:
*   **[MEDIUM] PDF Worker Alignment:** `PdfViewer.tsx` hardcodes the path to the PDF.js worker. The guide mandates dynamic version resolution to ensure the worker and API versions are perfectly aligned.
*   **[LOW] Large Payload Handling:** `ipcHandlers.ts` in `taxonomy-editor` reads/writes large JSON files directly. For very large taxonomy files, this could block the main thread.

### Remediation:
1.  Update the `pdfjsLib.GlobalWorkerOptions.workerSrc` assignment to use a version-stable URL or a Vite-managed worker import.
2.  Consider moving large JSON serialization/deserialization to a `Worker` thread in the Main process if files exceed 50MB.

---

## 5. Architecture and State Management (STRENGTHS)

### Observations:
*   **[STRENGTH] Zustand Implementation:** `useDebateStore` correctly uses the curried `create<T>()(...)` signature.
*   **[STRENGTH] IPC Lifecycle:** The IPC bridge in `preload.ts` correctly returns cleanup functions, preventing listener leaks.
*   **[STRENGTH] Prompts Isolation:** Prompt templates are successfully decoupled from implementation logic in `lib/debate/prompts.ts` and renderer-side prompt files.

---

## Final Recommendation
Prioritize the **Electron Security** and **Environment Leakage** fixes immediately. These represent tangible vulnerabilities where a malicious document or a compromised shell could escalate privileges or exfiltrate credentials. Following that, modernize the **AI Client** to the `@google/genai` SDK to ensure future-proofing and access to 2026-era model features.
