# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-SituationBdiViolationsFromJson {
    <#
    .SYNOPSIS
        Pure, module-free: classify situations changed between two JSON snapshots
        against the per-POV BDI decomposition rule (t/3901).
    .DESCRIPTION
        Prerequisite for the data-repo pre-commit hook (t/3892). `Test-SituationBdiCompliance
        -ChangedOnly` / `Get-ChangedSituationId` compare `-BaseRef` against the ON-DISK
        situations.json, which diverges from a hook's staged content on a shared
        checkout (another agent's unstaged edit, or `git add -p`). And `Import-Module
        AITriad` costs 6-17s per commit, which drives `--no-verify`, disarming every
        data-repo guard (t/3892#2).

        This function takes both snapshots as already-read STRINGS (baseline = the
        pre-commit content, candidate = the staged/to-be-committed content) and has
        NO module-scope dependencies: no Get-DataRoot, no git, no disk I/O. It is
        dot-sourceable standalone alongside Test-SituationBdiDecomposition.ps1 (the
        pure classifier) -- no other file needed. The load test in
        tests/Get-SituationBdiViolationsFromJson.Tests.ps1 proves this: a fresh
        `pwsh -NoProfile` dot-sources exactly these two files, no Import-Module, and
        calls this function successfully.

        Changed set (mirrors Get-ChangedSituationId's semantics exactly, computed from
        strings instead of git refs): a candidate situation counts as changed when its
        id is absent from the baseline, OR its serialized content differs from the
        baseline's (deep compare via `ConvertTo-Json -Compress`). An empty or absent
        baseline (first commit; the file did not exist yet) means every candidate
        situation counts as changed. Deleted ids (in baseline, not in candidate) are
        not reported -- the validator only cares about situations that are landing.

        Each changed situation is validated with Test-SituationBdiDecomposition (the
        classifier) -- the SAME rule Test-SituationBdiCompliance uses, pinned to the
        TS validator by t/3889's parity test. This function does not reimplement that
        rule: the classifier alone decides pass/fail (its EmptyIds/NonDecomposedIds).
        The per-POV `pov`/`reason` breakdown below is read-only ANNOTATION on an
        already-classifier-confirmed failure -- it narrates where the problem likely
        is, it does not change which nodes are flagged. If no single POV can be
        isolated (e.g. a null-sentinel value, t/3018), the whole node is reported
        instead of silently dropping a confirmed violation.
    .PARAMETER BaselineJson
        The situations.json content at the baseline (e.g. the pre-commit state), as a
        string. Pass an empty string or $null for "no baseline existed yet" -- every
        candidate situation is then treated as changed.
    .PARAMETER CandidateJson
        The situations.json content being validated (e.g. the staged content), as a
        string. Throws if this does not parse -- the caller should report COULD NOT
        VERIFY rather than treat an empty result as a pass.
    .OUTPUTS
        [pscustomobject[]] one entry per violation: { id, pov, reason }. Empty array
        (not $null) when every changed situation passes.
    .EXAMPLE
        Get-SituationBdiViolationsFromJson -BaselineJson $headText -CandidateJson $stagedText
    .LINK
        Test-SituationBdiCompliance
    .LINK
        Test-SituationBdiDecomposition
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject[]])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [AllowNull()]
        [string]$BaselineJson,

        [Parameter(Mandatory)]
        [string]$CandidateJson
    )

    Set-StrictMode -Version Latest

    # @(...) wrapping is load-bearing here, not defensive style: a zero-item pipeline
    # captured by plain `=` assignment unrolls to $null (not @()) in PowerShell, which
    # would then fail -BaselineNodes/-CandidateNodes's [AllowEmptyCollection()] bind
    # (that attribute permits an empty array, not $null) -- confirmed empirically.
    $CandidateNodes = @(ConvertTo-SituationNodeArray -Json $CandidateJson -Role 'candidate')
    $BaselineNodes  = @(if (-not [string]::IsNullOrWhiteSpace($BaselineJson)) {
        ConvertTo-SituationNodeArray -Json $BaselineJson -Role 'baseline'
    })

    $Changed = Select-ChangedSituationNode -BaselineNodes $BaselineNodes -CandidateNodes $CandidateNodes
    if ($Changed.Nodes.Count -eq 0) {
        return @()
    }

    $R = Test-SituationBdiDecomposition -Node $Changed.Nodes

    $Violations = [System.Collections.Generic.List[pscustomobject]]::new()

    foreach ($id in @($R.EmptyIds)) {
        $Violations.Add([pscustomobject][ordered]@{
            id     = $id
            pov    = 'all'
            reason = 'missing or empty interpretations block -- no POV carries a non-empty belief/desire/intention'
        })
    }

    foreach ($id in @($R.NonDecomposedIds)) {
        foreach ($v in (Get-SituationBdiNodePovViolation -Node $Changed.ById[$id] -Id $id)) {
            $Violations.Add($v)
        }
    }

    return $Violations.ToArray()
}

function ConvertTo-SituationNodeArray {
    <#
    .SYNOPSIS
        Sub-helper of Get-SituationBdiViolationsFromJson (t/3901, same file): parse a
        situations.json snapshot string into its .nodes array, or throw.
    .PARAMETER Role
        Human label for the snapshot ('baseline' or 'candidate'), used only in the
        thrown message so a caller can tell which input was bad.
    .OUTPUTS
        [object[]] -- empty array if the parsed document has no 'nodes' property.
    #>
    [CmdletBinding()]
    [OutputType([object[]])]
    param(
        [Parameter(Mandatory)]
        [string]$Json,

        [Parameter(Mandatory)]
        [string]$Role
    )

    Set-StrictMode -Version Latest

    # Strip a single leading U+FEFF (UTF-8 BOM carried through as a literal character,
    # e.g. from Get-Content -Raw on a BOM'd file, or `git show` of a BOM'd blob) --
    # PS7's ConvertFrom-Json (System.Text.Json underneath) rejects a leading BOM
    # character outright (verified: "Unexpected character ... line 0, position 0"),
    # so a BOM'd snapshot would otherwise throw here even though the JSON itself is
    # well-formed (TL review, t/3901#2).
    if ($Json.Length -gt 0 -and $Json[0] -eq [char]0xFEFF) {
        $Json = $Json.Substring(1)
    }

    try {
        $Data = $Json | ConvertFrom-Json
    }
    catch {
        throw "Get-SituationBdiViolationsFromJson: $Role JSON did not parse -- cannot verify BDI compliance ($($_.Exception.Message))."
    }
    if ($null -eq $Data) {
        throw "Get-SituationBdiViolationsFromJson: $Role JSON parsed to null (empty or invalid) -- cannot verify BDI compliance."
    }
    if ($Data.PSObject.Properties['nodes']) { return @($Data.nodes) }
    return @()
}

function Select-ChangedSituationNode {
    <#
    .SYNOPSIS
        Sub-helper of Get-SituationBdiViolationsFromJson (t/3901, same file): the
        changed-set deep compare, mirroring Get-ChangedSituationId's semantics exactly
        but operating on already-parsed node arrays instead of git refs.
    .OUTPUTS
        [pscustomobject] { Nodes = object[]; ById = hashtable } -- a candidate node
        counts as changed when its id is absent from -BaselineNodes, or its serialized
        content differs. Deleted ids (baseline-only) are not reported.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [object[]]$BaselineNodes,

        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [object[]]$CandidateNodes
    )

    Set-StrictMode -Version Latest

    $BaseMap = @{}
    foreach ($n in $BaselineNodes) {
        if ($n.PSObject.Properties['id']) {
            $BaseMap[[string]$n.id] = ($n | ConvertTo-Json -Depth 30 -Compress)
        }
    }

    $Changed = [System.Collections.Generic.List[object]]::new()
    $ById = @{}
    foreach ($n in $CandidateNodes) {
        if (-not $n.PSObject.Properties['id']) { continue }
        $id  = [string]$n.id
        $cur = $n | ConvertTo-Json -Depth 30 -Compress
        if (-not $BaseMap.ContainsKey($id) -or $BaseMap[$id] -ne $cur) {
            $Changed.Add($n)
            $ById[$id] = $n
        }
    }

    return [pscustomobject]@{ Nodes = $Changed.ToArray(); ById = $ById }
}

function Get-SituationBdiNodePovViolation {
    <#
    .SYNOPSIS
        Sub-helper of Get-SituationBdiViolationsFromJson (t/3901, same file -- the
        module-free load test dot-sources this file as one unit): per-POV violation
        breakdown for a single node already confirmed non-decomposed by the classifier.
    .DESCRIPTION
        Read-only ANNOTATION, not re-classification: the node is already a confirmed
        violation (Test-SituationBdiDecomposition flagged its id). This only narrates
        WHICH of accelerationist/safetyist/skeptic looks incomplete, using a simplified
        presence/non-empty check (deliberately not replicating the classifier's
        null-sentinel rule, t/3018, to avoid a second copy of that logic drifting from
        the first). If no single POV can be isolated, the whole node is reported
        instead of silently dropping a confirmed violation.
    .PARAMETER Node
        The parsed situation node object.
    .PARAMETER Id
        The node's id (passed separately since -Node may lack a readable .id in edge cases).
    .OUTPUTS
        [pscustomobject[]] one or more { id, pov, reason } entries -- never empty.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject[]])]
    param(
        [Parameter(Mandatory)]
        [object]$Node,

        [Parameter(Mandatory)]
        [string]$Id
    )

    Set-StrictMode -Version Latest

    $Result = [System.Collections.Generic.List[pscustomobject]]::new()
    $Interps = if ($Node.PSObject.Properties['interpretations']) { $Node.interpretations } else { $null }

    foreach ($Pov in 'accelerationist', 'safetyist', 'skeptic') {
        if (-not (Test-SituationBdiPovComplete -Interpretations $Interps -Pov $Pov)) {
            $Result.Add([pscustomobject][ordered]@{
                id     = $Id
                pov    = $Pov
                reason = 'entry missing, not an object, or belief/desire/intention incomplete'
            })
        }
    }

    if ($Result.Count -eq 0) {
        # The classifier flagged this node (likely a null-sentinel value, t/3018) but
        # the simplified per-POV check above couldn't isolate which POV -- report the
        # whole node rather than silently dropping a confirmed violation.
        $Result.Add([pscustomobject][ordered]@{
            id     = $Id
            pov    = 'all'
            reason = 'fails per-POV BDI decomposition (see Test-SituationBdiDecomposition); POV-level breakdown unavailable -- likely a null-sentinel value (t/3018)'
        })
    }

    return $Result.ToArray()
}

function Test-SituationBdiPovComplete {
    <#
    .SYNOPSIS
        Sub-helper of Get-SituationBdiNodePovViolation (t/3901, same file): does this
        one POV's interpretation entry look complete (non-empty belief/desire/intention)?
    .OUTPUTS
        [bool]
    #>
    [CmdletBinding()]
    [OutputType([bool])]
    param(
        [Parameter()]
        [AllowNull()]
        [object]$Interpretations,

        [Parameter(Mandatory)]
        [string]$Pov
    )

    Set-StrictMode -Version Latest

    if (-not $Interpretations -or -not $Interpretations.PSObject.Properties[$Pov]) { return $false }
    $P = $Interpretations.$Pov
    if (-not $P -or $P -is [string]) { return $false }
    if (-not $P.PSObject.Properties['belief'] -or -not $P.PSObject.Properties['desire'] -or -not $P.PSObject.Properties['intention']) {
        return $false
    }
    return [bool](([string]$P.belief).Trim() -and ([string]$P.desire).Trim() -and ([string]$P.intention).Trim())
}
