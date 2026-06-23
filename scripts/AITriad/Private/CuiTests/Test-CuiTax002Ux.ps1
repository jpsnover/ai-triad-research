# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiTax002Ux {
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

    if (-not $ScreenshotDir) { $ScreenshotDir = New-UxScreenshotDir -CuiId 'CUI-TAX-002' }

    $Session = Connect-CdpSession -Port $CdpPort
    try {
        Invoke-UxNavigate -Session $Session -Url $BaseUrl
        Invoke-UxWaitForSelector -Session $Session -Selector '.node-item' -TimeoutMs 10000 | Out-Null

        # Check 1: Click a node to open detail panel
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $detailOk = $false
        try {
            Invoke-UxClick -Session $Session -Selector '.node-item'
            $detailOk = Invoke-UxWaitForSelector -Session $Session -Selector '.node-detail-tabbed' -TimeoutMs 5000
        } catch { $detailOk = $false }
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Node click opens detail panel' -Pass $detailOk `
            -Detail $(if ($detailOk) { 'Detail panel visible' } else { 'Detail panel not found' }) -Ms $CheckSw.ElapsedMilliseconds))

        # Check 2: Node header shows label and ID
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $headerOk = $false
        if ($detailOk) {
            $labelExists = Invoke-UxElementExists -Session $Session -Selector '.nd-header-label'
            $idExists = Invoke-UxElementExists -Session $Session -Selector '.nd-header-id'
            $headerOk = $labelExists -and $idExists
        }
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Header shows label and ID' -Pass $headerOk `
            -Detail $(if ($headerOk) { 'Label and ID displayed' } else { 'Missing header elements' }) -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'node-detail.png')))

        # Check 3: Category badge is visible
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $catOk = Invoke-UxElementExists -Session $Session -Selector '.nd-header-cat'
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Category badge visible' -Pass $catOk `
            -Detail $(if ($catOk) { 'Category badge rendered' } else { 'No category badge' }) -Ms $CheckSw.ElapsedMilliseconds))

        # Check 4: Detail tabs are navigable
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $tabsExist = Invoke-UxElementExists -Session $Session -Selector '.node-detail-tabs'
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Detail tabs present' -Pass $tabsExist `
            -Detail $(if ($tabsExist) { 'Tabs rendered' } else { 'No detail tabs' }) -Ms $CheckSw.ElapsedMilliseconds))

        # Check 5: Tab content area renders
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $contentOk = Invoke-UxElementExists -Session $Session -Selector '.node-detail-tab-content'
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Tab content renders' -Pass $contentOk `
            -Detail $(if ($contentOk) { 'Content area visible' } else { 'No tab content' }) -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'detail-tabs.png')))

    } finally {
        Disconnect-CdpSession -Session $Session
    }

    $Sw.Stop()
    $Result = New-CuiTestResult -CuiId 'CUI-TAX-002' -Domain 'Taxonomy' -Priority 'P0' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
    $Result | Add-Member -NotePropertyName Screenshots -NotePropertyValue $Screenshots.ToArray()
    $Result
}
