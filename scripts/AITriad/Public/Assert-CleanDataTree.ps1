# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Assert-CleanDataTree {
    <#
    .SYNOPSIS
        Guard against dirty-tree sweeps: assert a file has no uncommitted changes
        before a whole-file rewrite (t/2902).

    .DESCRIPTION
        A whole-file JSON round-trip (ConvertFrom-Json | ConvertTo-Json, or Python
        json.load -> json.dump) re-reads the file's CURRENT on-disk content — which
        includes any concurrent uncommitted edits — and rewrites the whole file.
        On a shared / perpetually-dirty data tree (ai-triad-data), a later
        `git add <file>` then commits that concurrent state under a misleading
        message. This is the dirty-tree sweep failure class (t/2896 collateral:
        commit 128ce8f4 swept an unrelated `resolved_node_id: sit-477` into a
        "stance-only" commit).

        The collision is INTRA-FILE, so a path-level `git add <file>` gate cannot
        catch it — staging the file still captures the pre-existing WIP. The
        durable guard is to assert the target file is clean vs HEAD *before* the
        rewrite, so a whole-file write can never merge concurrent state.

        Behavior:
        - Target is tracked-modified (dirty)  -> throw New-ActionableError (or, with
          -Force, Write-Warning and proceed).
        - Target is clean                     -> return silently (no output, no
          warning — safe for the zero-noise clean path).
        - Target does not exist yet           -> clean (a brand-new file carries no
          concurrent state to sweep).
        - Target is not under a git work tree -> clean (guard only defends tracked
          state; -Verbose records the skip). Untracked files are ignored
          (`--untracked-files=no`) — a not-yet-tracked file cannot be swept.

    .PARAMETER Path
        One or more file paths about to be whole-file rewritten. Accepts pipeline
        input and the FullName property (so `Get-Item x.json | Assert-CleanDataTree`
        works).

    .PARAMETER Force
        Downgrade a dirty-target block to a warning and proceed. Use only when you
        own the pending changes and intend to include them.

    .EXAMPLE
        Assert-CleanDataTree -Path $summaryFile
        $data | ConvertTo-Json -Depth 20 | Write-Utf8NoBom -Path $summaryFile

    .EXAMPLE
        # Wired through the module's write chokepoint:
        $json | Write-Utf8NoBom -Path $file -RequireCleanTree
    #>
    [CmdletBinding()]
    [OutputType([void])]
    param(
        [Parameter(Mandatory, Position = 0, ValueFromPipeline, ValueFromPipelineByPropertyName)]
        [Alias('FullName', 'PSPath')]
        [string[]]$Path,

        [switch]$Force
    )
    begin {
        $dirty = [System.Collections.Generic.List[string]]::new()
    }
    process {
        foreach ($p in $Path) {
            # A not-yet-existent target carries no concurrent state to sweep.
            $resolved = Resolve-Path -LiteralPath $p -ErrorAction SilentlyContinue
            if (-not $resolved) {
                Write-Verbose "Assert-CleanDataTree: '$p' does not exist yet — nothing to sweep."
                continue
            }
            $full = $resolved.Path
            $dir = Split-Path -Parent $full
            $leaf = Split-Path -Leaf $full

            # Run with cwd = the file's directory and a bare-leaf pathspec so no
            # absolute Windows path reaches git's pathspec parser (avoids MSYS
            # path-conversion quirks — see "Git Forensics" in root AGENTS.md).
            # `--untracked-files=no`: an untracked (brand-new) file cannot be swept
            # by a rewrite of an existing file; we only defend tracked-modified state.
            $status = & git -C $dir status --porcelain --untracked-files=no -- $leaf 2>$null
            $exit = $LASTEXITCODE
            if ($exit -ne 0) {
                # Not a git work tree (or git unavailable). The guard defends tracked
                # state only; a target outside git has nothing to sweep — do not block.
                Write-Verbose "Assert-CleanDataTree: '$full' is not under a git work tree (git exit $exit) — skipping clean-tree check."
                continue
            }
            $lines = @($status | Where-Object { $_ -and $_.Trim() })
            if ($lines.Count -gt 0) {
                $dirty.Add($full)
            }
        }
    }
    end {
        if ($dirty.Count -eq 0) { return }

        $fileList = ($dirty | ForEach-Object { "     - $_" }) -join "`n"
        $problem = "Target file(s) already carry uncommitted changes; a whole-file rewrite would sweep that concurrent state into your commit:`n$fileList"

        if ($Force) {
            Write-Warning "Assert-CleanDataTree: $problem`n(Proceeding anyway — -Force specified.)"
            return
        }

        New-ActionableError `
            -Goal 'Write a data-repo file without sweeping concurrent uncommitted state into the commit' `
            -Problem $problem `
            -Location 'Assert-CleanDataTree' `
            -NextSteps @(
                'Commit or stash the pre-existing changes to these file(s) first, then re-run.'
                'Or change only the targeted fields surgically instead of re-serializing the whole file.'
                'If you own those pending changes and intend to include them, re-run with -Force.'
            ) `
            -Throw
    }
}
