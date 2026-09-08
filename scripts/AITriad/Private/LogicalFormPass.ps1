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

# ── Option C (t/3389; SO+TL signed e/145#13-#16) — topical_candidates ─────────────────────────────
# The mixed-convention about[] missed the concept-anchored golden floor (0.636 < 0.80, t/3381), so
# about[] reverts to ent-* only and term: concept refs move to `topical_candidates` — a quality-marked
# layer whose provenance block makes the unvalidated status legible FROM THE DATA (a consumer sees
# validated:false + the 0.54 blind-golden precision without reading the register). PHASE-1 is ADDITIVE:
# the validator ACCEPTS the field and about[] stays term:-tolerant (the ^ent- tightening is phase-3,
# post-migration — land-order is load-bearing, e/145#15/#16). Mirrors the Python reference (#2078).
# Ref vocabulary is exactly ^(term:|ent-) (hyphenated ent-, the e/145#14 d2 spec-typo catch).
$script:TopicalCandidateRefPattern = '^(term:|ent-)'
# Provenance STAMPED BY THIS GENERATOR (e/145#14(c) lifecycle rule): a repaired generator (t/3390)
# must UPDATE this block or revalidate-and-move the refs to about[] — never fresh refs under stale
# 0.54 metadata. `generator` is this port's identity (distinct from the Python's formalize_node_lf.py).
$script:TopicalCandidatesProvenance = [ordered]@{
    validated              = $false
    generator              = 'LogicalFormPass.ps1'
    golden_ref             = 't/3381'
    blind_golden_precision = 0.54
}

# Coercion map (t/3215#3, CL): full-DOLCE lit:/event sorts the model may still emit → the register's
# 5-value DolceCategory. The prompt now enumerates the 5 (t/3126, 90ce0d3e), so this is a
# defense-in-depth belt for RESIDUAL out-of-set lit:/event sorts — coerce to the nearest of the 5 and
# WARN, NEVER drop the arg or reject the form. ent-* sorts are register-copied and never coerced.
# Keys are lowercased; anything unmatched falls back to non-agentive-social-object (+WARN).
$script:LogicalFormSortCoercion = @{
    'abstract'                = 'non-agentive-social-object'
    'quality'                 = 'non-agentive-social-object'
    'region'                  = 'non-agentive-social-object'
    'social-object'           = 'non-agentive-social-object'
    'process'                 = 'perdurant'
    'event'                   = 'perdurant'
    'state'                   = 'perdurant'
    'achievement'             = 'perdurant'
    'accomplishment'          = 'perdurant'
    'agentive-social-object'  = 'agentive-physical-object'
    'social-group'            = 'agentive-physical-object'
    'organization'            = 'agentive-physical-object'
    'person'                  = 'agentive-physical-object'
    'agent'                   = 'agentive-physical-object'
    'physical-object'         = 'non-agentive-functional-artifact'
    'artifact'                = 'non-agentive-functional-artifact'
    'functional-artifact'     = 'non-agentive-functional-artifact'
    'norm'                    = 'normative-description'
    'law'                     = 'normative-description'
    'regulation'              = 'normative-description'
    'description'             = 'normative-description'
}

