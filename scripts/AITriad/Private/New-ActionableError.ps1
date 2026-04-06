# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Standardized actionable error helper.
# Produces structured error messages for both humans and AI agents.
# Dot-sourced by AITriad.psm1 — do NOT export.

function New-ActionableError {
    <#
    .SYNOPSIS
        Creates a structured, actionable error message for humans and AI agents.
    .DESCRIPTION
        Generates a formatted error that includes what was being attempted, what went
        wrong, where it happened, and specific steps to resolve. Outputs via Write-Error
        by default, or returns a string with -PassThru, or throws with -Throw.
    .EXAMPLE
        New-ActionableError -Goal 'Importing document' -Problem 'File not found' `
            -Location 'Import-AITriadDocument' `
            -NextSteps @('Verify the file path exists', 'Check file permissions')
    .EXAMPLE
        New-ActionableError -Goal 'Calling Gemini API' -Problem 'Authentication failed (401)' `
            -Location 'AIEnrich.psm1:Invoke-AICompletion' `
            -NextSteps @('Run: $env:GEMINI_API_KEY to verify the key is set',
                         'Regenerate key at https://aistudio.google.com/apikey') `
            -Throw
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Goal,

        [Parameter(Mandatory)]
        [string]$Problem,

        [Parameter(Mandatory)]
        [string]$Location,

        [Parameter(Mandatory)]
        [string[]]$NextSteps,

        [System.Management.Automation.ErrorRecord]$InnerError,

        [switch]$Throw,

        [switch]$PassThru
    )

    $StepList = ($NextSteps | ForEach-Object { $i = [int]($NextSteps.IndexOf($_)) + 1; "   $i. $_" }) -join "`n"
    if ($InnerError) { $InnerDetail = "`n   Inner error: $($InnerError.Exception.Message)" } else { $InnerDetail = '' }

    $Message = @"

  Goal:     $Goal
  Error:    $Problem$InnerDetail
  Location: $Location
  Resolve:
$StepList
"@

    if ($PassThru) {
        return $Message
    }
    elseif ($Throw) {
        throw $Message
    }
    else {
        Write-Error $Message
    }
}

function Invoke-WithRecovery {
    <#
    .SYNOPSIS
        Executes an action with optional retry and fallback, producing actionable errors on final failure.
    .DESCRIPTION
        Tries the primary action up to MaxRetries times. If all retries fail and a Fallback
        scriptblock is provided, executes the fallback. If everything fails, emits an
        actionable error via New-ActionableError.
    .EXAMPLE
        Invoke-WithRecovery -Goal 'Calling Gemini API' -Location 'Invoke-POVSummary' `
            -Action { Invoke-GeminiCompletion $Prompt } `
            -MaxRetries 2 -RetryDelaySeconds 3 `
            -NextSteps @('Check your GEMINI_API_KEY', 'Verify network connectivity')
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Goal,

        [Parameter(Mandatory)]
        [string]$Location,

        [Parameter(Mandatory)]
        [scriptblock]$Action,

        [scriptblock]$Fallback,

        [int]$MaxRetries = 0,

        [int]$RetryDelaySeconds = 2,

        [string[]]$NextSteps = @('Check the error details above and retry'),

        [switch]$Throw
    )

    $LastError = $null
    for ($attempt = 0; $attempt -le $MaxRetries; $attempt++) {
        try {
            return (& $Action)
        }
        catch {
            $LastError = $_
            if ($attempt -lt $MaxRetries) {
                Write-Warn "$Goal — attempt $($attempt + 1)/$($MaxRetries + 1) failed: $($_.Exception.Message). Retrying in ${RetryDelaySeconds}s..."
                Start-Sleep -Seconds $RetryDelaySeconds
            }
        }
    }

    # Primary action exhausted — try fallback
    if ($Fallback) {
        try {
            Write-Warn "$Goal — primary action failed, trying fallback..."
            return (& $Fallback)
        }
        catch {
            $LastError = $_
        }
    }

    # Everything failed — produce actionable error
    New-ActionableError -Goal $Goal -Problem $LastError.Exception.Message `
        -Location $Location -NextSteps $NextSteps -InnerError $LastError -Throw:$Throw
}
