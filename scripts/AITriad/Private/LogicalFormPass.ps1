# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Logical-form formalization pass — pure helpers (t/3215). Schema of record: t/3126,
# research/comp-linguist/docs/logical-form-schema.md; prompt: Prompts/logical-form-formalization.prompt.
# These helpers hold the placeholder-building, grounding-enforcement, and enum-validation logic so
# the correctness surface is unit-testable WITHOUT a live LLM (the orchestrator
# Public/Invoke-LogicalFormPass.ps1 supplies the model call). Dot-sourced by AITriad.psm1 — do NOT export.
#
# Design rule inherited from the schema (§8.1): "the prover is only as sound as the logical form."
# The pass therefore ENFORCES the grounding + one-identity invariants (R6 / t/2294) rather than
# trusting the model — every ent-* arg must come from the claim's own entity_refs[], and sort +
# match_level are COPIED from the register, never re-judged.

# ── Closed vocabularies — pinned to the schema doc + lib/entities/types.ts DolceCategory ──────────
$script:LogicalFormRoles = @(
    'agent', 'patient', 'theme', 'recipient', 'instrument', 'location',
    'source', 'goal', 'beneficiary', 'cause', 'manner'
)
# args[].sort ∈ the 5-value DolceCategory (lib/entities/types.ts) — the register's closed set.
$script:LogicalFormDolceSorts = @(
    'agentive-physical-object', 'non-agentive-functional-artifact',
    'perdurant', 'normative-description', 'non-agentive-social-object'
)
$script:LogicalFormMatchLevels   = @('exact', 'instance_of', 'subclass', 'superclass', 'related')
$script:LogicalFormTemporalTypes = @('at', 'before', 'after', 'during', 'unspecified')
$script:LogicalFormAttitudes     = @('belief', 'desire', 'intention')
$script:LogicalFormPolarities    = @('positive', 'negative')
$script:LogicalFormStatuses      = @('proposed', 'accepted', 'rejected')

function Get-EntityDolceMap {
    <#
    .SYNOPSIS
        Build an ent-id → dolce_category lookup over the entity register.
    .DESCRIPTION
        The `entity_ref` record on a claim does NOT carry `dolce_category` (t/3124 shipped the
        EntityLinkRef shape without it), so the formalization pass must look the sort up here to
        satisfy the schema's args[].sort ∈ DolceCategory invariant (copy-not-judge, rule 2). Every
        register status is included — a claim's entity_refs[] may have been resolved against
        `proposed` entities (Update-ClaimEntityRef -Status proposed), and the map's only job is to
        return the register's sort for an id the claim already links.
    .PARAMETER Entities
        The entity records (Get-EntitiesStore .entities). $null-tolerant.
    .OUTPUTS
        [hashtable] ent-id -> dolce_category (only records that declare a non-empty dolce_category).
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [AllowNull()]
        $Entities
    )
    Set-StrictMode -Version Latest

    $map = @{}
    foreach ($e in @($Entities)) {
        if (-not $e -or -not $e.PSObject.Properties['id']) { continue }
        if (-not $e.PSObject.Properties['dolce_category']) { continue }
        $sort = [string]$e.dolce_category
        if ([string]::IsNullOrWhiteSpace($sort)) { continue }
        $map[[string]$e.id] = $sort
    }
    return $map
}

function Get-ClaimCamp {
    <#
    .SYNOPSIS
        Derive the attributing camp (acc | saf | skp) from a claim's taxonomy_node_id prefix.
    .DESCRIPTION
        BDI claims carry a taxonomy_node_id shaped {acc|saf|skp}-{category}-NNN. The camp is the
        holder of the modal attitude (modality.holder = camp:<camp>). A null/empty/non-BDI id
        (a factual claim, or a key_point whose node was nulled) returns '' — the caller treats
        '' as "no camp" (factual, modality:null).
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [AllowNull()]
        [string]$NodeId
    )
    Set-StrictMode -Version Latest
    if ([string]::IsNullOrWhiteSpace($NodeId)) { return '' }
    if ($NodeId -match '^(acc|saf|skp)-') { return $Matches[1] }
    return ''
}

