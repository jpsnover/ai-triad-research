# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Regenerates operations/devops/test-powershell-shard-durations.json (t/4095) from a full,
    local Pester run -- the per-file duration data ShardBalancer.ps1 bin-packs against.
.DESCRIPTION
    Runs the WHOLE suite (no sharding) with -PassThru, sums each file's tests' Duration, and
    writes { "relative/path.ps1": seconds } sorted by path. ShardBalancer.ps1 falls back to the
    MEDIAN duration for any file this JSON doesn't list (new test files, stale data), so this
    file never needs to be perfectly fresh -- regenerate it when the shard durations visibly
    drift from reality (a shard's actual wall-clock stops matching its assigned total), not on
    every test file addition.

    Run from the repo root: ./operations/devops/Update-TestPowershellDurations.ps1
#>
[CmdletBinding()]
param(
    [string]$OutFile = "$PSScriptRoot/test-powershell-shard-durations.json"
)

$repoRoot = (Get-Location).Path
. ./operations/devops/Get-PesterExcludePaths.ps1

$config = New-PesterConfiguration
$allTests = @(Get-ChildItem ./tests -Recurse -Filter *.Tests.ps1 | Sort-Object FullName)
$config.Run.Path = @($allTests.FullName)
$config.Run.ExcludePath = Get-PesterExcludePaths
$config.Output.Verbosity = 'Normal'
$config.Run.Exit = $false
$config.Run.PassThru = $true

Write-Host "Running the full Pester suite ($($allTests.Count) files) to measure per-file duration..."
$r = Invoke-Pester -Configuration $config

$byFile = $r.Tests | Group-Object { $_.ScriptBlock.File } | ForEach-Object {
    $relPath = $_.Name.Substring($repoRoot.Length + 1) -replace '\\', '/'
    # Duration is a TimeSpan, not numeric -- Measure-Object -Sum on it silently yields 0.
    $measured = $_.Group | ForEach-Object { $_.Duration.TotalSeconds } | Measure-Object -Sum
    [PSCustomObject]@{ Path = $relPath; Seconds = [math]::Round($measured.Sum, 3) }
}

$ordered = [ordered]@{}
foreach ($entry in ($byFile | Sort-Object Path)) { $ordered[$entry.Path] = $entry.Seconds }
$ordered | ConvertTo-Json | Out-File -FilePath $OutFile -Encoding utf8

$total = [math]::Round(($byFile.Seconds | Measure-Object -Sum).Sum, 1)
Write-Host "Wrote $($byFile.Count) file durations ($($total)s total) to $OutFile"
