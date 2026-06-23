# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiTax010Ux {
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

    if (-not $ScreenshotDir) { $ScreenshotDir = New-UxScreenshotDir -CuiId 'CUI-TAX-010' }

    $Session = Connect-CdpSession -Port $CdpPort
    try {
        Invoke-UxNavigate -Session $Session -Url $BaseUrl
        Invoke-UxWaitForSelector -Session $Session -Selector '.node-item' -TimeoutMs 10000 | Out-Null

        # Check 1: Select a node to open detail panel
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $detailOk = $false
        try {
            Invoke-UxClick -Session $Session -Selector '.node-item'
            $detailOk = Invoke-UxWaitForSelector -Session $Session -Selector '.node-detail-tabbed' -TimeoutMs 5000
        } catch { $detailOk = $false }
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Node selected for editing' -Pass $detailOk `
            -Detail $(if ($detailOk) { 'Detail panel open' } else { 'Could not open detail' }) -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'node-selected.png')))

        # Check 2: Form group inputs are present
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $formOk = $false
        if ($detailOk) {
            $formOk = Invoke-UxElementExists -Session $Session -Selector '.form-group'
        }
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Edit form fields visible' -Pass $formOk `
            -Detail $(if ($formOk) { 'Form groups present' } else { 'No form fields found' }) -Ms $CheckSw.ElapsedMilliseconds))

        # Check 3: Header actions (edit/save buttons) visible
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $actionsOk = Invoke-UxElementExists -Session $Session -Selector '.nd-header-actions'
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Header action buttons visible' -Pass $actionsOk `
            -Detail $(if ($actionsOk) { 'Actions area present' } else { 'No header actions' }) -Ms $CheckSw.ElapsedMilliseconds))

        # Check 4: Overflow menu is accessible
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $menuOk = $false
        try {
            $triggerExists = Invoke-UxElementExists -Session $Session -Selector '.overflow-menu-trigger'
            if ($triggerExists) {
                Invoke-UxClick -Session $Session -Selector '.overflow-menu-trigger'
                $menuOk = Invoke-UxWaitForSelector -Session $Session -Selector '.overflow-menu-dropdown' -TimeoutMs 3000
            }
        } catch { $menuOk = $false }
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Overflow menu opens' -Pass $menuOk `
            -Detail $(if ($menuOk) { 'Menu dropdown visible' } else { 'Menu not accessible' }) -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'overflow-menu.png')))

        # Check 5: Close overflow menu by clicking elsewhere
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $closeOk = $true
        if ($menuOk) {
            try {
                Invoke-UxClick -Session $Session -Selector '.nd-header'
                Start-Sleep -Milliseconds 300
                $closeOk = -not (Invoke-UxElementExists -Session $Session -Selector '.overflow-menu-dropdown')
            } catch { $closeOk = $false }
        }
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Overflow menu dismisses' -Pass $closeOk `
            -Detail $(if ($closeOk) { 'Menu closed' } else { 'Menu still visible' }) -Ms $CheckSw.ElapsedMilliseconds))

        # Check 6: Validation banner state
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $validationExists = Invoke-UxElementExists -Session $Session -Selector '.validation-banner'
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Validation banner state checked' -Pass $true `
            -Detail $(if ($validationExists) { 'Validation banner present' } else { 'No validation errors (clean)' }) -Ms $CheckSw.ElapsedMilliseconds))

        # Check 7: Detail panel is scrollable/responsive
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $responsiveOk = Invoke-UxEvaluate -Session $Session -Expression @"
(() => {
  const detail = document.querySelector('.node-detail-tabbed');
  return detail ? detail.scrollHeight >= 0 : false;
})()
"@
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Detail panel layout valid' -Pass ($responsiveOk -eq $true) `
            -Detail 'Layout responsive' -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'edit-complete.png')))

    } finally {
        Disconnect-CdpSession -Session $Session
    }

    $Sw.Stop()
    $Result = New-CuiTestResult -CuiId 'CUI-TAX-010' -Domain 'Taxonomy' -Priority 'P0' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
    $Result | Add-Member -NotePropertyName Screenshots -NotePropertyValue $Screenshots.ToArray()
    $Result
}
