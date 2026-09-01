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

        Container sources — alias-first mention indexing over NON-NODE content text
        (source-evidence facts + summary content):
          - Source-Evidence-Index facts: container id `sei:<sei_key>`, text = the entry's
            `facts[].claim` values joined by newline in file order.
          - Summary key points (t/3122, claims-entity-fol-recommendations.md §4/R2.2 T2):
            container id `summary:<doc_id>#<pov>-kp-<n>` where <pov> ∈ acc/saf/skp, text = the
            key point's `point` field. `<n>` is a 0-based index reset PER POV array
            (`pov_summaries.<pov>.key_points`). POV-scoping (CL ruling p/23#220-221) confines
            renumber-churn to a single POV array instead of cascading a running counter across
            all three; key_points carry no stable per-claim id (taxonomy_node_id is a non-unique
            node reference), so positional is the pragmatic key and inserts within a POV still
            churn that array's tail (the reconciler must tolerate it).
          - Summary factual claims (t/3122, same doc §4/R2.2 T2): container id
            `summary:<doc_id>#fc-<n>`, text = the `factual_claims[n].claim` field, `<n>` the
            0-based index into that array.
        Live statement-side (debate/chat, `<debate_id>#<entry_id>`) is Phase 2b — NOT here.

        DISJOINT-SCOPE BOUNDARY (t/3160 G7, TL-approved contract t/3160#2-#3): this cmdlet
        owns ONLY {sei:*, summary:*} — alias-first mention indexing over source-evidence and
        summary content text. `node:*` mentions are NODE-GROUNDING (resolved from node text
        alongside concept_refs / entity_refs / used_by_nodes) and are owned by CL's hash-gated
        Python reconciler (research/comp-linguist/scripts/reconcile_grounding.py), not here.
        This cmdlet NEVER emits a `node:*` key; the two tools write disjoint container sets
        (asserted in the test suite). node:* was moved out here after the reconciler shipped
        (#1712) and covered pov+sit nodes — the sequenced no-orphan handoff.

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
    .PARAMETER SummariesPath
        Override the summary JSON files to scan for `summary:<doc_id>#kp-<n>` /
        `#fc-<n>` containers (t/3122). Defaults to every `*.json` file directly under
        Get-SummariesDir. Pass @() to skip summary containers entirely. Absent files/dir
        are skipped (non-fatal).
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
        Update-EntityMentionIndex -SummariesPath @()   # sei:*-only re-index (skip summary containers)
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
        [string[]]$SummariesPath,

        [Parameter()]
        [Alias('Path')]
        [string]$OutputPath,

        [Parameter()]
        [ValidateSet('proposed', 'approved', 'deprecated')]
        [string[]]$Status = @('approved'),

        [Parameter()]
        [switch]$Force,

        # Advisory lockfile timeout in seconds (default 60). Override in tests for fast timeout.
        [Parameter()]
        [int]$LockTimeoutSeconds = 60
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $EntPath = if ($EntitiesPath) { $EntitiesPath } else { Get-EntitiesFilePath }
    $SeiPath = if ($SourceEvidenceIndexPath) { $SourceEvidenceIndexPath } else { Join-Path (Get-TaxonomyDir) 'source_evidence_index.json' }
    $OutPath = if ($OutputPath) { $OutputPath } else { Get-EntityMentionsFilePath }
    if ($PSBoundParameters.ContainsKey('SummariesPath')) {
        $SummaryFiles = @($SummariesPath)
    }
    else {
        $SummDir = Get-SummariesDir
        if (Test-Path -LiteralPath $SummDir) {
            $SummaryFiles = @(Get-ChildItem -LiteralPath $SummDir -Filter '*.json' -File |
                    Sort-Object -Property Name | ForEach-Object { $_.FullName })
        }
        else {
            Write-Verbose "Summaries dir not found: $SummDir; skipping summary containers."
            $SummaryFiles = @()
        }
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

    # --- Collect containers: id -> exact analyzed text (outside lock — heavy load) -----------
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

    # node:* (POV/situation node grounding) is NO LONGER built here — it moved to CL's
    # hash-gated Python reconciler (reconcile_grounding.py) under the t/3160 G7 disjoint-scope
    # contract. This cmdlet owns {sei:*, summary:*} only; the disjoint-scope test asserts no
    # node:* key is ever emitted.

    # --- Summary key points + factual claims (t/3122, §4/R2.2 T2) -------------------------
    foreach ($summaryFile in $SummaryFiles) {
        if (-not (Test-Path -LiteralPath $summaryFile)) {
            Write-Verbose "Summary file not found: $summaryFile; skipping."
            continue
        }
        $summary = Get-Content -Raw -LiteralPath $summaryFile -Encoding utf8 | ConvertFrom-Json
        if (-not $summary.PSObject.Properties['doc_id'] -or -not $summary.doc_id) { continue }
        $docId = [string]$summary.doc_id

        # key_points: POV-SCOPED 0-based index — `summary:<doc_id>#<pov>-kp-<n>` (<pov> ∈
        # acc/saf/skp), `<n>` reset per POV array. CL ruling (p/23#220-221): a single running
        # counter across the three arrays is positionally fragile — inserting/removing a
        # key_point in one POV renumbers every later container id, churning unrelated refs and
        # spuriously staling their text_sha256. No stable per-claim id exists on a key_point
        # (taxonomy_node_id is a non-unique node reference), so POV-scoped positional is the
        # pragmatic key; inserts WITHIN a POV array still churn that array's tail.
        if ($summary.PSObject.Properties['pov_summaries'] -and $summary.pov_summaries) {
            $povCode = @{ accelerationist = 'acc'; safetyist = 'saf'; skeptic = 'skp' }
            foreach ($povName in @('accelerationist', 'safetyist', 'skeptic')) {
                if (-not $summary.pov_summaries.PSObject.Properties[$povName]) { continue }
                $povData = $summary.pov_summaries.$povName
                if (-not $povData -or -not $povData.PSObject.Properties['key_points'] -or -not $povData.key_points) { continue }
                $code = $povCode[$povName]
                $kpIndex = 0
                foreach ($kp in @($povData.key_points)) {
                    $pointVal = if ($kp.PSObject.Properties['point']) { $kp.point } else { $null }
                    $text = Get-MentionContainerText -Kind 'kp' -Fields @($pointVal)
                    if ($text -ne '') { $Containers["summary:$docId#$code-kp-$kpIndex"] = $text }
                    $kpIndex++
                }
            }
        }

        # factual_claims: 0-based index into the top-level array.
        if ($summary.PSObject.Properties['factual_claims'] -and $summary.factual_claims) {
            $claims = @($summary.factual_claims)
            for ($i = 0; $i -lt $claims.Count; $i++) {
                $claimVal = if ($claims[$i].PSObject.Properties['claim']) { $claims[$i].claim } else { $null }
                $text = Get-MentionContainerText -Kind 'fc' -Fields @($claimVal)
                if ($text -ne '') { $Containers["summary:$docId#fc-$i"] = $text }
            }
        }
    }

    # --- Advisory lockfile (entity_mentions.lock) — shared with reconcile_grounding.py (t/3203) --
    # Alias table and container collection (heavy loads) complete above, outside the lock.
    # Lock wraps only the read-merge-write of entity_mentions.json.
    # Contract: exclusive create (O_CREAT|O_EXCL equivalent); stale lock (>120 s mtime) is
    # broken with Write-Warning (fallback-path logging rule); bounded wait 0.5 s poll / 60 s timeout.
    $LockPath = "$OutPath.lock"
    $LockStream = $null
    $LockStaleSec = 120
    $LockWaitStart = [System.Diagnostics.Stopwatch]::StartNew()

    while ($true) {
        try {
            $LockStream = [System.IO.File]::Open(
                $LockPath,
                [System.IO.FileMode]::CreateNew,
                [System.IO.FileAccess]::Write,
                [System.IO.FileShare]::None)
            break   # exclusive lock acquired
        }
        catch [System.IO.IOException] {
            # Lock file exists — inspect staleness before deciding to wait
            $lockItem = Get-Item -LiteralPath $LockPath -ErrorAction SilentlyContinue
            if ($lockItem) {
                $lockAgeSec = ((Get-Date) - $lockItem.LastWriteTime).TotalSeconds
                if ($lockAgeSec -gt $LockStaleSec) {
                    Write-Warning ("Update-EntityMentionIndex: breaking stale entity_mentions.lock " +
                        "(age $([int]$lockAgeSec)s > ${LockStaleSec}s); prior writer may have crashed. Re-acquiring.")
                    Remove-Item -LiteralPath $LockPath -Force -ErrorAction SilentlyContinue
                    continue   # retry immediately after stale-break
                }
            }
            if ($LockWaitStart.Elapsed.TotalSeconds -ge $LockTimeoutSeconds) {
                throw (New-ActionableError -PassThru `
                        -Goal      'Update the entity mention index (entity_mentions.json)' `
                        -Problem   "Timed out after ${LockTimeoutSeconds}s waiting for advisory lockfile '$LockPath'. Another Update-EntityMentionIndex or reconcile_grounding.py may be running." `
                        -Location  'Update-EntityMentionIndex' `
                        -NextSteps @(
                            'Check whether another Update-EntityMentionIndex or reconcile_grounding.py process is running',
                            "Delete '$LockPath' manually if the previous writer crashed and the lock is stale (> ${LockStaleSec}s old)"))
            }
            Start-Sleep -Milliseconds 500
        }
    }
    try {

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

    # --- Disjoint-scope preservation (t/3160 G7) -----------------------------------------
    # entity_mentions.json is a SHARED file. This cmdlet OWNS {sei:*, summary:*} and rewrites
    # ONLY those. CL's Python reconciler owns node:* (node grounding) and read-merge-writes the
    # SAME file, preserving our sei:*/summary:* (it asserts sei:* unchanged). We MUST symmetrically
    # preserve THEIR containers: every existing container this cmdlet does NOT own is carried
    # forward VERBATIM, so a mention-index rebuild never clobbers reconciler-owned node:* — the
    # no-orphan half of the disjoint-scope contract. Without this, the full-file write below would
    # DELETE node:* on every rebuild.
    $IsOwnedKey = { param($k) ($k -like 'sei:*') -or ($k -like 'summary:*') }

    # Defensive disjoint-scope guard: this cmdlet must never itself BUILD a non-owned key.
    $ownBuiltForeign = @($NewContainers.Keys | Where-Object { -not (& $IsOwnedKey $_) })
    if ($ownBuiltForeign.Count -gt 0) {
        throw (New-ActionableError `
                -Goal     'Rebuild the entity mention index within its {sei:*, summary:*} scope' `
                -Problem  "Built container key(s) outside scope: $($ownBuiltForeign -join ', '). node:* grounding is owned by the CL reconciler (t/3160 G7)." `
                -Location 'Update-EntityMentionIndex' `
                -NextSteps @('Disjoint-scope regression — the cmdlet must only produce sei:*/summary:* keys. Check the container-collection blocks.'))
    }

    # Final map = preserved foreign (verbatim) + freshly-built own, key-sorted for a stable file.
    $FinalContainers = [ordered]@{}
    $PreservedForeign = 0
    $mergedKeys = [System.Collections.Generic.List[string]]::new()
    foreach ($k in $ExistingById.Keys) { if (-not (& $IsOwnedKey $k)) { $mergedKeys.Add([string]$k); $PreservedForeign++ } }
    foreach ($k in $NewContainers.Keys) { $mergedKeys.Add([string]$k) }
    foreach ($cid in ($mergedKeys | Sort-Object)) {
        $FinalContainers[$cid] = if ($NewContainers.Contains($cid)) { $NewContainers[$cid] } else { $ExistingById[$cid] }
    }

    # --- Idempotency: unchanged iff same FINAL container key-set AND no OWN content changed.
    # Preserved foreign containers are verbatim (never drive a rewrite); $AnyContentChanged tracks
    # own-container content, and the key-set check catches own add/remove (a removed own container
    # drops its key). Comparing the FINAL key-set (own + preserved) vs the existing file's keys.
    $newKeys = @($FinalContainers.Keys | Sort-Object)
    $oldKeys = @($ExistingById.Keys | Sort-Object)
    $sameKeys = (($newKeys -join "`n") -eq ($oldKeys -join "`n"))
    $unchanged = $sameKeys -and (-not $AnyContentChanged)
    $lastModified = if ($unchanged -and $ExistingLastModified) { $ExistingLastModified } else { (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ") }

    $result = [PSCustomObject]@{
        OutputPath            = $OutPath
        ContainerCount        = @($NewContainers.Keys).Count   # containers THIS cmdlet built (sei:*/summary:*)
        PreservedForeignCount = $PreservedForeign              # node:* etc. carried forward untouched (t/3160 G7)
        MentionCount          = $TotalMentions
        AliasCount            = @($AliasEntries).Count
        IndexedStatus         = @($Status | Sort-Object -Unique)
        Unchanged             = $unchanged
        Written               = $false
    }

    if ($unchanged -and -not $Force) {
        Write-Verbose "entity_mentions.json unchanged ($($result.ContainerCount) own + $PreservedForeign preserved containers); no write."
        return $result
    }

    $file = [ordered]@{
        _schema_version = '1.0.0'
        _doc            = 'Derived artifact — rebuildable via Update-EntityMentionIndex (re-index, epic t/1890 design §7). This tool owns {sei:*, summary:*}; node:* is owned by the CL grounding reconciler (t/3160 G7) and is preserved verbatim on rebuild. Absence of a container means "no links yet", never an error.'
        indexed_status  = @($Status | Sort-Object -Unique)
        last_modified   = $lastModified
        containers      = $FinalContainers
    }

    if ($PSCmdlet.ShouldProcess($OutPath, "Write entity_mentions.json ($($result.ContainerCount) own + $PreservedForeign preserved containers, $TotalMentions mentions)")) {
        $json = ConvertTo-Json $file -Depth 8
        Assert-DataWriteAllowed -Path $OutPath  # t/2902
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

    } # end try (lockfile scope)
    finally {
        # Release advisory lock: close and delete lockfile regardless of success or error.
        if ($null -ne $LockStream) {
            try { $LockStream.Dispose() } catch { }
            $LockStream = $null
        }
        Remove-Item -LiteralPath $LockPath -Force -ErrorAction SilentlyContinue
    }
}
