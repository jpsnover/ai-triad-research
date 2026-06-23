# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiCal001Ux {
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

    if (-not $ScreenshotDir) { $ScreenshotDir = New-UxScreenshotDir -CuiId 'CUI-CAL-001' }

    $Session = Connect-CdpSession -Port $CdpPort
    try {
        Invoke-UxNavigate -Session $Session -Url $BaseUrl
        Invoke-UxWaitForSelector -Session $Session -Selector '.toolbar' -TimeoutMs 10000 | Out-Null

        # Navigate to calibration via toolbar
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
    if (item.textContent?.toLowerCase().includes('calibration') || item.textContent?.toLowerCase().includes('validation')) {
      item.click(); return true;
    }
  }
  return false;
})()
"@
        Start-Sleep -Milliseconds 500

        # Check 1: Calibration/validation view loads
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $calOk = Invoke-UxWaitForSelector -Session $Session -Selector '.validation-sidebar, .validation-claim-list, .validation-detail' -TimeoutMs 5000
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Calibration view loads' -Pass $calOk `
            -Detail $(if ($calOk) { 'Calibration panel visible' } else { 'Calibration view not found' }) -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'calibration-view.png')))

        # Check 2: Progress bar present
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $progressOk = Invoke-UxElementExists -Session $Session -Selector '.validation-progress-bar'
        $progressText = ''
        if ($progressOk) {
            $progressText = Invoke-UxGetText -Session $Session -Selector '.validation-progress-text'
        }
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Progress indicator present' -Pass $progressOk `
            -Detail $(if ($progressOk) { "Progress: $progressText" } else { 'No progress bar' }) -Ms $CheckSw.ElapsedMilliseconds))

        # Check 3: Filter controls accessible
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $filterOk = Invoke-UxElementExists -Session $Session -Selector '.validation-filters, .validation-filter-select'
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Filter controls accessible' -Pass $filterOk `
            -Detail $(if ($filterOk) { 'Filter selects present' } else { 'No filter controls' }) -Ms $CheckSw.ElapsedMilliseconds))

        # Check 4: Claim list renders
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $claimListOk = Invoke-UxElementExists -Session $Session -Selector '.validation-claim-list'
        $claimCount = 0
        if ($claimListOk) {
            $claimCount = Invoke-UxEvaluate -Session $Session -Expression @"
document.querySelectorAll('.validation-claim-list > div[class*=claim]').length
"@
        }
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Claim list renders' -Pass $claimListOk `
            -Detail $(if ($claimListOk) { "$claimCount claims listed" } else { 'No claim list' }) -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'claim-list.png')))

    } finally {
        Disconnect-CdpSession -Session $Session
    }

    $Sw.Stop()
    $Result = New-CuiTestResult -CuiId 'CUI-CAL-001' -Domain 'Calibration' -Priority 'P1' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
    $Result | Add-Member -NotePropertyName Screenshots -NotePropertyValue $Screenshots.ToArray()
    $Result
}
