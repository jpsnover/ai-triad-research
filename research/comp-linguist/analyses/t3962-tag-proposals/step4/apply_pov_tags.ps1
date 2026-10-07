#Requires -Version 7.0
<#
.SYNOPSIS
    t/3962 step 4: write the FROZEN pov_tags assignments into skeptic.json via Set-PovNodeTags (t/3969).
.DESCRIPTION
    /data-mutation: reads ONLY frozen_assignments.json (never re-derives the set). Refuses unless
    skeptic.json under -DataRoot has the frozen base sha256. Dry run (-WhatIf, validation still runs)
    unless -Apply. Write into a clean data WORKTREE, never the shared data checkout (t/3969#2 cond B.4).
    Then run verify_pov_tags.py for the 0-collateral check.
.EXAMPLE
    ./apply_pov_tags.ps1 -DataRoot C:/Users/jsnov/repos/ai-triad-research/.worktrees/data-t3962-step4
    ./apply_pov_tags.ps1 -DataRoot <same> -Apply
#>
param(
    [Parameter(Mandatory)][string]$DataRoot,
    [switch]$Apply
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$frozen = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'frozen_assignments.json') | ConvertFrom-Json
$taxDir = Join-Path $DataRoot 'taxonomy' 'Origin'
$skp = Join-Path $taxDir 'skeptic.json'
$sha = (Get-FileHash -Algorithm SHA256 -LiteralPath $skp).Hash.ToLowerInvariant()
if ($sha -ne $frozen.base_skeptic_sha256) {
    throw "ABORT: skeptic.json sha256 $sha != frozen base $($frozen.base_skeptic_sha256) (file changed since freeze)"
}
if (@($frozen.assignments).Count -ne $frozen.count) { throw 'ABORT: frozen assignment count mismatch' }

# The module from THIS checkout (the worktree at origin/main), not whatever is on PSModulePath.
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..' '..' '..' '..' '..'))
Import-Module (Join-Path $repoRoot 'scripts' 'AITriad' 'AITriad.psd1') -Force

# ,@() keeps a one-element tag list an array (TL t/3955 cond 2).
$batch = foreach ($a in $frozen.assignments) { @{ NodeId = $a.node_id; Tags = [string[]]@($a.tags) } }

$result = Set-PovNodeTags -Assignment $batch -TargetPath $taxDir -WhatIf:(-not $Apply)
"mode: $(if ($Apply) { 'APPLY' } else { 'dry run (-WhatIf)' }) | checked $($result.Checked) | applied $($result.Applied) | notFound $(@($result.NotFound).Count)"
if (@($result.NotFound).Count) { throw "ABORT: nodes not found: $(@($result.NotFound) -join ', ')" }
if ($Apply -and $result.Applied -ne $frozen.count) { throw "ABORT: applied $($result.Applied) != frozen $($frozen.count)" }
