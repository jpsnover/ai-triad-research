# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiAuth002Ux {
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

    if (-not $ScreenshotDir) { $ScreenshotDir = New-UxScreenshotDir -CuiId 'CUI-AUTH-002' }

    $Session = Connect-CdpSession -Port $CdpPort
    try {
        Invoke-UxNavigate -Session $Session -Url $BaseUrl
        Invoke-UxWaitForSelector -Session $Session -Selector '.toolbar' -TimeoutMs 10000 | Out-Null

        # Check 1: Auth button visible in toolbar
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $authBtnOk = Invoke-UxElementExists -Session $Session -Selector '.toolbar-auth-btn'
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Auth button visible' -Pass $authBtnOk `
            -Detail $(if ($authBtnOk) { 'Auth button in toolbar' } else { 'Auth button not found' }) -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'toolbar-auth.png')))

        # Check 2: Click auth button opens popover
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $popoverOk = $false
        if ($authBtnOk) {
            try {
                Invoke-UxClick -Session $Session -Selector '.toolbar-auth-btn'
                $popoverOk = Invoke-UxWaitForSelector -Session $Session -Selector '.toolbar-auth-popover' -TimeoutMs 3000
            } catch { $popoverOk = $false }
        }
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Auth popover opens' -Pass $popoverOk `
            -Detail $(if ($popoverOk) { 'Popover visible' } else { 'Popover did not open' }) -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'auth-popover.png')))

        # Check 3: Anonymous state shows sign-in options or anon banner
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        $stateOk = $false
        if ($popoverOk) {
            $anonBanner = Invoke-UxElementExists -Session $Session -Selector '.toolbar-auth-anon-banner'
            $identity = Invoke-UxElementExists -Session $Session -Selector '.toolbar-auth-identity'
            $stateOk = $anonBanner -or $identity
        }
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Auth state displayed' -Pass $stateOk `
            -Detail $(if ($anonBanner) { 'Anonymous mode' } elseif ($identity) { 'Authenticated user' } else { 'No auth state shown' }) -Ms $CheckSw.ElapsedMilliseconds))

        # Check 4: Read-only access — taxonomy data loads even when anonymous
        $CheckSw = [System.Diagnostics.Stopwatch]::StartNew()
        Invoke-UxClick -Session $Session -Selector '.toolbar-auth-btn' -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 300
        $dataOk = Invoke-UxElementExists -Session $Session -Selector '.node-item'
        $CheckSw.Stop()
        $Checks.Add((New-CuiCheckResult -Check 'Read-only data accessible' -Pass $dataOk `
            -Detail $(if ($dataOk) { 'Taxonomy nodes visible' } else { 'No data access' }) -Ms $CheckSw.ElapsedMilliseconds))
        $Screenshots.Add((Invoke-UxScreenshot -Session $Session -Path (Join-Path $ScreenshotDir 'read-only-access.png')))

    } finally {
        Disconnect-CdpSession -Session $Session
    }

    $Sw.Stop()
    $Result = New-CuiTestResult -CuiId 'CUI-AUTH-002' -Domain 'Auth' -Priority 'P0' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
    $Result | Add-Member -NotePropertyName Screenshots -NotePropertyValue $Screenshots.ToArray()
    $Result
}
