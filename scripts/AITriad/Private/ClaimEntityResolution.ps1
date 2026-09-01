# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Claim-side entity resolution (t/3124, claims-entity-fol-recommendations.md §4/R2.3).
# Writes entity_refs[] onto summary claims (key_points + factual_claims), following the
# EXACT resolution discipline of CL's shipped node reconciler
# (research/comp-linguist/scripts/reconcile_grounding.py, resolve() entity branch): entities
# are PRECISE-ONLY — surface/alias word-boundary match -> a `linked` EntityLinkRef. There is
# deliberately NO entity-embedding rung (§13.3: "Embedding is propose-only, never an
# auto-link"; the "Andreessen cos-matches 45 nodes it doesn't mention" over-link). The
# link-record SHAPE is the Shared Lib contract EntityLinkRef (lib/entities/types.ts, t/3157):
#   { ref, surface, method: exact|alias, link_confidence: 1.0, match_level: 'exact', status: 'linked' }
# Normalization reuses the D1 parity primitives (Get-NormalizedName + $script:PinnedWhitespaceClass)
# so a surface this pass matches is byte-identically the surface the mention indexer / node
# reconciler match. Dot-sourced helpers — do NOT export.

function Get-EntityAliasEntry {
    <#
    .SYNOPSIS
        Build the ordered alias-surface table over in-scope entities — the resolver input.
    .DESCRIPTION
        Mirrors reconcile_grounding.py load_entities(): one entry per (entity, surface) with
        the exact `name` first (method 'exact') then each alias (method 'alias'). Surfaces
        shorter than 3 raw chars are dropped (parity with the Python `len(s) > 2` guard — a
        two-char surface like "AI" alias-matches far too much). Each entry precompiles the
        word-boundary regex over the NFC+lowercased surface with pinned-whitespace-tolerant
        interior, identical to Update-EntityMentionIndex's matcher.
    .PARAMETER Entities
        The entity records (from Get-EntitiesStore .entities).
    .PARAMETER Status
        Which entity statuses to include. Default @('approved') — the D1 caller-filters-to-
        approved contract (only approved entities are a grounding target).
    .OUTPUTS
        [pscustomobject[]] of @{ Ref; Method; Surface; Regex } in resolution order.
    #>
    [CmdletBinding()]
    [OutputType([System.Object[]])]
    param(
        [Parameter(Mandatory)]
        [AllowNull()]
        $Entities,

        [Parameter()]
        [string[]]$Status = @('approved')
    )
    Set-StrictMode -Version Latest

    $entries = [System.Collections.Generic.List[object]]::new()
    foreach ($e in @($Entities)) {
        if (-not $e -or -not $e.PSObject.Properties['id']) { continue }
        $eStatus = if ($e.PSObject.Properties['status']) { [string]$e.status } else { '' }
        if ($eStatus -notin $Status) { continue }
        $ref = [string]$e.id

        # Ordered surfaces: exact name, then aliases (aliases is frequently $null, not []).
        $surfaces = [System.Collections.Generic.List[object]]::new()
        if ($e.PSObject.Properties['name'] -and $e.name) {
            $surfaces.Add([pscustomobject]@{ Method = 'exact'; Surface = [string]$e.name })
        }
        if ($e.PSObject.Properties['aliases']) {
            foreach ($a in @($e.aliases)) {
                if ($a) { $surfaces.Add([pscustomobject]@{ Method = 'alias'; Surface = [string]$a }) }
            }
        }

        foreach ($s in $surfaces) {
            # Parity with reconcile_grounding.py load_entities(): raw surface must exceed 2 chars.
            if ($s.Surface.Length -le 2) { continue }
            $norm = Get-NormalizedName -Name $s.Surface
            if (-not $norm) { continue }
            $tokens = $norm -split ' '
            $pattern = (($tokens | ForEach-Object { [regex]::Escape($_) }) -join "$script:PinnedWhitespaceClass+")
            $rx = [regex]::new("(?<!\w)$pattern(?!\w)")
            $entries.Add([pscustomobject]@{ Ref = $ref; Method = $s.Method; Surface = $s.Surface; Regex = $rx })
        }
    }
    # Return the array plainly; every caller wraps in @(). A leading unary comma would
    # double-nest under the caller's @() (the outer wrapper unrolls, leaving one nested array).
    return $entries.ToArray()
}

