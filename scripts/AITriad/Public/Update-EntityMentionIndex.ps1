# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Update-EntityMentionIndex {
    <#
    .SYNOPSIS
        Rebuilds entity_mentions.json — the derived, alias-first mention index over the
        curated batch tier (t/1894, Phase 2-B; epic t/1890 design of record §5/§7).
    .DESCRIPTION
        The retroactive re-index (§7): the durable rebuild path for entity_mentions.json,
        a DERIVED artifact (never a source of truth). Scans each curated container's exact
        analyzed text for entity aliases and writes one Mention per hit. By default only
        APPROVED entities are indexed (design of record §5; the D1 caller-filters-to-approved
        contract) — widen with -Status to build a preview over proposed/deprecated records.

        Matching is ALIAS-FIRST and deterministic — an alias table (name + aliases) over the
        in-scope entities in entities.json (default: status 'approved'), matched
        case-insensitively with word boundaries and flexible interior whitespace. No AI call,
        no embeddings; embedding tie-break is D1 (Shared Lib), out of scope here. The
        populated statuses are recorded in the envelope's `indexed_status`, so a curated
        index is distinguishable from a preview by inspecting the file.

        Container sources (the curated batch tier — facts + POV, design §5):
          - Source-Evidence-Index facts: container id `sei:<sei_key>`, text = the entry's
            `facts[].claim` values joined by newline in file order.
          - POV / situation nodes: container id `node:<node_id>`, text = `label`, then
            `description`, then `plain_description` (present fields only), newline-separated.
        Live statement-side (debate/chat, `<debate_id>#<entry_id>`) is Phase 2b — NOT here.

        Per-container `text_sha256` (lowercase hex over the exact text's UTF-8 bytes) is the
        idempotency + supersession guard: re-running on unchanged input is a byte-stable
        no-op (extracted_at and the file are only rewritten when a container actually
        changes). Overlapping alias hits are settled by the longest-most-specific rule
        (§2), ties broken deterministically (length desc, offset asc, entity_ref asc).

        Human-authored mentions win (§5): on rebuild, existing `discovered_by:'human'`
        mentions on a container whose text is UNCHANGED (matching text_sha256) are preserved
        and take precedence over overlapping alias hits. If the container text changed, prior
        mentions were computed against text that no longer exists and are dropped
        (supersession). Containers with no resulting mentions are omitted (absence == "no
        links yet").
    .PARAMETER EntitiesPath
        Override entities.json path (fixtures/tests). Defaults to Get-EntitiesFilePath.
    .PARAMETER SourceEvidenceIndexPath
        Override source_evidence_index.json path. Defaults to
        Join-Path (Get-TaxonomyDir) 'source_evidence_index.json'. Absent file = skipped.
    .PARAMETER PovPath
        Override the POV/situation node files to scan. Defaults to the four canonical files
        under Get-TaxonomyDir (accelerationist/safetyist/skeptic/situations). Pass @() to
        skip POV containers entirely. Absent files are skipped (non-fatal).
    .PARAMETER OutputPath
        Override entity_mentions.json output path. Defaults to Get-EntityMentionsFilePath.
    .PARAMETER Status
        Which entity statuses to index. Default @('approved') — the design-of-record §5
        population and the D1 caller-filters-to-approved contract. Pass e.g.
        -Status approved,proposed to build an explicit PREVIEW over un-curated candidates
        (useful before any entity has been approved, so the Phase-2 render is not empty).
        The populated set is recorded in the output envelope's `indexed_status`.
    .PARAMETER Force
        Rewrite the file even when the containers are unchanged (bumps last_modified).
        Without -Force an unchanged rebuild is a no-op that does not touch the file.
    .EXAMPLE
        Update-EntityMentionIndex
    .EXAMPLE
        Update-EntityMentionIndex -PovPath @()   # facts-only re-index
    .LINK
        Invoke-EntityExtraction
    .LINK
        Get-EntityReport
    #>
    [CmdletBinding(SupportsShouldProcess)]
    [OutputType([PSCustomObject])]
    param(
        [Parameter()]
        [string]$EntitiesPath,

        [Parameter()]
        [string]$SourceEvidenceIndexPath,

        [Parameter()]
        [string[]]$PovPath,

        [Parameter()]
        [Alias('Path')]
        [string]$OutputPath,

        [Parameter()]
        [ValidateSet('proposed', 'approved', 'deprecated')]
        [string[]]$Status = @('approved'),

        [Parameter()]
        [switch]$Force
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $EntPath = if ($EntitiesPath) { $EntitiesPath } else { Get-EntitiesFilePath }
    $SeiPath = if ($SourceEvidenceIndexPath) { $SourceEvidenceIndexPath } else { Join-Path (Get-TaxonomyDir) 'source_evidence_index.json' }
    $OutPath = if ($OutputPath) { $OutputPath } else { Get-EntityMentionsFilePath }
    if ($PSBoundParameters.ContainsKey('PovPath')) {
        $PovFiles = @($PovPath)
    }
    else {
        $TaxDir = Get-TaxonomyDir
        $PovFiles = @('accelerationist.json', 'safetyist.json', 'skeptic.json', 'situations.json') |
            ForEach-Object { Join-Path $TaxDir $_ }
    }

    # Safe field read across both shapes we handle: [ordered] dicts (our freshly-built
    # mentions) and PSCustomObject (parsed from a possibly hand-edited entity_mentions.json).
    # Returns $null for an absent field instead of throwing under StrictMode.
    $GetProp = {
        param($o, $k)
        if ($null -eq $o) { return $null }
        if ($o -is [System.Collections.IDictionary]) { if ($o.Contains($k)) { return $o[$k] } else { return $null } }
        if ($o.PSObject.Properties[$k]) { return $o.$k }
        return $null
    }

    # By-value mention-list equality (avoids fragile JSON-string comparison across the
    # ordered-dict vs parsed-PSCustomObject boundary).
    $MentionsEqual = {
        param($a, $b)
        $aa = @($a); $bb = @($b)
        if ($aa.Count -ne $bb.Count) { return $false }
        for ($i = 0; $i -lt $aa.Count; $i++) {
            if ([string](& $GetProp $aa[$i] 'entity_ref') -ne [string](& $GetProp $bb[$i] 'entity_ref')) { return $false }
            if ([string](& $GetProp $aa[$i] 'quote') -ne [string](& $GetProp $bb[$i] 'quote')) { return $false }
            if ([string](& $GetProp $aa[$i] 'offset') -ne [string](& $GetProp $bb[$i] 'offset')) { return $false }
            if ([string](& $GetProp $aa[$i] 'discovered_by') -ne [string](& $GetProp $bb[$i] 'discovered_by')) { return $false }
        }
        return $true
    }

    # --- Alias table over in-scope entities (default: status 'approved'): normalized surface -> raw ent-* ref ------------
    $Store = Get-EntitiesStore -Path $EntPath -InitIfMissing
    $Entities = if ($Store.PSObject.Properties['entities']) { @($Store.entities) } else { @() }

    $AliasEntries = [System.Collections.Generic.List[object]]::new()
    foreach ($e in $Entities) {
        if (-not $e.PSObject.Properties['id']) { continue }
        # Status gate (§5 curation contract): index only the requested statuses; default is
        # approved-only. A record without a `status` field is treated as un-indexable.
        $eStatus = if ($e.PSObject.Properties['status']) { [string]$e.status } else { '' }
        if ($eStatus -notin $Status) { continue }
        $ref = [string]$e.id
        $surfaces = [System.Collections.Generic.List[string]]::new()
        if ($e.PSObject.Properties['name'] -and $e.name) { $surfaces.Add([string]$e.name) }
        # aliases is frequently `null` (not []) in live data — @($null) collapses safely.
        if ($e.PSObject.Properties['aliases']) {
            foreach ($a in @($e.aliases)) { if ($a) { $surfaces.Add([string]$a) } }
        }
        foreach ($s in $surfaces) {
            # Normalize the alias per the D1 parity contract (Get-NormalizedName: NFC +
            # ToLowerInvariant + collapse the pinned whitespace set + trim).
            $norm = Get-NormalizedName -Name $s
            if (-not $norm) { continue }
            # Match the normalized (already-lowercased, single-space) alias against the NFC+
            # lowercased container text, tolerating any run of the SAME pinned whitespace set
            # between tokens. No IgnoreCase — the text is pre-lowercased with ToLowerInvariant,
            # so casing mirrors D1 exactly (regex case-folding would NOT). Word boundaries
            # delimit the in-text span (this span-delimiting extends beyond the pure equality
            # contract — flagged to Shared Lib for concurrence).
            $tokens = $norm -split ' '
            $pattern = (($tokens | ForEach-Object { [regex]::Escape($_) }) -join "$script:PinnedWhitespaceClass+")
            $rx = [regex]::new("(?<!\w)$pattern(?!\w)")
            $AliasEntries.Add([PSCustomObject]@{ EntityRef = $ref; Regex = $rx })
        }
    }

    # --- Existing index (for human-mention preservation + idempotency) ---------------------
    $ExistingById = @{}
    $ExistingLastModified = $null
    if (Test-Path -LiteralPath $OutPath) {
        try {
            $prior = Get-Content -Raw -LiteralPath $OutPath -Encoding utf8 | ConvertFrom-Json
            if ($prior.PSObject.Properties['last_modified']) { $ExistingLastModified = [string]$prior.last_modified }
            if ($prior.PSObject.Properties['containers'] -and $prior.containers) {
                foreach ($p in $prior.containers.PSObject.Properties) { $ExistingById[$p.Name] = $p.Value }
            }
        }
        catch {
            Write-Verbose "Existing $OutPath unreadable ($($_.Exception.Message)); rebuilding from scratch."
        }
    }

    # --- Collect containers: id -> exact analyzed text ------------------------------------
    $Containers = [ordered]@{}   # insertion order irrelevant; sorted before write

    if (Test-Path -LiteralPath $SeiPath) {
        $Sei = Get-Content -Raw -LiteralPath $SeiPath -Encoding utf8 | ConvertFrom-Json -AsHashtable
        foreach ($key in ($Sei.Keys | Sort-Object)) {
            $entry = $Sei[$key]
            if (-not ($entry -is [System.Collections.IDictionary]) -or -not $entry.ContainsKey('facts')) { continue }
            $claims = @($entry['facts'] | ForEach-Object {
                    if ($_ -is [System.Collections.IDictionary] -and $_.ContainsKey('claim')) { [string]$_['claim'] }
                })
            $text = Get-MentionContainerText -Kind 'sei' -Fields $claims
            if ($text -eq '') { continue }
            $Containers["sei:$key"] = $text
        }
    }
    else {
        Write-Verbose "SEI not found at $SeiPath; skipping fact containers."
    }

    foreach ($povFile in $PovFiles) {
        if (-not (Test-Path -LiteralPath $povFile)) {
            Write-Verbose "POV file not found: $povFile; skipping."
            continue
        }
        $pov = Get-Content -Raw -LiteralPath $povFile -Encoding utf8 | ConvertFrom-Json
        if (-not $pov.PSObject.Properties['nodes']) { continue }
        foreach ($node in @($pov.nodes)) {
            if (-not $node.PSObject.Properties['id']) { continue }
            # Pass field values in fixed order ($null for absent); the helper applies the
            # omission rule (null/"" omitted, whitespace kept) and the "\n\n" join + NFC.
            $vals = foreach ($field in @('label', 'description', 'plain_description')) {
                if ($node.PSObject.Properties[$field]) { $node.$field } else { $null }
            }
            $text = Get-MentionContainerText -Kind 'node' -Fields @($vals)
            if ($text -eq '') { continue }
            $Containers["node:$($node.id)"] = $text
        }
    }

    # --- Scan each container; build canonical container records ---------------------------
    $NewContainers = [ordered]@{}
    $TotalMentions = 0
    $AnyContentChanged = $false

    foreach ($cid in ($Containers.Keys | Sort-Object)) {
        # $nfc IS the "exact analyzed text" — already NFC-canonical from Get-MentionContainerText
        # (contract step: reconstruct then NFC the whole). text_sha256 pins it; offset/quote index
        # into it. $lower mirrors D1's ToLowerInvariant for matching; for the Latin corpus
        # lowercasing is length-preserving, so match offsets align 1:1 with $nfc and quote is
        # sliced from $nfc to preserve original casing.
        $nfc = [string]$Containers[$cid]
        $lower = $nfc.ToLowerInvariant()
        $sha = Get-TextSha256 -Text $nfc

        # Preserve human mentions only when the container text is unchanged (else supersede).
        $accepted = [System.Collections.Generic.List[object]]::new()   # {Offset,Length,Quote,EntityRef,By}
        if ($ExistingById.ContainsKey($cid)) {
            $ex = $ExistingById[$cid]
            if ($ex.PSObject.Properties['text_sha256'] -and [string]$ex.text_sha256 -eq $sha -and $ex.PSObject.Properties['mentions']) {
                foreach ($m in @($ex.mentions)) {
                    if ([string](& $GetProp $m 'discovered_by') -ne 'human') { continue }
                    # Human mentions are hand-editable (§5) — read defensively and skip a
                    # malformed entry (missing offset/quote/ref) rather than throwing.
                    $q = & $GetProp $m 'quote'
                    $off = & $GetProp $m 'offset'
                    $eref = & $GetProp $m 'entity_ref'
                    if ($null -eq $q -or $null -eq $off -or $null -eq $eref) {
                        Write-Verbose "Skipping malformed human mention in container '$cid' (missing offset/quote/entity_ref)."
                        continue
                    }
                    $qs = [string]$q
                    $accepted.Add([PSCustomObject]@{
                            Offset = [int]$off; Length = $qs.Length; Quote = $qs
                            EntityRef = [string]$eref; By = 'human'
                        })
                }
            }
        }

        # Candidate alias hits.
        $candidates = [System.Collections.Generic.List[object]]::new()
        $sliceable = ($nfc.Length -eq $lower.Length)
        foreach ($ae in $AliasEntries) {
            foreach ($mt in $ae.Regex.Matches($lower)) {
                $quote = if ($sliceable) { $nfc.Substring($mt.Index, $mt.Length) } else { $mt.Value }
                $candidates.Add([PSCustomObject]@{
                        Offset = $mt.Index; Length = $mt.Length; Quote = $quote
                        EntityRef = $ae.EntityRef; By = 'alias'
                    })
            }
        }

        # Longest-most-specific overlap resolution; human intervals (seeded) win.
        $ordered = @($candidates | Sort-Object -Property @{Expression = 'Length'; Descending = $true },
            @{Expression = 'Offset'; Descending = $false },
            @{Expression = 'EntityRef'; Descending = $false })
        foreach ($c in $ordered) {
            $cEnd = $c.Offset + $c.Length
            $overlaps = $false
            foreach ($a in $accepted) {
                $aEnd = $a.Offset + $a.Length
                if ($c.Offset -lt $aEnd -and $a.Offset -lt $cEnd) { $overlaps = $true; break }
            }
            if (-not $overlaps) { $accepted.Add($c) }
        }

        if (@($accepted).Count -eq 0) { continue }

        $mentions = @($accepted |
                Sort-Object -Property @{Expression = 'Offset'; Descending = $false }, @{Expression = 'EntityRef'; Descending = $false } |
                ForEach-Object {
                    [ordered]@{
                        entity_ref    = $_.EntityRef
                        quote         = $_.Quote
                        offset        = [int]$_.Offset
                        discovered_by = $_.By
                    }
                })
        $TotalMentions += @($mentions).Count

        # Reuse extracted_at when this container's text + mentions are unchanged; otherwise
        # it is new/changed content and the file must be rewritten with a fresh timestamp.
        $extractedAt = $null
        if ($ExistingById.ContainsKey($cid)) {
            $ex = $ExistingById[$cid]
            $exMentions = if ($ex.PSObject.Properties['mentions']) { @($ex.mentions) } else { @() }
            if ($ex.PSObject.Properties['text_sha256'] -and [string]$ex.text_sha256 -eq $sha -and
                (& $MentionsEqual $exMentions $mentions) -and $ex.PSObject.Properties['extracted_at']) {
                $extractedAt = [string]$ex.extracted_at
            }
        }
        if (-not $extractedAt) {
            $extractedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
            $AnyContentChanged = $true
        }

        $NewContainers[$cid] = [ordered]@{
            text_sha256  = $sha
            extracted_at = $extractedAt
            mentions     = $mentions
        }
    }

    # --- Idempotency: unchanged iff same container key-set AND no container content changed.
    # $AnyContentChanged already flags added/content-changed containers (fresh timestamp);
    # a removed container drops its key, so the key-set check catches deletions.
    $newKeys = @($NewContainers.Keys | Sort-Object)
    $oldKeys = @($ExistingById.Keys | Sort-Object)
    $sameKeys = (($newKeys -join "`n") -eq ($oldKeys -join "`n"))
    $unchanged = $sameKeys -and (-not $AnyContentChanged)
    $lastModified = if ($unchanged -and $ExistingLastModified) { $ExistingLastModified } else { (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ") }

    $result = [PSCustomObject]@{
        OutputPath     = $OutPath
        ContainerCount = @($NewContainers.Keys).Count
        MentionCount   = $TotalMentions
        AliasCount     = @($AliasEntries).Count
        IndexedStatus  = @($Status | Sort-Object -Unique)
        Unchanged      = $unchanged
        Written        = $false
    }

    if ($unchanged -and -not $Force) {
        Write-Verbose "entity_mentions.json unchanged ($($result.ContainerCount) containers); no write."
        return $result
    }

    $file = [ordered]@{
        _schema_version = '1.0.0'
        _doc            = 'Derived artifact — rebuildable via Update-EntityMentionIndex (re-index, epic t/1890 design §7). Absence of a container means "no links yet", never an error.'
        indexed_status  = @($Status | Sort-Object -Unique)
        last_modified   = $lastModified
        containers      = $NewContainers
    }

    if ($PSCmdlet.ShouldProcess($OutPath, "Write entity_mentions.json ($($result.ContainerCount) containers, $TotalMentions mentions)")) {
        $json = ConvertTo-Json $file -Depth 8
        $tmp = "$OutPath.tmp"
        try {
            Set-Content -LiteralPath $tmp -Value $json -Encoding utf8NoBOM
            [System.IO.File]::Move($tmp, $OutPath, $true)
        }
        catch {
            if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
            throw (New-ActionableError -PassThru `
                    -Goal 'Write the entity mention index' `
                    -Problem "Failed to write ${OutPath}: $($_.Exception.Message)" `
                    -Location 'Update-EntityMentionIndex' `
                    -NextSteps @('Verify the data-repo path is writable', 'Check disk space and that the taxonomy directory exists') `
                    -InnerError $_)
        }
        $result.Written = $true
    }

    return $result
}
