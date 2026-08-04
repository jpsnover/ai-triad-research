# Runbook: Required-Context Swap Protocol

**Owner:** DevOps. **Last updated:** 2026-08-04

Changing which status contexts are required on `main` silently strands every open PR that predates the swap: the new check never reports on those PRs, so armed auto-merge cannot fire. This runbook makes the swap and the re-trigger a single atomic operation.

See also: `docs/orca-github-workflow.md` §5 (costs) and §6 item 4.

---

## When this applies

Any change to `required_status_checks.contexts` on the `main` branch — adding a context, removing one, or renaming one — requires running the re-trigger step below before considering the change complete.

---

## Protocol

### Step 1 — Make the protection change

```bash
# Example: update required contexts via GitHub API
gh api repos/jpsnover/ai-triad-research/branches/main/protection \
  --method PUT \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": false,
    "contexts": ["ci-gate", "CodeQL"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null
}
EOF
```

Verify the change took effect:

```bash
gh api repos/jpsnover/ai-triad-research/branches/main/protection/required_status_checks \
  --jq '.contexts'
```

### Step 2 — Re-trigger every open PR (mandatory)

Run immediately after the protection change — do not skip, do not defer:

```powershell
# Dry-run: shows what would be triggered
./operations/devops/Invoke-ContextSwapRetrigger.ps1 -WhatIf

# Live run: triggers ci.yml and codeql.yml on every open PR's branch
./operations/devops/Invoke-ContextSwapRetrigger.ps1
```

The script:
- Auto-fetches the current required contexts from the live branch protection
- Prints a **before** table showing each PR's current check state
- Close-reopens each open non-draft PR to synthesize a fresh `pull_request` event, causing all PR-triggered workflows (ci.yml, codeql.yml, etc.) to run without modifying the branch
- Polls up to 8 minutes for terminal state
- Prints an **after** table with `before → after` per context per PR
- Exits 0 if all PRs report all required contexts as `success`; exits 1 otherwise

**Trade-off:** close-reopen sends GitHub notifications and briefly de-arms auto-merge. For the rare context-swap operation this is acceptable; it is the only mechanism that reliably re-triggers all PR workflows without `workflow_dispatch` on each workflow file or empty commits on each branch.

Optional parameters:

| Parameter | Default | Purpose |
|-----------|---------|---------|
| `-Repo` | `jpsnover/ai-triad-research` | Target repo |
| `-RequiredContexts` | fetched from live protection | Override which contexts to verify |
| `-TimeoutMinutes` | `8` | Extend for slow CI |
| `-WhatIf` | off | Dry-run |

### Step 3 — Confirm

The script exits with a summary. If any PR is not green:

1. Check the after table — identify which context is missing or non-success.
2. Re-run without `-WhatIf` to trigger again, or trigger that specific PR manually: `gh pr view <N>` → push an empty commit.
3. Do not consider the swap complete until the script exits 0.

---

## Enforcement mechanism

A **feedback rule** (`context-swap-reminder`) fires on every Bash/PowerShell tool call and injects a reminder to run this protocol if a protection change is in progress.

**Limitations (both must be stated per ticket t/2076):**

1. **Session-start lag (t/1625):** A feedback rule is pinned to the manifest loaded at session start. A rule created mid-session is not active until the next session start — the creating session cannot verify it fires.

2. **Broad trigger (condition parser limitation):** The Orca condition parser does not support substring matching on `input.command`. The rule therefore fires on *all* Bash/PowerShell calls, not only protection-change calls. A 1-hour cooldown limits noise. Operators should dismiss it unless they are performing a context swap.

The rule is advisory: it surfaces the reminder but cannot block the protection call. The script's exit code and the before/after table are the authoritative gate.

---

## Precedents

- Six-contexts → `ci-gate` swap (t/1962): stranded open PRs discovered after the fact.
- `strict: true` evaluation (t/2074): planned swap that this protocol covers going forward.