function Get-LogicalFormRefTable {
    <#
    .SYNOPSIS
        Join a claim's entity_refs[] with the register's dolce_category → the per-claim grounding table.
    .DESCRIPTION
        Produces the rows the prompt's {{ENTITY_REFS}} block and the grounding-enforcement step both
        read: { ref, surface, match_level, sort }. `sort` is the register's dolce_category for that
        ent id (the join the entity_ref itself lacks); `match_level` is copied verbatim from the
        entity_ref. An ent id absent from the dolce map is DROPPED — a ref whose register sort is
        unknown cannot be grounded to a DolceCategory value, so it must not appear as a formal arg
        (it may still surface as a lit: in the model output).
    .PARAMETER EntityRefs
        The claim's entity_refs[] (EntityLinkRef records). $null / empty tolerated.
    .PARAMETER DolceMap
        Output of Get-EntityDolceMap.
    .OUTPUTS
        [pscustomobject[]] { ref; surface; match_level; sort } in the claim's entity_refs order.
    #>
    [CmdletBinding()]
    [OutputType([System.Object[]])]
    param(
        [AllowNull()]
        $EntityRefs,

        [Parameter(Mandatory)]
        [hashtable]$DolceMap
    )
    Set-StrictMode -Version Latest

    $rows = [System.Collections.Generic.List[object]]::new()
    foreach ($r in @($EntityRefs)) {
        if (-not $r -or -not $r.PSObject.Properties['ref']) { continue }
        $ref = [string]$r.ref
        if ([string]::IsNullOrWhiteSpace($ref)) { continue }
        if (-not $DolceMap.ContainsKey($ref)) { continue }   # no register sort -> not groundable as an arg
        $surface = if ($r.PSObject.Properties['surface']) { [string]$r.surface } else { '' }
        $ml      = if ($r.PSObject.Properties['match_level']) { [string]$r.match_level } else { 'exact' }
        $rows.Add([pscustomobject]@{ ref = $ref; surface = $surface; match_level = $ml; sort = $DolceMap[$ref] })
    }
    return $rows.ToArray()
}

function ConvertTo-EntityRefsPromptJson {
    <#
    .SYNOPSIS
        Render the grounding table as the {{ENTITY_REFS}} JSON the prompt consumes.
    .DESCRIPTION
        Emits a JSON array of { ref, surface, sort, match_level } — the exact fields the prompt tells
        the model to copy verbatim. Empty table → "[]" (the model then has no ent ids to use and must
        emit lit:"…" for every participant). -InputObject on the materialized array keeps single-row
        output a JSON array (the pipeline-unwrap footgun), not a bare object.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [AllowNull()]
        $RefTable
    )
    Set-StrictMode -Version Latest

    $list = [System.Collections.Generic.List[object]]::new()
    foreach ($r in @($RefTable)) {
        if ($null -eq $r) { continue }   # @($null) is a 1-element [$null] array — guard the empty-table case
        $list.Add([ordered]@{
                ref         = [string]$r.ref
                surface     = [string]$r.surface
                sort        = [string]$r.sort
                match_level = [string]$r.match_level
            })
    }
    if ($list.Count -eq 0) { return '[]' }
    return (ConvertTo-Json -InputObject $list.ToArray() -Depth 4 -Compress)
}

