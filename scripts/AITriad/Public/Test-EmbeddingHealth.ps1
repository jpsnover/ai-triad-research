# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-EmbeddingHealth {
    <#
    .SYNOPSIS
        Smoke-test POST /api/embeddings/compute on a deployed taxonomy-editor.
    .DESCRIPTION
        Diagnosing a semantic-search HTTP 500 (t/2784) needed a user to trigger search
        and capture a dump. This proactively probes the embedding endpoint: it establishes
        an anonymous session (AUTH_OPTIONAL cookie-less requests get the Sign-In
        interstitial — t/2684), POSTs a minimal `{ texts: [...] }` payload with an
        x-request-id it generates, and reports success/failure, HTTP status, duration, the
        returned vector dimensionality, and the requestId (usable with
        `Get-ServerLog -RequestId` to trace a failure server-side).

        Suitable for the session-start health suite alongside Test-TaxEditorHealth.
        No AI calls are made client-side (the server computes the embedding).
    .PARAMETER BaseUrl
        Deployed base URL. Default: module-resolved (Get-TaxEditorBaseUrl).
    .PARAMETER Backend
        ADVISORY. Forwarded as a `?backend=` hint. The /compute endpoint currently selects
        the embedding backend from server config, not per-request, so this does not change
        which backend runs today — it is reserved for forward-compat and echoed in output.
    .PARAMETER TimeoutSec
        Per-request timeout. Default 30 (the server caps compute at 50s).
    .OUTPUTS
        [PSCustomObject] Healthy, BaseUrl, Backend, StatusCode, DurationMs, VectorDims,
        RequestId, Error, Timestamp.
    .EXAMPLE
        Test-EmbeddingHealth
    .EXAMPLE
        $h = Test-EmbeddingHealth; if (-not $h.Healthy) { Get-ServerLog -RequestId $h.RequestId }
    .LINK
        Show-AITriadHelp
    .LINK
        Test-TaxEditorHealth
    .LINK
        Get-ServerLog
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param(
        [Parameter()]
        [string]$BaseUrl,

        [Parameter()]
        [string]$Backend,

        [Parameter()]
        [ValidateRange(1, 600)]
        [int]$TimeoutSec = 30
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    if (-not $BaseUrl) { $BaseUrl = Get-TaxEditorBaseUrl }
    $BaseUrl = $BaseUrl.TrimEnd('/')

    # Anon session so the cookie-less POST reaches the handler (not the interstitial).
    $Session = New-AnonymousWebSession -BaseUrl $BaseUrl -TimeoutSec $TimeoutSec
    if (-not $Session) {
        Write-Host '  (anonymous session not established — the probe may hit the auth interstitial)' -ForegroundColor DarkYellow
    }

    $RequestId = [guid]::NewGuid().ToString()
    $Path = '/api/embeddings/compute'
    if ($Backend) { $Path += "?backend=$([uri]::EscapeDataString($Backend))" }
    $BodyJson = '{"texts":["embedding health check"]}'

    $Params = @{
        BaseUrl               = $BaseUrl
        Path                  = $Path
        Method                = 'POST'
        Body                  = $BodyJson
        TimeoutSec            = $TimeoutSec
        AcceptableStatusCodes = @(200)
        ExtraHeaders          = @{ 'x-request-id' = $RequestId; 'Content-Type' = 'application/json' }
    }
    if ($Session) { $Params.Session = $Session }

    $Check = Invoke-RemoteCheck @Params

    # Success = 200 AND a non-empty vector came back (proves the compute path ran).
    $VectorDims = $null
    $HasVector  = $false
    if ($Check.Success -and $Check.Body -and $Check.Body.PSObject.Properties['vectors']) {
        $Vectors = @($Check.Body.vectors)
        if ($Vectors.Count -gt 0 -and $null -ne $Vectors[0]) {
            $VectorDims = @($Vectors[0]).Count
            $HasVector  = $VectorDims -gt 0
        }
    }
    $Healthy = [bool]($Check.Success -and $HasVector)

    $ErrText = $null
    if (-not $Healthy) {
        $ErrText = if ($Check.Error) { $Check.Error }
                   elseif (-not $Check.Success) { "HTTP $($Check.StatusCode)" }
                   else { 'no vectors in response' }
    }

    # ── Report ───────────────────────────────────────────────────────────────────
    $Icon  = if ($Healthy) { '[PASS]' } else { '[FAIL]' }
    $Color = if ($Healthy) { 'Green' } else { 'Red' }
    Write-Host "`nEmbedding Health — $BaseUrl" -ForegroundColor Cyan
    Write-Host "  $Icon POST /api/embeddings/compute — $($Check.StatusCode) $($Check.ResponseMs)ms$(if ($HasVector) { " (dims=$VectorDims)" })" -ForegroundColor $Color
    if (-not $Healthy) {
        Write-Host "        $ErrText" -ForegroundColor DarkRed
        Write-Host "        Trace: Get-ServerLog -RequestId $RequestId" -ForegroundColor DarkYellow
    }
    Write-Host ''

    [PSCustomObject]@{
        Healthy    = $Healthy
        BaseUrl    = $BaseUrl
        Backend    = if ($Backend) { $Backend } else { $null }
        StatusCode = $Check.StatusCode
        DurationMs = $Check.ResponseMs
        VectorDims = $VectorDims
        RequestId  = $RequestId
        Error      = $ErrText
        Timestamp  = (Get-Date).ToUniversalTime().ToString('o')
    }
}
