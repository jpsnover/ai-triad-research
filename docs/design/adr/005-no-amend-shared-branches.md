# ADR-005: No git amend on shared branches

**Status:** accepted
**Date:** 2026-05-01
**Author:** Technical Lead

## Context

In a multi-agent environment, multiple agents may commit to the same branch (feature branches with multiple assignees, `main`). If Agent A commits, Agent B commits, then Agent A runs `git commit --amend`, it rewrites Agent A's original commit — but now Agent B's commit is based on the pre-amend version. The amend silently discards Agent B's work from the branch history.

The same risk applies to `git rebase` on shared branches.

## Decision

- Never use `git commit --amend` on any branch where more than one agent may be committing
- Never use `git rebase` on shared branches
- Always create a new commit instead
- When staging files on a shared branch, use explicit pathspec (`git commit -- <files>`) to avoid sweeping in other agents' pre-staged files

## Consequences

- Branch history has more commits (fixup commits instead of amended ones) — acceptable tradeoff
- No risk of silently discarding another agent's work
- `git commit -- <files>` requires knowing which files you changed — agents must be explicit
- Clean history can be achieved via squash merge at PR time, not during development
