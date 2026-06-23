# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiDeb001Ux {
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

    if (-not $ScreenshotDir) { $ScreenshotDir = New-UxScreenshotDir -CuiId 'CUI-DEB-001' }

    $Session = Connect-CdpSession -Port $CdpPort
    try {
        Invoke-UxNavigate -Session $Session -Url $BaseUrl
        Invoke-UxWaitForSelector -Session $Session -Selector '.toolbar' -TimeoutMs 10000 | Out-Null

        # Check 1: Navigate to debate view via toolbar
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $debateViewOk = $false
        try {
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
            $debateViewOk = Invoke-UxWaitForSelector -Session $Session -Selector '.debate-session-list, .debate-action-bar, .two-column' -TimeoutMs 5000
        } catch { $debateViewOk = $false }
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Debate view accessible' -Pass $debateViewOk `
            -Detail $(if ($debateViewOk) { 'Debate workspace loaded' } else { 'Could not navigate to debate' }) -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'debate-view.png')))

        # Check 2: Debate session list visible
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $listOk = Invoke-UxWaitForSelector -Session $Session -Selector '.debate-session-list, .list-panel' -TimeoutMs 3000
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Session list panel visible' -Pass $listOk `
            -Detail $(if ($listOk) { 'Session list rendered' } else { 'No session list' }) -Ms $CheckSw.ElapsedMilliseconds))

        # Check 3: Debate input area available
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $inputOk = Invoke-UxElementExists -Session $Session -Selector '.debate-input, textarea.debate-input'
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Debate input area present' -Pass $inputOk `
            -Detail $(if ($inputOk) { 'Topic input available' } else { 'No input area found' }) -Ms $CheckSw.ElapsedMilliseconds))

        # Check 4: Debater toggle pills visible
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $pillsOk = Invoke-UxElementExists -Session $Session -Selector '.debate-debater-pill'
        $pillCount = 0
        if ($pillsOk) {
            $pillCount = Invoke-UxEvaluate -Session $Session -Expression "document.querySelectorAll('.debate-debater-pill').length"
        }
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Debater toggles visible' -Pass $pillsOk `
            -Detail $(if ($pillsOk) { "$pillCount debater pills" } else { 'No debater toggles' }) -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'debate-controls.png')))

        # Check 5: Send button present
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $sendOk = Invoke-UxElementExists -Session $Session -Selector '.debate-send-btn'
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Send button present' -Pass $sendOk `
            -Detail $(if ($sendOk) { 'Send button visible' } else { 'No send button' }) -Ms $CheckSw.ElapsedMilliseconds))

        # Check 6: Action bar layout complete
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $actionBarOk = Invoke-UxElementExists -Session $Session -Selector '.debate-action-bar'
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Action bar renders completely' -Pass $actionBarOk `
            -Detail $(if ($actionBarOk) { 'Action bar present' } else { 'No action bar' }) -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'action-bar.png')))

    } finally {
        Disconnect-CdpSession -Session $Session
    }

    $Sw.Stop()
    $Result = New-CuiTestResult -CuiId 'CUI-DEB-001' -Domain 'Debate' -Priority 'P0' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
    $Result | Add-Member -NotePropertyName Screenshots -NotePropertyValue $Screenshots.ToArray()
    $Result
}
