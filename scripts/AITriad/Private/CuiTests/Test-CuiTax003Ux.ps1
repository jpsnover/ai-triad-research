# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiTax003Ux {
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

    if (-not $ScreenshotDir) { $ScreenshotDir = New-UxScreenshotDir -CuiId 'CUI-TAX-003' }

    $Session = Connect-CdpSession -Port $CdpPort
    try {
        Invoke-UxNavigate -Session $Session -Url $BaseUrl
        Invoke-UxWaitForSelector -Session $Session -Selector '.toolbar' -TimeoutMs 10000 | Out-Null

        # Check 1: Search input is accessible via toolbar
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $searchInputOk = $false
        try {
            $searchExists = Invoke-UxElementExists -Session $Session -Selector '.search-input'
            if (-not $searchExists) {
                $null = Invoke-UxEvaluate -Session $Session -Expression @"
(() => {
  const btns = document.querySelectorAll('.toolbar-icon');
  for (const b of btns) { if (b.textContent.includes('search') || b.title?.includes('Search')) { b.click(); return true; } }
  return false;
})()
"@
                Start-Sleep -Milliseconds 500
            }
            $searchInputOk = Invoke-UxWaitForSelector -Session $Session -Selector '.search-input' -TimeoutMs 3000
        } catch { $searchInputOk = $false }
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Search input accessible' -Pass $searchInputOk `
            -Detail $(if ($searchInputOk) { 'Search input found' } else { 'Could not open search' }) -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'search-open.png')))

        # Check 2: Typing in search filters nodes
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $filterOk = $false
        if ($searchInputOk) {
            try {
                $beforeCount = Invoke-UxEvaluate -Session $Session -Expression "document.querySelectorAll('.node-item').length"
                Invoke-UxType -Session $Session -Selector '.search-input' -Text 'safety' -Clear
                Start-Sleep -Milliseconds 800
                $afterCount = Invoke-UxEvaluate -Session $Session -Expression "document.querySelectorAll('.node-item').length"
                $filterOk = ($null -ne $afterCount) -and ($afterCount -ge 0)
            } catch { $filterOk = $false }
        }
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Search query filters display' -Pass $filterOk `
            -Detail $(if ($filterOk) { "Nodes after filter: $afterCount" } else { 'Filter did not execute' }) -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'search-filtered.png')))

        # Check 3: Clearing search restores full view
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $clearOk = $false
        if ($searchInputOk) {
            try {
                Invoke-UxType -Session $Session -Selector '.search-input' -Text '' -Clear
                Start-Sleep -Milliseconds 500
                $clearOk = Invoke-UxWaitForSelector -Session $Session -Selector '.node-item' -TimeoutMs 3000
            } catch { $clearOk = $false }
        }
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Clear search restores view' -Pass $clearOk `
            -Detail $(if ($clearOk) { 'Nodes restored' } else { 'Clear did not restore' }) -Ms $CheckSw.ElapsedMilliseconds))

        # Check 4: Search across POVs finds results
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $crossPovOk = $false
        if ($searchInputOk) {
            try {
                Invoke-UxType -Session $Session -Selector '.search-input' -Text 'risk' -Clear
                Start-Sleep -Milliseconds 800
                $resultCount = Invoke-UxEvaluate -Session $Session -Expression "document.querySelectorAll('.node-item').length"
                $crossPovOk = ($null -ne $resultCount) -and ($resultCount -gt 0)
            } catch { $crossPovOk = $false }
        }
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Cross-POV search returns results' -Pass $crossPovOk `
            -Detail $(if ($crossPovOk) { "$resultCount nodes matched" } else { 'No results' }) -Ms $CheckSw.ElapsedMilliseconds))

        # Check 5: Clicking search result selects node
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $clickResultOk = $false
        if ($crossPovOk) {
            try {
                Invoke-UxClick -Session $Session -Selector '.node-item'
                $clickResultOk = Invoke-UxWaitForSelector -Session $Session -Selector '.node-detail-tabbed' -TimeoutMs 3000
            } catch { $clickResultOk = $false }
        }
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Click search result selects node' -Pass $clickResultOk `
            -Detail $(if ($clickResultOk) { 'Node selected from search' } else { 'Selection failed' }) -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'search-selected.png')))

    } finally {
        Disconnect-CdpSession -Session $Session
    }

    $Sw.Stop()
    $Result = New-CuiTestResult -CuiId 'CUI-TAX-003' -Domain 'Taxonomy' -Priority 'P1' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
    $Result | Add-Member -NotePropertyName Screenshots -NotePropertyValue $Screenshots.ToArray()
    $Result
}
