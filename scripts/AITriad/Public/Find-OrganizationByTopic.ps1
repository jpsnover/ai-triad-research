# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Find-OrganizationByTopic {
    <#
    .SYNOPSIS
        Find organizations engaged with a specific topic (situation node).
    .DESCRIPTION
        Filters the organizations registry by topic_engagement[].topic_ref.
        Optionally narrows by stance (advocate, opponent, researcher, neutral).
    .PARAMETER TopicRef
        Situation id (sit-NNN) to match against.
    .PARAMETER Stance
        Optional stance filter (advocate, opponent, researcher, neutral).
    .OUTPUTS
        [Organization[]]
    .EXAMPLE
        Find-OrganizationByTopic -TopicRef sit-003
    .EXAMPLE
        Find-OrganizationByTopic -TopicRef sit-001 -Stance advocate
    #>
    [CmdletBinding()]
    [OutputType('Organization[]')]
    param(
        [Parameter(Mandatory)]
        [ValidatePattern('^sit-\d+$')]
        [string]$TopicRef,

        [ValidateSet('advocate','opponent','researcher','neutral')]
        [string]$Stance
    )

    Set-StrictMode -Version Latest

    $store = Get-OrganizationsStore
    $orgs = @()
    if ($store.PSObject.Properties['organizations']) { $orgs = @($store.organizations) }

    $out = foreach ($raw in $orgs) {
        if (-not $raw.PSObject.Properties['topic_engagement']) { continue }
        $hit = $false
        foreach ($t in @($raw.topic_engagement)) {
            $tref = if ($t.PSObject.Properties['topic_ref']) { [string]$t.topic_ref } else { '' }
            if ($tref -ne $TopicRef) { continue }
            if ($Stance) {
                $ts = if ($t.PSObject.Properties['stance']) { [string]$t.stance } else { '' }
                if ($ts -ne $Stance) { continue }
            }
            $hit = $true
            break
        }
        if ($hit) { ConvertTo-OrganizationObject -Raw $raw }
    }
    return @($out)
}
