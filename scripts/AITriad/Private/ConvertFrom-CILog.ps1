# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function ConvertFrom-CILog {
    <#
    .SYNOPSIS
        Pure parser (t/2882): extract Pester failures and error lines from a gh run log.
    .DESCRIPTION
        Takes the raw text of a `gh run view --log`/`--log-failed` capture and returns a
        structured summary: the failing Pester test names, the raw `[-]` failure lines
        plus their assertion detail (test-emitted), and the remaining `##[error]` lines
        (real infrastructure errors — a failed step, a module-load error, etc.).

        Pure by design (no gh call) so it is unit-testable against synthetic log text.
    .PARAMETER LogText
        The captured CI log text.
    .PARAMETER FailedJobs
        Optional list of failed job names (from `gh run view --json jobs`), echoed through.
    .OUTPUTS
        [PSCustomObject] with FailedJobs, FailingTests, PesterFailureLines, InfraErrorLines,
        FailedCount.
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string]$LogText,

        [Parameter()]
        [string[]]$FailedJobs = @()
    )

    Set-StrictMode -Version Latest

    $FailingTests       = [System.Collections.Generic.List[string]]::new()
    $PesterFailureLines = [System.Collections.Generic.List[string]]::new()
    $InfraErrorLines    = [System.Collections.Generic.List[string]]::new()
    $FailedCount        = $null

    # gh prefixes each line with "job<TAB>step<TAB>timestamp "; strip a leading
    # "<stuff>##[error]" and any leading timestamp so matching is prefix-agnostic.
    $Lines = $LogText -split "\r?\n"
    $InAssertionBlock = $false

    foreach ($Raw in $Lines) {
        # `gh run view --log` prefixes each line with "job<TAB>step<TAB>ISO-timestamp ".
        # Strip up to and including that timestamp so content matches cleanly (no-op when
        # the caller pipes an already-clean log).
        $Line = ($Raw -replace '^.*?\d{4}-\d{2}-\d{2}T[0-9:.]+Z\s+', '').Trim()
        if ([string]::IsNullOrWhiteSpace($Line)) { continue }

        # A Pester FAILING test line: "[-] <name> <ms>", optionally prefixed with ##[error].
        if ($Line -match '\[-\]\s+(.+?)(?:\s+\d+(?:\.\d+)?\s*ms)?\s*$') {
            $Name = ($Matches[1] -replace '^.*##\[error\]', '').Trim()
            $FailingTests.Add($Name)
            $PesterFailureLines.Add(($Line -replace '^.*##\[error\]', '').Trim())
            $InAssertionBlock = $true
            continue
        }

        # Assertion detail that belongs to the failing test just above it.
        if ($InAssertionBlock -and
            $Line -match 'Expected|But was|but got|Should\s|##\[group\]Message|at .+:\d+') {
            $PesterFailureLines.Add(($Line -replace '^.*##\[error\]', '').Trim())
            continue
        }
        $InAssertionBlock = $false

        # Pester's own run summary — pull the failed count if present.
        if ($Line -match 'Tests? (?:Passed|completed).*Failed:\s*(\d+)' -or
            $Line -match 'Failed:\s*(\d+)\b') {
            $FailedCount = [int]$Matches[1]
            continue
        }

        # Everything else carrying ##[error] that is NOT a test failure/assertion and NOT
        # the generic step-wrapper marker is a real infrastructure error.
        if ($Line -match '##\[error\]' -and
            $Line -notmatch '\[-\]' -and
            $Line -notmatch 'Process completed with exit code') {
            $Msg = ($Line -replace '^.*##\[error\]', '').Trim()
            if ($Msg) { $InfraErrorLines.Add($Msg) }
        }
    }

    return [PSCustomObject]@{
        FailedJobs         = @($FailedJobs)
        FailingTests       = @($FailingTests)
        PesterFailureLines = @($PesterFailureLines)
        InfraErrorLines    = @($InfraErrorLines)
        FailedCount        = $FailedCount
    }
}
