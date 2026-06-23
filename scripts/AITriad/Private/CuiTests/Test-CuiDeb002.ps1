# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiDeb002 {
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

    # Check 1: Load existing debates list
    $r = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/api/debates' -TimeoutSec $TimeoutSec
    $HasDebates = $r.Success -and $r.Body -and @($r.Body).Count -gt 0
    $Checks.Add((New-CuiCheckResult -Check 'Debates list loads' -Pass $r.Success `
        -Detail $(if ($HasDebates) { "$(@($r.Body).Count) debates" } elseif ($r.Success) { 'Empty list' } else { "Failed: $($r.Error)" }) -Ms $r.ResponseMs))

    # Check 2: Load a specific debate (first one, or create a test one)
    $DebateId = $null
    if ($HasDebates) {
        $FirstDebate = @($r.Body)[0]
        if ($FirstDebate.PSObject.Properties['id']) {
            $DebateId = $FirstDebate.id
        }
    }

    $LoadOk = $false
    if ($DebateId) {
        $dr = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path "/api/debates/$DebateId" -TimeoutSec $TimeoutSec
        $LoadOk = $dr.Success
        $Checks.Add((New-CuiCheckResult -Check 'Load specific debate' -Pass $LoadOk `
            -Detail $(if ($LoadOk) { "Loaded $DebateId" } else { "Failed: $($dr.Error)" }) -Ms $dr.ResponseMs))
    } else {
        $Checks.Add((New-CuiCheckResult -Check 'Load specific debate' -Pass $false `
            -Detail 'No debates available to load'))
    }

    # Check 3: AI generation with debate context
    $GenSw = [System.Diagnostics.Stopwatch]::StartNew()
    $GenOk = $false
    try {
        $GenBody = @{ prompt = 'In one sentence, argue for AI regulation.'; maxTokens = 100 } | ConvertTo-Json -Compress
        $GenResp = Invoke-WebRequest -Uri "$BaseUrl/api/ai/generate" -Method POST `
            -Body $GenBody -ContentType 'application/json' -TimeoutSec 60 `
            -UseBasicParsing -ErrorAction Stop -Headers $AuthHeaders
        $GenOk = $GenResp.StatusCode -eq 200
        $GenJson = $GenResp.Content | ConvertFrom-Json
        if (-not ($GenJson.PSObject.Properties['text'] -and $GenJson.text.Length -gt 0)) {
            $GenOk = $false
        }
    } catch { }
    $GenSw.Stop()
    $Checks.Add((New-CuiCheckResult -Check 'AI generation with context' -Pass $GenOk `
        -Detail $(if ($GenOk) { 'Generated' } else { 'Generation failed' }) -Ms $GenSw.ElapsedMilliseconds))

    # Check 4: Save updated debate (PUT)
    $SaveOk = $false
    if ($DebateId -and $LoadOk) {
        $SaveSw = [System.Diagnostics.Stopwatch]::StartNew()
        try {
            $SaveResp = Invoke-WebRequest -Uri "$BaseUrl/api/debates" -Method PUT `
                -Body ($dr.Body | ConvertTo-Json -Depth 20 -Compress) -ContentType 'application/json' `
                -TimeoutSec $TimeoutSec -UseBasicParsing -ErrorAction Stop -Headers $AuthHeaders
            $SaveOk = $SaveResp.StatusCode -eq 200
        } catch { }
        $SaveSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Save debate (PUT)' -Pass $SaveOk `
            -Detail $(if ($SaveOk) { 'Saved' } else { 'Save failed (may need auth)' }) -Ms $SaveSw.ElapsedMilliseconds))
    } else {
        $Checks.Add((New-CuiCheckResult -Check 'Save debate (PUT)' -Pass $false `
            -Detail 'Skipped — no debate loaded'))
    }

    $Sw.Stop()
    New-CuiTestResult -CuiId 'CUI-DEB-002' -Domain 'Debate' -Priority 'P0' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
}
