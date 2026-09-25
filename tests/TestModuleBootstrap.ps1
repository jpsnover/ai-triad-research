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

    # Reset every module that opts into the Initialize-<Name>RuntimeState convention (set is
    # DERIVED, never hand-listed). Two provenances must both be covered:
    #   - NESTED: AIEnrich/DocConverters imported at AITriad's scope (not top-level entries).
    #   - TOP-LEVEL: a few AI-API tests import AIEnrich top-level to call Invoke-AIApi directly
    #     — that is a SEPARATE module instance from the nested one, so it must be reset too.
    # Dedup by instance so a module reachable both ways is reset once.
    $aitriad = Get-Module AITriad
    $family  = [System.Collections.Generic.List[object]]::new()
    foreach ($m in (@(Get-Module) + @($aitriad) + @($aitriad.NestedModules))) {
        if ($m -and -not ($family -contains $m)) { $family.Add($m) }
    }
    foreach ($m in $family) {
        & $m {
            $fn = "Initialize-$($ExecutionContext.SessionState.Module.Name)RuntimeState"
            $cmd = Get-Command -Name $fn -CommandType Function -ErrorAction SilentlyContinue
            if ($cmd) { & $cmd }
        }
    }
}
