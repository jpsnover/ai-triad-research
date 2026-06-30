# LLM Codebase Analysis Optimization — Evaluation & Recommendations

**Date:** 2026-06-29
**Author:** Technical Lead
**Ticket:** t/1100
**Status:** Evaluation complete

## Executive Summary

Eight techniques for optimizing LLM-agent codebase analysis were evaluated against our current Orca + Claude Code architecture. **We already implement 4 of 8 techniques** through existing tooling. Of the remaining 4, one has clear near-term ROI (LSP integration), one is worth experimenting with (repo map generation), and two should be skipped (Tree-sitter chunking, prompt compression).

Our primary efficiency bottleneck is **multi-agent coordination overhead** (ticket routing, design review gates, cross-scope consistency checks), not context window limits or single-agent token cost. Most of the suggested techniques optimize for a problem we don't have.

## Recommendation Summary

| Technique | Verdict | Rationale |
|-----------|---------|-----------|
| Tree-sitter / AST chunking | **Skip** | Claude reads whole files well; our files are small enough. Adds build complexity for marginal gain. |
| Graph databases for code | **Skip** | We have depgraph.mjs + dependency-cruiser. Neo4j for code deps is over-engineered for our scale. |
| LSP integration | **Experiment** | "Go to definition" across files would reduce grep-then-read cycles. Check Claude Code roadmap first. |
| Repo map generation | **Experiment** | Compressed codebase overview could help new-session cold starts. Low-effort to prototype. |
| Prompt compression (LLMLingua) | **Skip** | Claude's 200K context handles our files. Compression risks stripping semantically important code. |
| Router-Editor agent split | **Already have** | Orca role scoping + TL routing = this architecture. |
| SWE-bench restricted toolsets | **Already have** | Claude Code's Read/Edit/Grep/Glob/Bash = structured, restricted tool access. |
| Unified diffs / search-replace | **Already have** | Claude Code's Edit tool outputs search-and-replace blocks. Never rewrites full files. |

## Detailed Evaluation

### 1. Tree-sitter / AST-Based Semantic Chunking

**What it does:** Parse code into an Abstract Syntax Tree, chunk by function/class/method boundaries instead of line count.

**What we have instead:** Claude Code's Read tool reads files with line-number offsets. Agents read specific line ranges when they know what they need. Our TypeScript files average 200-500 lines — well within a single read. The largest file (`server.ts`) is ~4500 lines, but agents read specific sections via offset/limit.

**Why skip:** AST chunking solves a problem for RAG pipelines that must pre-chunk code into embedding vectors. We don't use RAG for code — agents read files on demand with full structural context. Adding Tree-sitter parsing would introduce a build step and runtime dependency with no measurable improvement for our file sizes. If we had a monorepo with 10K+ line files, this would matter.

**Revisit when:** File sizes routinely exceed 2000 lines, or we add a code-search RAG pipeline.

---

### 2. Graph Databases for Code Dependencies

**What it does:** Build a code dependency graph (function calls, class inheritance, imports) in Neo4j or a property graph, then query it to find relevant execution paths.

**What we have instead:**
- `depgraph.mjs` — custom dependency graph tool with `--stats`, `--reverse`, `--query`, `--orphans` modes
- `dependency-cruiser` — static import analysis, runs in the verify gate
- Neo4j integration for **taxonomy data** (`Invoke-CypherQuery`, `Export-TaxonomyToGraph`) — but not for code structure

**Why skip:** `depgraph.mjs` already provides the import-level dependency graph agents need for blast-radius analysis. A full Neo4j code graph would require continuous re-indexing on every commit, schema maintenance, and a running database — significant infrastructure cost. Our codebase (~200 TypeScript files, ~50 PowerShell files) is small enough that Grep finds cross-references in seconds.

**Revisit when:** Codebase exceeds 1000 files, or we need runtime call-graph analysis (not just static imports).

---

### 3. LSP Integration (Go-to-Definition, Find-References)

**What it does:** Give the LLM agent programmatic access to Language Server Protocol features — jump to definition, find all references, get type information at a cursor position.

**What we have instead:** Grep + Glob for manual symbol search. Works but requires the agent to know what to grep for, and often produces noisy results (string matches vs. semantic references).

**Why experiment:** This is the highest-ROI gap in our current tooling. When an agent needs to trace a function through 3 files, the current workflow is: grep for the name → read each match → determine which is the definition vs. a reference → read the definition file. An LSP "go to definition" call collapses this to one step. Key questions:

1. **Does Claude Code's roadmap include LSP?** — Check before building custom tooling. If it's coming natively, wait.
2. **TypeScript-only or polyglot?** — We need TS (tsserver) at minimum. PowerShell LSP would be nice but lower priority.
3. **Prototype:** A lightweight MCP server wrapping `tsserver` that exposes `go-to-definition` and `find-references` as tools. Scope: 1-2 days to prototype, test with agents for a sprint.

**Recommendation:** Check Claude Code roadmap. If no near-term LSP support, prototype a tsserver MCP wrapper and evaluate whether it measurably reduces agent search cycles.

---

### 4. Repository Map Generation (Aider-style)

**What it does:** Generate a compressed "map" of the codebase — file names, exported functions/classes, module structure — ranked by importance (e.g., PageRank on import graph). Feed this to the agent at session start so it knows where things are without reading every file.

