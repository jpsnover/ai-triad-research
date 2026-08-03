# ElectronMain — File Inventory

Reference inventory of the Electron main-process files in `taxonomy-editor/src/main/`.
Behavioral norms live in `AGENTS.md`; this file is discovery only.

| File | Purpose |
|------|---------|
| `main.ts` | Electron app entry point, window creation, lifecycle |
| `ipcHandlers.ts` | IPC registrar — installs the per-domain handler groups in `ipc/` |
| `ipc/` | Per-domain IPC handler modules (taxonomy, source, ai, debate, chat, apiKey, dataRepo, organization, flightRecorder, community, system) |
| `preload.cts` | Preload script — exposes safe APIs to renderer |
| `fileIO.ts` | File system read/write operations |
| `debateIO.ts` | Debate save/load to disk |
| `debateExport.ts` | Debate export (Markdown, JSON) |
| `chatIO.ts` | Chat history persistence |
| `apiKeyStore.ts` | Secure API key storage |
| `modelDiscovery.ts` | LLM model enumeration from backends |
| `embeddings.ts` | Local embedding model management |
| `dataUpdateChecker.ts` | Data repo sync detection |
| `terminal.ts` | Terminal/PTY integration |
| `diagnosePython.ts` | Python environment diagnostics |
| `pty-broker.py` | Python PTY broker script |
