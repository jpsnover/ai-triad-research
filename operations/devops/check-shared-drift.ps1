# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Scheduled drift check for the fleet's shared main checkout (t/2452).
.DESCRIPTION
    Checks the shared main checkout for: commits behind origin/main, uncommitted
    tracked files (classified as 0-diff-safe or real WIP), 0-byte untracked junk
    files, and non-0-byte extension-less untracked files in source directories
    (t/2222 spray pattern + t/2473 extension; excluding linked worktrees).

    Contract (TL-approved, t/2452#4 + t/2476 amendment):
      - Always exits 0; git failures are best-effort skips.
      - SILENT on a clean + current tree (Alarm=$false, no output beyond the object).
      - Returns a PSCustomObject for the calling agent to interpret and ping on.
      - Cadence: 60 min (hourly backstop via Orca reminder; proportionate given the
        dev-start hook in check-drift.cjs already covers the acute at-dev-time case).
      - AUTO-REMEDIATES 0-byte JunkPaths with triple guard (t/2476): files that pass
        all three checks are deleted and logged in AutoRemoved. SuspiciousPaths, real
        WIP, and behind-count remain WARN-ONLY (agent ping required).

    Seeded-arm proofs must use a disposable clone (-RepoRoot <clone>), NOT the live
    shared tree. Only the clean arm runs against the real checkout.
.PARAMETER RepoRoot
    Absolute path to the shared main checkout. Defaults to the standard fleet path.
    Pass a disposable clone path when running proof/test arms.
#>

param(
    [string]$RepoRoot = 'C:\Users\jsnov\repos\ai-triad-research'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

function Invoke-Git {
    param([string[]]$GitArgs, [int]$TimeoutMs = 5000)
    try {
        $job = Start-Job { & git @using:GitArgs 2>$null }
        $completed = Wait-Job $job -Timeout ([int]($TimeoutMs / 1000))
        if (-not $completed) { Remove-Job $job -Force; return $null }
        $out = Receive-Job $job
        Remove-Job $job
        return $out
    } catch { return $null }
}

function Get-GitDiffExitCode {
    # t/3669: phantom-vs-real discriminator via git-diff EXIT CODE, never stdout. A CRLF-only /
    # normalized file still emits the `diff --git`/`index` header with ZERO hunks, so the old
    # stdout-capture read it as a real diff and mis-escalated (p/331#1363-1367). `--quiet` implies
    # `--exit-code` and prints nothing; `--ignore-cr-at-eol` makes a CRLF-only change exit 0
    # (phantom) even where autocrlf is not configured (e.g. the Linux CI runner). Returns:
    #   0  identical to origin/main modulo CRLF  -> PHANTOM
    #   1  genuine content diff                  -> REAL WIP
    #  -1  query failed / timeout / bad ref      -> caller buckets conservatively as REAL
    # Mirrors Invoke-Git's Start-Job pattern (timeout-bounded; does not touch parent $LASTEXITCODE).
    param([string]$RepoRoot, [string]$File, [int]$TimeoutMs = 5000)
    try {
        $job = Start-Job {
            & git -C $using:RepoRoot diff --quiet --ignore-cr-at-eol origin/main -- $using:File 2>$null
            $LASTEXITCODE
        }
        $completed = Wait-Job $job -Timeout ([int]($TimeoutMs / 1000))
        if (-not $completed) { Remove-Job $job -Force; return -1 }
        $out = @(Receive-Job $job)
        Remove-Job $job
        $code = if ($out.Count) { $out[-1] } else { $null }
        if ($code -eq 0) { return 0 }
        elseif ($code -eq 1) { return 1 }
        else { return -1 }
    } catch { return -1 }
}

# t/3652: pure branch-strand classifier (CLEAN/STRANDED/DIVERGED/UNKNOWN), split into its own
# dot-sourceable file (mirrors FlakeVerdict.ps1) so its three arms are unit-testable without
# running the whole drift check. Best-effort dot-source; if absent, the 5d block below no-ops.
$strandVerdictScript = Join-Path $PSScriptRoot 'BranchStrandVerdict.ps1'
if (Test-Path $strandVerdictScript) { . $strandVerdictScript }

# t/3669: pure phantom-vs-real WIP classifier (maps file->exit-code to Phantom/RealWip buckets),
# same dot-sourceable pattern so both arms are unit-testable without a git fixture.
$phantomVerdictScript = Join-Path $PSScriptRoot 'DriftPhantomVerdict.ps1'
if (Test-Path $phantomVerdictScript) { . $phantomVerdictScript }

# t/3652: bounded gh invocation. Returns combined output + exit code + timeout flag so the caller
# can distinguish gh-absent / unauth / rate-limited / timeout — different causes, different fixes
# (TL t/3652#3 condition 2). Never throws.
function Invoke-Gh {
    param([string[]]$GhArgs, [int]$TimeoutMs = 15000)
    try {
        $job = Start-Job {
            $ErrorActionPreference = 'Continue'
            $out = & gh @using:GhArgs 2>&1
            [PSCustomObject]@{ Out = @($out | ForEach-Object { "$_" }); Code = $LASTEXITCODE }
        }
        $completed = Wait-Job $job -Timeout ([int]($TimeoutMs / 1000))
        if (-not $completed) { Remove-Job $job -Force; return [PSCustomObject]@{ Output = @(); ExitCode = -1; TimedOut = $true } }
        $res = Receive-Job $job
        Remove-Job $job
        return [PSCustomObject]@{ Output = @($res.Out); ExitCode = ([int]$res.Code); TimedOut = $false }
    } catch { return [PSCustomObject]@{ Output = @(); ExitCode = -1; TimedOut = $false } }
}

# t/3058: attribute shell-word-split junk to the scope-owning role by path prefix.
# Each Orca agent's shell cwd is its own scope dir, so a word-split fragment lands in
# the CREATING role's directory — the junk file's path IS the attribution. Ordered
# longest-prefix-first so deeper scopes (e.g. .../src/server) win over their parents.
$scopeRoleMap = [ordered]@{
    'taxonomy-editor/src/renderer/components/debate' = 'DebateUI'
    'taxonomy-editor/src/server'                     = 'ServerAPI'
    'taxonomy-editor'                                = 'Rosetta Stone'
    'lib/debate'                                     = 'DebateTool'
    'lib'                                            = 'Shared Lib'
    'engineering/tech-lead'                          = 'Tech Lead'
    'operations/devops'                              = 'DevOps'
    'operations/sage'                                = 'Sage'
    'operations/diagnostics'                         = 'Diagnostics'
    'research/comp-linguist'                         = 'Computational Linguist'
    'research/collaborator'                          = 'Collaborator'
    'scripts'                                        = 'PowerShell'
}
function Get-OwningScope {
    param([string]$Path)
    $p = ($Path -replace '\\', '/')
    foreach ($prefix in $scopeRoleMap.Keys) {
        if ($p -eq $prefix -or $p.StartsWith("$prefix/")) {
            return [PSCustomObject]@{ Scope = $prefix; Role = $scopeRoleMap[$prefix] }
        }
    }
    # Unmapped path — log the top segment as scope so it stays attributable/coachable.
    $seg = ($p -split '/')[0]
    return [PSCustomObject]@{ Scope = $seg; Role = "unmapped:$seg" }
}

$result = [PSCustomObject]@{
    Alarm            = $false
    BehindCount      = 0
    DirtyFiles       = @()
    HasRealDiff      = $false           # t/3669: = RealWipFiles.Count -gt 0 (the t/2452 reminder branches on this)
    PhantomFiles     = @()              # t/3669: dirty but byte-identical to origin/main modulo CRLF — safe to restore, no owner-claim
    RealWipFiles     = @()              # t/3669: dirty with a genuine content diff — owner-claim required
    JunkPaths        = @()
    ShellFragmentPaths = @()
    SuspiciousPaths  = @()
    NestedWorktrees  = @()
    StrandedBranches = @()            # t/3652: AT-RISK branches (STRANDED / DIVERGED-UNLANDED) — these ALARM
    StrandedBranchesInfo = @()        # t/3652: DIVERGED-STALE — informational only (stale reset branch, 0 unlanded), does NOT alarm (TL p/331#1324)
    StrandedBranchesStatus = 'OK'     # t/3652: OK | PARTIAL | SKIPPED-NO-NETWORK — degraded state lives in the RETURN VALUE, not just a WARN (TL t/3652#3: WARN+success reads as clean = invisible degradation)
    StrandedBranchesReason = ''       # t/3652: WHY degraded (gh-absent / gh-unauth / gh-rate-limited / N-unresolved) — different causes need different fixes
    AutoRemoved      = @()
    Attribution      = @{}
    RemediationHint  = ''
}

try {
    # 1. Fetch (best-effort; skip on failure — we compare against last-fetched ref)
    Invoke-Git @('-C', $RepoRoot, 'fetch', '--quiet', 'origin', 'main') | Out-Null

    # 2. Behind count
    $behindRaw = Invoke-Git @('-C', $RepoRoot, 'rev-list', '--count', 'HEAD..origin/main')
    $behind = if ($behindRaw -match '^\d+$') { [int]$behindRaw } else { 0 }
    $result.BehindCount = $behind

    # 3. Dirty tracked files (tracked only — untracked handled separately)
    $statusOut = Invoke-Git @('-C', $RepoRoot, 'status', '--porcelain', '--untracked-files=no')
    $dirtyFiles = @($statusOut | Where-Object { $_ } | ForEach-Object { $_.Substring(3).Trim() })
    $result.DirtyFiles = $dirtyFiles

    # 4. Classify each dirty file: PHANTOM (byte-identical to origin/main modulo CRLF) vs REAL WIP.
    #    t/3669: discriminate on the git-diff EXIT CODE, never stdout. The prior stdout-capture
    #    (`--ignore-cr-at-eol` + capture) mis-read a CRLF-only file as real WIP — `git diff` still
    #    prints the `diff --git`/`index` HEADER (zero hunks) for a blob-hash-differing file, so the
    #    captured string was non-empty and every CRLF-only file mis-escalated to an owner-claim
    #    (p/331#1363-1367). Exit-code can't be fooled by header text. Query-failure (-1) buckets as
    #    REAL — a failed diff must never read as a safe phantom (same "don't infer safe from silence").
    $fileExitCodes = [ordered]@{}
    foreach ($f in $dirtyFiles) {
        $fileExitCodes[$f] = Get-GitDiffExitCode -RepoRoot $RepoRoot -File $f
    }
    if (Get-Command Get-DriftPhantomVerdict -ErrorAction SilentlyContinue) {
        $verdict = Get-DriftPhantomVerdict -FileExitCodes $fileExitCodes
        $result.PhantomFiles = $verdict.PhantomFiles
        $result.RealWipFiles = $verdict.RealWipFiles
        $result.HasRealDiff  = $verdict.HasRealDiff
    }
    else {
        # Fail-safe if the verdict file is missing: treat every dirty file as REAL (conservative).
        $result.RealWipFiles = $dirtyFiles
        $result.HasRealDiff  = $dirtyFiles.Count -gt 0
    }
    $hasRealDiff  = $result.HasRealDiff
    $phantomFiles = $result.PhantomFiles
    $realWipFiles = $result.RealWipFiles

    # 5. Junk untracked — two classes (t/2222 + t/2473), excluding linked worktrees (.worktrees/):
    #    JunkPaths:       0-byte files anywhere in the tree
    #    SuspiciousPaths: non-0-byte, extension-less files inside source directories
    #                     (shell-quoting debris like src/server/community/22)
    # t/3634: enumerate NUL-delimited with core.quotePath=false so names containing shell
    # metacharacters or control bytes (e.g. the ESC in `lib/<ESC>[22m…`) come back LITERAL,
    # not octal-quoted. The previous plain enum + non-`-LiteralPath` Get-Item silently DROPPED
    # such names (they parsed as non-matching PowerShell wildcards → Get-Item errored → caught),
    # which is why 0-byte shell-fragment junk with these names accumulated unseen.
    $untrackedRaw = Invoke-Git @('-C', $RepoRoot, '-c', 'core.quotePath=false', 'ls-files', '--others', '--exclude-standard', '-z')
    $untracked = @((($untrackedRaw -join '') -split "`0") | Where-Object { $_ })
    # Shell-metacharacter set (t/3634 TL spec) + control chars — used to name the ShellFragmentPaths finding.
    $shellMetaChars = [char[]]('`', '{', '}', '[', ']', '(', ')', '$', '|', [char]39, [char]34)
    $sourceDirs = @('taxonomy-editor/src/', 'taxonomy-editor/lib/', 'lib/', 'engineering/', 'operations/', 'research/')
    # OS-locked files confirmed as junk but un-deletable until host restart.
    # Entries here suppress SuspiciousPaths alarm. Remove when the file clears.
    $knownOsLocked = @(
        'engineering/tech-lead/fail-open'   # vim TUI artifact, OS handle lock — clears on host restart
    )
    $junkPaths = @()
    $shellFragmentPaths = @()
    $suspiciousPaths = @()
    foreach ($f in $untracked) {
        # Skip anything under .worktrees/ — other agents' in-worktree files are not shared-tree drift
        if ($f -match '^\.worktrees[\\/]') { continue }
        $fullPath = Join-Path $RepoRoot $f
        try {
            # t/3634: -LiteralPath so `[`, `]`, backtick etc. in the name are NOT treated as
            # PowerShell wildcards (the old non-literal Get-Item silently errored on these).
            $item = Get-Item -LiteralPath $fullPath -ErrorAction Stop
            if ($item.Length -eq 0) {
                $junkPaths += $f
                # t/3634: a 0-byte untracked file whose NAME carries a shell metacharacter/control
                # char is the t/2112 word-split signature — surface it as a distinct named finding
                # (it still feeds the auto-remove below; this just makes the class explicit).
                $leaf = [System.IO.Path]::GetFileName($f)
                $hasControl = @($leaf.ToCharArray() | Where-Object { [int]$_ -lt 32 }).Count -gt 0
                if ($leaf.IndexOfAny($shellMetaChars) -ge 0 -or $hasControl) { $shellFragmentPaths += $f }
            } else {
                # Non-0-byte: flag if extension-less file found under a source directory
                $normalizedF = $f -replace '\\', '/'
                $inSourceDir = @($sourceDirs | Where-Object { $normalizedF.StartsWith($_) })
                $hasNoExtension = [System.IO.Path]::GetExtension($item.Name) -eq ''
                if ($inSourceDir.Count -gt 0 -and $hasNoExtension -and ($normalizedF -notin $knownOsLocked)) { $suspiciousPaths += $f }
            }
        } catch { continue }
    }
    $result.SuspiciousPaths = $suspiciousPaths
    $result.ShellFragmentPaths = $shellFragmentPaths   # t/3634: detected this run (also auto-removed below)

    # 5c. NESTED .worktrees directories outside repo root (t/3145; t/2222 cwd-reset class).
    #     A `git worktree add` run with the shell cwd reset into a subdir drops .worktrees UNDER a
    #     role subtree instead of the repo root. Legit worktrees live ONLY at <root>/.worktrees/.
    #     Warn-only (advisory). Per TL disposition (t/3145#2):
    #       - ONLY INERT (unregistered) nested dirs are drift; an ACTIVE registered worktree nested
    #         under a subtree is EXEMPT (someone's using it — it has a .git safety net).
    #       - Route each flag to the OWNING role (path-derived) so the owner cleans it, not DevOps.
    #     Root <root>/.worktrees/ is never flagged. Each entry is "<relpath> (Owner)".
    $rootFull = ((Resolve-Path $RepoRoot -ErrorAction SilentlyContinue).Path -replace '\\', '/').TrimEnd('/')
    # Registered worktree paths (absolute, normalized, lowercased) — the EXEMPT set.
    $registered = @{}
    foreach ($line in @(Invoke-Git @('-C', $RepoRoot, 'worktree', 'list', '--porcelain') | Where-Object { $_ -like 'worktree *' })) {
        $wp = ((($line -replace '^worktree\s+', '') -replace '\\', '/').TrimEnd('/')).ToLowerInvariant()
        $registered[$wp] = $true
    }
    # Find every nested .worktrees dir (not root). `git ls-files --others --directory` WITHOUT
    # --exclude-standard surfaces the .gitignore'd .worktrees; --directory collapses dirs (cheap —
    # no descent into node_modules/dist contents). Then flag each INERT child (exempt registered).
    $nestedWorktrees = @()
    $seenNested = @{}
    foreach ($d in @(Invoke-Git @('-C', $RepoRoot, 'ls-files', '--others', '--directory') | Where-Object { $_ })) {
        $nd = ($d -replace '\\', '/').TrimEnd('/')
        if ($nd -notmatch '^\.worktrees(/|$)' -and $nd -match '^(.+?/\.worktrees)(/|$)') {
            $wtDir = $matches[1]
            if ($seenNested[$wtDir]) { continue }
            $seenNested[$wtDir] = $true
            $abs = "$rootFull/$wtDir"
            $children = @(Get-ChildItem -LiteralPath $abs -Directory -Force -ErrorAction SilentlyContinue)
            if ($children.Count -eq 0) {
                $owner = Get-OwningScope -Path $wtDir
                $nestedWorktrees += "$wtDir ($($owner.Role))"     # empty nested .worktrees dir — inert leftover
            } else {
                foreach ($c in $children) {
                    if ($registered[(($c.FullName -replace '\\', '/').TrimEnd('/')).ToLowerInvariant()]) { continue } # active registered — EXEMPT
                    $childRel = "$wtDir/$($c.Name)"
                    $owner = Get-OwningScope -Path $childRel
                    $nestedWorktrees += "$childRel ($($owner.Role))"
                }
            }
        }
    }
    $nestedWorktrees = @($nestedWorktrees | Select-Object -Unique)
    $result.NestedWorktrees = $nestedWorktrees

    # 5d. STRANDED-BRANCH DETECTION (t/3652): commits pushed to a branch whose PR already MERGED/CLOSED.
    #     Silent failure class — the branch looks healthy, CI may go green, but no PR will ever land
    #     the commits (near-miss: two security fixes sat on a dead branch for hours while the epic
    #     carried the unfixed code — e/203#4). Detection-only; a human decides. Needs gh to map
    #     branch->PR, so it degrades EXPLICITLY into the return value (StrandedBranchesStatus/Reason),
    #     never a silent WARN+success (TL t/3652#3). Signal = Get-BranchStrandVerdict (squash-safe).
    # Own try/catch so a failure here can NEVER skip section 6 (alarm) — degrade into the status field.
    try {
    if (-not (Get-Command Get-BranchStrandVerdict -ErrorAction SilentlyContinue)) {
        $result.StrandedBranchesStatus = 'SKIPPED-NO-NETWORK'
        $result.StrandedBranchesReason = 'classifier-unavailable: BranchStrandVerdict.ps1 not dot-sourced'
    }
    $strandedBranches = @()
    $strandedInfo = @()
    # Only meaningful against a real GitHub repo. A temp/test repo or non-GitHub mirror has no PRs
    # to map — running gh there just errors → a spurious SKIPPED alarm (this exact case broke the
    # ShellFragment clean-tree test). No github origin => detection N/A: leave status OK, no alarm.
    $originUrl = (Invoke-Git @('-C', $RepoRoot, 'remote', 'get-url', 'origin'))
    $originUrl = if ($originUrl) { ($originUrl | Select-Object -First 1).Trim() } else { '' }
    $noGithubRemote = ($originUrl -notmatch 'github\.com')
    # Dismissal allowlist: `branch  # reason` — reason mandatory (t/3557 exemption-ratchet). Blank / full-line `#` ignored.
    $dismissed = @{}
    $dismissFile = Join-Path $RepoRoot 'operations/devops/stranded-branch-dismissals.txt'
    if (Test-Path $dismissFile) {
        foreach ($line in @(Get-Content -LiteralPath $dismissFile -ErrorAction SilentlyContinue)) {
            $t = "$line".Trim()
            if (-not $t -or $t.StartsWith('#')) { continue }
            $name = (($t -split '#', 2)[0]).Trim()
            if ($name) { $dismissed[$name] = $true }
        }
    }
    if ($noGithubRemote) {
        # No GitHub origin (temp/test repo or non-GitHub mirror) — stranded detection is N/A;
        # no PRs to map. Leave StrandedBranchesStatus='OK', no findings, no alarm.
    } elseif ($result.StrandedBranchesStatus -ne 'OK') {
        # classifier-unavailable already recorded above — skip the gh/network work entirely
    } elseif (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        $result.StrandedBranchesStatus = 'SKIPPED-NO-NETWORK'
        $result.StrandedBranchesReason = 'gh-absent: GitHub CLI not on PATH — branch->PR mapping unavailable'
    } else {
        $gh = Invoke-Gh @('pr', 'list', '--state', 'all', '--limit', '200', '--json', 'number,state,headRefName,headRefOid') -TimeoutMs 15000
        $ghFail = Resolve-GhFailureReason -TimedOut $gh.TimedOut -ExitCode $gh.ExitCode -OutputText ($gh.Output -join ' ')
        if ($ghFail) {
            $errText = ($gh.Output -join ' ')
            $snip = if ($errText.Length -gt 180) { $errText.Substring(0, 180) } else { $errText }
            $result.StrandedBranchesStatus = 'SKIPPED-NO-NETWORK'
            $result.StrandedBranchesReason = if ($snip) { "${ghFail}: $snip" } else { $ghFail }
        } else {
            $prs = $null
            try { $prs = ($gh.Output -join '') | ConvertFrom-Json } catch { }
            if ($null -eq $prs) {
                $result.StrandedBranchesStatus = 'SKIPPED-NO-NETWORK'; $result.StrandedBranchesReason = 'gh-parse: could not parse `gh pr list` JSON output'
            } else {
                # Live remote branch tips (one call). name -> tip SHA.
                $remoteRefs = @{}
                foreach ($r in @(Invoke-Git @('-C', $RepoRoot, 'ls-remote', '--heads', 'origin') -TimeoutMs 15000)) {
                    if ("$r" -match '^([0-9a-f]{40})\s+refs/heads/(.+)$') { $remoteRefs[$matches[2]] = $matches[1] }
                }
                # Most-recent closed/merged PR per branch (a branch may have had several).
                $latestByBranch = @{}
                foreach ($p in @($prs | Where-Object { $_.state -in @('MERGED', 'CLOSED') })) {
                    $b = $p.headRefName
                    if (-not $latestByBranch.ContainsKey($b) -or $p.number -gt $latestByBranch[$b].number) { $latestByBranch[$b] = $p }
                }
                $unresolved = 0
                foreach ($b in $latestByBranch.Keys) {
                    if ($dismissed[$b]) { continue }
                    if (-not $remoteRefs.ContainsKey($b)) { continue }          # branch deleted after merge — the clean, common case
                    $tip = $remoteRefs[$b]
                    $mergedHead = $latestByBranch[$b].headRefOid
                    if ($tip -eq $mergedHead) { continue }                      # unchanged since merge — fast path, no fetch
                    # Bring the branch's objects local so merge-base can run (best-effort).
                    Invoke-Git @('-C', $RepoRoot, 'fetch', '--quiet', 'origin', $b) -TimeoutMs 20000 | Out-Null
                    $v = Get-BranchStrandVerdict -RepoRoot $RepoRoot -Tip $tip -MergedHead $mergedHead -MainRef 'origin/main'
                    $pn = $latestByBranch[$b].number
                    switch ($v.Verdict) {
                        'STRANDED'         { $strandedBranches += "$b ($($v.Ahead) commit(s) after PR #$pn merged)" }
                        'DIVERGED-UNLANDED' { $strandedBranches += "$b (DIVERGED — $($v.Ahead) unlanded commit(s) force-pushed off merged PR #$pn head)" }
                        'DIVERGED-STALE'   { $strandedInfo += "$b (stale reset off merged PR #$pn head — 0 unlanded, nothing at risk)" }
                        'UNKNOWN'          { $unresolved++ }
                        default            { }
                    }
                }
                if ($unresolved -gt 0 -and $result.StrandedBranchesStatus -eq 'OK') {
                    $result.StrandedBranchesStatus = 'PARTIAL'
                    $result.StrandedBranchesReason = "$unresolved branch(es) unresolved: a required commit SHA was not fetchable (deleted/gc'd) — could not classify"
                }
            }
        }
    }
    $result.StrandedBranches = @($strandedBranches)
    $result.StrandedBranchesInfo = @($strandedInfo)
    } catch {
        # 5d must never break the rest of the guard — degrade into the status field, never throw.
        $result.StrandedBranchesStatus = 'SKIPPED-NO-NETWORK'
        $result.StrandedBranchesReason = "strand-check-error: $($_.Exception.Message)"
    }

    # 5b. Auto-remediate 0-byte junk — triple guard per t/2476#1:
    #     (a) path is in $junkPaths (already classified as 0-byte untracked)
    #     (b1) not tracked in main repo (git ls-files returns empty at delete time)
    #     (b2) not tracked in overlay repo (.orca-git), if overlay is present
    #     (c) re-stat immediately before delete — still 0 bytes (TOCTOU guard)
    $overlayGitDir = Join-Path $RepoRoot '.orca-git'
    $autoRemoved = @()
    $remainingJunk = @()
    $attribution = @{}            # t/3058: role -> count for this run
    $attributionDetail = @()      # t/3058: per-file {Path, Role, Scope, Mtime, Removed}
    foreach ($f in $junkPaths) {
        $fullPath = Join-Path $RepoRoot $f
        try {
            # Guard (b1): not tracked in main repo. `:(literal)` pathspec magic (t/3634) so a name
            # containing `[` `]` `*` `?` is matched literally, not as a git pathspec glob.
            if (Invoke-Git @('-C', $RepoRoot, 'ls-files', '--', ":(literal)$f")) { $remainingJunk += $f; continue }
            # Guard (b2): not tracked in overlay (skip check when no overlay present)
            # -C $RepoRoot anchors path resolution to repo root regardless of script CWD (t/2477)
            if ((Test-Path $overlayGitDir) -and (Invoke-Git @('-C', $RepoRoot, '--git-dir', $overlayGitDir, 'ls-files', '--', ":(literal)$f"))) {
                $remainingJunk += $f; continue
            }
            # Guard (c): re-stat — file must still be 0 bytes at deletion time (TOCTOU).
            # Capture mtime here (t/3058) so attribution survives the delete.
            # -LiteralPath (t/3634): stat + remove metachar names literally (the old non-literal
            # form silently errored on `[`/backtick names, leaving fragments unremoved).
            $item = Get-Item -LiteralPath $fullPath -ErrorAction Stop
            if ($item.Length -ne 0) { $remainingJunk += $f; continue }
            $mtime = $item.LastWriteTime.ToString('o')

            Remove-Item -LiteralPath $fullPath -Force -ErrorAction Stop
            $autoRemoved += $fullPath  # full path per t/2476#1 observability requirement

            # t/3058: attribute the removed fragment to the scope-owning role (path-derived).
            $owner = Get-OwningScope -Path $f
            $attribution[$owner.Role] = ([int]($attribution[$owner.Role]) + 1)
            $attributionDetail += [PSCustomObject]@{ Path = $f; Role = $owner.Role; Scope = $owner.Scope; Mtime = $mtime; Removed = $true }
        } catch { $remainingJunk += $f }
    }
    $result.JunkPaths = $remainingJunk
    $result.AutoRemoved = $autoRemoved

    # t/3058: also attribute non-removed spray (guard-blocked junk + suspicious files) so the
    # tally covers every fragment, not just the auto-cleaned ones. mtime best-effort (may be gone).
    foreach ($f in @($remainingJunk + $suspiciousPaths)) {   # nestedWorktrees carry their own (Owner) annotation + hint; not re-attributed here
        $mtime = $null
        try { $mtime = (Get-Item -LiteralPath (Join-Path $RepoRoot $f) -ErrorAction Stop).LastWriteTime.ToString('o') } catch { }
        $owner = Get-OwningScope -Path $f
        $attribution[$owner.Role] = ([int]($attribution[$owner.Role]) + 1)
        $attributionDetail += [PSCustomObject]@{ Path = $f; Role = $owner.Role; Scope = $owner.Scope; Mtime = $mtime; Removed = $false }
    }
    $result.Attribution = $attribution

    # t/3058: append a per-role tally + per-file detail to a rolling log so recurring spray
    # offenders are visible over time (the log itself is gitignored — see operations/devops
    # entry in .gitignore). Best-effort; never let logging break the guard.
    if ($attributionDetail.Count -gt 0) {
        try {
            $logPath = Join-Path $RepoRoot 'operations/devops/junk-attribution.jsonl'
            $logLine = [PSCustomObject]@{
                ts      = (Get-Date).ToString('o')
                perRole = $attribution
                detail  = $attributionDetail
            } | ConvertTo-Json -Depth 6 -Compress
            Add-Content -Path $logPath -Value $logLine -ErrorAction Stop
        } catch { }
    }

    # 6. Determine alarm + remediation hint
    # t/3634: shell-fragment 0-byte files ALARM even when auto-removed — the t/2112 word-split
    # signature is a named finding worth surfacing (converts silent accumulation into a visible
    # event), unlike generic 0-byte junk which is swept quietly.
    # t/3652: stranded/diverged branches ALARM (a silent, dangerous class). A DEGRADED stranded-check
    # (StrandedBranchesStatus != OK) ALSO alarms — the whole point (TL t/3652#3) is that "couldn't
    # check" must not read as "clean"; surfacing it via the alarm/ping path is how it stays visible.
    $strandedAlarm = ($result.StrandedBranches.Count -gt 0) -or ($result.StrandedBranchesStatus -ne 'OK')
    $alarm = $behind -gt 0 -or $dirtyFiles.Count -gt 0 -or $remainingJunk.Count -gt 0 -or $suspiciousPaths.Count -gt 0 -or $nestedWorktrees.Count -gt 0 -or $shellFragmentPaths.Count -gt 0 -or $strandedAlarm
    $result.Alarm = $alarm

    if ($alarm) {
        $hints = @()
        if ($behind -gt 0) {
            $hints += "behind ($behind commit(s)): git fetch && git merge --ff-only origin/main"
        }
        if ($autoRemoved.Count -gt 0) {
            $listed = $autoRemoved -join ', '
            $hints += "auto-removed 0-byte junk [$listed]"
        }
        if ($shellFragmentPaths.Count -gt 0) {
            $listed = $shellFragmentPaths -join ', '
            $hints += "shell-fragment 0-byte file(s) detected — t/2112 mis-quote word-split signature [$listed]: auto-removed if guards passed; prefer explicit paths over 'git add -A' and avoid pasting multi-line code into the shell (Shell Quoting Rule)"
        }
        if ($remainingJunk.Count -gt 0) {
            $listed = $remainingJunk -join ', '
            $hints += "junk 0-byte file(s) NOT auto-removed (guard blocked) [$listed]: Remove-Item <paths> manually"
        }
        if ($suspiciousPaths.Count -gt 0) {
            $listed = $suspiciousPaths -join ', '
            $hints += "suspicious extension-less file(s) in source dir [$listed]: verify untracked, then Remove-Item <paths>"
        }
        if ($result.StrandedBranches.Count -gt 0) {
            $listed = $result.StrandedBranches -join '; '
            $hints += "AT-RISK branch(es) — unlanded commits no PR will land: STRANDED (pushed after merge) or DIVERGED-UNLANDED (force-pushed off the merged head) (t/3652) [$listed]: verify with the branch owner, then cherry-pick the unlanded commits onto the live target and delete/dismiss the branch (add to operations/devops/stranded-branch-dismissals.txt WITH a reason if intentionally kept). Detection-only — a human decides; do NOT auto-merge."
        }
        if ($result.StrandedBranchesInfo.Count -gt 0) {
            $listed = $result.StrandedBranchesInfo -join '; '
            $hints += "(info) DIVERGED-STALE branch(es) — diverged from a merged PR head but 0 unlanded commits (stale reset, nothing at risk) [$listed]: no action needed; delete when convenient."
        }
        if ($result.StrandedBranchesStatus -ne 'OK') {
            $hints += "stranded-branch check DEGRADED [$($result.StrandedBranchesStatus)]: $($result.StrandedBranchesReason). This is 'could-not-check', NOT 'clean' — re-run once gh is reachable/authed; a persistent gh-unauth/gh-absent is a host-config fix, a rate-limit/timeout is transient."
        }
        if ($nestedWorktrees.Count -gt 0) {
            $listed = $nestedWorktrees -join '; '
            $hints += "INERT nested .worktrees dir(s) outside <root>/.worktrees/ (t/3145; t/2222 cwd-reset drift) — routed to owning role [$listed]: orphaned copies (no .git safety net). OWNER: confirm inert (no .git, no unpushed/unique content) then 'Remove-Item -Recurse -Force <path>'. Active registered worktrees are EXEMPT (never listed)."
        }
        # t/3669: report phantom and real WIP as SEPARATE hints so a mixed dirty set names each
        # correctly — the old single-boolean lumped all dirty files under one verdict.
        if ($realWipFiles.Count -gt 0) {
            $listed = $realWipFiles -join ', '
            $hints += "dirty tracked with REAL DIFF (WIP) [$listed]: snapshot-first + owner-claim required — do NOT stash or auto-merge; escalate to TL | POST-CLAIM pull: git restore <files> THEN git pull --ff-only (dirty tracked file silently blocks ff-merge even on byte-identical incoming content — restore first; p/331#98)"
        }
        if ($phantomFiles.Count -gt 0) {
            $listed = $phantomFiles -join ', '
            $hints += "PHANTOM dirty tracked (byte-identical to origin/main modulo CRLF — NOT real WIP, no owner-claim) [$listed]: safe to restore unilaterally — git restore <files> THEN git pull --ff-only (a phantom silently blocks ff-merge even on byte-identical incoming; t/2066, p/331#98)"
        }
        $result.RemediationHint = $hints -join ' | '
    }
} catch {
    # Catch-all — never let the guard throw to the calling agent session
}

# Emit the object, then FORCE exit 0 to honor the contract ("Always exits 0", line 14). t/3652's
# classifier uses direct `& git merge-base --is-ancestor`, which leaves $LASTEXITCODE=1 on the
# DIVERGED/UNKNOWN paths; without an explicit exit that would leak as a non-zero script exit code
# (the pre-t/3652 script stayed 0 only because every git call went through Start-Job, which does
# not touch the parent's $LASTEXITCODE). Callers read the returned object, not the exit code.
$result
exit 0
