# UsageID API (`ai-usages.json`)

> Extracted from the root `AGENTS.md` for token efficiency (t/1730). Read when working on AI call sites, model routing, or cost tracking.

Config-driven AI call abstraction. Each AI call is assigned a UsageID (e.g., `server.chat-response`, `debate.topic-critique`) and its parameters live in `ai-usages.json` at the repo root. Enables experimentation (swap a model for all chat calls in one place) and per-usage cost tracking.

**Three parameter classes:**
- **Template-dynamic** — rendered per-call from `{{var}}` placeholders (`messages`, `systemMessage`)
- **Config-dynamic** — overridden per-call when needed (`model`, `temperature`, `maxTokens`, `timeoutMs`)
- **Always-static** — set once in config, never overridden (`jsonMode`, `responseSchema`, `tools`)

**Entry points by stack:**
| Stack | Function | Location |
|-------|----------|----------|
| Shared lib (TS) | `callByUsage(usageId, values, deps, overrides?)` | `lib/ai-client/usageRegistry.ts` |
| Server (TS) | `generateTextByUsage()` / `generateTextWithSearchByUsage()` | `taxonomy-editor/src/server/ai/aiBackends.ts` |
| Debate engine (TS) | `generateViaUsage()` (private, falls back when no usageDeps) | `lib/debate/debateEngine.ts` |
| PowerShell | `Invoke-AIByUsage -UsageId <id> -Values @{...}` | `scripts/AITriad/Public/Invoke-AIByUsage.ps1` |

Config supports `_extends` for inheritance (child fields override parent). Cycle detection built in. See `lib/ai-client/usageTypes.ts` for the schema.

**Scope (ADR-006, accepted):** UsageID is the **routing-and-parameters layer**, not the prompt-content layer. Every AI call site must have a UsageID (enables model swapping + cost tracking), but prompt text stays in code builders (`prompts.ts` / `.prompt` files) passed via `{{prompt}}` — that passthrough is the sanctioned pattern, not a stopgap. Only simple static prompts belong fully in config. Never convert complex builders to templates.
