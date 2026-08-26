# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-Situation {
    <#
    .SYNOPSIS
        Lists and filters situations in the taxonomy.
    .DESCRIPTION
        Reads situations.json and returns situations matching the specified criteria.
        String filters support wildcards; multiple filters are AND-combined. With no
        parameters, returns all situations sorted by Id.

        A situation's per-POV "supporting evidence" is derived from `linked_nodes` by POV
        id-prefix (acc-/saf-/skp-) — the same derivation the UI uses (SituationDetail) — so
        the AccEvidence/SafEvidence/SkpEvidence counts mirror what a reader sees per camp.
    .PARAMETER Id
        Wildcard pattern matched against the situation id (e.g. 'sit-001', 'sit-0*').
    .PARAMETER Label
        Wildcard pattern matched against the situation label.
    .PARAMETER Text
        Wildcard pattern matched against the description (and plain_description if present).
    .PARAMETER LinkedNode
        Wildcard pattern matched against the situation's linked_nodes entries — find every
        situation that links a given POV node (e.g. 'acc-beliefs-039', 'skp-*').
    .PARAMETER Camp
        Return only situations that have at least one linked node for this POV camp
        (by id-prefix), i.e. situations showing supporting evidence for that camp.
    .PARAMETER WithLinks
        Return only situations that have at least one linked_node (any camp).
    .PARAMETER First
        Return only the first N matching situations.
    .PARAMETER RepoRoot
        Test/override hook only. When set, situations.json is read from
        <RepoRoot>/taxonomy/Origin. Left empty in production so the path resolves via
        Get-TaxonomyDir (→ .aitriad.json → the data repo, where situations.json lives).
    .EXAMPLE
        Get-Situation
        # All situations.
    .EXAMPLE
        Get-Situation sit-001
        # A single situation by id.
    .EXAMPLE
        Get-Situation -Label '*alignment*'
        # Situations whose label mentions alignment.
    .EXAMPLE
        Get-Situation -LinkedNode 'acc-beliefs-039'
        # Every situation that links that node as supporting evidence.
    .EXAMPLE
        Get-Situation -Camp skeptic -WithLinks
        # Situations that have Skeptic-camp supporting evidence.
    .EXAMPLE
        Get-Situation -Text '*existential*' -First 5
        # First 5 situations mentioning existential (risk) in their description.
    .LINK
        Show-AITriadHelp
    .LINK
        Repair-SituationReciprocity
    .LINK
        Add-SituationEvidenceLink
    .LINK
        Get-Edge
    .LINK
        Get-GraphNode
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param(
        [Parameter(Position = 0)]
        [string]$Id,

        [string]$Label,

        [string]$Text,

        [string]$LinkedNode,

        [ValidateSet('accelerationist', 'safetyist', 'skeptic', '')]
        [string]$Camp,

        [switch]$WithLinks,

        [int]$First = 0,

        # Test/override hook only — left empty in production so the taxonomy dir resolves via
        # Get-TaxonomyDir (→ .aitriad.json → data repo). Defaulting to the code-repo root sent
        # the reader to <code-repo>\taxonomy\Origin, which does not exist — situations.json
        # lives in the DATA repo — so Get-Situation always reported "No situations.json found".
        [string]$RepoRoot = ''
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $TaxDir  = if ($RepoRoot) { Join-Path $RepoRoot 'taxonomy/Origin' } else { Get-TaxonomyDir }
    $SitPath = Join-Path $TaxDir 'situations.json'

    if (-not (Test-Path -LiteralPath $SitPath)) {
        Write-Fail "No situations.json found at $SitPath."
        return
    }

    $SitData = Get-Content -Raw -LiteralPath $SitPath | ConvertFrom-Json

    # POV camp -> node id-prefix (how the UI derives per-camp supporting evidence).
    $CampPrefix = @{ accelerationist = 'acc-'; safetyist = 'saf-'; skeptic = 'skp-' }

    $Results = [System.Collections.Generic.List[PSObject]]::new()

    foreach ($S in @($SitData.nodes)) {
        # ── Filters (guard every optional field for StrictMode) ──
        if ($Id    -and $S.id    -notlike $Id)    { continue }
        if ($Label) {
            $SLabel = if ($S.PSObject.Properties['label']) { [string]$S.label } else { '' }
            if ($SLabel -notlike $Label) { continue }
        }
        if ($Text) {
            $SDesc  = if ($S.PSObject.Properties['description']) { [string]$S.description } else { '' }
            $SPlain = if ($S.PSObject.Properties['plain_description']) { [string]$S.plain_description } else { '' }
            if ($SDesc -notlike $Text -and $SPlain -notlike $Text) { continue }
        }

        # NB: an if-EXPRESSION returning @() unrolls to $null, so assign @() directly then overwrite —
        # otherwise a situation with empty linked_nodes yields $null and $Linked.Count throws (StrictMode).
        $Linked = @()
        if ($S.PSObject.Properties['linked_nodes'] -and $null -ne $S.linked_nodes) { $Linked = @($S.linked_nodes) }

        if ($LinkedNode) {
            if (-not (@($Linked | Where-Object { $_ -like $LinkedNode }).Count -gt 0)) { continue }
        }
        if ($WithLinks -and $Linked.Count -eq 0) { continue }
        if ($Camp) {
            $CampCount = @($Linked | Where-Object { $_ -like "$($CampPrefix[$Camp])*" }).Count
            if ($CampCount -eq 0) { continue }
        }

        # ── Per-camp evidence counts (by prefix — mirrors the UI's linkedByPov) ──
        $AccN = @($Linked | Where-Object { $_ -like 'acc-*' }).Count
        $SafN = @($Linked | Where-Object { $_ -like 'saf-*' }).Count
        $SkpN = @($Linked | Where-Object { $_ -like 'skp-*' }).Count

        # ── Machine-linked provenance (WS-B; field is optional/absent pre-apply) ──
        $MachineLinked = 0
        if ($S.PSObject.Properties['evidence_provenance'] -and $null -ne $S.evidence_provenance) {
            foreach ($p in $S.evidence_provenance.PSObject.Properties) {
                $prov = $p.Value
                if ($prov.PSObject.Properties['origin'] -and $prov.origin -eq 'machine') { $MachineLinked++ }
            }
        }

        $Results.Add([PSCustomObject]@{
            PSTypeName       = 'AITriad.Situation'
            Id               = $S.id
            Label            = if ($S.PSObject.Properties['label']) { $S.label } else { $null }
            Description      = if ($S.PSObject.Properties['description']) { $S.description } else { $null }
            LinkedNodes      = $Linked
            LinkedNodeCount  = $Linked.Count
            AccEvidence      = $AccN
            SafEvidence      = $SafN
            SkpEvidence      = $SkpN
            MachineLinked    = $MachineLinked
            DisagreementType = if ($S.PSObject.Properties['disagreement_type']) { $S.disagreement_type } else { $null }
            ParentId         = if ($S.PSObject.Properties['parent_id']) { $S.parent_id } else { $null }
            Interpretations  = if ($S.PSObject.Properties['interpretations']) { $S.interpretations } else { $null }
        })

        if ($First -gt 0 -and $Results.Count -ge $First) { break }
    }

    if ($Results.Count -eq 0) {
        Write-Warning 'No situations matched the specified filters.'
        return
    }

    $Results | Sort-Object Id
}
