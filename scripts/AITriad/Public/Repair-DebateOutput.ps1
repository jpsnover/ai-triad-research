# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Repairs debate output files by extracting clean text from raw JSON in transcript entries.
.DESCRIPTION
    Fixes transcript entries where the LLM returned raw JSON instead of clean text.
    Regenerates the markdown file from the repaired JSON.
.EXAMPLE
    Repair-DebateOutput ./debates/my-debate.json
.EXAMPLE
    Get-ChildItem ./debates/*-debate.json | Repair-DebateOutput
#>
function Repair-DebateOutput {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory, ValueFromPipeline, ValueFromPipelineByPropertyName, Position = 0)]
        [Alias('FullName', 'PSPath')]
        [string[]]$Path
    )

    begin {
        Set-StrictMode -Version Latest

        # Verify npx is available
        $NpxCmd = Get-Command npx -ErrorAction SilentlyContinue
        if (-not $NpxCmd) {
            throw @"
npx (Node.js package runner) is not installed.
Required to run the repair script. Install Node.js from https://nodejs.org (v18+).
"@
        }

        $RepoRoot = Split-Path $PSScriptRoot -Parent | Split-Path -Parent | Split-Path -Parent
        $CliScript = Join-Path $RepoRoot 'lib' 'debate' 'repairTranscript.ts'

        if (-not (Test-Path $CliScript)) {
            throw @"
Repair script not found at: $CliScript

Expected location: lib/debate/repairTranscript.ts
Computed repo root: $RepoRoot

Verify the file exists: Get-Item '$CliScript'
"@
        }
    }

    process {
        foreach ($Item in $Path) {
            $ResolvedPaths = @(Resolve-Path -Path $Item -ErrorAction SilentlyContinue)
            if ($ResolvedPaths.Count -eq 0) {
                Write-Error "File not found: $Item"
                continue
            }

            foreach ($Resolved in $ResolvedPaths) {
                $JsonPath = $Resolved.Path
                if (-not $JsonPath.EndsWith('.json')) {
                    Write-Warning "Skipping '$JsonPath' — Repair-DebateOutput only processes JSON debate transcript files (.json)."
                    continue
                }

                # Verify it's valid JSON before sending to the repair script
                try {
                    $null = Get-Content -Raw $JsonPath -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
                } catch {
                    Write-Error "Cannot read or parse '$JsonPath': $_`nVerify the file is valid JSON: ConvertFrom-Json (Get-Content '$JsonPath' -Raw)"
                    continue
                }

                Write-Verbose "Repairing: $JsonPath"
                try {
                    $Output = & $NpxCmd.Source tsx $CliScript $JsonPath 2>&1
                    if ($LASTEXITCODE -ne 0) {
                        $ErrorLines = $Output | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] } | Select-Object -First 5
                        Write-Error "Repair script failed for '$JsonPath' (exit code $LASTEXITCODE):`n$($ErrorLines -join "`n")"
                        continue
                    }
                } catch {
                    Write-Error "Failed to run repair script on '$JsonPath': $_`nVerify tsx is installed: npx tsx --version"
                    continue
                }

                $StdErr = $Output | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] -or ($_ -is [string] -and $_ -match '^\[repair\]') }
                $StdOut = $Output | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] -and $_ -notmatch '^\[repair\]' }

                foreach ($line in $StdErr) { Write-Verbose "$line" }
                foreach ($line in $StdOut) { Write-Output $line }
            }
        }
    }
}
