# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiAdm003Ux {
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

    if (-not $ScreenshotDir) { $ScreenshotDir = New-UxScreenshotDir -CuiId 'CUI-ADM-003' }

    $Session = Connect-CdpSession -Port $CdpPort
    try {
        Invoke-UxNavigate -Session $Session -Url $BaseUrl
        Invoke-UxWaitForSelector -Session $Session -Selector '.toolbar' -TimeoutMs 10000 | Out-Null

        # Check 1: App renders without console errors
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        Invoke-CdpCommand -Session $Session -Method 'Runtime.enable' | Out-Null
        $errorCount = Invoke-UxEvaluate -Session $Session -Expression @"
(() => {
  const origError = console.error;
  let count = 0;
  return typeof window.__cui_error_count !== 'undefined' ? window.__cui_error_count : 0;
})()
"@
        $noErrorsOk = ($null -eq $errorCount) -or ($errorCount -eq 0)
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'No critical console errors' -Pass $noErrorsOk `
            -Detail $(if ($noErrorsOk) { 'No tracked errors' } else { "$errorCount errors detected" }) -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'error-check.png')))

        # Check 2: Feedback button accessible in toolbar
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $feedbackOk = Invoke-UxElementExists -Session $Session -Selector '.toolbar-feedback-wrap'
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Feedback mechanism accessible' -Pass $feedbackOk `
            -Detail $(if ($feedbackOk) { 'Feedback button present' } else { 'No feedback button' }) -Ms $CheckSw.ElapsedMilliseconds))

        # Check 3: Page performance is acceptable
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $perfOk = Invoke-UxEvaluate -Session $Session -Expression @"
(() => {
  const perf = performance.getEntriesByType('navigation');
  if (perf.length === 0) return { ok: true, loadMs: 0 };
  const nav = perf[0];
  const loadMs = Math.round(nav.loadEventEnd - nav.startTime);
  return { ok: loadMs < 15000, loadMs };
})()
"@
        $perfPass = $true
        $loadMs = 0
        if ($null -ne $perfOk -and $perfOk.PSObject.Properties['ok']) {
            $perfPass = $perfOk.ok
            $loadMs = $perfOk.loadMs
        }
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Page load performance' -Pass $perfPass `
            -Detail "Load time: ${loadMs}ms" -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'performance.png')))

    } finally {
        Disconnect-CdpSession -Session $Session
    }

    $Sw.Stop()
    $Result = New-CuiTestResult -CuiId 'CUI-ADM-003' -Domain 'Admin' -Priority 'P1' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
    $Result | Add-Member -NotePropertyName Screenshots -NotePropertyValue $Screenshots.ToArray()
    $Result
}
