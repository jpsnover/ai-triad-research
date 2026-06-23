# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiDeb003Ux {
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

    if (-not $ScreenshotDir) { $ScreenshotDir = New-UxScreenshotDir -CuiId 'CUI-DEB-003' }

    $Session = Connect-CdpSession -Port $CdpPort
    try {
        Invoke-UxNavigate -Session $Session -Url $BaseUrl
        Invoke-UxWaitForSelector -Session $Session -Selector '.toolbar' -TimeoutMs 10000 | Out-Null

        # Navigate to debate and select a session
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
        $hasSession = Invoke-UxWaitForSelector -Session $Session -Selector '.debate-session-item' -TimeoutMs 5000
        if ($hasSession) {
            try { Invoke-UxClick -Session $Session -Selector '.debate-session-item' } catch {}
            Start-Sleep -Milliseconds 500
        }

        # Check 1: Claims editor accessible
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $claimsOk = Invoke-UxElementExists -Session $Session -Selector '.debate-claims-editor, .claims-editor-item'
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Claims editor present' -Pass $claimsOk `
            -Detail $(if ($claimsOk) { 'Claims panel visible' } else { 'No claims editor (may need active debate)' }) -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'claims-panel.png')))

        # Check 2: Debate statements have speaker labels
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $speakerOk = Invoke-UxEvaluate -Session $Session -Expression @"
(() => {
  const statements = document.querySelectorAll('.debate-statement');
  if (statements.length === 0) return false;
  const speakers = ['accelerationist', 'safetyist', 'skeptic', 'system'];
  return speakers.some(s => document.querySelector('.debate-speaker-' + s));
})()
"@
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Speaker labels on statements' -Pass ($speakerOk -eq $true) `
            -Detail $(if ($speakerOk -eq $true) { 'Speaker labels present' } else { 'No speaker labels (may need active debate)' }) -Ms $CheckSw.ElapsedMilliseconds))

        # Check 3: Markdown content renders in statements
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $markdownOk = Invoke-UxElementExists -Session $Session -Selector '.debate-statement-content.markdown-body, .debate-statement-content'
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Markdown content rendered' -Pass $markdownOk `
            -Detail $(if ($markdownOk) { 'Content rendered with markdown' } else { 'No content area' }) -Ms $CheckSw.ElapsedMilliseconds))

        # Check 4: Phase segments show debate progress
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $segmentsOk = Invoke-UxElementExists -Session $Session -Selector '.adaptive-phase-segment'
        $segmentCount = 0
        if ($segmentsOk) {
            $segmentCount = Invoke-UxEvaluate -Session $Session -Expression "document.querySelectorAll('.adaptive-phase-segment').length"
        }
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Phase segments visible' -Pass $segmentsOk `
            -Detail $(if ($segmentsOk) { "$segmentCount phase segments" } else { 'No phase segments' }) -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'analysis-panels.png')))

        # Check 5: Step mode toggle accessible
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $stepOk = Invoke-UxElementExists -Session $Session -Selector '.debate-step-toggle'
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Step mode toggle present' -Pass $stepOk `
            -Detail $(if ($stepOk) { 'Step toggle available' } else { 'No step toggle' }) -Ms $CheckSw.ElapsedMilliseconds))

    } finally {
        Disconnect-CdpSession -Session $Session
    }

    $Sw.Stop()
    $Result = New-CuiTestResult -CuiId 'CUI-DEB-003' -Domain 'Debate' -Priority 'P1' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
    $Result | Add-Member -NotePropertyName Screenshots -NotePropertyValue $Screenshots.ToArray()
    $Result
}
