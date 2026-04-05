# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Invoke-CypherQuery {
    <#
    .SYNOPSIS
        Runs a Cypher query against the Neo4j graph database and returns results.
    .DESCRIPTION
        Sends a Cypher query to the Neo4j HTTP API and returns structured results.
        Supports parameterized queries for safety and performance.
    .PARAMETER Query
        The Cypher query string.
    .PARAMETER Parameters
        Hashtable of query parameters (referenced as $paramName in Cypher).
    .PARAMETER Uri
        Neo4j Bolt URI. Default: bolt://localhost:7687.
    .PARAMETER Credential
        PSCredential for Neo4j authentication.
    .PARAMETER Raw
        Return raw API response instead of parsed results.
    .EXAMPLE
        Invoke-CypherQuery "MATCH (n:TaxonomyNode) RETURN n.id, n.label LIMIT 10"
    .EXAMPLE
        Invoke-CypherQuery "MATCH (a)-[r:TENSION_WITH]->(b) RETURN a.label, b.label, r.confidence"
    .EXAMPLE
        Invoke-CypherQuery "MATCH (n:TaxonomyNode {pov: `$pov}) RETURN n.id, n.label" -Parameters @{ pov = 'safetyist' }
    .EXAMPLE
        Invoke-CypherQuery "MATCH p=shortestPath((a:TaxonomyNode {id: `$from})-[*]-(b:TaxonomyNode {id: `$to})) RETURN p" -Parameters @{ from = 'acc-desires-001'; to = 'saf-desires-001' }
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory, Position = 0)]
        [string]$Query,

        [hashtable]$Parameters = @{},

        [string]$Uri = 'bolt://localhost:7687',

        [PSCredential]$Credential,

        [switch]$Raw
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $HttpUri = $Uri -replace 'bolt://', 'http://' -replace ':7687', ':7474'

    if ($Credential) {
        $Pair = "$($Credential.UserName):$($Credential.GetNetworkCredential().Password)"
    } else {
        $Neo4jPwd = if ($env:NEO4J_PASSWORD) { $env:NEO4J_PASSWORD } else { 'aitriad2026' }
        $Pair = "neo4j:$Neo4jPwd"
    }
    $Bytes = [System.Text.Encoding]::ASCII.GetBytes($Pair)
    $AuthHeader = @{ Authorization = "Basic $([Convert]::ToBase64String($Bytes))" }

    $Body = @{
        statements = @(
            @{
                statement  = $Query
                parameters = $Parameters
            }
        )
    } | ConvertTo-Json -Depth 10

    try {
        $Response = Invoke-RestMethod `
            -Uri "$HttpUri/db/neo4j/tx/commit" `
            -Method POST `
            -ContentType 'application/json' `
            -Headers $AuthHeader `
            -Body $Body `
            -ErrorAction Stop
    } catch {
        Write-Fail "Neo4j query failed: $_"
        Write-Info 'Is Neo4j running? Try: Install-GraphDatabase'
        return
    }

    if ($Response.errors -and $Response.errors.Count -gt 0) {
        foreach ($Err in $Response.errors) {
            Write-Fail "Cypher error: $($Err.message)"
        }
        return
    }

    if ($Raw) {
        return $Response
    }

    # Parse results into PSCustomObjects
    foreach ($Result in $Response.results) {
        $Columns = $Result.columns
        foreach ($Row in $Result.data) {
            $Obj = [ordered]@{}
            for ($i = 0; $i -lt $Columns.Count; $i++) {
                $Val = $Row.row[$i]
                $Obj[$Columns[$i]] = $Val
            }
            [PSCustomObject]$Obj
        }
    }
}
