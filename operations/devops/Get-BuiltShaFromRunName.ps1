# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
Extracts the commit a Container Image run actually BUILT from that run's name (t/4129).

.DESCRIPTION
Auto-Deploy to Staging fires on `workflow_run` of Container Image. It used to deploy
`github.event.workflow_run.head_sha`, assuming that was the built commit. It is not, on the only
real build path: a `workflow_dispatch` with an explicit `sha` input has head_sha = the dispatch
ref's tip (main at dispatch time), while the job checks out, bakes and tags `inputs.sha`. So
staging looked up `sha-<main tip>`, which was never pushed, and failed with ImageTagNotFound
whenever main had moved between the built commit and the dispatch (t/4129: built eeb267d0,
looked up d42561bc).

container.yml now sets `run-name: Container Image (sha-<inputs.sha || github.sha>)`, using the
SAME expression as its per-SHA tag and its BUILD_SHA build-arg, so the run name, the tag and the
baked marker cannot disagree. This function reads the commit back out of that name.

FAIL-CLOSED: a name with no `(sha-<hex>)` marker returns nothing and the caller must abort. It
must NOT fall back to head_sha; that fallback is the defect this replaces.

Invoked (not dot-sourced) with -RunName and -GitHubOutput, it writes `sha=<commit>` to
$env:GITHUB_OUTPUT, or throws an actionable error.
#>
[CmdletBinding()]
param(
    [string] $RunName,
    [switch] $GitHubOutput
)

function Get-BuiltShaFromRunName {
    # PURE: returns the 7-40 hex-char commit from "...(sha-<hex>)...", or $null.
    param([AllowEmptyString()][AllowNull()][string] $RunName)
    if ([string]::IsNullOrWhiteSpace($RunName)) { return $null }
    $m = [regex]::Match($RunName, '\(sha-([0-9a-fA-F]{7,40})\)')
    if (-not $m.Success) { return $null }
    return $m.Groups[1].Value.ToLowerInvariant()
}

# Run only when invoked, so the tests can dot-source the pure function.
if ($MyInvocation.InvocationName -ne '.') {
    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'
    $sha = Get-BuiltShaFromRunName -RunName $RunName
    if (-not $sha) {
        throw ("Goal: deploy the commit Container Image actually built (t/4129). " +
            "Error: run name '$RunName' carries no '(sha-<commit>)' marker, so the built commit is unknown. " +
            "Refusing to fall back to workflow_run.head_sha, which is the dispatch ref tip, not the built commit. " +
            "Location: operations/devops/Get-BuiltShaFromRunName.ps1. " +
            "Resolve: the triggering build predates container.yml's run-name (t/4129); dispatch a new Container Image build, " +
            "or deploy that commit explicitly via Deploy to Azure.")
    }
    Write-Host "Built commit (from run name): $sha"
    if ($GitHubOutput) { Add-Content -Path $env:GITHUB_OUTPUT -Value "sha=$sha" }
}
