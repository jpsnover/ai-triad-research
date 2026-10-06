# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-DepAIApiKeyBackend {
    <#
    .SYNOPSIS
        One generic live-probe prober for a single AI API key backend, replacing the 3
        near-identical Gemini/Anthropic/Groq blocks in Invoke-DependencyCheck's section 3
        (t/3910) -- the main complexity win for that section, mirroring the
        Test-AIProviderKeyStatus decomposition already done for Get-AICostReport.
    .PARAMETER Ctx
        The shared counters/results hashtable.
    .PARAMETER Backend
        One row of the backend table Test-DepAIApiKeys builds: @{
            EnvVar            = <string>            # e.g. 'GEMINI_API_KEY'
            Invoke            = <scriptblock>        # param($Key); returns the raw Invoke-RestMethod response
            InvalidStatusCodes = <int[]>             # HTTP codes that mean "invalid key", -> FAIL
            SuccessMessage    = <scriptblock>        # param($Key, $Response); returns the PASS message
            InvalidMessage    = <scriptblock>        # param($StatusCode); returns the FAIL message
            UnreachableMessage = <string>             # WARN message when reachable-but-not-a-known-invalid-code
            NotSetSeverity    = 'Warn' | 'Skip'
            NotSetMessage     = <string>
        }
    .OUTPUTS
        [bool] whether this backend counts as "having a usable key" (set + valid, or set +
        unreachable-but-assumed-ok) -- the caller ORs these across all backends to decide
        $HasAnyKey, matching the original inline logic exactly.
    #>
    [CmdletBinding()]
    [OutputType([bool])]
    param([Parameter(Mandatory)][hashtable]$Ctx, [Parameter(Mandatory)][hashtable]$Backend)

    $Key = [Environment]::GetEnvironmentVariable($Backend.EnvVar)
    if (-not $Key) {
        if ($Backend.NotSetSeverity -eq 'Warn') { Write-DepWarn -Ctx $Ctx -Message $Backend.NotSetMessage }
        else { Write-DepSkip -Message $Backend.NotSetMessage }
        return $false
    }

    try {
        $Response = & $Backend.Invoke $Key
        Write-DepPass -Ctx $Ctx -Message (& $Backend.SuccessMessage $Key $Response)
        return $true
    }
    catch {
        $SC = $_.Exception.Response.StatusCode.value__
        if ($SC -in $Backend.InvalidStatusCodes) {
            Write-DepFail -Ctx $Ctx -Message (& $Backend.InvalidMessage $SC)
            return $false
        }
        else {
            Write-DepWarn -Ctx $Ctx -Message $Backend.UnreachableMessage
            return $true
        }
    }
}
