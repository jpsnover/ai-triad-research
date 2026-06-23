# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiCom001Ux {
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

    if (-not $ScreenshotDir) { $ScreenshotDir = New-UxScreenshotDir -CuiId 'CUI-COM-001' }

    $Session = Connect-CdpSession -Port $CdpPort
    try {
        Invoke-UxNavigate -Session $Session -Url $BaseUrl
        Invoke-UxWaitForSelector -Session $Session -Selector '.toolbar' -TimeoutMs 10000 | Out-Null

        # Navigate to community via toolbar
        $null = Invoke-UxEvaluate -Session $Session -Expression @"
(() => {
  const wraps = document.querySelectorAll('.toolbar-more-wrap .toolbar-icon, .toolbar-icon');
  for (const w of wraps) { if (w.closest('.toolbar-more-wrap')) { w.click(); return true; } }
  return false;
})()
"@
        Start-Sleep -Milliseconds 300
        $null = Invoke-UxEvaluate -Session $Session -Expression @"
(() => {
  const items = document.querySelectorAll('.toolbar-more-item');
  for (const item of items) {
    if (item.textContent?.toLowerCase().includes('community') || item.textContent?.toLowerCase().includes('library')) {
      item.click(); return true;
    }
  }
  return false;
})()
"@
        Start-Sleep -Milliseconds 500

        # Check 1: Community library loads
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $communityOk = Invoke-UxWaitForSelector -Session $Session -Selector '.community-library, .community-grid, .community-tabs' -TimeoutMs 5000
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Community library loads' -Pass $communityOk `
            -Detail $(if ($communityOk) { 'Community view visible' } else { 'Community library not found' }) -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'community-library.png')))

        # Check 2: Tab navigation (debates/chats)
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $tabsOk = Invoke-UxElementExists -Session $Session -Selector '.list-view-tab, .community-tabs button'
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Content tabs present' -Pass $tabsOk `
            -Detail $(if ($tabsOk) { 'Tab navigation visible' } else { 'No tabs found' }) -Ms $CheckSw.ElapsedMilliseconds))

        # Check 3: Community cards or content grid renders
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $cardsOk = Invoke-UxElementExists -Session $Session -Selector '.community-card, .community-grid, .community-empty'
        $cardCount = 0
        if ($cardsOk) {
            $cardCount = Invoke-UxEvaluate -Session $Session -Expression "document.querySelectorAll('.community-card').length"
        }
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Content area renders' -Pass $cardsOk `
            -Detail $(if ($cardCount -gt 0) { "$cardCount community items" } elseif ($cardsOk) { 'Grid rendered (empty)' } else { 'No content area' }) -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'community-content.png')))

    } finally {
        Disconnect-CdpSession -Session $Session
    }

    $Sw.Stop()
    $Result = New-CuiTestResult -CuiId 'CUI-COM-001' -Domain 'Community' -Priority 'P1' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
    $Result | Add-Member -NotePropertyName Screenshots -NotePropertyValue $Screenshots.ToArray()
    $Result
}