function Get-ClaimProposition {
    <#
    .SYNOPSIS
        Select the proposition text to formalize for a claim.
    .DESCRIPTION
        BDI key_points: the register-normalized `canonical_proposition`, falling back to `point` when
        it is empty (canonical_proposition is empty for a majority of claims — D3a). factual_claims:
        the `claim` field (the authoritative factual text field in the summaries schema —
        pov-summary-schema.prompt; factual_claims carry neither point nor verbatim nor
        canonical_proposition). `verbatim` (a string OR a span array) is the last-ditch fallback.
    .PARAMETER Claim
        The claim PSObject.
    .PARAMETER IsFactual
        $true for a factual_claim, $false for a BDI key_point.
    .OUTPUTS
        [string] the proposition, or '' when the claim carries no usable text.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        $Claim,

        [switch]$IsFactual
    )
    Set-StrictMode -Version Latest

    $order = if ($IsFactual) { @('claim', 'point', 'verbatim') } else { @('canonical_proposition', 'point', 'verbatim') }
    foreach ($field in $order) {
        if (-not $Claim.PSObject.Properties[$field]) { continue }
        $raw = $Claim.$field
        if ($null -eq $raw) { continue }
        # verbatim may be a single string OR an array of non-contiguous spans.
        $text = if ($raw -is [System.Array]) { (@($raw) -join ' ') } else { [string]$raw }
        if (-not [string]::IsNullOrWhiteSpace($text)) { return $text.Trim() }
    }
    return ''
}

