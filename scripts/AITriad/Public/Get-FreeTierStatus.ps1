# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-FreeTierStatus {
    <#
    .SYNOPSIS
        Reports live free-tier configuration and usage from a deployed server.
    .DESCRIPTION
        Queries GET /api/proxy/usage and reshapes the response into a single
        FreeTierStatus object. Turns "why is this anonymous user getting 429?"
        from a server-log investigation into one command.

        Background: diagnosing t/1061 (token budget exhaustion) was slowed
        because /health used to hardcode tokensPerDay instead of reading the
        runtime config. This cmdlet sources from /api/proxy/usage which
        already reads the live config + actual usage counter.

        AllowedRoutes is a hardcoded list mirroring the server's free-tier
        route table (the server doesn't expose it via API). If you change the
        free-tier route set server-side, also update this list.
    .PARAMETER BaseUrl
        Target server URL. Defaults to the current production URL.
    .PARAMETER TimeoutSec
        HTTP request timeout (1-30, default 10).
    .EXAMPLE
        Get-FreeTierStatus
    .EXAMPLE
        Get-FreeTierStatus -BaseUrl https://staging.example.com | Format-List
    .EXAMPLE
        (Get-FreeTierStatus).BudgetUtilizationPct
    #>
    [CmdletBinding()]
    param(
        [Parameter(Position = 0)]
        [string]$BaseUrl = (Get-TaxEditorBaseUrl),

        [ValidateRange(1, 30)]
        [int]$TimeoutSec = 10
    )

    Set-StrictMode -Version Latest

    # Hardcoded mirror of the server's free-tier route table.
    # Update when the server-side free-tier route set changes.
    $AllowedRoutes = @(
        '/api/auth/anonymous',
        '/api/ai/generate',
        '/api/embeddings/compute',
        '/api/embeddings/query',
        '/api/debates/:id',
        '/api/flight-recorder/server-dump',
        '/api/flight-recorder/download-merged/:dumpId'
    )

    $BaseUrl = $BaseUrl.TrimEnd('/')
    $Check = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/api/proxy/usage' `
        -TimeoutSec $TimeoutSec -AcceptableStatusCodes @(200)

    if (-not $Check.Success) {
        New-ActionableError `
            -Goal     'Query free-tier status' `
            -Problem  ("GET /api/proxy/usage failed: HTTP {0} {1}" -f $Check.StatusCode, $Check.Error) `
            -Location 'Get-FreeTierStatus' `
            -NextSteps @(
                "Verify -BaseUrl is correct: $BaseUrl",
                'Run Test-TaxEditorHealth to confirm the server is reachable',
                'Check that the server version exposes /api/proxy/usage (server.ts:1420)'
            ) -Throw
    }

    $Body = $Check.Body
    if (-not $Body -or -not $Body.PSObject.Properties['limits'] -or -not $Body.PSObject.Properties['usage']) {
        New-ActionableError `
            -Goal     'Parse free-tier status response' `
            -Problem  'Response missing expected limits/usage fields' `
            -Location 'Get-FreeTierStatus' `
            -NextSteps @('Check server version compatibility', "Raw response: $($Body | ConvertTo-Json -Depth 3 -Compress)") `
            -Throw
    }

    $Limits = $Body.limits
    $Usage  = $Body.usage

    $DailyBudget = if ($Limits.PSObject.Properties['tokensPerDay']) { [int]$Limits.tokensPerDay } else { 0 }
    $TokensUsed  = if ($Usage.PSObject.Properties['tokensToday'])   { [int]$Usage.tokensToday }   else { 0 }
    $RPMLimit    = if ($Limits.PSObject.Properties['requestsPerMinute']) { [int]$Limits.requestsPerMinute } else { 0 }
    $Remaining   = [Math]::Max(0, $DailyBudget - $TokensUsed)
    $UtilPct     = if ($DailyBudget -gt 0) { [Math]::Round(($TokensUsed / $DailyBudget) * 100, 2) } else { 0 }

    # Milestone warning thresholds (absolute token counts at 50%/80%/95%)
    $Milestones = [ordered]@{
        '50pct' = [Math]::Round($DailyBudget * 0.50)
        '80pct' = [Math]::Round($DailyBudget * 0.80)
        '95pct' = [Math]::Round($DailyBudget * 0.95)
    }

    # LastResetTime: server returns resetsAt = next UTC midnight; the last reset
    # was 24h before that.
    $LastReset = $null
    if ($Usage.PSObject.Properties['resetsAt'] -and $Usage.resetsAt) {
        try {
            $ResetsAt = [DateTimeOffset]::Parse([string]$Usage.resetsAt).UtcDateTime
            $LastReset = $ResetsAt.AddDays(-1).ToString('yyyy-MM-ddTHH:mm:ssZ')
        } catch { }
    }

    $Tier = if ($Body.PSObject.Properties['tier']) { [string]$Body.tier } else { 'unknown' }

    $Result = [FreeTierStatus]::new()
    $Result.Tier                   = $Tier
    $Result.DailyTokenBudget       = $DailyBudget
    $Result.TokensUsedToday        = $TokensUsed
    $Result.TokensRemainingToday   = $Remaining
    $Result.BudgetUtilizationPct   = $UtilPct
    $Result.RPMLimit               = $RPMLimit
    $Result.AllowedRoutes          = $AllowedRoutes
    $Result.MilestoneWarnings      = $Milestones
    $Result.LastResetTime          = $LastReset
    $Result.BaseUrl                = $BaseUrl
    $Result
}
