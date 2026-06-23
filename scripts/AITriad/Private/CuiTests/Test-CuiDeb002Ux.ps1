# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiDeb002Ux {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$BaseUrl,
        [Parameter()][int]$CdpPort = 9222,
        [Parameter()][string]$ScreenshotDir
    )

    Set-StrictMode -Version Latest
    $Sw = [System.Diagnostics.Stopwatch]::StartNew()
    $Checks = [System.Collections.Generic.List[PSObject]]::new()
    $Screenshots = [System.Collections.Generic.List[string]]::new()

    if (-not $ScreenshotDir) { $ScreenshotDir = New-UxScreenshotDir -CuiId 'CUI-DEB-002' }

    $Session = Connect-CdpSession -Port $CdpPort
    try {
        Invoke-UxNavigate -Session $Session -Url $BaseUrl
        Invoke-UxWaitForSelector -Session $Session -Selector '.toolbar' -TimeoutMs 10000 | Out-Null

        # Navigate to debate view
        Invoke-UxEvaluate -Session $Session -Expression @"
(() => {
  const items = document.querySelectorAll('.toolbar-more-item, .toolbar-icon');
  for (const item of items) {
    if (item.textContent?.toLowerCase().includes('debate') || item.title?.toLowerCase().includes('debate')) {
      item.click(); return true;
    }
  }
  return false;
})()
"@
        Start-Sleep -Milliseconds 500

        # Check 1: Existing debate sessions listed
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $sessionsOk = Invoke-UxWaitForSelector -Session $Session -Selector '.debate-session-item' -TimeoutMs 5000
        $sessionCount = 0
        if ($sessionsOk) {
            $sessionCount = Invoke-UxEvaluate -Session $Session -Expression "document.querySelectorAll('.debate-session-item').length"
        }
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Debate sessions listed' -Pass $sessionsOk `
            -Detail $(if ($sessionsOk) { "$sessionCount sessions" } else { 'No sessions found' }) -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'session-list.png')))

        # Check 2: Click a session to load it
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $loadOk = $false
        if ($sessionsOk) {
            try {
                Invoke-UxClick -Session $Session -Selector '.debate-session-item'
                Start-Sleep -Milliseconds 500
                $loadOk = Invoke-UxWaitForSelector -Session $Session -Selector '.debate-statement, .debate-action-bar' -TimeoutMs 5000
            } catch { $loadOk = $false }
        }
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Session loads on click' -Pass $loadOk `
            -Detail $(if ($loadOk) { 'Debate content loaded' } else { 'Session did not load' }) -Ms $CheckSw.ElapsedMilliseconds))

        # Check 3: Debate statements/responses visible
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $statementsOk = $false
        $statementCount = 0
        if ($loadOk) {
            $statementsOk = Invoke-UxElementExists -Session $Session -Selector '.debate-statement'
            if ($statementsOk) {
                $statementCount = Invoke-UxEvaluate -Session $Session -Expression "document.querySelectorAll('.debate-statement').length"
            }
        }
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Debate statements visible' -Pass $statementsOk `
            -Detail $(if ($statementsOk) { "$statementCount statements" } else { 'No statements rendered' }) -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'debate-statements.png')))

        # Check 4: Phase progress indicator present
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $phaseOk = Invoke-UxElementExists -Session $Session -Selector '.adaptive-phase-bar, .debate-progress-indicator'
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Phase progress visible' -Pass $phaseOk `
            -Detail $(if ($phaseOk) { 'Phase bar present' } else { 'No phase indicator' }) -Ms $CheckSw.ElapsedMilliseconds))

        # Check 5: Continue/next-round button accessible
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $continueOk = Invoke-UxElementExists -Session $Session -Selector '.debate-continue-btn, .debate-send-btn'
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Continue/send button accessible' -Pass $continueOk `
            -Detail $(if ($continueOk) { 'Round control available' } else { 'No round control button' }) -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'round-controls.png')))

    } finally {
        Disconnect-CdpSession -Session $Session
    }

    $Sw.Stop()
    $Result = New-CuiTestResult -CuiId 'CUI-DEB-002' -Domain 'Debate' -Priority 'P0' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
    $Result | Add-Member -NotePropertyName Screenshots -NotePropertyValue $Screenshots.ToArray()
    $Result
}
