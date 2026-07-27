# ServerAPI — File Inventory

Core-layer files owned by **ServerAPI Main** (the HTTP/wiring layer). Cluster
modules (auth/keys, storage, AI proxy, community/admin) belong to the sub-roles —
see the Sub-roles table in [AGENTS.md](./AGENTS.md).

| File | Purpose |
|------|---------|
| `server.ts` | Main HTTP server — route definitions, middleware, WebSocket setup |
| `config.ts` | Data paths, project root resolution, `.aitriad.json` config |
| `runtimeConfig.ts` | Typed runtime config — DEFAULTS, validation, mtime-cached `getConfig()`, REST endpoints |
| `featureFlags.ts` | Server-side feature flag evaluation |
| `logger.ts` | Server-side structured logging (pino + per-request context) |
| `serverLogBuffer.ts` | Ring buffer of recent server log lines (for flight-recorder dumps) |
| `flightRecorderDumps.ts` / `flightRecorderViewer.ts` | Server dump merge/read + viewer |
| `rollbackStatus.ts` | Admin rollback status endpoint |
