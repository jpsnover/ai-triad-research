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

**Fallback (DevOps unavailable):** if DevOps is asleep or unreachable and the tree is diverged, the **Technical Lead** may sync under the *identical* preconditions below, and MUST include an explicit "DevOps unavailable — TL syncing" line in the announcement. This exists because the procedure must not deadlock on one agent's availability — a permanently-stale tree is itself the hazard (it caused two of the six 2026-09-28 collisions). Still single-owner-at-a-time: never two syncers.

## Cadence — sync promptly, not rarely

Blast radius is a function of **M** (how many commits the tree moves at once), not of how often you sync. Rarity *maximises* M: defer a sync an afternoon and the reset rewrites dozens of commits under everyone; sync on detection and M is 1–2, close to harmless. So **sync promptly whenever divergence appears — the hourly drift check is the natural trigger — precisely so no individual sync is large.** Frequency is the safety property once the preconditions are mechanical, and it keeps the operation routine rather than an event: a procedure run hourly gets followed; one run monthly gets improvised.

> **The first sync after this procedure is adopted is the largest one you will ever run** — it clears whatever accumulated before the cadence existed. It is the least-representative sample there is: a rough first sync does not discredit the cadence, and a smooth one does not validate it.

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

### Classifying UNIQUE-vs-stale when a file overlaps an incoming commit (t/3785)

The content test above is right, but it has a trap when the **same file** is touched by both a local change and an incoming commit. Learned live on t/3785 — where the method misfired in both directions in one incident:

