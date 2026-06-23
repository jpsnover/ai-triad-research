# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiAi002 {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$BaseUrl,
        [Parameter()][int]$TimeoutSec = 15,
        [Parameter()][hashtable]$AuthHeaders = @{}
    )

    Set-StrictMode -Version Latest
    $Sw = [System.Diagnostics.Stopwatch]::StartNew()
    $Checks = [System.Collections.Generic.List[PSObject]]::new()
    $BaseUrl = $BaseUrl.TrimEnd('/')

    # Check 1: At least one backend available
    $r = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/api/backends/available' -TimeoutSec $TimeoutSec
    $HasBackend = $r.Success -and $r.Body -and @($r.Body).Count -gt 0
    $Checks.Add((New-CuiCheckResult -Check 'Backend available' -Pass $HasBackend `
        -Detail $(if ($HasBackend) { "$(@($r.Body).Count) backends" } else { "No backends: $($r.Error)" }) -Ms $r.ResponseMs))

    # Check 2: POST /api/ai/generate with simple prompt → 200, non-empty text
    $GenSw = [System.Diagnostics.Stopwatch]::StartNew()
    $GenOk = $false
    $GenText = ''
    try {
        $GenBody = @{ prompt = 'What is 2+2? Answer with just the number.'; maxTokens = 20 } | ConvertTo-Json -Compress
        $GenResp = Invoke-WebRequest -Uri "$BaseUrl/api/ai/generate" -Method POST `
            -Body $GenBody -ContentType 'application/json' -TimeoutSec 60 `
            -UseBasicParsing -ErrorAction Stop -Headers $AuthHeaders
        if ($GenResp.StatusCode -eq 200) {
            $GenJson = $GenResp.Content | ConvertFrom-Json
            if ($GenJson.PSObject.Properties['text'] -and $GenJson.text.Length -gt 0) {
                $GenOk = $true
                $GenText = $GenJson.text
            }
        }
    } catch { }
    $GenSw.Stop()
    $Checks.Add((New-CuiCheckResult -Check 'AI generation returns text' -Pass $GenOk `
        -Detail $(if ($GenOk) { "Response: $($GenText.Substring(0, [Math]::Min(40, $GenText.Length)))" } else { 'Empty or failed' }) -Ms $GenSw.ElapsedMilliseconds))

    # Check 3: Response time < 60s
    $TimeOk = $GenSw.ElapsedMilliseconds -lt 60000
    $Checks.Add((New-CuiCheckResult -Check 'Response time < 60s' -Pass $TimeOk `
        -Detail "$([Math]::Round($GenSw.ElapsedMilliseconds / 1000, 1))s" -Ms $GenSw.ElapsedMilliseconds))

    # Check 4: Response is coherent (not an error message)
    $CoherentOk = $GenOk -and $GenText -notmatch '(?i)(error|exception|failed|unauthorized)'
    $Checks.Add((New-CuiCheckResult -Check 'Response is coherent' -Pass $CoherentOk `
        -Detail $(if ($CoherentOk) { 'Valid text' } elseif (-not $GenOk) { 'No response' } else { 'Looks like error text' })))

    $Sw.Stop()
    New-CuiTestResult -CuiId 'CUI-AI-002' -Domain 'AI' -Priority 'P0' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
}
