# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Shared console/result-recording primitives for Invoke-DependencyCheck's decomposed section
# helpers (t/3910). Extracted verbatim from the closures Invoke-DependencyCheck used to define
# locally (DPass/DWarn/DFail/DSkip/DFix/DStale/DSection) -- same symbols, same console glyphs,
# same colors, same Results-list shape -- but as real functions taking $Ctx/$Quiet explicitly
# instead of closing over them, since a closure can't cross a file boundary. No behavior change.

function Write-DepPass {
    param([Parameter(Mandatory)][hashtable]$Ctx, [Parameter(Mandatory)][string]$Message, [switch]$Quiet)
    $Ctx.Passed++
    if (-not $Quiet) { Write-Host "   ✓  $Message" -ForegroundColor Green }
    $Ctx.Results.Add([PSCustomObject]@{ Status = 'pass'; Message = $Message })
}

function Write-DepWarn {
    param([Parameter(Mandatory)][hashtable]$Ctx, [Parameter(Mandatory)][string]$Message)
    $Ctx.Warned++
    Write-Host "   ⚠  $Message" -ForegroundColor Yellow
    $Ctx.Results.Add([PSCustomObject]@{ Status = 'warn'; Message = $Message })
}

function Write-DepFail {
    param([Parameter(Mandatory)][hashtable]$Ctx, [Parameter(Mandatory)][string]$Message)
    $Ctx.Failed++
    Write-Host "   ✗  $Message" -ForegroundColor Red
    $Ctx.Results.Add([PSCustomObject]@{ Status = 'fail'; Message = $Message })
}

function Write-DepSkip {
    param([Parameter(Mandatory)][string]$Message, [switch]$Quiet)
    if (-not $Quiet) { Write-Host "   →  $Message" -ForegroundColor DarkGray }
}

function Write-DepFix {
    param([Parameter(Mandatory)][string]$Message)
    Write-Host "   🔧  $Message" -ForegroundColor Cyan
}

function Write-DepStale {
    param([Parameter(Mandatory)][hashtable]$Ctx, [Parameter(Mandatory)][string]$Message)
    $Ctx.Outdated++
    Write-Host "   ⬆  $Message" -ForegroundColor Yellow
    $Ctx.Results.Add([PSCustomObject]@{ Status = 'outdated'; Message = $Message })
}

function Write-DepSection {
    param([Parameter(Mandatory)][string]$Message)
    Write-Host "`n  $Message" -ForegroundColor White
    Write-Host "  $('─' * 50)" -ForegroundColor DarkGray
}
