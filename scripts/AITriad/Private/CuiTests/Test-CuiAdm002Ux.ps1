# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiAdm002Ux {
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

    if (-not $ScreenshotDir) { $ScreenshotDir = New-UxScreenshotDir -CuiId 'CUI-ADM-002' }

    $Session = Connect-CdpSession -Port $CdpPort
    try {
        Invoke-UxNavigate -Session $Session -Url $BaseUrl
        Invoke-UxWaitForSelector -Session $Session -Selector '.toolbar' -TimeoutMs 10000 | Out-Null

        # Navigate to admin
        Invoke-UxEvaluate -Session $Session -Expression @"
(() => {
  const wraps = document.querySelectorAll('.toolbar-more-wrap .toolbar-icon, .toolbar-icon');
  for (const w of wraps) { if (w.closest('.toolbar-more-wrap')) { w.click(); return true; } }
  return false;
})()
"@
        Start-Sleep -Milliseconds 300
        Invoke-UxEvaluate -Session $Session -Expression @"
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

        # Check 1: Admin panel renders
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $adminOk = Invoke-UxWaitForSelector -Session $Session -Selector '.admin-panel' -TimeoutMs 5000
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Admin panel loads' -Pass $adminOk `
            -Detail $(if ($adminOk) { 'Admin panel visible' } else { 'Not found (may require admin auth)' }) -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'admin-panel.png')))

        # Check 2: Filter controls present
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $filterOk = Invoke-UxElementExists -Session $Session -Selector '.admin-filter'
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Filter controls present' -Pass $filterOk `
            -Detail $(if ($filterOk) { 'Filter area rendered' } else { 'No filters' }) -Ms $CheckSw.ElapsedMilliseconds))

        # Check 3: Submission table renders
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $tableOk = Invoke-UxElementExists -Session $Session -Selector '.admin-table'
        $rowCount = 0
        if ($tableOk) {
            $rowCount = Invoke-UxEvaluate -Session $Session -Expression "document.querySelectorAll('.admin-submission-row').length"
        }
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Submission table renders' -Pass $tableOk `
            -Detail $(if ($tableOk) { "$rowCount submission rows" } else { 'No table' }) -Ms $CheckSw.ElapsedMilliseconds))

        # Check 4: Submission actions accessible
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $actionsOk = Invoke-UxElementExists -Session $Session -Selector '.admin-submission-actions'
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Submission actions accessible' -Pass $actionsOk `
            -Detail $(if ($actionsOk) { 'Action buttons present' } else { 'No actions (may need submissions)' }) -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'admin-table.png')))

    } finally {
        Disconnect-CdpSession -Session $Session
    }

    $Sw.Stop()
    $Result = New-CuiTestResult -CuiId 'CUI-ADM-002' -Domain 'Admin' -Priority 'P1' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
    $Result | Add-Member -NotePropertyName Screenshots -NotePropertyValue $Screenshots.ToArray()
    $Result
}
