# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-ComplexityBudget {
    <#
    .SYNOPSIS
        Enforces the PowerShell complexity-ratchet baseline (t/3829).
    .DESCRIPTION
        For every file in scope: a file not in the baseline is a violation if its
        max complexity exceeds the threshold ("new offender"); a file already in the
        baseline is a violation if Get-ComplexityBudgetVerdict rejects it ("regression");
        otherwise it is clean. An unmodified tree produces zero violations.

        -Threshold is OPTIONAL and, when omitted, is read back from the baseline's own
        __meta__.threshold -- there is deliberately no independent default here, so the
        threshold has exactly one authoritative home (the baseline file Update-ComplexityBaseline
        writes) rather than two places that can drift apart (t/3829#4). If -Threshold IS
        passed explicitly and disagrees with the baseline's recorded value, this is a hard
        error, never a silent re-scope -- the TypeScript peer's "thresholdMismatch" check,
        adopted verbatim (t/3821#5's finding: a threshold bump without regenerating must not
        pass silently). Same treatment for -Path's scan-scope label vs __meta__.scan.
    .PARAMETER Path
        Root directory to scan. Default: the scripts/ directory (same resolution as
        Measure-CodeComplexity's default).
    .PARAMETER BaselinePath
        Path to the baseline JSON file. Default: complexity-baseline.json directly
        under -Path.
    .PARAMETER Threshold
        Optional override. When omitted, uses the baseline's own __meta__.threshold.
        When supplied, must match the baseline's recorded value or this hard-errors.
    .PARAMETER FailOnViolation
        When set, throws (via New-ActionableError) if any violation is found --
        this is the knob a CI step flips from warn-only to blocking once the gate
        has run non-blocking for at least one green cycle (t/3829's Gate Promotion
        requirement). Without it, violations are reported, not thrown.
    .OUTPUTS
        [PSCustomObject] { Passed; Violations; Threshold; Scan; FilesScanned }
    .EXAMPLE
        Test-ComplexityBudget
    .EXAMPLE
        Test-ComplexityBudget -FailOnViolation
    .LINK
        Update-ComplexityBaseline
    .LINK
        Measure-CodeComplexity
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter()]
        [string]$Path,

        [Parameter()]
        [string]$BaselinePath,

        [Parameter()]
        [Nullable[int]]$Threshold,

        [Parameter()]
        [switch]$FailOnViolation
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    if (-not $Path) {
        $Path = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path
    }
    if (-not $BaselinePath) {
        $BaselinePath = Join-Path $Path 'complexity-baseline.json'
    }
    $scanLabel = Split-Path $Path -Leaf

    if (-not (Test-Path -LiteralPath $BaselinePath)) {
        New-ActionableError `
            -Goal 'Enforce the complexity-ratchet budget' `
            -Problem "Baseline not found: $BaselinePath" `
            -Location 'Test-ComplexityBudget' `
            -NextSteps @("Run Update-ComplexityBaseline -Path '$Path' to generate it") `
            -Throw
    }

    $raw = Get-Content -LiteralPath $BaselinePath -Raw | ConvertFrom-Json
    if (-not $raw.PSObject.Properties['__meta__']) {
        New-ActionableError `
            -Goal 'Enforce the complexity-ratchet budget' `
            -Problem "Baseline at '$BaselinePath' is missing __meta__ -- malformed or from a different format version" `
            -Location 'Test-ComplexityBudget' `
            -NextSteps @('Regenerate with Update-ComplexityBaseline') `
            -Throw
    }
    $recordedThreshold = [int]$raw.__meta__.threshold
    $recordedScan = [string]$raw.__meta__.scan

    if ($null -ne $Threshold -and $Threshold -ne $recordedThreshold) {
        New-ActionableError `
            -Goal 'Enforce the complexity-ratchet budget' `
            -Problem "Threshold mismatch: caller passed -Threshold $Threshold but the baseline was generated with threshold=$recordedThreshold" `
            -Location 'Test-ComplexityBudget' `
            -NextSteps @('Regenerate the baseline with Update-ComplexityBaseline -Threshold <new value>', 'Or omit -Threshold here to use the baseline-recorded value') `
            -Throw
    }
    $effectiveThreshold = if ($null -ne $Threshold) { $Threshold } else { $recordedThreshold }

    if ($scanLabel -ne $recordedScan) {
        New-ActionableError `
            -Goal 'Enforce the complexity-ratchet budget' `
            -Problem "Scan-scope mismatch: -Path '$Path' resolves to scan label '$scanLabel' but the baseline recorded scan='$recordedScan'" `
            -Location 'Test-ComplexityBudget' `
            -NextSteps @("Pass -Path pointing at the baselined scope ('$recordedScan')", 'Or regenerate the baseline against the new scope') `
            -Throw
    }

    $existingBaseline = @{}
    foreach ($prop in $raw.PSObject.Properties) {
        if ($prop.Name -eq '__meta__') { continue }
        # t/3874: normalize on READ (the "lookup" side) -- a '\'-keyed entry (legacy or
        # hand-edited) must still match the '/'-keyed $file from the now-normalized
        # Get-ComplexityScanTargets below, or every baselined file reads as new.
        $key = $prop.Name.Replace('\', '/')
        $existingBaseline[$key] = @{ max = [int]$prop.Value.max; countOver = [int]$prop.Value.countOver }
    }

    $targets = @(Get-ComplexityScanTargets -Path $Path)
    $violations = [System.Collections.Generic.List[PSObject]]::new()
    $groups = @($targets | Group-Object File)

    foreach ($group in $groups) {
        $maxComplexity = ($group.Group | Measure-Object -Property Complexity -Maximum).Maximum
        $countOver = @($group.Group | Where-Object { $_.Complexity -gt $effectiveThreshold }).Count
        $observed = @{ max = [int]$maxComplexity; countOver = $countOver }
        $file = $group.Name

        if ($existingBaseline.ContainsKey($file)) {
            $existing = $existingBaseline[$file]
            if (-not (Get-ComplexityBudgetVerdict -Observed $observed -Existing $existing -Threshold $effectiveThreshold)) {
                $violations.Add([PSCustomObject]@{
                    File     = $file
                    Reason   = 'regression'
                    Observed = [PSCustomObject]$observed
                    Baseline = [PSCustomObject]$existing
                })
            }
        } elseif ($observed.max -gt $effectiveThreshold) {
            $violations.Add([PSCustomObject]@{
                File     = $file
                Reason   = 'new-offender'
                Observed = [PSCustomObject]$observed
                Baseline = $null
            })
        }
    }

    $result = [PSCustomObject]@{
        Passed       = ($violations.Count -eq 0)
        Violations   = $violations.ToArray()
        Threshold    = $effectiveThreshold
        Scan         = $scanLabel
        FilesScanned = $groups.Count
    }

    if ($FailOnViolation -and -not $result.Passed) {
        $lines = $violations | ForEach-Object {
            if ($_.Reason -eq 'new-offender') {
                "  NEW OFFENDER: $($_.File) (max=$($_.Observed.max), threshold=$effectiveThreshold)"
            } else {
                "  REGRESSION:   $($_.File) (observed max=$($_.Observed.max)/countOver=$($_.Observed.countOver) vs baseline max=$($_.Baseline.max)/countOver=$($_.Baseline.countOver))"
            }
        }
        New-ActionableError `
            -Goal 'Enforce the complexity-ratchet budget' `
            -Problem "$($violations.Count) complexity-budget violation(s):`n$($lines -join "`n")" `
            -Location 'Test-ComplexityBudget' `
            -NextSteps @('Decompose the offending function(s), or', 'If this is an intentional decomposition that still trips the ceiling, discuss with Tech Lead before overriding') `
            -Throw
    }

    $result
}
