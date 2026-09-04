# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.
#
# Shared PS wrapper over the Node fetch-CLI (lib/url-fetch/fetch-url-cli.mjs, t/3324) — the ONE
# PS-side external-URL fetch path for the WAF-fingerprint class (t/3312): Import-AITriadDocument
# (t/3310), Repair-PovLineage (t/3313), and New-OpEd's CLI path (t/3320) all route through here.
# Node's undici passes WAFs that block the .NET/PowerShell client fingerprint (t/3306), and the CLI
# reuses fetchUrlForPromptBinary's SSRF guards. File-based handoff: response bytes go to a temp --out
# file, metadata comes back as stdout JSON. Contract FROZEN to t/3324:
#   { status, contentType, finalUrl, error, bodySnippet }   (status 200 | HTTP code | null)
# Dot-sourced by AITriad.psm1 — do NOT export. This is the single allowlisted call site for the
# t/3314 WAF-fetch prevention guard.

function ConvertFrom-FetchCliOutput {
    <#
    .SYNOPSIS
        Pure parse of fetch-url-cli.mjs stdout → the frozen t/3324 contract object, or throw on
        unparseable output. Extracted so the contract mapping is unit-testable WITHOUT spawning node.
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param(
        [string]$Stdout,
        [string]$Stderr,
        [int]$ExitCode,
        [Parameter(Mandatory)][string]$OutPath,
        [string]$Url = ''
    )
    Set-StrictMode -Version Latest

    $meta = $null
    if (-not [string]::IsNullOrWhiteSpace($Stdout)) {
        try { $meta = $Stdout | ConvertFrom-Json } catch { $meta = $null }
    }
    if ($null -eq $meta) {
        Remove-Item -LiteralPath $OutPath -Force -ErrorAction SilentlyContinue
        throw (New-ActionableError -PassThru -ErrorType 'FetcherUnparseable' `
            -Goal "Fetch '$Url' via the shared Node fetcher" `
            -Problem "fetch-url-cli emitted no parseable JSON (exit $ExitCode): $($Stderr.Trim())" `
            -Location 'Get-UrlViaSharedFetcher' `
            -NextSteps @('Confirm node can run lib/url-fetch/fetch-url-cli.mjs', 'Retry, or supply local content'))
    }

    # Guarded property reads (StrictMode + ConvertFrom-Json).
    $get = { param($o, $n) if ($o.PSObject.Properties[$n]) { $o.$n } else { $null } }
    return [PSCustomObject]@{
        Status      = (& $get $meta 'status')        # 200 | HTTP code | $null (transport failure)
        ContentType = [string](& $get $meta 'contentType')
        FinalUrl    = [string](& $get $meta 'finalUrl')
        Error       = (& $get $meta 'error')          # $null on success
        BodySnippet = [string](& $get $meta 'bodySnippet')
        OutPath     = $OutPath                         # caller reads + deletes
        ExitCode    = $ExitCode
    }
}


function Get-UrlViaSharedFetcher {
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Url,

        [ValidateRange(1000, 600000)]
        [int]$TimeoutMs = 30000,

        [long]$MaxBytes = 0   # 0 => CLI default
    )

    Set-StrictMode -Version Latest

    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        throw (New-ActionableError -PassThru -ErrorType 'NodeMissing' `
            -Goal "Fetch '$Url' via the shared Node fetcher" `
            -Problem 'node was not found on PATH — the shared URL fetcher requires Node.js' `
            -Location 'Get-UrlViaSharedFetcher' `
            -NextSteps @('Install Node.js and ensure `node` is on PATH', 'Or supply local content instead of a URL'))
    }
    $cli = Join-Path (Get-CodeRoot) 'lib' 'url-fetch' 'fetch-url-cli.mjs'
    if (-not (Test-Path -LiteralPath $cli)) {
        throw (New-ActionableError -PassThru -ErrorType 'FetcherMissing' `
            -Goal "Fetch '$Url' via the shared Node fetcher" `
            -Problem "fetch-url-cli.mjs not found at '$cli'" `
            -Location 'Get-UrlViaSharedFetcher' `
            -NextSteps @('Confirm lib/url-fetch/fetch-url-cli.mjs is present (t/3324)'))
    }

    # Caller owns OutPath (reads bytes + deletes). $cliArgs, NOT $args ($args is an automatic variable).
    $outFile = [System.IO.Path]::GetTempFileName()
    $cliArgs = @($cli, $Url, '--out', $outFile, '--timeout-ms', [string]$TimeoutMs)
    if ($MaxBytes -gt 0) { $cliArgs += @('--max-bytes', [string]$MaxBytes) }

    $proc = [System.Diagnostics.Process]::new()
    $proc.StartInfo.FileName = $node.Source
    foreach ($a in $cliArgs) { $proc.StartInfo.ArgumentList.Add([string]$a) }
    $proc.StartInfo.UseShellExecute = $false
    $proc.StartInfo.RedirectStandardOutput = $true
    $proc.StartInfo.RedirectStandardError = $true
    $proc.StartInfo.WorkingDirectory = (Get-CodeRoot)
    $null = $proc.Start()
    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()
    $exit = $proc.ExitCode

    return (ConvertFrom-FetchCliOutput -Stdout $stdout -Stderr $stderr -ExitCode $exit -OutPath $outFile -Url $Url)
}
