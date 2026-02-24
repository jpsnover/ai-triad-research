# Shared console-output helpers used by multiple public functions.
# Dot-sourced by AITriad.psm1 — do NOT export.

function Write-Step  { param([string]$M) Write-Host "`n`u{25B6}  $M"    -ForegroundColor Cyan   }
function Write-OK    { param([string]$M) Write-Host "   `u{2713}  $M"   -ForegroundColor Green  }
function Write-Warn  { param([string]$M) Write-Host "   `u{26A0}  $M"   -ForegroundColor Yellow }
function Write-Fail  { param([string]$M) Write-Host "   `u{2717}  $M"   -ForegroundColor Red    }
function Write-Info  { param([string]$M) Write-Host "   `u{2192}  $M"   -ForegroundColor Gray   }
function Write-Label { param([string]$M) Write-Host "   $M"             -ForegroundColor White  }