function ConvertTo-DolceSort {
    <#
    .SYNOPSIS
        Coerce a lit:/event arg's sort to the 5-value DolceCategory (t/3215#3 belt (b)).
    .DESCRIPTION
        In-set sorts pass through unchanged. A residual out-of-set sort is mapped via
        $script:LogicalFormSortCoercion (nearest of the 5); an unmapped value defaults to
        non-agentive-social-object. Every coercion emits a WARN (fallback-path logging,
        docs/error-handling.md) naming the original → coerced value. NEVER used for ent-* args —
        those are register-copied (copy-not-judge) and always valid by construction.
    .OUTPUTS
        [string] one of the 5 DolceCategory values.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [AllowNull()]
        [string]$Sort
    )
    Set-StrictMode -Version Latest

    $s = if ($null -eq $Sort) { '' } else { $Sort.Trim() }
    if ($s -in $script:LogicalFormDolceSorts) { return $s }   # already valid — no coercion

    $key = $s.ToLowerInvariant()
    if ($script:LogicalFormSortCoercion.ContainsKey($key)) {
        $coerced = $script:LogicalFormSortCoercion[$key]
        Write-Warning "LogicalForm: coerced out-of-set lit sort '$s' -> '$coerced' (DolceCategory belt, t/3215)."
        return $coerced
    }
    Write-Warning "LogicalForm: unmapped lit sort '$s' -> 'non-agentive-social-object' (default coercion, t/3215)."
    return 'non-agentive-social-object'
}

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
    .PARAMETER ConceptRefs
        The claim's concept_refs[] (term:* universals; t/3389 Option C). $null / empty tolerated. Each is
        emitted as a grounding row with sort='universal' + match_level='exact' — the 6th arg-slot sort
        (t/3251), mirroring the Python reference's `allowed[cid] = ("universal", "exact")` (#2078). These
        are what the about[] split (ConvertTo-GroundedLogicalForm) routes into topical_candidates.
    .OUTPUTS
        [pscustomobject[]] { ref; surface; match_level; sort } — entity rows first (entity_refs order),
        then concept rows (concept_refs order).
    #>
    [CmdletBinding()]
    [OutputType([System.Object[]])]
    param(
        [AllowNull()]
        $EntityRefs,

        [Parameter(Mandatory)]
        [hashtable]$DolceMap,

        [AllowNull()]
        $ConceptRefs
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
    # Concept refs (term:* universals, t/3389/t/3251): a concept is a UNIVERSAL (kind), sort='universal'
    # (distinct from the 5 particular DolceCategory sorts), match_level='exact'. They ground the about[]
    # split -> topical_candidates. Mirrors #2078. (Dormant on summaries today — 0 concept_refs there.)
    foreach ($r in @($ConceptRefs)) {
        if (-not $r -or -not $r.PSObject.Properties['ref']) { continue }
        $ref = [string]$r.ref
        if ([string]::IsNullOrWhiteSpace($ref)) { continue }
        $surface = if ($r.PSObject.Properties['surface']) { [string]$r.surface } else { '' }
        $rows.Add([pscustomobject]@{ ref = $ref; surface = $surface; match_level = 'exact'; sort = 'universal' })
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
                # lit:"…" or event var — the model's DOLCE-lite sort, COERCED to the 5-value set
                # (t/3215#3 belt (b)): the prompt now constrains it, but a residual out-of-set sort is
                # coerced (never dropped/nuked) so one bad lit sort can't reject an otherwise-good form.
                $rawSort = if ($a.PSObject.Properties['sort']) { [string]$a.sort } else { '' }
                $sort = ConvertTo-DolceSort -Sort $rawSort
                $ml   = if ($a.PSObject.Properties['match_level']) { [string]$a.match_level } else { 'exact' }
            }
            $groundedArgs.Add([ordered]@{ role = $role; ref = $ref; sort = $sort; match_level = $ml })
        }
    }

    # ── about[] / topical_candidates: Option C split (t/3389, e/145#13-#16; mirrors #2078) ────────────
    # Grounded refs only (in the claim's entity_refs/concept_refs = $byRef) — R6/t/2294, never mint.
    # ent-* -> about[]; term:* concept refs -> topical_candidates.refs (about[] reverts to ent-only for
    # NEW generations; concept refs carry the topical signal under a quality-marked provenance block).
    # match_level is copied authoritatively from the register (enum-clamped so a concept's universal sort
    # can never leak into match_level, t/3379) — never the model's guess.
    $groundedAbout = [System.Collections.Generic.List[object]]::new()
    $candidateRefs = [System.Collections.Generic.List[object]]::new()
    if ($Raw.PSObject.Properties['about'] -and $Raw.about) {
        foreach ($ab in @($Raw.about)) {
            if (-not $ab -or -not $ab.PSObject.Properties['ref']) { continue }
            $ref = [string]$ab.ref
            if (-not $byRef.ContainsKey($ref)) {
                Write-Verbose "LogicalForm: dropped about ref '$ref' — not grounded in the claim's refs (R6)."
                continue
            }
            $ml = [string]$byRef[$ref].match_level
            if ($ml -notin $script:LogicalFormMatchLevels) { $ml = 'exact' }
            $entry = [ordered]@{ ref = $ref; match_level = $ml }
            if ($ref -like 'ent-*') { $groundedAbout.Add($entry) }
            else { $candidateRefs.Add($entry) }   # term:* concept ref -> topical_candidates
        }
    }
    # topical_candidates present ONLY when concept refs exist (absent != null, t/2943). Provenance is
    # stamped FRESH by this generator each call (e/145#14(c) lifecycle rule — never a shared/stale ref).
    $topicalCandidates = $null
    if ($candidateRefs.Count -gt 0) {
        $topicalCandidates = [ordered]@{
            validated              = $script:TopicalCandidatesProvenance.validated
            generator              = $script:TopicalCandidatesProvenance.generator
            golden_ref             = $script:TopicalCandidatesProvenance.golden_ref
            blind_golden_precision = $script:TopicalCandidatesProvenance.blind_golden_precision
            refs                   = $candidateRefs.ToArray()
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

    $result = [ordered]@{
        predicate = $predicate
        event_ref = $eventRef
        args      = $groundedArgs.ToArray()
        polarity  = $polarity
        modality  = $modality
        temporal  = [ordered]@{ type = $tempType; value = $tempValue }
        about     = $groundedAbout.ToArray()
    }
    # topical_candidates sits after about[] when concept refs exist (absent != null, t/2943 — never a null key).
    if ($null -ne $topicalCandidates) { $result['topical_candidates'] = $topicalCandidates }
    $result['formalization_confidence'] = $conf
    $result['status'] = $status
    return [pscustomobject]$result
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

    # about[] stays TOLERANT of term: refs in phase-1 — NO ^ent- tightening here (Option C, t/3389).
    # Tightening about[].ref to ent-* only is PHASE-3, after the t/3391 corpus migration: enforcing
    # ^ent- before the 1560 term: refs migrate would red the corpus (e/145#15/#16, land-order is
    # load-bearing). Remove this note + add the ^ent- check together in phase-3.
    foreach ($ab in @($lf.about)) {
        if ([string]::IsNullOrWhiteSpace([string]$ab.ref)) { return [pscustomobject]@{ Ok = $false; Reason = 'about missing ref' } }
        if ([string]$ab.match_level -notin $script:LogicalFormMatchLevels) { return [pscustomobject]@{ Ok = $false; Reason = "about match_level '$($ab.match_level)' invalid" } }
    }

    # topical_candidates (Option C phase-1, t/3389): OPTIONAL. Absent is valid (absent != null, t/2943);
    # present must be a well-formed quality-marked block. This is the migration front-edge — all four
    # validator ports ACCEPT the field before any data moves (e/145#13/#16). Handles both a generator-
    # produced ordered-dict and a JSON-parsed PSObject (dual-type accessor below).
    if ($lf.PSObject.Properties['topical_candidates'] -and $null -ne $lf.topical_candidates) {
        $getp = {
            param($o, $n)
            if ($null -eq $o) { return $null }
            if ($o -is [System.Collections.IDictionary]) { if ($o.Contains($n)) { return $o[$n] } return $null }
            $p = $o.PSObject.Properties[$n]; if ($p) { return $p.Value } return $null
        }
        $tc = $lf.topical_candidates
        if (($tc -isnot [System.Collections.IDictionary]) -and ($tc -isnot [psobject])) {
            return [pscustomobject]@{ Ok = $false; Reason = 'topical_candidates must be an object' }
        }
        if ((& $getp $tc 'validated') -isnot [bool]) { return [pscustomobject]@{ Ok = $false; Reason = 'topical_candidates.validated must be a boolean' } }
        if ([string]::IsNullOrWhiteSpace([string](& $getp $tc 'generator')))  { return [pscustomobject]@{ Ok = $false; Reason = 'topical_candidates.generator empty' } }
        if ([string]::IsNullOrWhiteSpace([string](& $getp $tc 'golden_ref'))) { return [pscustomobject]@{ Ok = $false; Reason = 'topical_candidates.golden_ref empty' } }
        $prec = (& $getp $tc 'blind_golden_precision')
        $precD = 0.0
        $precOk = ($null -ne $prec) -and [double]::TryParse([string]$prec, [ref]$precD)
        if (-not $precOk -or $precD -lt 0.0 -or $precD -gt 1.0) { return [pscustomobject]@{ Ok = $false; Reason = 'topical_candidates.blind_golden_precision not in [0,1]' } }
        foreach ($r in @(& $getp $tc 'refs')) {
            $rref = [string](& $getp $r 'ref')
            if ($rref -notmatch $script:TopicalCandidateRefPattern) { return [pscustomobject]@{ Ok = $false; Reason = "topical_candidates ref '$rref' must match $($script:TopicalCandidateRefPattern)" } }
            $rml = [string](& $getp $r 'match_level')
            if ($rml -notin $script:LogicalFormMatchLevels) { return [pscustomobject]@{ Ok = $false; Reason = "topical_candidates ref '$rref' match_level '$rml' invalid" } }
        }
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
