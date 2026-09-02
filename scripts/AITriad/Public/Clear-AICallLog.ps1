# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Clear-AICallLog {
    <#
    .SYNOPSIS
        Rotate/clear the AI call log — removes ai-call-log.jsonl so the next entry restarts ID at 1.
    .DESCRIPTION
        The rotate/clear for the AI Call Log (t/3241; epic t/3235). A "session" is one log file, so
        clearing it starts a fresh session — the next Write-AICallLogEntry mints ID 1 again. No-op
        (Removed=$false) when the file is already absent. Honors -WhatIf/-Confirm (it deletes a file).
    .PARAMETER Path
        Log file override (fixtures/tests). Default: Get-AICallLogPath (data-root resolved).
    .OUTPUTS
        [pscustomobject] { Path, Removed } — the resolved path and whether a file was deleted.
    .EXAMPLE
        Clear-AICallLog
        Starts a fresh AI-call-log session (ID resets to 1 on the next logged call).
    .EXAMPLE
        Clear-AICallLog -WhatIf
        Shows what would be removed without deleting.
    .LINK
        Get-AICallLog
    .LINK
        Show-AICallLog
    #>
    [CmdletBinding(SupportsShouldProcess)]
    [OutputType([PSCustomObject])]
    param(
        [Parameter()]
        [string]$Path
    )
    Set-StrictMode -Version Latest

    $logPath = if ($PSBoundParameters.ContainsKey('Path') -and $Path) { $Path } else { Get-AICallLogPath }

    $removed = $false
    if (Test-Path -LiteralPath $logPath) {
        if ($PSCmdlet.ShouldProcess($logPath, 'Remove AI call log (reset session, next ID = 1)')) {
            Remove-Item -LiteralPath $logPath -Force
            $removed = $true
        }
    }

    return [pscustomobject]@{
        Path    = $logPath
        Removed = $removed
    }
}
