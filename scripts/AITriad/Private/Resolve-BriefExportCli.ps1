# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Resolve-BriefExportCli {
    <#
    .SYNOPSIS
        Resolve the invocation for the shared lib/brief full-pipeline export CLI (t/2837).
    .DESCRIPTION
        Returns @{ Exe = <string>; ArgPrefix = <string[]> } so the caller invokes:
            & $inv.Exe @($inv.ArgPrefix + $flagArgs)
        This isolates the tsx-vs-compiled-bin entrypoint decision (owned by lib/brief,
        pending TL freeze on t/2837) from Export-TriadDebateBrief, which only knows the
        frozen flag interface (--path/--model/--preset/--skip-narration/--out).

        Until the CLI lands and its entrypoint is frozen, this throws an actionable error
        rather than guessing a path. Tests mock this function.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param()

    Set-StrictMode -Version Latest

    # The entrypoint (tsx vs compiled bin) and its on-disk location are still being
    # frozen by the Tech Lead on t/2837; Shared Lib will hand over the exact invocation.
    # Deliberately not guessed here — resolve once, in one place, when it lands.
    throw (New-ActionableError `
            -Goal     'Run the offline brief-export pipeline (local mode)' `
            -Problem  'The shared lib/brief full-pipeline CLI (t/2837) has not landed yet, so local-mode export cannot run. Its entrypoint is being frozen by the Tech Lead.' `
            -Location 'Resolve-BriefExportCli' `
            -NextSteps @(
                'Track t/2837 (Shared Lib brief full-pipeline CLI) — local mode activates when it lands',
                'Once frozen, wire the invocation here: @{ Exe = ''node''|''npx''; ArgPrefix = @(...) }'
            ))
}
