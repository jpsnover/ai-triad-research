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
            -Location 'Import-Document' `
            -NextSteps @('Verify the file path exists', 'Check file permissions')
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Goal,
        [Parameter(Mandatory)][string]$Problem,
        [Parameter(Mandatory)][string]$Location,
        [Parameter(Mandatory)][string[]]$NextSteps,
        [System.Management.Automation.ErrorRecord]$InnerError,
        [switch]$Throw,
        [switch]$PassThru
    )

    Set-StrictMode -Version Latest

    $i = 0
    $StepList = ($NextSteps | ForEach-Object { $i++; "   $i. $_" }) -join "`n"
    if ($InnerError) { $InnerDetail = "`n   Inner error: $($InnerError.Exception.Message)" } else { $InnerDetail = '' }

    $Message = @"

  Goal:     $Goal
  Error:    $Problem$InnerDetail
  Location: $Location
  Resolve:
$StepList
"@

    if ($PassThru) { return $Message }
    elseif ($Throw) { throw $Message }
    else { Write-Error $Message }
}

function Invoke-WithRecovery {
    <#
    .SYNOPSIS
        Executes an action with optional retry and fallback, producing actionable errors on final failure.
    .EXAMPLE
        Invoke-WithRecovery -Goal 'Calling API' -Location 'Get-Data' `
            -Action { Invoke-RestMethod $uri } `
            -MaxRetries 2 -RetryDelaySeconds 3 `
            -NextSteps @('Check your API key', 'Verify network connectivity')
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Goal,
        [Parameter(Mandatory)][string]$Location,
        [Parameter(Mandatory)][scriptblock]$Action,
        [scriptblock]$Fallback,
        [int]$MaxRetries = 0,
        [int]$RetryDelaySeconds = 2,
        [string[]]$NextSteps = @('Check the error details above and retry'),
        [switch]$Throw
    )

    Set-StrictMode -Version Latest

    $LastError = $null
    for ($attempt = 0; $attempt -le $MaxRetries; $attempt++) {
        try {
            return (& $Action)
        }
        catch {
            $LastError = $_
            if ($attempt -lt $MaxRetries) {
                Write-Warning "$Goal - attempt $($attempt + 1)/$($MaxRetries + 1) failed: $($_.Exception.Message). Retrying in ${RetryDelaySeconds}s..."
                Start-Sleep -Seconds $RetryDelaySeconds
            }
        }
    }

    if ($Fallback) {
        try {
            Write-Warning "$Goal - primary action failed, trying fallback..."
            return (& $Fallback)
        }
        catch {
            Write-Warning "$Goal - fallback also failed: $($_.Exception.Message)"
        }
    }

    New-ActionableError -Goal $Goal -Problem $LastError.Exception.Message `
        -Location $Location -NextSteps $NextSteps -InnerError $LastError -Throw:$Throw
}