function ConvertTo-GroundedLogicalForm {
    <#
    .SYNOPSIS
        Normalize a raw model logical-form object into the grounded, schema-shaped form to persist.
    .DESCRIPTION
        ENFORCES the invariants the model is asked but not trusted to honor:
          - Grounding (R6 / t/2294): any args[].ref / about[].ref that is an ent-* id MUST be in the
            claim's entity_refs[] (the RefTable). A non-grounded ent id is DROPPED — never minted,
            never kept. lit:"…" and event-var refs are preserved as-is.
          - Copy-not-judge (rule 2): for a grounded ent-* arg, sort + match_level are OVERWRITTEN from
            the register/entity_ref, discarding whatever the model emitted (one-identity, §7.4/t/2946).
          - Mechanical modality (rule 3): holder follows the camp, attitude follows the category —
            never re-read from prose. Factual claims get modality: null.
          - No silent omissions (rule 4): temporal always present ({type,value}); status honored when
            'rejected', otherwise forced 'proposed' (new forms land proposed).
        The result is an ordered object ready to attach as claim.logical_form and serialize.
    .PARAMETER Raw
        The parsed model output (a PSObject from ConvertFrom-Json).
    .PARAMETER RefTable
        The claim's grounding table (Get-LogicalFormRefTable). $null / empty ⇒ no ent-* refs allowed.
    .PARAMETER Category
        The BDI category (Beliefs | Desires | Intentions) or 'factual'.
    .PARAMETER Camp
        The attributing camp (acc | saf | skp); ignored for factual.
    .OUTPUTS
        [pscustomobject] the grounded logical_form.
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param(
        [Parameter(Mandatory)]
        $Raw,

        [Parameter(Mandatory)]
        [AllowNull()]
        $RefTable,

        [Parameter(Mandatory)]
        [string]$Category,

        [AllowNull()]
        [string]$Camp
    )
    Set-StrictMode -Version Latest

    $byRef = @{}
    foreach ($r in @($RefTable)) { if ($null -ne $r) { $byRef[[string]$r.ref] = $r } }
    $isFactual = ($Category -eq 'factual')

    # ── args: grounding + copy-not-judge ──────────────────────────────────────────────
    $groundedArgs = [System.Collections.Generic.List[object]]::new()
    if ($Raw.PSObject.Properties['args'] -and $Raw.args) {
        foreach ($a in @($Raw.args)) {
            if (-not $a -or -not $a.PSObject.Properties['ref']) { continue }
            $ref  = [string]$a.ref
            $role = if ($a.PSObject.Properties['role']) { [string]$a.role } else { '' }
            if ($ref -like 'ent-*') {
                if (-not $byRef.ContainsKey($ref)) {
                    Write-Verbose "LogicalForm: dropped arg ref '$ref' — not in claim entity_refs (no minted ids, R6)."
                    continue
                }
                $reg  = $byRef[$ref]
                $sort = [string]$reg.sort         # copied from register — not re-judged
                $ml   = [string]$reg.match_level  # copied from the entity_ref
            }
            else {
                # lit:"…" or event var — keep the model's DOLCE-lite sort / default match_level.
                $sort = if ($a.PSObject.Properties['sort']) { [string]$a.sort } else { '' }
                $ml   = if ($a.PSObject.Properties['match_level']) { [string]$a.match_level } else { 'exact' }
            }
            $groundedArgs.Add([ordered]@{ role = $role; ref = $ref; sort = $sort; match_level = $ml })
        }
    }

    # ── about[]: projection of already-resolved entity_refs (ent-* only, no lits, no new resolution) ──
    $groundedAbout = [System.Collections.Generic.List[object]]::new()
    if ($Raw.PSObject.Properties['about'] -and $Raw.about) {
        foreach ($ab in @($Raw.about)) {
            if (-not $ab -or -not $ab.PSObject.Properties['ref']) { continue }
            $ref = [string]$ab.ref
            if (-not ($ref -like 'ent-*') -or -not $byRef.ContainsKey($ref)) {
                Write-Verbose "LogicalForm: dropped about ref '$ref' — about[] projects the claim's entity_refs only."
                continue
            }
            $groundedAbout.Add([ordered]@{ ref = $ref; match_level = [string]$byRef[$ref].match_level })
        }
    }

    # ── modality: mechanical from category/camp ───────────────────────────────────────
    $modality = $null
    if (-not $isFactual) {
        $attitude = switch -Regex ($Category) {
            '^Belief'    { 'belief';    break }
            '^Desire'    { 'desire';    break }
            '^Intention' { 'intention'; break }
            default      { '' }
        }
        $modality = [ordered]@{ holder = "camp:$Camp"; attitude = $attitude }
    }

    # ── temporal: never omitted ───────────────────────────────────────────────────────
    $tempType  = 'unspecified'
    $tempValue = $null
    if ($Raw.PSObject.Properties['temporal'] -and $Raw.temporal) {
        $t = $Raw.temporal
        if ($t.PSObject.Properties['type'] -and $t.type) { $tempType = [string]$t.type }
        if ($t.PSObject.Properties['value'] -and $null -ne $t.value) {
            $vv = [string]$t.value
            if (-not [string]::IsNullOrWhiteSpace($vv)) { $tempValue = $vv }
        }
    }
    if ($tempType -eq 'unspecified') { $tempValue = $null }   # value is null iff unspecified

    # ── status: honor 'rejected', else land 'proposed' ────────────────────────────────
    $rawStatus = if ($Raw.PSObject.Properties['status']) { [string]$Raw.status } else { '' }
    $status    = if ($rawStatus -eq 'rejected') { 'rejected' } else { 'proposed' }

    $polarity  = if ($Raw.PSObject.Properties['polarity']) { [string]$Raw.polarity } else { 'positive' }
    $predicate = if ($Raw.PSObject.Properties['predicate']) { [string]$Raw.predicate } else { '' }
    $eventRef  = if ($Raw.PSObject.Properties['event_ref'] -and $Raw.event_ref) { [string]$Raw.event_ref } else { 'e1' }

    $conf = 0.0
    if ($Raw.PSObject.Properties['formalization_confidence'] -and $null -ne $Raw.formalization_confidence) {
        try { $conf = [double]$Raw.formalization_confidence } catch { $conf = 0.0 }
    }

    return [pscustomobject][ordered]@{
        predicate                = $predicate
        event_ref                = $eventRef
        args                     = $groundedArgs.ToArray()
        polarity                 = $polarity
        modality                 = $modality
        temporal                 = [ordered]@{ type = $tempType; value = $tempValue }
        about                    = $groundedAbout.ToArray()
        formalization_confidence = $conf
        status                   = $status
    }
}

