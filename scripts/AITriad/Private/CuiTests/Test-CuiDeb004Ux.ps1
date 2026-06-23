# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiDeb004Ux {
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

    if (-not $ScreenshotDir) { $ScreenshotDir = New-UxScreenshotDir -CuiId 'CUI-DEB-004' }

    $Session = Connect-CdpSession -Port $CdpPort
    try {
        Invoke-UxNavigate -Session $Session -Url $BaseUrl
        Invoke-UxWaitForSelector -Session $Session -Selector '.toolbar' -TimeoutMs 10000 | Out-Null

        # Navigate to debate view
        $null = Invoke-UxEvaluate -Session $Session -Expression @"
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

        # Check 1: Debate session list loads
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $listOk = Invoke-UxWaitForSelector -Session $Session -Selector '.debate-session-item' -TimeoutMs 5000
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Debate session list loads' -Pass $listOk `
            -Detail $(if ($listOk) { 'Sessions listed' } else { 'No sessions found' }) -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'session-list.png')))

        # Check 2: Session metadata visible (phase badge, turn count, date)
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $metaOk = $false
        if ($listOk) {
            $phaseBadge = Invoke-UxElementExists -Session $Session -Selector '.debate-phase-badge'
            $turnCount = Invoke-UxElementExists -Session $Session -Selector '.debate-session-item-turns'
            $dateField = Invoke-UxElementExists -Session $Session -Selector '.debate-session-item-date'
            $metaOk = $phaseBadge -or $turnCount -or $dateField
        }
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Session metadata displayed' -Pass $metaOk `
            -Detail $(if ($metaOk) { 'Metadata fields present' } else { 'No metadata visible' }) -Ms $CheckSw.ElapsedMilliseconds))

        # Check 3: Click session to resume — content loads
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $resumeOk = $false
        if ($listOk) {
            try {
                Invoke-UxClick -Session $Session -Selector '.debate-session-item'
                Start-Sleep -Milliseconds 500
                $resumeOk = Invoke-UxWaitForSelector -Session $Session -Selector '.debate-statement, .debate-action-bar' -TimeoutMs 5000
            } catch { $resumeOk = $false }
        }
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Session resumes on click' -Pass $resumeOk `
            -Detail $(if ($resumeOk) { 'Debate content loaded' } else { 'Resume failed' }) -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'session-resumed.png')))

        # Check 4: Session title visible in header
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $titleOk = Invoke-UxElementExists -Session $Session -Selector '.debate-session-item-title, .debate-session-item.selected'
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Session title visible' -Pass $titleOk `
            -Detail $(if ($titleOk) { 'Title displayed' } else { 'No title element' }) -Ms $CheckSw.ElapsedMilliseconds))

        # Check 5: Edit actions accessible on session item
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $editOk = Invoke-UxElementExists -Session $Session -Selector '.debate-session-item-edit-actions'
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Edit actions accessible' -Pass $editOk `
            -Detail $(if ($editOk) { 'Edit actions present' } else { 'No edit actions (may require hover)' }) -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'edit-actions.png')))

    } finally {
        Disconnect-CdpSession -Session $Session
    }

    $Sw.Stop()
    $Result = New-CuiTestResult -CuiId 'CUI-DEB-004' -Domain 'Debate' -Priority 'P1' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
    $Result | Add-Member -NotePropertyName Screenshots -NotePropertyValue $Screenshots.ToArray()
    $Result
}