function Resolve-ClaimEntityRef {
    <#
    .SYNOPSIS
        Resolve one claim's text to entity_refs[] — precise-only surface/alias links.
    .DESCRIPTION
        Mirrors reconcile_grounding.py resolve() entity branch: for each entity, take the
        FIRST of its surfaces (exact then aliases) that word-boundary-matches the text, emit
        ONE EntityLinkRef, and move on (Python `next(...)`). At most one ref per entity; no
        cross-entity overlap resolution (parity — multiple distinct entities may each link).
        Text is NFC+lowercased for matching (mirrors the indexer's $lower). Returns entity_refs
        in first-match-offset order for a stable, idempotent array.
    .PARAMETER Text
        The claim text (a key_point .point or a factual_claim .claim).
    .PARAMETER AliasEntries
        Output of Get-EntityAliasEntry.
    .OUTPUTS
        [pscustomobject[]] EntityLinkRef-shaped: { ref, surface, method, link_confidence,
        match_level, status }.
    #>
    [CmdletBinding()]
    [OutputType([System.Object[]])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string]$Text,

        [Parameter(Mandatory)]
        [AllowNull()]
        $AliasEntries
    )
    Set-StrictMode -Version Latest

    if ([string]::IsNullOrWhiteSpace($Text)) { return @() }
    $low = $Text.Normalize([System.Text.NormalizationForm]::FormC).ToLowerInvariant()

    # First-match-per-entity, preserving alias-table order (exact before alias). Track the
    # earliest match offset per ref for a deterministic output ordering.
    $byRef = [ordered]@{}
    foreach ($ae in @($AliasEntries)) {
        if ($byRef.Contains($ae.Ref)) { continue }   # entity already linked by an earlier surface
        $m = $ae.Regex.Match($low)
        if (-not $m.Success) { continue }
        $byRef[$ae.Ref] = [pscustomobject]@{
            Offset = $m.Index
            Ref    = [pscustomobject]@{
                ref             = $ae.Ref
                surface         = $ae.Surface
                method          = $ae.Method
                link_confidence = 1.0
                match_level     = 'exact'
                status          = 'linked'
            }
        }
    }
    if ($byRef.Count -eq 0) { return @() }

    $ordered = @($byRef.Values | Sort-Object -Property @{ Expression = 'Offset'; Descending = $false },
        @{ Expression = { $_.Ref.ref }; Descending = $false })
    return @($ordered | ForEach-Object { $_.Ref })
}

function Test-ClaimEntityRefEqual {
    # By-value equality of two entity_refs arrays (field-wise, order-sensitive) — avoids a
    # spurious rewrite when the resolved refs match what's already persisted. Order is
    # deterministic (Resolve-ClaimEntityRef sorts), so positional comparison is sound.
    [CmdletBinding()]
    [OutputType([bool])]
    param([AllowNull()]$A, [AllowNull()]$B)
    Set-StrictMode -Version Latest
    # Guard $null explicitly: an empty array bound through an untyped param arrives as $null,
    # and @($null) is a ONE-element array holding $null (count 1) — which would spuriously
    # match a single new ref and then dereference the null. Direct-assign the empty case (an
    # `if (...) { @() }` EXPRESSION collapses to $null on assignment — a second PS gotcha).
    $aa = @(); if ($null -ne $A) { $aa = @($A) }
    $bb = @(); if ($null -ne $B) { $bb = @($B) }
    if ($aa.Count -ne $bb.Count) { return $false }
    for ($i = 0; $i -lt $aa.Count; $i++) {
        foreach ($f in @('ref', 'surface', 'method', 'match_level', 'status')) {
            $av = if ($aa[$i].PSObject.Properties[$f]) { [string]$aa[$i].$f } else { '' }
            $bv = if ($bb[$i].PSObject.Properties[$f]) { [string]$bb[$i].$f } else { '' }
            if ($av -ne $bv) { return $false }
        }
        $ac = if ($aa[$i].PSObject.Properties['link_confidence']) { [double]$aa[$i].link_confidence } else { 0.0 }
        $bc = if ($bb[$i].PSObject.Properties['link_confidence']) { [double]$bb[$i].link_confidence } else { 0.0 }
        if ([Math]::Abs($ac - $bc) -gt 1e-9) { return $false }
    }
    return $true
}

