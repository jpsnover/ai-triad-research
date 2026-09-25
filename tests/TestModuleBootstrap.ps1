# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Shared test bootstrap (t/3665). Replaces per-file `Import-Module … -Force`.
# First call imports AITriad once (defining ~396 functions + eager corpus load, ~4.6s).
# Every later call skips the re-import (~0ms) and instead RESETS mutable module state by
# invoking each loaded module's Initialize-<Name>RuntimeState — the set is DERIVED from the
# convention (not hand-listed), so a new AITriad-family module is covered automatically.
function Enter-AITriadTestModule {
    [CmdletBinding()]
    param()

    if (-not (Get-Module AITriad)) {
        # Resolve repo root from THIS bootstrap's location (tests/), depth-independent for callers.
        $repoRoot = Split-Path $PSScriptRoot -Parent
        Import-Module (Join-Path $repoRoot 'scripts' 'AITriad' 'AITriad.psm1') -WarningAction SilentlyContinue
    }

    # Reset every module in the AITriad family that opts into the Initialize-<Name>RuntimeState
    # convention. AIEnrich/DocConverters are NESTED modules of AITriad (imported at its scope),
    # so they are NOT top-level Get-Module entries — derive the set from AITriad + its
    # NestedModules (still derived from the convention, never hand-listed).
    $aitriad = Get-Module AITriad
    $family  = @($aitriad) + @($aitriad.NestedModules)
    foreach ($m in $family) {
        & $m {
            $fn = "Initialize-$($ExecutionContext.SessionState.Module.Name)RuntimeState"
            $cmd = Get-Command -Name $fn -CommandType Function -ErrorAction SilentlyContinue
            if ($cmd) { & $cmd }
        }
    }
}
