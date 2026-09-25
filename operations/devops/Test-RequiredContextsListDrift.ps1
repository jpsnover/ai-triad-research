# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    t/3646 drift-guard: verify the committed required-contexts SSOT matches live branch protection.
.DESCRIPTION
    The SSOT (.github/ci/required-contexts.json) is a MIRROR of the required status checks on main;
    branch protection is authoritative. workflow-lint enforces its required-context rules against the
    workflows named in the SSOT, so a STALE SSOT makes the lint enforce the wrong set. This guard must
    be green on main BEFORE the lint is promoted to blocking (TL t/3646 ruling 1).

    Reading branch protection requires admin scope. The GitHub Actions default GITHUB_TOKEN does NOT
    have it, so this guard is intended to run where an admin-authenticated gh is available (the fleet
    host / a job with an admin PAT). If it cannot read protection it FAILS DEGRADED (exit 2), never a
    silent green — "could not verify" must not read as "in sync".

    Exit codes: 0 = in sync; 1 = DRIFT (details printed); 2 = could-not-verify (gh/SSOT unavailable).
.PARAMETER Repo
    owner/name. Default jpsnover/ai-triad-research.
.PARAMETER SsotPath
    Path to the SSOT JSON. Default: <repo-root>/.github/ci/required-contexts.json.
#>

[CmdletBinding()]
param(
    [string]$Repo = 'jpsnover/ai-triad-research',
    [string]$SsotPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

. "$PSScriptRoot/RequiredContextsDriftVerdict.ps1"

if (-not $SsotPath) {
    $repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # operations/devops -> repo root
    $SsotPath = Join-Path $repoRoot '.github/ci/required-contexts.json'
}

# ── Load the SSOT ────────────────────────────────────────────────────────────
if (-not (Test-Path -LiteralPath $SsotPath)) {
    Write-Host "::error::required-contexts drift-guard: SSOT not found at $SsotPath — cannot verify (exit 2)."
    exit 2
}
try {
    $ssotJson = Get-Content -LiteralPath $SsotPath -Raw | ConvertFrom-Json
    $ssotContexts = @($ssotJson.required_contexts | ForEach-Object { $_.context } | Where-Object { $_ })
} catch {
    Write-Host "::error::required-contexts drift-guard: SSOT malformed ($($_.Exception.Message)) — cannot verify (exit 2)."
    exit 2
}
if ($ssotContexts.Count -eq 0) {
    Write-Host "::error::required-contexts drift-guard: SSOT has no required_contexts — cannot verify (exit 2)."
    exit 2
}

# ── Query live branch protection (needs admin gh) ────────────────────────────
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Host "::error::required-contexts drift-guard: gh not on PATH — cannot read branch protection (exit 2)."
    exit 2
}
$apiRaw = & gh api "repos/$Repo/branches/main/protection/required_status_checks" 2>&1
$apiExit = $LASTEXITCODE
if ($apiExit -ne 0) {
    $txt = ($apiRaw | ForEach-Object { "$_" }) -join ' '
    $why = if ($txt -match '(?i)404|not.*admin|must have admin|resource not accessible|403') {
        'no admin access to branch protection (the Actions default GITHUB_TOKEN lacks it — run with an admin gh/PAT)'
    } elseif ($txt -match '(?i)auth|login|token') { 'gh not authenticated' }
    else { "gh error: $($txt.Substring(0,[Math]::Min(160,$txt.Length)))" }
    Write-Host "::error::required-contexts drift-guard: could not read branch protection — $why (exit 2, NOT in-sync)."
    exit 2
}
try {
    $api = ($apiRaw | ForEach-Object { "$_" }) -join "`n" | ConvertFrom-Json
    # Prefer the modern `checks[].context`; fall back to the legacy `contexts[]`.
    $apiContexts = @()
    if ($api.PSObject.Properties['checks'] -and $api.checks) { $apiContexts = @($api.checks | ForEach-Object { $_.context }) }
    elseif ($api.PSObject.Properties['contexts']) { $apiContexts = @($api.contexts) }
    $apiContexts = @($apiContexts | Where-Object { $_ })
} catch {
    Write-Host "::error::required-contexts drift-guard: branch-protection payload unparseable ($($_.Exception.Message)) — cannot verify (exit 2)."
    exit 2
}
if ($apiContexts.Count -eq 0) {
    Write-Host "::error::required-contexts drift-guard: branch protection returned zero required contexts — cannot verify (exit 2)."
    exit 2
}

# ── Compare ──────────────────────────────────────────────────────────────────
$v = Get-RequiredContextsDriftVerdict -Ssot $ssotContexts -Api $apiContexts
Write-Host "SSOT:  $([string]::Join(', ', ($ssotContexts | Sort-Object)))"
Write-Host "API:   $([string]::Join(', ', ($apiContexts | Sort-Object)))"
if ($v.InSync) {
    Write-Host 'required-contexts drift-guard: IN SYNC — SSOT matches live branch protection.'
    exit 0
}
if ($v.MissingFromApi.Count -gt 0) {
    Write-Host "::error::required-contexts drift-guard: SSOT lists context(s) NOT required by branch protection (stale SSOT over-claims): $([string]::Join(', ', $v.MissingFromApi)) — update the SSOT or branch protection."
}
if ($v.MissingFromSsot.Count -gt 0) {
    Write-Host "::error::required-contexts drift-guard: branch protection requires context(s) MISSING from the SSOT (SSOT under-claims — the lint won't guard them): $([string]::Join(', ', $v.MissingFromSsot)) — add them to $SsotPath."
}
exit 1