**What we have instead:**
- Orca role scoping — each agent knows its own files by scope definition
- `AGENTS.md` files — human-written descriptions of each role's responsibilities and key files
- `depgraph.mjs --stats` — shows file counts and top importers
- Root `AGENTS.md` — architecture overview with key file pointers

**Why experiment:** Our existing approach works well for **within-scope** navigation (agents know their files), but breaks down for **cross-scope** discovery. When the TL needs to trace a bug across 4 agents' scopes, or a new agent needs to understand the full architecture, there's a cold-start cost. A compressed repo map (auto-generated from the AST, not hand-maintained) could help.

**Prototype approach:**
1. Script that walks the TypeScript AST (via `ts.createProgram`) and extracts exported symbols per file
2. Output a `REPO_MAP.md` with one line per file: `path — exported symbols (top 5 by import count)`
3. Auto-regenerate on commit (CI step or pre-commit hook)
4. Load into agent context on session start alongside AGENTS.md

**Expected ROI:** Low effort (1 day to build), moderate benefit for cross-scope work and onboarding new roles. Worth a prototype.

---

### 5. Prompt Compression (LLMLingua)

**What it does:** Use a smaller model to remove redundant tokens, comments, and boilerplate from code before sending to the main model. Reduces input token count by 30-60%.

**What we have instead:** Claude's 200K context window. Our largest single-agent context load (reading multiple files for a cross-cutting review) rarely exceeds 50K tokens.

**Why skip:** Prompt compression introduces a lossy transformation that can strip semantically important code (variable names shortened, comments with intent removed, whitespace that conveys structure). The cost savings (~30% token reduction on inputs that are already well within budget) don't justify the risk of degraded code understanding. Our token costs are dominated by multi-agent output tokens (many agents generating responses), not input tokens.

**Revisit when:** Input token costs become a dominant budget line, or context windows shrink (unlikely).

---

### 6. Router-Editor Agent Split — ALREADY HAVE

**What the suggestion describes:**
- Agent 1 (Searcher): Cheap model identifies relevant files
- Agent 2 (Editor): Expensive model generates the fix

**What we have:** This is exactly our Orca architecture:
- **TL** routes work by analyzing the problem and identifying owning agents (the "router")
- **Explore agent** (`subagent_type: Explore`) does fast read-only search with cheaper context
- **Owning agents** (DebateTool, Server Storage, Taxonomy Editor, etc.) implement fixes in their scope (the "editors")
- **Code review sub-agents** (`ts-code-reviewer`, `error-handling-auditor`) provide specialized review

Our version is actually more sophisticated than the suggested 2-agent split — we have N specialized agents with file ownership, design review gates, and cross-agent consistency checks.

**No action needed.**

---

### 7. SWE-bench Restricted Toolsets — ALREADY HAVE

**What the suggestion describes:** Give agents a restricted set of bash tools tailored for code navigation (search, view, edit) instead of letting them read entire files.

**What we have:** Claude Code provides exactly this:
- `Read` — read specific line ranges of files
- `Edit` — search-and-replace within files (not full rewrites)
- `Grep` — ripgrep-powered content search with regex, file type filters, context lines
- `Glob` — fast file pattern matching
- `Bash` / `PowerShell` — shell access for git, npm, test runners
- `Agent` — spawn sub-agents for parallel work

These tools are more capable than SWE-bench's restricted toolset (which uses custom `open`, `goto`, `edit` commands). Our agents can also use MCP tools for Orca communication, ticket management, and dashboard access.

**No action needed.**

---

### 8. Unified Diffs / Search-and-Replace Output — ALREADY HAVE

**What the suggestion describes:** Instead of rewriting full files, output only the diff (search-and-replace blocks).

**What we have:** Claude Code's `Edit` tool works exactly this way:
```
Edit(file_path, old_string="existing code", new_string="replacement code")
```

The agent specifies only the changed portion. The tool handles finding the match and applying the replacement. Full file rewrites use the `Write` tool, which agents are instructed to avoid for existing files. Our AGENTS.md explicitly says: "Prefer editing existing files to creating new ones."

**No action needed.**

---

## Where Our Actual Friction Is

The suggested techniques optimize for **single-agent context efficiency**. Our bottlenecks are different:

1. **Multi-agent coordination overhead** — Design review gates, ticket routing, cross-scope consistency checks. Each agent interaction costs a full context load. Orca's ping/email/ticket system helps but adds latency.

2. **Cold-start cost** — When an agent starts a new session, it re-reads AGENTS.md, checks tickets, scans recent commits. This is ~10-20K tokens before any work begins. A compressed repo map (technique 4) could reduce discovery time.

3. **Cross-scope tracing** — Diagnosing bugs that span multiple agents' scopes (like the anonymous user bugs in today's retrospective) requires the TL to read files across 4+ scopes. LSP (technique 3) would help here.

4. **Stale context in long sessions** — As conversations grow, earlier file reads become stale. Context compression happens automatically, but important details can be lost. This is a Claude Code platform concern, not something we can fix with tooling.

## Recommended Next Steps

1. **Check Claude Code roadmap for LSP support** — if coming soon, wait; if not, prototype a tsserver MCP wrapper (1-2 days)
2. **Prototype auto-generated repo map** — script to extract exported symbols per file, ranked by import count (1 day)
3. **Monitor token costs** — if input costs become significant, revisit prompt compression
4. **No infrastructure changes** — skip Tree-sitter, code-graph Neo4j, and LLMLingua for now