1. **A file-level line-diff is UNRELIABLE when an incoming commit touches that file — in BOTH directions.** A net-deletion incoming fix makes deliberately-removed pre-fix code look line-*unique* (so you think you have novel work you don't); a restructuring incoming batch can hide genuine unique work behind an apparent-supersede (so you discard work you needed). File-overlap **narrows** the suspect set; it does **not settle** it.
2. **Settle each suspect by a CONTENT MARKER, per-suspect** — pick a symbol/heading from the "unique" lines and count it: N× at local-HEAD vs M× on `origin/main`. If the incoming commit *removed* it (N>0, M=0), the local copy is stale pre-fix code → discard. If it exists only locally (M=0 and no incoming commit removed it), it is genuine → Step 2. **Never discard on file-overlap alone. Order: narrow by overlap → settle by content marker.**
3. **`git cherry` / patch-id is the WRONG test for "already landed."** A squash-merge or a review edit lands identical semantic content under a *different* patch-id, so a **patch-id mismatch is INCONCLUSIVE, not negative** — it cannot distinguish *lost* from *landed-differently*. Use the `git diff <sha> origin/main -- <paths>` content test, then content-marker-settle any residual. (Same narrow-then-settle order, applied to the tool rather than the file.)
4. **Line count measures ELAPSED TIME, not risk.** A large `behind-N` / big `-` diff means `origin` advanced a lot since the branch was cut; the reset *gains* that, it does not *lose* yours. Don't read diff size as danger — read it as "origin moved."
5. **Preserve-first (Step 2) makes being wrong cheap.** When in any doubt, push the exact HEAD to a rescue branch *before* the reset (seconds, lossless) and classify afterward against the pushed branch. The reset is then unambiguously safe regardless of how the classification lands.

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

Every check here must be **adjacent to the reset** — re-run immediately before Step 4, not minutes earlier. A clean result at classification time is not a clean result now; the window between them is long enough for a colleague to begin work the reset would destroy. (This is the *verify at the point of use* discipline: a stale check is itself the failure mode this procedure exists to prevent.)

**1. No uncommitted TRACKED work by anyone.** `reset --hard` destroys uncommitted modifications to *tracked* files; it does **not** touch untracked files — so the two are not equal and must not be treated equally.
   ```sh
   git status --short --untracked-files=no   # TRACKED mods — these BLOCK absolutely
   git status --short                         # full picture, including untracked
   ```
   - **Any tracked modification → STOP.** Classify real WIP vs phantom **mechanically, never by inspection** — a judgment call about a colleague's file, made by the one person whose next command destroys it, is exactly incident #6. A path is a phantom **only** if `git diff --ignore-cr-at-eol --ignore-all-space -- <path>` is empty, or it matches a declared generated-file glob. Restore phantoms; anything that needs the diff eyeballed to decide is real WIP by definition → `resolve_owner` the path, ping the owner, wait.
   - **Untracked files do NOT block.** `reset --hard` will not delete them, and this tree permanently carries `.cache/`, `.fol-eval-corr*/`, `scripts/batch-configs-t3411/`, etc. — blocking on untracked makes this precondition unsatisfiable, and an unsatisfiable precondition gets waived on first use. **Exception:** an untracked path that *collides* with a path the incoming commits add can be clobbered — check explicitly and STOP on any overlap:
     ```sh
     comm -12 <(git diff --name-only main origin/main | sort) <(git ls-files --others --exclude-standard | sort)
     ```

**2. No agent actively READING the tree.** `git status` detects writers, not readers — an agent with a perfectly clean tree can be mid-build or mid-test, about to act on file contents it read seconds ago, and the reset moves the ground under it (incident #4's shape, delivered by the sync itself). Check the fleet, adjacent to the reset:
   ```
   list_instances / get_agent_status  →  no instance in `working` state with an active task on this tree
   ```

**3. REDUNDANT confirmed** (Step 1), or Step 2 completed and object-level verified.

**4. Announced, then WAIT.** Announcing and resetting in the same second is a formality — nobody has read it. Announce in the channel the fleet reads, then wait a quiet interval (**≥60s**) or collect explicit acks from any instance showing active work. The announcement names the owner ("DevOps syncing" / "DevOps unavailable — TL syncing").

## Step 4 — Record the rollback, then sync (in one command)

```sh
git log --oneline -8 main > "$SCRATCH/pre-sync-main.txt"   # SHAs for rollback; session scratchpad, NOT /tmp (unstable under Git Bash on this fleet)
```

Then couple precondition-1's tracked check to the reset **in a single command**, so the TOCTOU gap is milliseconds, not the minutes that two tool calls allow (shell state does not persist between calls, and they can be arbitrarily far apart):

```sh
git status --short --untracked-files=no && git fetch origin && git reset --hard origin/main
```

If the status check surfaces any tracked modification, the `&&` chain stops before the reset. Apply the same adjacency to precondition-2's fleet check — re-confirm readers in the same breath if the tooling allows.

`reset --hard` is correct here and there is no gentler option — `merge --ff-only` fails by definition on a diverged branch. **The reset moves files on disk under anyone currently reading them** — which is exactly why precondition 1 must clear the tracked index and precondition 2 must clear the fleet, *adjacent to this command*, not minutes before. (An agent mid-task does not expect the tree at `origin/main`; it expects the tree where it last read it. The reassuring-sounding opposite is the belief that makes an operator stop thinking about readers.)

**Rollback if Step 1 misjudged and unique content was lost:** do NOT `git reset --hard <old-sha>` from the reflog — that re-diverges the tree, the exact state you just cleaned. Recovery is Step 2 after the fact: take the lost SHA from `pre-sync-main.txt`, cherry-pick it onto a fresh worktree branch off `origin/main`, PR, merge.

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
| 3.1 — tracked blocks, untracked doesn't, phantom-by-diff-only | A sync over a peer's uncommitted WIP; an unsatisfiable precondition waived on first use; the incident-#6 eyeball-judgment about a colleague's file |
| 3.2 — fleet/readers check | A tree swapped under an agent mid-build/test whose index is clean (incident #4, via the sync) |
| 3.4 — announce **then wait** | Two actors rewriting one tree; an announcement nobody has read yet |
| 4 — adjacent single-command check + written rollback | A stale precondition (TOCTOU); an irreversible reset on a wrong Step-1 call with no recovery |
| 5 — verify with a SHA | "Done" reported for an operation that did not complete |
| Cadence — prompt, not rare | A large-M sync (wide blast radius); a procedure run so seldom it gets improvised |

The through-line: **every step is a check that the thing you believe about the tree is actually true of the tree.** The session that produced these six incidents produced them mostly through careful work on an untrue belief about what was on disk.
