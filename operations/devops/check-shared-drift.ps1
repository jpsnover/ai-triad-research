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
    HasRealDiff      = $false
    JunkPaths        = @()
    SuspiciousPaths  = @()
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

    # 4. Classify each dirty file: 0-diff vs real WIP
    $hasRealDiff = $false
    foreach ($f in $dirtyFiles) {
        $diff = Invoke-Git @('-C', $RepoRoot, 'diff', 'origin/main', '--', $f)
        if ($diff) { $hasRealDiff = $true; break }
    }
    $result.HasRealDiff = $hasRealDiff

    # 5. Junk untracked — two classes (t/2222 + t/2473), excluding linked worktrees (.worktrees/):
    #    JunkPaths:       0-byte files anywhere in the tree
    #    SuspiciousPaths: non-0-byte, extension-less files inside source directories
    #                     (shell-quoting debris like src/server/community/22)
    $untracked = @(Invoke-Git @('-C', $RepoRoot, 'ls-files', '--others', '--exclude-standard') | Where-Object { $_ })
    $sourceDirs = @('taxonomy-editor/src/', 'taxonomy-editor/lib/', 'lib/', 'engineering/', 'operations/', 'research/')
    # OS-locked files confirmed as junk but un-deletable until host restart.
    # Entries here suppress SuspiciousPaths alarm. Remove when the file clears.
    $knownOsLocked = @(
        'engineering/tech-lead/fail-open'   # vim TUI artifact, OS handle lock — clears on host restart
    )
    $junkPaths = @()
    $suspiciousPaths = @()
    foreach ($f in $untracked) {
        # Skip anything under .worktrees/ — other agents' in-worktree files are not shared-tree drift
        if ($f -match '^\.worktrees[\\/]') { continue }
        $fullPath = Join-Path $RepoRoot $f
        try {
            $item = Get-Item $fullPath -ErrorAction Stop
            if ($item.Length -eq 0) {
                $junkPaths += $f
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
            # Guard (b1): not tracked in main repo
            if (Invoke-Git @('-C', $RepoRoot, 'ls-files', $f)) { $remainingJunk += $f; continue }
            # Guard (b2): not tracked in overlay (skip check when no overlay present)
            # -C $RepoRoot anchors path resolution to repo root regardless of script CWD (t/2477)
            if ((Test-Path $overlayGitDir) -and (Invoke-Git @('-C', $RepoRoot, '--git-dir', $overlayGitDir, 'ls-files', $f))) {
                $remainingJunk += $f; continue
            }
            # Guard (c): re-stat — file must still be 0 bytes at deletion time (TOCTOU).
            # Capture mtime here (t/3058) so attribution survives the delete.
            $item = Get-Item $fullPath -ErrorAction Stop
            if ($item.Length -ne 0) { $remainingJunk += $f; continue }
            $mtime = $item.LastWriteTime.ToString('o')

            Remove-Item $fullPath -Force -ErrorAction Stop
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
    foreach ($f in @($remainingJunk + $suspiciousPaths)) {
        $mtime = $null
        try { $mtime = (Get-Item (Join-Path $RepoRoot $f) -ErrorAction Stop).LastWriteTime.ToString('o') } catch { }
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
    $alarm = $behind -gt 0 -or $dirtyFiles.Count -gt 0 -or $remainingJunk.Count -gt 0 -or $suspiciousPaths.Count -gt 0
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
        if ($remainingJunk.Count -gt 0) {
            $listed = $remainingJunk -join ', '
            $hints += "junk 0-byte file(s) NOT auto-removed (guard blocked) [$listed]: Remove-Item <paths> manually"
        }
        if ($suspiciousPaths.Count -gt 0) {
            $listed = $suspiciousPaths -join ', '
            $hints += "suspicious extension-less file(s) in source dir [$listed]: verify untracked, then Remove-Item <paths>"
        }
        if ($dirtyFiles.Count -gt 0) {
            if (-not $hasRealDiff) {
                $listed = $dirtyFiles -join ', '
                $hints += "dirty tracked (0-diff, safe to drop) [$listed]: git checkout -- <files>"
            } else {
                $listed = $dirtyFiles -join ', '
                $hints += "dirty tracked with REAL DIFF (WIP) [$listed]: snapshot-first + owner-claim required — do NOT stash or auto-merge; escalate to TL | POST-CLAIM pull: git restore <files> THEN git pull --ff-only (dirty tracked file silently blocks ff-merge even on byte-identical incoming content — restore first; p/331#98)"
            }
        }
        $result.RemediationHint = $hints -join ' | '
    }
} catch {
    # Catch-all — never let the guard throw to the calling agent session
}

return $result