function Set-ClaimEntityRef {
    <#
    .SYNOPSIS
        Walk one parsed summary object and (re)write entity_refs[] on every claim.
    .DESCRIPTION
        Mutates the summary object in place. For each pov_summaries.<pov>.key_points[] (text =
        .point) and each top-level factual_claims[] (text = .claim), resolves entity_refs via
        Resolve-ClaimEntityRef and sets the field. A claim that resolves to nothing has its
        entity_refs REMOVED (absence == "no links", never an empty-array sentinel) — parity
        with the node reconciler's `elif "entity_refs" in n: del n["entity_refs"]`. Idempotent:
        re-running over unchanged text produces byte-identical refs. Returns per-run stats.
    .PARAMETER Summary
        A parsed summary PSObject (ConvertFrom-Json of a summaries/<doc>.json file).
    .PARAMETER AliasEntries
        Output of Get-EntityAliasEntry.
    .OUTPUTS
        [pscustomobject] @{ ClaimsProcessed; RefsWritten; Changed }.
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param(
        [Parameter(Mandatory)]
        $Summary,

        [Parameter(Mandatory)]
        [AllowNull()]
        $AliasEntries
    )
    Set-StrictMode -Version Latest

    $claims = [System.Collections.Generic.List[object]]::new()
    $textFields = @{}

    if ($Summary.PSObject.Properties['pov_summaries'] -and $Summary.pov_summaries) {
        foreach ($povName in @('accelerationist', 'safetyist', 'skeptic')) {
            if (-not $Summary.pov_summaries.PSObject.Properties[$povName]) { continue }
            $povData = $Summary.pov_summaries.$povName
            if (-not $povData -or -not $povData.PSObject.Properties['key_points'] -or -not $povData.key_points) { continue }
            foreach ($kp in @($povData.key_points)) { $claims.Add($kp); $textFields[$claims.Count - 1] = 'point' }
        }
    }
    if ($Summary.PSObject.Properties['factual_claims'] -and $Summary.factual_claims) {
        foreach ($fc in @($Summary.factual_claims)) { $claims.Add($fc); $textFields[$claims.Count - 1] = 'claim' }
    }

    $processed = 0
    $written = 0
    $changed = $false
    for ($i = 0; $i -lt $claims.Count; $i++) {
        $claim = $claims[$i]
        $field = $textFields[$i]
        if (-not $claim -or -not $claim.PSObject.Properties[$field]) { continue }
        $processed++
        $text = [string]$claim.$field
        $refs = @(Resolve-ClaimEntityRef -Text $text -AliasEntries $AliasEntries)
        $existing = if ($claim.PSObject.Properties['entity_refs']) { @($claim.entity_refs) } else { @() }
        if (-not (Test-ClaimEntityRefEqual -A $existing -B $refs)) {
            $changed = $true
            if ($refs.Count -gt 0) {
                if ($claim.PSObject.Properties['entity_refs']) { $claim.entity_refs = $refs }
                else { Add-Member -InputObject $claim -NotePropertyName 'entity_refs' -NotePropertyValue $refs -Force }
            }
            elseif ($claim.PSObject.Properties['entity_refs']) {
                $claim.PSObject.Properties.Remove('entity_refs')
            }
        }
        $written += $refs.Count
    }

    return [pscustomobject]@{
        ClaimsProcessed = $processed
        RefsWritten     = $written
        Changed         = $changed
    }
}
