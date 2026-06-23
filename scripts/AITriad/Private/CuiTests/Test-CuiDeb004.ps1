# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiDeb004 {
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
    $DebateId = "cui-save-test-$(Get-Date -Format 'yyyyMMddHHmmss')"

    # Check 1: PUT save a test debate
    $PutSw = [System.Diagnostics.Stopwatch]::StartNew()
    $SaveOk = $false
    try {
        $DebateObj = @{
            id         = $DebateId
            topic      = 'CUI save/resume test'
            transcript = @(
                @{ role = 'accelerationist'; content = 'Test turn 1' }
                @{ role = 'safetyist'; content = 'Test turn 2' }
            )
        } | ConvertTo-Json -Depth 4 -Compress
        $PutResp = Invoke-WebRequest -Uri "$BaseUrl/api/debates" -Method PUT `
            -Body $DebateObj -ContentType 'application/json' -TimeoutSec $TimeoutSec `
            -UseBasicParsing -ErrorAction Stop -Headers $AuthHeaders
        $SaveOk = $PutResp.StatusCode -eq 200
    } catch { }
    $PutSw.Stop()
    $Checks.Add((New-CuiCheckResult -Check 'Save debate (PUT)' -Pass $SaveOk `
        -Detail $(if ($SaveOk) { "Saved $DebateId" } else { 'Save failed (may need auth)' }) -Ms $PutSw.ElapsedMilliseconds))

    # Check 2: GET load the saved debate — verify it round-trips
    $GetSw = [System.Diagnostics.Stopwatch]::StartNew()
    $LoadOk = $false
    $TopicMatch = $false
    if ($SaveOk) {
        $gr = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path "/api/debates/$DebateId" -TimeoutSec $TimeoutSec
        $LoadOk = $gr.Success -and ($null -ne $gr.Body)
        if ($LoadOk -and $gr.Body.PSObject.Properties['topic']) {
            $TopicMatch = $gr.Body.topic -eq 'CUI save/resume test'
        }
        $GetSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Resume debate (GET)' -Pass $LoadOk `
            -Detail $(if ($TopicMatch) { 'Round-trip verified' } elseif ($LoadOk) { 'Loaded but topic mismatch' } else { "Failed: $($gr.Error)" }) -Ms $GetSw.ElapsedMilliseconds))
    } else {
        $GetSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Resume debate (GET)' -Pass $false `
            -Detail 'Skipped — save failed' -Ms 0))
    }

    # Check 3: Verify transcript is intact
    $TranscriptOk = $false
    if ($LoadOk -and $gr.Body.PSObject.Properties['transcript']) {
        $TranscriptOk = @($gr.Body.transcript).Count -ge 2
    }
    $Checks.Add((New-CuiCheckResult -Check 'Transcript intact after resume' -Pass $TranscriptOk `
        -Detail $(if ($TranscriptOk) { "$(@($gr.Body.transcript).Count) turns preserved" } elseif (-not $SaveOk) { 'Skipped — save failed' } else { 'Transcript missing or truncated' })))

    # Cleanup
    if ($SaveOk) {
        try {
            Invoke-WebRequest -Uri "$BaseUrl/api/debates/$DebateId" -Method DELETE `
                -TimeoutSec $TimeoutSec -UseBasicParsing -ErrorAction SilentlyContinue -Headers $AuthHeaders | Out-Null
        } catch { }
    }

    $Sw.Stop()
    New-CuiTestResult -CuiId 'CUI-DEB-004' -Domain 'Debate' -Priority 'P1' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
}
