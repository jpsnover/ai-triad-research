# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Console output helpers for consistent status messaging.
.DESCRIPTION
    Provides six themed Write-Host wrapper functions used throughout the AITriad
    module for consistent, color-coded console output:

      Write-Step   — Cyan, with ▶ prefix.   Announces a major pipeline step.
      Write-OK     — Green, with ✓ prefix.  Confirms a successful operation.
      Write-Warn   — Yellow, with ⚠ prefix. Non-fatal warnings.
      Write-Fail   — Red, with ✗ prefix.    Fatal errors or hard failures.
      Write-Info   — Gray, with → prefix.   Informational detail lines.
      Write-Label  — White, no prefix.      Section labels and headings.

    These are internal helpers (not exported).  Public functions use them to
    produce readable, scannable output during long-running operations like
    batch summarization and document ingestion.
.EXAMPLE
    Write-Step  'Ingesting document'
    Write-Info  'Source: https://example.com/paper.pdf'
    Write-OK    'Snapshot created'

    Produces themed console output during a pipeline step.
#>
function Write-Step  { param([string]$M) Write-Host "`n`u{25B6}  $M"    -ForegroundColor Cyan   }
function Write-OK    { param([string]$M) Write-Host "   `u{2713}  $M"   -ForegroundColor Green  }
function Write-Warn  { param([string]$M) Write-Host "   `u{26A0}  $M"   -ForegroundColor Yellow }
function Write-Fail  { param([string]$M) Write-Host "   `u{2717}  $M"   -ForegroundColor Red    }
function Write-Info  { param([string]$M) Write-Host "   `u{2192}  $M"   -ForegroundColor Gray   }
function Write-Label { param([string]$M) Write-Host "   $M"             -ForegroundColor White  }
