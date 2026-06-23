# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiAdm001Ux {
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

    if (-not $ScreenshotDir) { $ScreenshotDir = New-UxScreenshotDir -CuiId 'CUI-ADM-001' }

    $Session = Connect-CdpSession -Port $CdpPort
    try {
        Invoke-UxNavigate -Session $Session -Url $BaseUrl
        Invoke-UxWaitForSelector -Session $Session -Selector '.toolbar' -TimeoutMs 10000 | Out-Null

        # Navigate to admin panel via toolbar
        $null = Invoke-UxEvaluate -Session $Session -Expression @"
(() => {
  const wraps = document.querySelectorAll('.toolbar-more-wrap .toolbar-icon, .toolbar-icon');
  for (const w of wraps) {
    if (w.closest('.toolbar-more-wrap')) { w.click(); return true; }
  }
  return false;
})()
"@
        Start-Sleep -Milliseconds 300

        $null = Invoke-UxEvaluate -Session $Session -Expression @"
(() => {
  const items = document.querySelectorAll('.toolbar-more-item');
  for (const item of items) {
    if (item.textContent?.toLowerCase().includes('admin') || item.textContent?.toLowerCase().includes('submissions')) {
      item.click(); return true;
    }
  }
  return false;
})()
"@
        Start-Sleep -Milliseconds 500

        # Check 1: Admin panel loads
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $adminOk = Invoke-UxWaitForSelector -Session $Session -Selector '.admin-panel' -TimeoutMs 5000
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Admin panel loads' -Pass $adminOk `
            -Detail $(if ($adminOk) { 'Admin panel visible' } else { 'Admin panel not found (may require admin auth)' }) -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'admin-panel.png')))

        # Check 2: Admin header present
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $headerOk = Invoke-UxElementExists -Session $Session -Selector '.admin-header'
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Admin header visible' -Pass $headerOk `
            -Detail $(if ($headerOk) { 'Header rendered' } else { 'No admin header' }) -Ms $CheckSw.ElapsedMilliseconds))

        # Check 3: Admin table or content area renders
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $contentOk = Invoke-UxElementExists -Session $Session -Selector '.admin-table, .admin-filter'
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Admin content renders' -Pass $contentOk `
            -Detail $(if ($contentOk) { 'Table/filter present' } else { 'No admin content' }) -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'admin-content.png')))

    } finally {
        Disconnect-CdpSession -Session $Session
    }

    $Sw.Stop()
    $Result = New-CuiTestResult -CuiId 'CUI-ADM-001' -Domain 'Admin' -Priority 'P0' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
    $Result | Add-Member -NotePropertyName Screenshots -NotePropertyValue $Screenshots.ToArray()
    $Result
}
