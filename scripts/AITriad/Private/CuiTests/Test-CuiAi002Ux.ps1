# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiAi002Ux {
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

    if (-not $ScreenshotDir) { $ScreenshotDir = New-UxScreenshotDir -CuiId 'CUI-AI-002' }

    $Session = Connect-CdpSession -Port $CdpPort
    try {
        Invoke-UxNavigate -Session $Session -Url $BaseUrl
        Invoke-UxWaitForSelector -Session $Session -Selector '.toolbar' -TimeoutMs 10000 | Out-Null

        # Check 1: Open tools menu
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
            -Detail $(if ($menuOk) { 'Popover visible' } else { 'Menu failed' }) -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'tools-menu.png')))

        # Check 2: Section labels present in menu
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $sectionsOk = $false
        if ($menuOk) {
            $sectionsOk = Invoke-UxElementExists -Session $Session -Selector '.toolbar-more-section-label'
        }
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Menu sections organized' -Pass $sectionsOk `
            -Detail $(if ($sectionsOk) { 'Section labels present' } else { 'No section labels' }) -Ms $CheckSw.ElapsedMilliseconds))

        # Check 3: Model/temperature settings accessible
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $settingsOk = Invoke-UxEvaluate -Session $Session -Expression @"
(() => {
  const items = document.querySelectorAll('.toolbar-more-item');
  return Array.from(items).some(i =>
    i.textContent?.toLowerCase().includes('settings') ||
    i.textContent?.toLowerCase().includes('temperature') ||
    i.textContent?.toLowerCase().includes('model'));
})()
"@
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'AI settings accessible' -Pass ($settingsOk -eq $true) `
            -Detail $(if ($settingsOk -eq $true) { 'Settings option found' } else { 'No settings option' }) -Ms $CheckSw.ElapsedMilliseconds))

        # Check 4: Quota/usage info in auth popover
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        Invoke-UxClick -Session $Session -Selector 'body' -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 300
        $quotaOk = $false
        try {
            Invoke-UxClick -Session $Session -Selector '.toolbar-auth-btn'
            Start-Sleep -Milliseconds 300
            $quotaOk = Invoke-UxElementExists -Session $Session -Selector '.toolbar-auth-quota'
        } catch { $quotaOk = $false }
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Quota info displayed' -Pass $quotaOk `
            -Detail $(if ($quotaOk) { 'Quota section visible' } else { 'No quota info (may require auth)' }) -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'ai-settings.png')))

    } finally {
        Disconnect-CdpSession -Session $Session
    }

    $Sw.Stop()
    $Result = New-CuiTestResult -CuiId 'CUI-AI-002' -Domain 'AI' -Priority 'P1' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
    $Result | Add-Member -NotePropertyName Screenshots -NotePropertyValue $Screenshots.ToArray()
    $Result
}
