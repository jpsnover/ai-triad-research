# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiAi001Ux {
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

    if (-not $ScreenshotDir) { $ScreenshotDir = New-UxScreenshotDir -CuiId 'CUI-AI-001' }

    $Session = Connect-CdpSession -Port $CdpPort
    try {
        Invoke-UxNavigate -Session $Session -Url $BaseUrl
        Invoke-UxWaitForSelector -Session $Session -Selector '.toolbar' -TimeoutMs 10000 | Out-Null

        # Check 1: Toolbar more-menu opens
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $menuOk = $false
        try {
            $null = Invoke-UxEvaluate -Session $Session -Expression @"
(() => {
  const wraps = document.querySelectorAll('.toolbar-more-wrap .toolbar-icon, .toolbar-icon');
  for (const w of wraps) {
    if (w.closest('.toolbar-more-wrap')) { w.click(); return true; }
  }
  return false;
})()
"@
            $menuOk = Invoke-UxWaitForSelector -Session $Session -Selector '.toolbar-more-popover' -TimeoutMs 3000
        } catch { $menuOk = $false }
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Tools menu opens' -Pass $menuOk `
            -Detail $(if ($menuOk) { 'More popover visible' } else { 'Could not open tools menu' }) -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'tools-menu.png')))

        # Check 2: AI-related menu items present
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $aiItemOk = $false
        if ($menuOk) {
            $aiItemOk = Invoke-UxEvaluate -Session $Session -Expression @"
(() => {
  const items = document.querySelectorAll('.toolbar-more-item');
  return Array.from(items).some(i =>
    i.textContent?.toLowerCase().includes('debate') ||
    i.textContent?.toLowerCase().includes('ai') ||
    i.textContent?.toLowerCase().includes('model'));
})()
"@
        }
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'AI-related menu items present' -Pass ($aiItemOk -eq $true) `
            -Detail $(if ($aiItemOk -eq $true) { 'AI options found in menu' } else { 'No AI menu items' }) -Ms $CheckSw.ElapsedMilliseconds))

        # Check 3: Navigate to debate for AI interaction
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $debateOk = $false
        try {
            $null = Invoke-UxEvaluate -Session $Session -Expression @"
(() => {
  const items = document.querySelectorAll('.toolbar-more-item');
  for (const item of items) {
    if (item.textContent?.toLowerCase().includes('debate')) { item.click(); return true; }
  }
  return false;
})()
"@
            Start-Sleep -Milliseconds 500
            $debateOk = Invoke-UxWaitForSelector -Session $Session -Selector '.debate-action-bar, .two-column' -TimeoutMs 5000
        } catch { $debateOk = $false }
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'AI workspace accessible' -Pass $debateOk `
            -Detail $(if ($debateOk) { 'Debate workspace loaded for AI' } else { 'Could not reach AI workspace' }) -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'ai-workspace.png')))

        # Check 4: Debate input for AI prompt entry
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $inputOk = Invoke-UxElementExists -Session $Session -Selector 'textarea.debate-input, .debate-input'
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'AI prompt input available' -Pass $inputOk `
            -Detail $(if ($inputOk) { 'Input field ready' } else { 'No prompt input' }) -Ms $CheckSw.ElapsedMilliseconds))

    } finally {
        Disconnect-CdpSession -Session $Session
    }

    $Sw.Stop()
    $Result = New-CuiTestResult -CuiId 'CUI-AI-001' -Domain 'AI' -Priority 'P0' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
    $Result | Add-Member -NotePropertyName Screenshots -NotePropertyValue $Screenshots.ToArray()
    $Result
}
