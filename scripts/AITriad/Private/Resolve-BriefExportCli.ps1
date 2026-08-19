# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Resolve-BriefExportCli {
    <#
    .SYNOPSIS
        Resolve the invocation for the shared lib/brief full-pipeline export CLI (t/2837).
    .DESCRIPTION
        Returns @{ Exe = <string>; ArgPrefix = <string[]> } so the caller invokes:
            & $inv.Exe @($inv.ArgPrefix + $flagArgs)
        This isolates the tsx-vs-compiled-bin entrypoint decision (owned by lib/brief)
        from Export-TriadDebateBrief, which only knows the flag interface
        (--path/--model/--preset/--out + optional --skip-narration/--checker-model/--allow-open).

        The CLI (lib/brief/cli.ts) is a TypeScript module; lib/brief's tsconfig is noEmit,
        so there is no committed cli.js. The repo's convention for running lib/*.ts without
        a build is `tsx` (a root devDependency, used by the parity tests). We therefore run
        the source via `npx tsx lib/brief/cli.ts`. (PROVISIONAL — confirming the canonical
        invocation with Shared Lib on p/470 before un-drafting; if they prefer the
        build:server output `dist/server/lib/brief/cli.js` or a dedicated npm script, only
        this function changes.) Tests mock this function.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param()

    Set-StrictMode -Version Latest

    # Repo root = two levels up from the module (scripts/AITriad → repo root).
    $repoRoot = [System.IO.Path]::GetFullPath((Join-Path $script:ModuleRoot '..' '..'))
    $cliPath = Join-Path $repoRoot 'lib' 'brief' 'cli.ts'

    if (-not (Test-Path -LiteralPath $cliPath -PathType Leaf)) {
        throw (New-ActionableError `
                -Goal     'Run the offline brief-export pipeline (local mode)' `
                -Problem  "The brief full-pipeline CLI was not found at '$cliPath'. Local-mode export needs the lib/brief sources in the repo checkout." `
                -Location 'Resolve-BriefExportCli' `
                -NextSteps @(
                    'Run from a full repo checkout (where lib/brief lives)',
                    'Install dependencies (npm ci) — the pipeline needs tsx AND its runtime packages'
                ))
    }

    return @{ Exe = 'npx'; ArgPrefix = @('--yes', 'tsx', $cliPath) }
}
