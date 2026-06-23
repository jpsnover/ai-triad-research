# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiDeb001 {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$BaseUrl,
        [Parameter()][int]$TimeoutSec = 15,
        [Parameter()][hashtable]$AuthHeaders = @{}
    )

    Set-StrictMode -Version Latest
    $Sw = [System.Diagnostics.Stopwatch]::StartNew()
    $Checks = [System.Collections.Generic.List[PSObject]]::new()

    # Check 1: At least one AI backend available
    $r = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/api/backends/available' -TimeoutSec $TimeoutSec
    $HasBackend = $r.Success -and $r.Body -and @($r.Body).Count -gt 0
    $Checks.Add((New-CuiCheckResult -Check 'Backend available' -Pass $HasBackend `
        -Detail $(if ($HasBackend) { "$(@($r.Body).Count) backends" } else { "No backends: $($r.Error)" }) -Ms $r.ResponseMs))

    # Check 2: AI generation works with a simple prompt
    $GenSw = [System.Diagnostics.Stopwatch]::StartNew()
    $GenOk = $false
    $GenDetail = ''
    try {
        $GenBody = @{ prompt = 'Say hello in exactly three words.'; maxTokens = 50 } | ConvertTo-Json -Compress
        $GenResp = Invoke-WebRequest -Uri "$($BaseUrl.TrimEnd('/'))/api/ai/generate" -Method POST `
            -Body $GenBody -ContentType 'application/json' -TimeoutSec 60 `
            -UseBasicParsing -ErrorAction Stop -Headers $AuthHeaders
        if ($GenResp.StatusCode -eq 200) {
            $GenJson = $GenResp.Content | ConvertFrom-Json
            if ($GenJson.PSObject.Properties['text'] -and $GenJson.text.Length -gt 0) {
                $GenOk = $true
                $GenDetail = "Response: $($GenJson.text.Substring(0, [Math]::Min(50, $GenJson.text.Length)))"
            } else {
                $GenDetail = 'Empty response text'
            }
        }
    } catch {
        $GenDetail = $_.Exception.Message
    }
    $GenSw.Stop()
    $Checks.Add((New-CuiCheckResult -Check 'AI generation succeeds' -Pass $GenOk `
        -Detail $GenDetail -Ms $GenSw.ElapsedMilliseconds))

    # Check 3: PUT a minimal debate session
    $DebateId = "cui-test-$(Get-Date -Format 'yyyyMMddHHmmss')"
    $PutSw = [System.Diagnostics.Stopwatch]::StartNew()
    $PutOk = $false
    try {
        $DebateObj = @{
            id = $DebateId
            topic = 'CUI test debate'
            transcript = @()
        } | ConvertTo-Json -Compress
        $PutResp = Invoke-WebRequest -Uri "$($BaseUrl.TrimEnd('/'))/api/debates" -Method PUT `
            -Body $DebateObj -ContentType 'application/json' -TimeoutSec $TimeoutSec `
            -UseBasicParsing -ErrorAction Stop -Headers $AuthHeaders
        $PutOk = $PutResp.StatusCode -eq 200
    } catch {
        # Auth required — acceptable skip
        $PutOk = $false
    }
    $PutSw.Stop()
    $Checks.Add((New-CuiCheckResult -Check 'PUT debate session' -Pass $PutOk `
        -Detail $(if ($PutOk) { "Created $DebateId" } else { 'PUT failed (may need auth)' }) -Ms $PutSw.ElapsedMilliseconds))

    # Check 4: GET debates list contains the new debate (or at least loads)
    $r = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/api/debates' -TimeoutSec $TimeoutSec
    $ListOk = $r.Success
    $Checks.Add((New-CuiCheckResult -Check 'GET debates list' -Pass $ListOk `
        -Detail $(if ($ListOk) { 'Debates list loaded' } else { "Failed: $($r.Error)" }) -Ms $r.ResponseMs))

    # Cleanup: delete test debate if created
    if ($PutOk) {
        try {
            Invoke-WebRequest -Uri "$($BaseUrl.TrimEnd('/'))/api/debates/$DebateId" -Method DELETE `
                -TimeoutSec $TimeoutSec -UseBasicParsing -ErrorAction SilentlyContinue -Headers $AuthHeaders | Out-Null
        } catch { }
    }

    $Sw.Stop()
    New-CuiTestResult -CuiId 'CUI-DEB-001' -Domain 'Debate' -Priority 'P0' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
}
