# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Extracted for t/3856 (the Install-GraphDatabase Step 6b credential-verification repair).
#
# Step 6b previously verified a just-created Neo4j container's credential by calling
# Invoke-CypherQuery -ErrorAction Stop and checking for a thrown exception.
# Invoke-CypherQuery.ps1 catches its own HTTP/auth exceptions internally (Write-Fail + a bare
# return, never rethrows), so -ErrorAction Stop at that call site was a no-op -- no exception
# ever propagated, so the probe reported "verified" whether authentication succeeded, failed
# (401), or the database was unreachable. This function calls Invoke-RestMethod directly so a
# real exception reaches this function's own try/catch, where it is actually caught.
#
# Does NOT fix Invoke-CypherQuery itself (t/3855, separate -- changing its swallow-to-throw
# behavior affects every other caller and needs its own blast-radius review).

function Test-Neo4jAuthProbe {
    <#
    .SYNOPSIS
        Authenticates a Neo4j credential with a live RETURN 1 query (t/3856).
    .DESCRIPTION
        Calls Invoke-RestMethod directly (not Invoke-CypherQuery) so a real exception reaches
        this function's own try/catch -- see the file header for why that distinction matters.
        Distinguishes a rejected credential (HTTP 401) from an unreachable database, since the
        two have opposite remedies (re-run with the right password vs. check the
        container/network) -- SO condition 5 (e/242#2), same discipline as t/3833's Step 6b.
    .PARAMETER Credential
        Neo4j credential to probe. Plaintext is materialized only inside this function, at the
        point of use, to build the Basic auth header for this one request (PSAvoidUsingUsernameAndPasswordParams --
        a separate -User/-PlainPassword pair is a PSSA error).
    .PARAMETER HttpUri
        Neo4j HTTP endpoint. Default: http://localhost:7474.
    .OUTPUTS
        [PSCustomObject] { Verified: bool; Reason: 'unauthorized' | 'unreachable' | $null;
        Message: string | $null }. Reason/Message are $null when Verified is $true.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [PSCredential]$Credential,

        [string]$HttpUri = 'http://localhost:7474'
    )

    Set-StrictMode -Version Latest

    $Pair = "$($Credential.UserName):$($Credential.GetNetworkCredential().Password)"
    $AuthHeader = @{ Authorization = "Basic $([Convert]::ToBase64String([System.Text.Encoding]::ASCII.GetBytes($Pair)))" }
    $Body = @{ statements = @(@{ statement = 'RETURN 1' }) } | ConvertTo-Json -Depth 5

    try {
        # fetch-allowlist: local graph DB (neo4j) HTTP auth probe, same class as Invoke-CypherQuery (t/3314 AllowedSites)
        $null = Invoke-RestMethod -Uri "$HttpUri/db/neo4j/tx/commit" -Method POST `
            -ContentType 'application/json' -Headers $AuthHeader -Body $Body `
            -TimeoutSec 5 -ErrorAction Stop
        return [PSCustomObject]@{ Verified = $true; Reason = $null; Message = $null }
    } catch {
        # StrictMode guard: HttpRequestException (connection-level failures) has no .Response
        # property at all -- a bare $_.Exception.Response throws PropertyNotFoundException
        # under Set-StrictMode rather than returning $null, so check PSObject.Properties first.
        $Resp = if ($_.Exception.PSObject.Properties['Response']) { $_.Exception.Response } else { $null }
        if ($Resp -and [int]$Resp.StatusCode -eq 401) {
            return [PSCustomObject]@{ Verified = $false; Reason = 'unauthorized'; Message = "credential rejected (HTTP 401) at $HttpUri" }
        }
        return [PSCustomObject]@{ Verified = $false; Reason = 'unreachable'; Message = "could not reach ${HttpUri}: $($_.Exception.Message)" }
    }
}
