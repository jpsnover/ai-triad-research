# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-Organization {
    <#
    .SYNOPSIS
        Look up organizations by ID or search by name.
    .DESCRIPTION
        Reads the organizations registry (organizations.json) and returns
        matching [Organization] records. With no filters, returns all orgs.

        Uses the module-scope cache — first call reads from disk, subsequent
        calls return cached results until the file mtime changes.
    .PARAMETER Id
        Exact organization id (org-NNN). Returns at most one record.
    .PARAMETER Name
        Substring match against Name or ShortName (case-insensitive).
    .PARAMETER Type
        Filter by type enum (think_tank, advocacy, regulatory, academic,
        corporate, intergovernmental, civil_society, standards_body, research_lab).
    .OUTPUTS
        [Organization]
    .EXAMPLE
        Get-Organization -Id org-001
    .EXAMPLE
        Get-Organization -Name 'anthropic'
    .EXAMPLE
        Get-Organization -Type advocacy
    #>
    [CmdletBinding()]
    [OutputType('Organization')]
    param(
        [string]$Id,
        [string]$Name,
        [ValidateSet('think_tank','advocacy','regulatory','academic','corporate','intergovernmental','civil_society','standards_body','research_lab')]
        [string]$Type
    )

    Set-StrictMode -Version Latest

    $store = Get-OrganizationsStore
    $orgs = @()
    if ($store.PSObject.Properties['organizations']) { $orgs = @($store.organizations) }

    $filtered = foreach ($raw in $orgs) {
        if ($Id) {
            $rid = if ($raw.PSObject.Properties['id']) { [string]$raw.id } else { '' }
            if ($rid -ne $Id) { continue }
        }
        if ($Type) {
            $rt = if ($raw.PSObject.Properties['type']) { [string]$raw.type } else { '' }
            if ($rt -ne $Type) { continue }
        }
        if ($Name) {
            $rn = if ($raw.PSObject.Properties['name']) { [string]$raw.name } else { '' }
            $rsn = if ($raw.PSObject.Properties['short_name']) { [string]$raw.short_name } else { '' }
            if (($rn -notmatch [regex]::Escape($Name)) -and ($rsn -notmatch [regex]::Escape($Name))) { continue }
        }
        ConvertTo-OrganizationObject -Raw $raw
    }

    return @($filtered)
}
