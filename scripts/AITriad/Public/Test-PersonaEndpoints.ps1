# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-PersonaEndpoints {
    <#
    .SYNOPSIS
        Auth-gate regression matrix: hits critical API endpoints as each user
        persona and reports pass/fail per cell.
    .DESCRIPTION
        Background: t/1062, t/1063, t/1064 all shared the same anti-pattern —
        an auth gate was added that correctly restricted access but wasn't
        verified against all personas. A regular run of this matrix would
        catch that class of regression.

        Each cell tests "did the actual access (2xx vs 401/403) match the
        expected access for this persona?" Pass means the auth gate behaved
        as designed. Fail means either:
          - A gate was added that's too tight (operator getting 401/403 they
            shouldn't), or
          - A gate was removed that's too loose (operator getting 200 they
            shouldn't).

        Persona auth model:
          - anonymous     — no auth headers; always testable
          - authenticated — requires X-Test-Persona header support (server t/1125)
          - admin         — same; persona name must be in ADMIN_USERS

        Without -PersonaSecret, only the anonymous row runs and the
        authenticated/admin rows are marked 'skipped: needs server t/1125'.
        Once ServerAPI ships t/1125, set -PersonaSecret (or read from
        $env:TEST_PERSONA_SECRET) to enable the full matrix.
    .PARAMETER BaseUrl
        Target server URL.
    .PARAMETER Persona
        Test only the named persona(s). Default: all three.
    .PARAMETER Category
        Test only endpoints in this category. Default: all.
    .PARAMETER PersonaSecret
        Shared secret matching the server's TEST_PERSONA_SECRET. Enables
        admin/authenticated rows. Defaults to $env:TEST_PERSONA_SECRET.
    .PARAMETER Detailed
        Print a side-by-side matrix to host (in addition to the structured
        result objects).
    .PARAMETER TimeoutSec
        HTTP request timeout (1-60, default 15).
    .EXAMPLE
        Test-PersonaEndpoints
    .EXAMPLE
        # Once server t/1125 is in place:
        $env:TEST_PERSONA_SECRET = '<secret-from-vault>'
        Test-PersonaEndpoints -Detailed
    .EXAMPLE
        Test-PersonaEndpoints -Category Admin | Where-Object { -not $_.Pass }
    .EXAMPLE
        Test-PersonaEndpoints -Persona anonymous
    #>
    [CmdletBinding()]
    param(
        [Parameter(Position = 0)]
        [string]$BaseUrl = (Get-TaxEditorBaseUrl),

        [ValidateSet('anonymous', 'authenticated', 'admin')]
        [string[]]$Persona = @('anonymous', 'authenticated', 'admin'),

        [ValidateSet('AI', 'Data', 'Admin', 'Debug')]
        [string[]]$Category,

        [string]$PersonaSecret = $env:TEST_PERSONA_SECRET,

        [switch]$Detailed,

        [ValidateRange(1, 60)]
        [int]$TimeoutSec = 15
    )

    Set-StrictMode -Version Latest

    $BaseUrl = $BaseUrl.TrimEnd('/')

    # ── Endpoint × persona expectation table ─────────────────
    # Body shapes are minimal smoke payloads; we only care about the auth-gate
    # response, not the success-path data path.
    $Endpoints = @(
        @{ Method = 'POST'; Path = '/api/ai/generate';                            Cat = 'AI';
           Body = @{ prompt = 'noop'; maxTokens = 1 };
           Expected = @{ admin = $true; authenticated = $true; anonymous = $true } }
        @{ Method = 'POST'; Path = '/api/embeddings/compute';                     Cat = 'AI';
           Body = @{ texts = @('noop') };
           Expected = @{ admin = $true; authenticated = $true; anonymous = $true } }
        @{ Method = 'GET';  Path = '/api/flight-recorder/download-merged/none';   Cat = 'Debug';
           Body = $null;
           Expected = @{ admin = $true; authenticated = $false; anonymous = $false } }
        @{ Method = 'POST'; Path = '/api/flight-recorder/server-dump';            Cat = 'Debug';
           Body = @{ reason = 'persona-matrix' };
           Expected = @{ admin = $true; authenticated = $false; anonymous = $false } }
        @{ Method = 'GET';  Path = '/api/admin/review/stats';                     Cat = 'Admin';
           Body = $null;
           Expected = @{ admin = $true; authenticated = $false; anonymous = $false } }
        @{ Method = 'GET';  Path = '/api/taxonomy/accelerationist';               Cat = 'Data';
           Body = $null;
           Expected = @{ admin = $true; authenticated = $true; anonymous = $true } }
        @{ Method = 'POST'; Path = '/api/debates';                                Cat = 'Data';
           Body = @{ title = 'persona-matrix' };
           Expected = @{ admin = $true; authenticated = $true; anonymous = $true } }
    )

    if ($Category) {
        $Endpoints = @($Endpoints | Where-Object { $_.Cat -in $Category })
    }

    $Results = [System.Collections.Generic.List[PersonaEndpointTestResult]]::new()

    foreach ($Pers in $Persona) {
        $NeedsPersonaSecret = ($Pers -ne 'anonymous')
        $PersonaSkipNote = $null
        if ($NeedsPersonaSecret -and [string]::IsNullOrWhiteSpace($PersonaSecret)) {
            $PersonaSkipNote = 'skipped: no PersonaSecret — needs server t/1125 + $env:TEST_PERSONA_SECRET'
        }

        foreach ($Ep in $Endpoints) {
            $Expected = [bool]$Ep.Expected[$Pers]
            $R = [PersonaEndpointTestResult]::new()
            $R.Persona        = $Pers
            $R.Method         = $Ep.Method
            $R.Endpoint       = $Ep.Path
            $R.Category       = $Ep.Cat
            $R.ExpectedAccess = $Expected

            if ($PersonaSkipNote) {
                $R.Pass = $false
                $R.Note = $PersonaSkipNote
                $Results.Add($R)
                continue
            }

            Write-Verbose "[$Pers] $($Ep.Method) $($Ep.Path)"

            $Params = @{
                BaseUrl               = $BaseUrl
                Path                  = $Ep.Path
                Method                = $Ep.Method
                TimeoutSec            = $TimeoutSec
                AcceptableStatusCodes = @(200, 201, 204, 401, 403)
            }
            if ($null -ne $Ep.Body) { $Params.Body = $Ep.Body }
            if ($NeedsPersonaSecret) {
                $Params.ExtraHeaders = @{
                    'X-Test-Persona'        = $Pers
                    'X-Test-Persona-Secret' = $PersonaSecret
                }
            }

            $Check = Invoke-RemoteCheck @Params

            $Http2xx = ($Check.StatusCode -ge 200 -and $Check.StatusCode -lt 300)

            # t/1355 — classify the response body so we can distinguish "real API grant"
            # from "SPA-shell fall-through". A 2xx that returns text/html with a page shape
            # (DOCTYPE + Sign-In title) is the sign-in page, not real access — the request
            # never reached the intended handler.
            $CT = if ($Check.PSObject.Properties['ContentType']) { [string]$Check.ContentType } else { '' }
            $RawBody = if ($Check.PSObject.Properties['RawBody']) { [string]$Check.RawBody } else { '' }
            $IsHtml = $CT -match '^text/html'
            $IsShell = $IsHtml -and (
                ($RawBody -match '(?i)<title>\s*Sign In') -or
                ($RawBody -match '(?i)<!DOCTYPE\s+html')
            )
            $BodyKind = if ($null -ne $Check.Body) { 'json' }
                        elseif ($IsHtml)          { 'html' }
                        elseif ([string]::IsNullOrEmpty($RawBody)) { 'empty' }
                        else                      { 'unparsed' }

            # SPA-shell soft-pass — only applies when the persona was NOT expected to have
            # access, we got 2xx, and the body is the shell (not real data). The request
            # fell through to the sign-in page; the auth-gate contract is honored.
            # A 2xx with real JSON and ExpectedAccess=false STILL hard-fails — that's the
            # critical property this refinement must not break.
            $ActualAccess = $Http2xx
            $ShellNote = $null
            if (-not $Expected -and $Http2xx -and $IsShell) {
                $ActualAccess = $false
                $ShellNote = '200-but-SPA-shell — request fell through to sign-in page, no data leak'
            }

            $R.ActualAccess = $ActualAccess
            $R.Pass         = ($Expected -eq $ActualAccess)
            $R.StatusCode   = $Check.StatusCode
            $R.ContentType  = $CT
            $R.BodyKind     = $BodyKind
            $R.Ms           = $Check.ResponseMs
            $R.Error        = $Check.Error
            if ($ShellNote) { $R.Note = $ShellNote }
            $Results.Add($R)
        }
    }

    if ($Detailed) {
        $PersonaList = @($Persona | Sort-Object -Unique)
        $EndpointList = @($Endpoints | ForEach-Object { "$($_.Method) $($_.Path)" } | Select-Object -Unique)
        $PathWidth = [Math]::Min(48, ([Math]::Max(20, ($EndpointList | Measure-Object Length -Maximum).Maximum)))

        # Note: '-f' binds tighter than '+' — using string interpolation for the
        # width so the whole format string is one literal, not `'X' + $w + ('}' -f ...)`
        # which throws "Format item ends prematurely" (DevOps p/169#4).
        $Header = "  {0,-$PathWidth}" -f 'Endpoint'
        foreach ($P in $PersonaList) { $Header += ('  {0,-13}' -f $P) }
        Write-Host ''
        Write-Host $Header -ForegroundColor White
        Write-Host (('  ' + ('-' * $PathWidth)) + ('  ' + ('-' * 13)) * $PersonaList.Count) -ForegroundColor DarkGray

        foreach ($Ep in $Endpoints) {
            $Label = "$($Ep.Method) $($Ep.Path)"
            if ($Label.Length -gt $PathWidth) { $Label = $Label.Substring(0, $PathWidth - 1) + '…' }
            $Line = "  {0,-$PathWidth}" -f $Label
            $Color = 'Gray'
            foreach ($P in $PersonaList) {
                $Cell = @($Results | Where-Object { $_.Persona -eq $P -and $_.Endpoint -eq $Ep.Path })[0]
                if (-not $Cell) { $Line += '  {0,-13}' -f '-'; continue }
                $Mark = if ($Cell.Note) { 'skip' }
                        elseif ($Cell.Pass) { if ($Cell.ExpectedAccess) { 'OK (200)' } else { 'OK (gated)' } }
                        else { "FAIL ($($Cell.StatusCode))" }
                $Line += '  {0,-13}' -f $Mark
                if (-not $Cell.Pass -and -not $Cell.Note) { $Color = 'Red' }
            }
            Write-Host $Line -ForegroundColor $Color
        }
        Write-Host ''
    }

    $Total = @($Results).Count
    $Passed = @($Results | Where-Object { $_.Pass }).Count
    $Failed = @($Results | Where-Object { -not $_.Pass -and -not $_.Note }).Count
    $Skipped = @($Results | Where-Object { $_.Note }).Count
    $Color = if ($Failed -eq 0) { 'Green' } else { 'Red' }
    Write-Host ("Persona matrix: {0}/{1} pass, {2} fail, {3} skipped" -f $Passed, $Total, $Failed, $Skipped) -ForegroundColor $Color

    @($Results)
}
