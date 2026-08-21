# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# ── Centralized dirty-tree-sweep guard for data-repo writes (t/2902 Part 2) ──
# The single chokepoint every data-of-record write funnels through. It asserts the
# SPECIFIC target file is clean vs HEAD before a whole-file rewrite, so concurrent
# uncommitted working-tree state can't be swept into the commit (t/2896: 128ce8f4
# swept sit-477). Per-FILE-dirty — NOT a whole-tree assertion (the data tree is
# perpetually dirty; a whole-tree gate would false-block at scale). Delegates the
# actual git check to Assert-CleanDataTree (Part 1).
#
# Gate promotion (t/2902 condition 4): default mode is WARN (surface, don't block)
# so a ≥1-cycle warn-first period can flush any false-fire on legitimate sequential
# dirty-target rewrites before promotion to BLOCK. Override with the env var
# AI_TRIAD_DATA_WRITE_GUARD = Warn | Block | Off.

$script:DataWriteGuardMode = $null   # in-process override (tests / callers); env wins if set

function Get-DataWriteGuardMode {
    <#
    .SYNOPSIS
        Resolve the active guard mode: Block | Warn | Off. Priority:
        $env:AI_TRIAD_DATA_WRITE_GUARD > $script:DataWriteGuardMode > 'Warn' (default).
    #>
    [OutputType([string])]
    param()
    $envMode = [Environment]::GetEnvironmentVariable('AI_TRIAD_DATA_WRITE_GUARD')
    if (-not [string]::IsNullOrWhiteSpace($envMode)) {
        switch -Regex ($envMode.Trim()) {
            '^(?i)block$' { return 'Block' }
            '^(?i)warn$'  { return 'Warn' }
            '^(?i)off$'   { return 'Off' }
            default {
                Write-Warning "AI_TRIAD_DATA_WRITE_GUARD='$envMode' is not Block/Warn/Off — defaulting to Warn."
                return 'Warn'
            }
        }
    }
    if ($script:DataWriteGuardMode) { return $script:DataWriteGuardMode }
    return 'Warn'   # warn-first default
}

function Test-IsUnderDataRoot {
    <#
    .SYNOPSIS
        True when $Path resolves to a location under the shared data root. The guard
        only fires for data-of-record writes; non-data outputs (reports, PDFs, config,
        flight-recorder dumps) are never sweep-prone and must not be guarded.
    #>
    [OutputType([bool])]
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
    try { $root = Get-DataRoot } catch { return $false }
    if ([string]::IsNullOrWhiteSpace($root)) { return $false }
    try {
        $full = [System.IO.Path]::GetFullPath($Path)
        $rootFull = [System.IO.Path]::GetFullPath($root)
    } catch { return $false }
    $sep = [System.IO.Path]::DirectorySeparatorChar
    if (-not $rootFull.EndsWith($sep)) { $rootFull += $sep }
    return $full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)
}

function Assert-DataWriteAllowed {
    <#
    .SYNOPSIS
        Sink-level dirty-tree-sweep guard. Call immediately before any whole-file
        rewrite of a data-repo file. No-op unless the target is under the data root
        AND already carries uncommitted changes.
    .PARAMETER Path
        The target file about to be overwritten.
    .PARAMETER AllowDirty
        Opt-out for a writer that legitimately rewrites a target left dirty by a
        prior pass in the same sequence (t/2902 condition 4). Bypasses the guard.
    .OUTPUTS
        None. In Block mode a dirty data-target throws (New-ActionableError via
        Assert-CleanDataTree); in Warn mode it warns and proceeds.
    #>
    [CmdletBinding()]
    [OutputType([void])]
    param(
        [Parameter(Mandatory)]
        [string]$Path,

        [switch]$AllowDirty
    )
    if ($AllowDirty) { return }
    $mode = Get-DataWriteGuardMode
    if ($mode -eq 'Off') { return }
    if (-not (Test-IsUnderDataRoot -Path $Path)) { return }

    if ($mode -eq 'Block') {
        Assert-CleanDataTree -Path $Path            # dirty data-target -> throw
    }
    else {
        Assert-CleanDataTree -Path $Path -Force     # Warn: dirty -> warn, proceed
    }
}
