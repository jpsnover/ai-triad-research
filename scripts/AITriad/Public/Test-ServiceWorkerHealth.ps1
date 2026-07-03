# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-ServiceWorkerHealth {
    <#
    .SYNOPSIS
        Fetches a deployed /sw.js and reports skipWaiting mode, clientsClaim,
        denylist coverage, navigateFallback, precache count, and a content hash.
    .DESCRIPTION
        Background: diagnosing t/1126 required manual curl + grep against
        production to assemble the SW config picture. This cmdlet collapses
        that workflow to one call and returns a structured pass/fail object.

        Key check: skipWaiting must be 'auto' (called inside the install/activate
        event). With registerType: 'prompt' on the client side, message-based
        skipWaiting is broken — the SW will install but never activate, and
        clients see stale assets indefinitely. The cmdlet flags this.
    .PARAMETER BaseUrl
        Target server URL. Defaults to current production.
    .PARAMETER ExpectedDenylist
        Regex patterns that MUST appear in the SW's navigateFallbackDenylist.
        Default protects auth + API routes from SPA-fallback hijacking.
    .PARAMETER Detailed
        Print the full precache manifest table to host (in addition to the
        structured ServiceWorkerHealth object).
    .PARAMETER TimeoutSec
        HTTP request timeout (1-60, default 15).
    .EXAMPLE
        Test-ServiceWorkerHealth
    .EXAMPLE
        Test-ServiceWorkerHealth -BaseUrl https://staging.example.com -Detailed
    .EXAMPLE
        # Verify additional patterns are gated against:
        Test-ServiceWorkerHealth -ExpectedDenylist @('\.auth', 'api', '/healthz', '/metrics')
    #>
    [CmdletBinding()]
    param(
        [Parameter(Position = 0)]
        [string]$BaseUrl = (Get-TaxEditorBaseUrl),

        [string[]]$ExpectedDenylist = @('\.auth', 'api'),

        [switch]$Detailed,

        [ValidateRange(1, 60)]
        [int]$TimeoutSec = 15
    )

    Set-StrictMode -Version Latest

    $BaseUrl = $BaseUrl.TrimEnd('/')
    $SwUrl   = "$BaseUrl/sw.js"
    $Result  = [ServiceWorkerHealth]::new()
    $Result.BaseUrl   = $BaseUrl
    $Result.Denylist  = @()
    $Result.MissingDenylist = @()
    $Result.PrecacheManifest = @()
    $Result.Checks    = @()

    # ── Fetch ────────────────────────────────────────────────
    $Body = $null
    try {
        $Resp = Invoke-WebRequest -Uri $SwUrl -Method Get `
            -TimeoutSec $TimeoutSec -UseBasicParsing -ErrorAction Stop `
            -Headers @{ 'Accept' = 'application/javascript, text/javascript, */*' }
        $Result.StatusCode = [int]$Resp.StatusCode
        $Result.FetchedOk  = ($Result.StatusCode -eq 200)
        $Body = if ($Resp.Content -is [byte[]]) { [System.Text.Encoding]::UTF8.GetString($Resp.Content) } else { [string]$Resp.Content }
        $Result.Bytes = if ($Body) { $Body.Length } else { 0 }
    } catch {
        $Result.StatusCode = 0
        if ($_.Exception.PSObject.Properties['Response'] -and $_.Exception.Response) {
            try { $Result.StatusCode = [int]$_.Exception.Response.StatusCode } catch { }
        }
        $Result.FetchedOk = $false
        $Result.Checks = @(
            [ServiceWorkerHealthCheck]@{ Name = 'fetched'; Pass = $false; Detail = $_.Exception.Message }
        )
        $Result.OverallPass = $false
        Write-Host ("SW Health Check — {0}" -f $BaseUrl) -ForegroundColor White
        Write-Host ("  Fetch failed: HTTP {0} — {1}" -f $Result.StatusCode, $_.Exception.Message) -ForegroundColor Red
        return $Result
    }

    # ── Hash ─────────────────────────────────────────────────
    $Sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $HashBytes = $Sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Body))
        $Result.Hash = -join ($HashBytes[0..3] | ForEach-Object { '{0:x2}' -f $_ })
    } finally { $Sha.Dispose() }

    # ── skipWaiting mode ─────────────────────────────────────
    # 'auto'    = skipWaiting() invoked unconditionally (install handler / top level)
    # 'message' = invoked only inside a message-event listener gated on SKIP_WAITING
    # 'none'    = no skipWaiting found
    # Detection: presence of a SKIP_WAITING message contract is the high-confidence
    # signal for 'message' mode (vite-plugin-pwa with registerType: 'prompt' always
    # emits it). When that's present, skipWaiting() in the file is gated even if it
    # also appears at top level. Pre-check whether skipWaiting is called at all.
    $HasSkipWaitingCall = $Body -match 'skipWaiting\s*\(\s*\)'
    # cmatch = case-sensitive: SKIP_WAITING is the message-contract constant,
    # distinct from the camelCase skipWaiting() function name.
    $HasMessageContract = $Body -cmatch 'SKIP_WAITING'
    $Result.SkipWaitingMode = if ($HasMessageContract) { 'message' }
                              elseif ($HasSkipWaitingCall) { 'auto' }
                              else { 'none' }

    # ── clientsClaim ─────────────────────────────────────────
    $Result.ClientsClaim = ($Body -match 'clientsClaim\s*\(\s*\)') -or
                           ($Body -match 'self\.clients\.claim\s*\(\s*\)')

    # ── navigateFallback ─────────────────────────────────────
    if ($Body -match "navigateFallback\s*:\s*[`"']([^`"']+)[`"']") {
        $Result.NavigateFallback = $Matches[1]
    }

    # ── navigateFallbackDenylist ─────────────────────────────
    $DenylistFound = @()
    if ($Body -match 'navigateFallbackDenylist\s*:\s*\[([^\]]*)\]') {
        $ArrBody = $Matches[1]
        # Extract regex literals (/.../[flags]) and string literals ('...' or "...")
        $Regexes = [regex]::Matches($ArrBody, '/((?:[^/\\]|\\.)+)/[gimsuy]*')
        $Strings = [regex]::Matches($ArrBody, "[`"']([^`"']+)[`"']")
        $DenylistFound += @($Regexes | ForEach-Object { $_.Groups[1].Value })
        $DenylistFound += @($Strings | ForEach-Object { $_.Groups[1].Value })
    }
    $Result.Denylist = @($DenylistFound)
    $Missing = [System.Collections.Generic.List[string]]::new()
    foreach ($Expected in $ExpectedDenylist) {
        $Hit = $false
        foreach ($Found in $DenylistFound) {
            if ($Found -match [regex]::Escape($Expected) -or $Expected -match [regex]::Escape($Found)) {
                $Hit = $true; break
            }
        }
        if (-not $Hit) { $Missing.Add($Expected) }
    }
    $Result.MissingDenylist = @($Missing)

    # ── Precache manifest ────────────────────────────────────
    # Workbox precache entries look like {"revision":"hash","url":"/path"} or
    # {url:"/path",revision:"hash"} (field order varies by build). Find any {...}
    # block in the body that has a url:"..." field — non-precache blocks won't
    # match because they don't carry that exact field shape.
    $PrecacheCount = 0
    $PrecacheEntries = @()
    $Blocks = [regex]::Matches($Body, '\{[^{}]*"url"\s*:\s*"[^"]+"[^{}]*\}')
    foreach ($B in $Blocks) {
        $block = $B.Value
        $url = $null; $rev = $null
        if ($block -match '"url"\s*:\s*"([^"]+)"') { $url = $Matches[1] }
        if ($block -match '"revision"\s*:\s*"([^"]*)"') { $rev = $Matches[1] }
        if ($url) {
            $PrecacheCount++
            $PrecacheEntries += [PSCustomObject]@{ Url = $url; Revision = $rev }
        }
    }
    $Result.PrecacheCount    = $PrecacheCount
    $Result.PrecacheManifest = @($PrecacheEntries)

    # ── Compose pass/fail checks ─────────────────────────────
    $Checks = [System.Collections.Generic.List[ServiceWorkerHealthCheck]]::new()
    $Checks.Add([ServiceWorkerHealthCheck]@{ Name='fetched';      Pass=$Result.FetchedOk; Detail="HTTP $($Result.StatusCode)" })
    $Checks.Add([ServiceWorkerHealthCheck]@{ Name='skipWaiting';  Pass=($Result.SkipWaitingMode -eq 'auto'); Detail=$Result.SkipWaitingMode })
    $Checks.Add([ServiceWorkerHealthCheck]@{ Name='clientsClaim'; Pass=$Result.ClientsClaim; Detail=$(if ($Result.ClientsClaim) { 'present' } else { 'missing' }) })
    $Checks.Add([ServiceWorkerHealthCheck]@{ Name='denylist';     Pass=(@($Result.MissingDenylist).Count -eq 0); Detail=$(if (@($Result.MissingDenylist).Count -eq 0) { 'all expected patterns present' } else { 'missing: ' + (($Result.MissingDenylist) -join ', ') }) })
    $Result.Checks = $Checks.ToArray()
    $Result.OverallPass = ($Checks | Where-Object { -not $_.Pass } | Measure-Object).Count -eq 0

    # ── Render ───────────────────────────────────────────────
    $Color     = $Result.OverallPass ? 'Green' : 'Yellow'
    $SkipColor = ($Result.SkipWaitingMode -eq 'auto') ? 'Green' : 'Yellow'
    $ClaimColor = $Result.ClientsClaim ? 'Green' : 'Yellow'
    $skipMark = ($Result.SkipWaitingMode -eq 'auto') ? 'OK' : 'WARN'
    $claimText = $Result.ClientsClaim ? 'present' : 'missing'
    Write-Host ("SW Health Check — {0}" -f $BaseUrl) -ForegroundColor White
    Write-Host ("  skipWaiting:     {0} [{1}]" -f $Result.SkipWaitingMode, $skipMark) -ForegroundColor $SkipColor
    Write-Host ("  clientsClaim:    {0}" -f $claimText) -ForegroundColor $ClaimColor
    if ($Result.Denylist.Count -gt 0) {
        $denyDisplay = (($Result.Denylist | ForEach-Object { $_ }) -join ', ')
        Write-Host ("  Denylist:        {0}" -f $denyDisplay) -ForegroundColor Gray
    }
    if (@($Result.MissingDenylist).Count -gt 0) {
        Write-Host ("  Missing patterns: {0}" -f (($Result.MissingDenylist) -join ', ')) -ForegroundColor Yellow
    }
    if ($Result.NavigateFallback) {
        Write-Host ("  Fallback:        {0}" -f $Result.NavigateFallback) -ForegroundColor Gray
    }
    Write-Host ("  Precached:       {0} assets" -f $Result.PrecacheCount) -ForegroundColor Gray
    Write-Host ("  Hash:            {0}" -f $Result.Hash) -ForegroundColor DarkGray
    Write-Host ("  OverallPass:     {0}" -f $Result.OverallPass) -ForegroundColor $Color

    if ($Detailed -and $Result.PrecacheManifest.Count -gt 0) {
        Write-Host ''
        Write-Host '  Precache manifest:' -ForegroundColor White
        $Result.PrecacheManifest | Format-Table Url, Revision -AutoSize | Out-Host
    }

    $Result
}
