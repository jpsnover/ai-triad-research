# Route Enumeration

How to review a gate, guard, or monitor for **scope** rather than correctness. Origin: 2026-09-29, where a fourteen-hour red `main` produced six consecutive defects and every one was in the *remedy*, not the original problem (t/3736, t/3737, t/3738; consult e/225).

Companion to the five Gate signal integrity rules in `engineering/tech-lead/AGENTS.md`. Those ask *does this gate work?* This asks *what does it not look at?*

## The rule

**Name every route that reaches the protected thing. Show which the mechanism covers. Leave the uncovered ones as visible blanks.**

Then, for any check with a health check or a probe: **name what its health check does not assert.**

The output is a table, produced once at Gate Verification. It is cheap, it is falsifiable by someone without domain priors, and a blank cell is an admission rather than an omission.

## Why a table and not more care

Three enforcement mechanisms failed in one week, and all three were *day-one* scope gaps rather than decay:

| | reads as | actually |
|---|---|---|
| t/3695 | `enabled: true` | never executes — predicate proven, runtime loading never was |
| t/3716 | draft blocks the merge | blocks a human; automation is indistinguishable in the timeline |
| t/3736 | required checks gate `main` | gate PR merges; a red check blocks no admin, and every agent is an admin |

Periodic re-testing would have passed cleanly every cycle from the beginning, because each mechanism worked *within its scope* and nobody tested the scope boundary. A schedule catches a mechanism that stops working. These never covered what they appeared to.

## The worked examples carry more weight than the rule

The rule tells you to make a table. The examples train the recognition that produces rows you would not otherwise have written. Read these rather than the rule.

### Example 1 — a correct playbook, bypassed

`/land-from-worktree` step 1 specifies the base ref explicitly:

```
git worktree add -b <branch> <path> origin/main
```

and step 6 carries a merge-base scope check with a STOP on foreign files, traced to t/3670. It even records its own residual: *"this is discipline, not enforcement — not invoking this playbook bypasses it entirely."*

A TL handed out an ad-hoc `git worktree add -b <branch> <path>` — dropping `origin/main` — on a shared tree three commits ahead of origin. The branch inherited three other agents' commits; the PR landed them; the rescue PRs for the same content were still open. QUIET duplicate-parallel-land.

**Row it produces:** *branch off a tree that is itself diverged.* Not derivable by thinking carefully about branch protection, because it is not a branch-protection problem. It came from an incident.

**And note what the review got wrong first:** the playbook was blamed twice before anyone read it. A mechanism's residual, written in the mechanism, was the exact prediction of the failure.

### Example 2 — a health check asserting less than its name

A `main`-CI monitor was specified with "a known-positive probe" in its health check. That answers *can I see anything at all?* It does not answer:

- *would I notice a red?* — a drifted predicate passes a known-positive probe **every cycle**, visible runs and no conclusions. Needs a **constructed, persistent** red fixture; today's outage cannot serve, because it evaporates when fixed.
- *am I pointed at the right thing?* — a monitor on the wrong branch satisfies both of the above and reports green while `main` burns. This is the original fourteen-hour incident restated: a mechanism that worked, watching something nobody read.
- *does the alert reach someone who acts?* — detecting correctly into an unread channel reproduces the incident with more machinery.

**Prompt worth carrying:** when a check needs a fixture, ask whether the **production target** can serve as one. Changing the probe's subject from an arbitrary known-positive SHA to `main` itself collapsed *query health* and *wiring* into one assertion, against the thing that matters — the only correction in the sequence that **removed** machinery while covering more.

### Example 3 — the check that failed open on unverified input

A CI check was designed to detect branches carrying foreign commits:

```bash
git log --format=%s%n%b $(git merge-base origin/main HEAD)..HEAD | grep -oE 't/[0-9]+' | sort -u
```

`actions/checkout` defaults to `fetch-depth: 1`, so `origin/main` may not resolve. Then the ref set is **empty**, empty is a subset of the PR's own ticket, and the check **passes** — a negative result that is an artifact of the question, presenting as a clean bill of health, inside the check built to catch exactly that.

Its author had catalogued that pattern one hour earlier. **Fluency in a failure shape does not prevent producing it**, which rules out "learn the pattern" as the remedy and is the argument for a mechanical check.

## Fail closed on uncertainty — the requirement, not the config

**Assert the query could have answered before trusting that it did.** If a lookup errors, or its range is empty, or its scope was never established, exit *cannot evaluate* — loudly. Never pass.

Four instances of the same sentence:

| instance | the misleading negative |
|---|---|
| `gh run list --commit <sha>` | returns nothing for push-event runs — reads as "no CI ran" |
| `gh api commits/<ref>/status` | `{"state":"pending","total_count":0}` while the tree is red — Actions posts check-runs, not legacy statuses. A **confident wrong answer**, which no known-positive probe catches |
| `gh run list --workflow --branch --event` | **not portable** — current runs for one agent, stale runs for another, identical command |
| the t/3738 check above | shallow checkout → empty range → passes |

The generalizable form: **when a question has several plausible query forms, the disagreement between them is the finding.** Two agents getting different answers from the same command was more informative than either answer.

Config (`fetch-depth: 0`) fixes today. The **assertion** survives someone copying a checkout step from another job. Specify the assertion; treat the config as an optimisation.

## What this rule does NOT close

**A route table makes blanks visible and missing rows invisible.**

A blank cell says *uncovered*. An unlisted route says nothing at all — the absence-doesn't-announce-itself property from the query traps above, relocated one level up. No amount of care in filling the table addresses it, because the failure is in what never became a row.

So the enumeration converts *some* unknowns into visible blanks and leaves the unnamed-route case exactly where it was. That is an improvement worth having and **not a closure of the class.** Anyone citing this rule to close a prevention ticket still owes the surviving-vector sentence required by root `AGENTS.md`.

Stated plainly because the alternative would be this document committing the error it catalogues: every defect in the sequence that produced it was in the remedy, which predicts the next one is in here.

## Worked table — routes to an unverified `main` (2026-09-29)

| route | status |
|---|---|
| merge a PR whose required checks are **failing** | open — `enforce_admins: false`; caused the incident |
| merge a **stale** PR (`strict: false`) + skip-tolerance | open — composite; #2516 merged green in 4 s onto a red `main` |
| **PR aperture** smaller than push aperture | open — push runs the full matrix, PR runs prune. A green PR *structurally* cannot guarantee green `main` |
| rebase/squash lands a **SHA never tested** | open — inherent to the merge method |
| **branch off a diverged tree** | open — t/3738 covers the *ticketed* case only |
| `main` goes red and **nobody is told** | open — 14 h (t/3737) |

Note the last row is **detection** in a prevention table, and it is the row that did the damage. A table scoped to prevention would have scored this surface three-quarters solved with the expensive gap outside the frame.

Note also what the table cannot tell you: **detection everywhere, attribution nowhere.** Every row above detects; none attributes. Every agent acts with the repo owner's credentials, so post-incident questions here are answerable as *what happened*, never *who did it* (t/3736#4).

Ref: t/3736, t/3737, t/3738, t/3695, t/3716, t/3670, e/225 (the consult; six rounds, each defect reachable only after the previous fix)
