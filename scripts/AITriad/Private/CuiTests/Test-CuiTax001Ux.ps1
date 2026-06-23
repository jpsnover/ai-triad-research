# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiTax001Ux {
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

    if (-not $ScreenshotDir) { $ScreenshotDir = New-UxScreenshotDir -CuiId 'CUI-TAX-001' }

    $Session = Connect-CdpSession -Port $CdpPort
    try {
        # Check 1: App loads with toolbar visible
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        Invoke-UxNavigate -Session $Session -Url $BaseUrl
        $toolbarVisible = Invoke-UxWaitForSelector -Session $Session -Selector '.toolbar' -TimeoutMs 10000
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'App loads with toolbar' -Pass $toolbarVisible `
            -Detail $(if ($toolbarVisible) { 'Toolbar rendered' } else { 'Toolbar not found within 10s' }) -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'app-loaded.png')))

        # Check 2: Tab bar renders with POV tabs
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $tabBarVisible = Invoke-UxWaitForSelector -Session $Session -Selector '.tab-bar' -TimeoutMs 5000
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Tab bar with POV tabs' -Pass $tabBarVisible `
            -Detail $(if ($tabBarVisible) { 'Tab bar visible' } else { 'Tab bar not found' }) -Ms $CheckSw.ElapsedMilliseconds))

        # Check 3: Taxonomy nodes render in tree
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $nodesVisible = Invoke-UxWaitForSelector -Session $Session -Selector '.node-item' -TimeoutMs 8000
        $CheckSw.Stop()
        $nodeCount = 0
        if ($nodesVisible) {
            $nodeCount = Invoke-UxEvaluate -Session $Session -Expression "document.querySelectorAll('.node-item').length"
        }
        $Checks.Add((New-CuiCheckResult -Check 'Taxonomy nodes rendered' -Pass ($nodesVisible -and $nodeCount -gt 0) `
            -Detail $(if ($nodesVisible) { "$nodeCount nodes visible" } else { 'No nodes rendered' }) -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'nodes-loaded.png')))

        # Check 4: Click a node item to select it
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $selectOk = $false
        try {
            Invoke-UxClick -Session $Session -Selector '.node-item'
            $selectOk = Invoke-UxWaitForSelector -Session $Session -Selector '.node-detail-tabbed' -TimeoutMs 5000
        } catch { $selectOk = $false }
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Node selection opens detail panel' -Pass $selectOk `
            -Detail $(if ($selectOk) { 'Detail panel opened' } else { 'Detail panel not found after click' }) -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'node-selected.png')))

        # Check 5: Switch POV tab
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $tabSwitchOk = $false
        try {
            $tabCount = Invoke-UxEvaluate -Session $Session -Expression "document.querySelectorAll('.tab-bar button[data-tab]').length"
            if ($tabCount -gt 1) {
                Invoke-UxClick -Session $Session -Selector '.tab-bar button[data-tab]:nth-child(2)'
                Start-Sleep -Milliseconds 500
                $tabSwitchOk = Invoke-UxWaitForSelector -Session $Session -Selector '.node-item' -TimeoutMs 5000
            }
        } catch { $tabSwitchOk = $false }
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Switch POV tab loads nodes' -Pass $tabSwitchOk `
            -Detail $(if ($tabSwitchOk) { 'Tab switched, nodes loaded' } else { 'Tab switch failed' }) -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'tab-switched.png')))

    } finally {
        Disconnect-CdpSession -Session $Session
    }

    $Sw.Stop()
    $Result = New-CuiTestResult -CuiId 'CUI-TAX-001' -Domain 'Taxonomy' -Priority 'P0' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
    $Result | Add-Member -NotePropertyName Screenshots -NotePropertyValue $Screenshots.ToArray()
    $Result
}
