# Shared-Tree Divergence — Cleanup Procedure

**Scope:** the shared checkout's local `main` has diverged from `origin/main` (N ahead, M behind) and cannot fast-forward. Referenced from root `AGENTS.md` → Workflow Mode.

## The distinction this procedure exists to make

Root `AGENTS.md` says tree-rewriting operations (`checkout`, `reset`, `rebase`, `merge`, `pull --rebase`, `stash`) are worktree-only in the shared checkout. Read literally, that leaves a diverged shared tree with no legal way back — and a tree that can never sync becomes permanently stale, which is its own hazard: two of the six collisions on 2026-09-28 were caused by stale or foreign content in the shared tree, not by rewrites.

So the rule is not "never sync." It is:

> **An incidental rewrite — done mid-task, unannounced, to unblock your own push — is prohibited. A maintenance sync — announced, serialized, preconditions verified, by the designated owner — is required.**

Same git commands, different acts, opposite risk profiles. The incidental one injures whoever is reading the tree. The scheduled one is the thing that stops the tree rotting.

**Do not use this procedure to resolve your own rejected push.** That is the incidental case. See *Prevention* below.

## Owner

**DevOps** performs the sync. They run the hourly drift check and own shared-tree health. Anyone else who finds a diverged tree reports it and stops — a second actor mid-sync is how you get two agents rewriting one tree.

## Step 1 — Classify the local commits

Diverged trees differ only in whether the local commits carry content that exists nowhere else.

```sh
git fetch origin
git log --oneline origin/main..main          # local-only commits
git rev-list --left-right --count origin/main...main
```

For **each** local commit, ask whether its *content* is already on `origin/main`. Ancestry is the wrong test — a squash-merge or cherry-pick lands the content under a different SHA, so `--is-ancestor` reports "not merged" for work that landed hours ago. Compare content:

```sh
git show <local-sha> --stat                  # what did it touch?
git diff <local-sha> origin/main -- <paths>  # empty ⇒ content already on origin
```

- **REDUNDANT** — every local commit's content is on `origin/main`. Go to Step 3.
- **UNIQUE** — some content exists only locally. Go to Step 2 first. **Do not reset; you would destroy it.**

## Step 2 — Rescue unique content into a branch

Never resolve unique local commits in place. Move them to a branch off current `origin/main`:

```sh
git worktree add .worktrees/<name> -b <rescue-branch> origin/main
cd .worktrees/<name> && git cherry-pick <local-sha> [<local-sha>...]
git push -u origin <rescue-branch>
```

Open a PR, verify, merge with `--match-head-commit`. Preservative by construction: the author's content lands unchanged under a new SHA.

Then confirm at the object level that it landed, and only then treat the local commits as REDUNDANT:

```sh
git fetch origin && git diff <local-sha> origin/main -- <paths>   # must be empty
```

**Notify the commit's author.** You are landing someone else's work; they should know it is safe and where it went.

## Step 3 — Verify the preconditions

All three must hold. If any fails, **stop** — a sync into a dirty tree destroys a colleague's uncommitted work, which is the incident this whole rule set exists to prevent.

1. **No uncommitted work by anyone.** Scan **unscoped** — a path-filtered status reports clean while a peer's file sits outside your filter.
   ```sh
   git status --short                        # tracked + untracked, whole tree
   git status --short --untracked-files=no   # tracked only
   ```
   Distinguish **real WIP** (needs an owner claim — `resolve_owner` the path, ping them, wait) from **phantoms** (byte-identical-modulo-CRLF snapshots, generated files). Restore phantoms; never assume a real modification is abandoned.

2. **Step 1 says REDUNDANT**, or Step 2 completed and was verified.

3. **Announced.** Say you are syncing, in the channel the fleet reads, before you start.

## Step 4 — Record the escape hatch, then sync

```sh
git log --oneline -5 main > /tmp/pre-sync-main.txt   # recoverable via reflog if Step 1 was wrong
git fetch origin
git reset --hard origin/main
```

`reset --hard` is correct here and there is no gentler option — `merge --ff-only` fails by definition on a diverged branch. The file changes that land on disk are the M commits the tree was behind by, which is the tree arriving at the state every agent already expects `main` to be in.

## Step 5 — Verify, and say what you verified

```sh
git rev-parse HEAD origin/main               # must match
git status --short --untracked-files=no      # must be empty
git rev-list --left-right --count origin/main...main   # must be 0  0
```

Report the SHA. "Synced" without a SHA is indistinguishable from a sync that silently failed.

## Prevention — the cheap path that avoids all of the above

Divergence is not inevitable. It is the product of a gap between committing and pushing, and at this fleet's merge rate that gap is usually enough.

- **Push immediately after committing on shared `main`.** Not at the end of the task — in the same breath as the commit.
- **If the push is rejected, do NOT resolve it in place.** That is the incidental rewrite. Cherry-pick to a worktree (Step 2) and land it from there. Costs seconds; a shared-tree rebase costs somebody else's uncommitted work.
- **For anything beyond a one-file edit, start in a worktree.** Then divergence cannot arise, because you never commit on the shared tree at all.

## Why each step is there

Every precondition maps to an observed failure on 2026-09-28 (anchor: t/3714, six collisions in one session):

| Step | Failure it prevents |
|---|---|
| 1 — content, not ancestry | A `reset` that discards work which squash-merge made *look* unmerged |
| 2 — rescue before reset | Destroying unique local commits; the incident-#6 shape (a local commit invisible to origin) |
| 3.1 — unscoped status | A sync over a peer's uncommitted WIP; and a peer's WIP compiling into your build |
| 3.3 — announce | Two actors rewriting one tree concurrently |
| 4 — record before reset | An irreversible reset taken on a wrong Step-1 call |
| 5 — verify with a SHA | "Done" reported for an operation that did not complete |

The through-line: **every step is a check that the thing you believe about the tree is actually true of the tree.** The session that produced these six incidents produced them mostly through careful work on an untrue belief about what was on disk.