function Test-LogicalFormStructure {
    <#
    .SYNOPSIS
        Validate a GROUNDED logical_form against the schema's closed vocabularies.
    .DESCRIPTION
        Run after ConvertTo-GroundedLogicalForm. Confirms every enum-valued field is in its closed
        set (roles, args[].sort ∈ DolceCategory, match_level, polarity, temporal.type, status,
        modality.attitude/holder) and that required fields are non-empty. A `rejected` form is still
        shape-checked (it is kept as negative signal, mirroring the entity-resolution status field);
        callers decide whether to persist it. Returns { Ok; Reason } — never throws.
    .PARAMETER LogicalForm
        The grounded object (from ConvertTo-GroundedLogicalForm).
    .PARAMETER Category
        The BDI category or 'factual' (governs the modality-null vs modality-object rule).
    .OUTPUTS
        [pscustomobject] @{ Ok = [bool]; Reason = [string] }.
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param(
        [Parameter(Mandatory)]
        [AllowNull()]
        $LogicalForm,

        [Parameter(Mandatory)]
        [string]$Category
    )
    Set-StrictMode -Version Latest

    $lf = $LogicalForm
    if ($null -eq $lf) { return [pscustomobject]@{ Ok = $false; Reason = 'null logical_form' } }
    $isFactual = ($Category -eq 'factual')

    if ([string]::IsNullOrWhiteSpace([string]$lf.predicate)) { return [pscustomobject]@{ Ok = $false; Reason = 'empty predicate' } }
    if ([string]::IsNullOrWhiteSpace([string]$lf.event_ref)) { return [pscustomobject]@{ Ok = $false; Reason = 'empty event_ref' } }
    if ([string]$lf.polarity -notin $script:LogicalFormPolarities) { return [pscustomobject]@{ Ok = $false; Reason = "polarity '$($lf.polarity)' not in {positive,negative}" } }
    if ([string]$lf.status -notin $script:LogicalFormStatuses) { return [pscustomobject]@{ Ok = $false; Reason = "status '$($lf.status)' invalid" } }

    $conf = [double]$lf.formalization_confidence
    if ($conf -lt 0.0 -or $conf -gt 1.0) { return [pscustomobject]@{ Ok = $false; Reason = "formalization_confidence $conf out of [0,1]" } }

    $t = $lf.temporal
    if ($null -eq $t -or [string]$t.type -notin $script:LogicalFormTemporalTypes) {
        return [pscustomobject]@{ Ok = $false; Reason = 'temporal.type invalid or missing' }
    }

    foreach ($a in @($lf.args)) {
        if ([string]::IsNullOrWhiteSpace([string]$a.ref)) { return [pscustomobject]@{ Ok = $false; Reason = 'arg missing ref' } }
        if ([string]$a.role -notin $script:LogicalFormRoles) { return [pscustomobject]@{ Ok = $false; Reason = "arg role '$($a.role)' invalid" } }
        if ([string]$a.sort -notin $script:LogicalFormDolceSorts) { return [pscustomobject]@{ Ok = $false; Reason = "arg sort '$($a.sort)' not in DolceCategory" } }
        if ([string]$a.match_level -notin $script:LogicalFormMatchLevels) { return [pscustomobject]@{ Ok = $false; Reason = "arg match_level '$($a.match_level)' invalid" } }
    }

    foreach ($ab in @($lf.about)) {
        if ([string]::IsNullOrWhiteSpace([string]$ab.ref)) { return [pscustomobject]@{ Ok = $false; Reason = 'about missing ref' } }
        if ([string]$ab.match_level -notin $script:LogicalFormMatchLevels) { return [pscustomobject]@{ Ok = $false; Reason = "about match_level '$($ab.match_level)' invalid" } }
    }

    if ($isFactual) {
        if ($null -ne $lf.modality) { return [pscustomobject]@{ Ok = $false; Reason = 'factual claim must have null modality' } }
    }
    else {
        if ($null -eq $lf.modality) { return [pscustomobject]@{ Ok = $false; Reason = 'BDI claim missing modality' } }
        if ([string]$lf.modality.attitude -notin $script:LogicalFormAttitudes) { return [pscustomobject]@{ Ok = $false; Reason = "modality.attitude '$($lf.modality.attitude)' invalid" } }
        if ([string]$lf.modality.holder -notmatch '^camp:(acc|saf|skp)$') { return [pscustomobject]@{ Ok = $false; Reason = "modality.holder '$($lf.modality.holder)' invalid" } }
    }

    return [pscustomobject]@{ Ok = $true; Reason = $null }
}
