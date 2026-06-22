# ADR-004: Use Edit/Write tools instead of shell escaping

**Status:** accepted
**Date:** 2026-04-15
**Author:** Technical Lead

## Context

When AI agents write or modify code containing template literals, nested quotes, backticks, `$` variables, or f-strings, shell escaping via `sed`, `awk`, or heredocs silently corrupts the output. This was the #1 source of bugs in early development — code that looked correct in the prompt was mangled by shell interpretation.

## Decision

When writing, editing, or executing code containing special shell characters, always use the Edit/Write tools instead of Bash `sed`, `awk`, or heredocs.

When running Python/PowerShell scripts that contain quotes or f-strings, write the script to a temp file with the Write tool and execute it, rather than inlining in a heredoc or `bash -c`.

## Consequences

- Eliminates an entire category of silent corruption bugs
- Agents must use two steps (write file, then execute) instead of one (inline command) for complex scripts
- Edit/Write tools provide exact string replacement with no shell interpretation layer
- This rule applies to all agents in the project — enforced via CLAUDE.md convention
