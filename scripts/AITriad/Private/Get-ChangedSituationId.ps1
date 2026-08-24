# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-ChangedSituationId {
    <#
    .SYNOPSIS
        Return the ids of situation nodes new-or-modified vs a git baseline ref (t/3011).
    .DESCRIPTION
        Support helper for Test-SituationBdiCompliance -ChangedOnly. Compares the
        situations.json content at -BaseRef against the current on-disk file (passed
        pre-parsed as -CurrentNodes) and returns the ids whose serialized content is
        new or changed. Deleted ids are ignored — the validator only cares about
        situations that are landing.

        Returns $null (not an empty array) when the baseline cannot be resolved — not
        a git work tree, git unavailable, or -BaseRef is not a real commit (shallow
        checkout, all-zero first-push SHA). The caller treats $null as "fail safe:
        validate the full corpus". An empty array means "baseline resolved, nothing
        changed".

        git is invoked with `-C <dir>` and cwd = the file's directory so the colon
        revspec uses a repo-relative `./<leaf>` path — avoiding the MSYS path-conversion
        quirk that mangles absolute Windows paths in git's pathspec/revspec parser
        (see "Git Forensics" in root AGENTS.md). Runs from pwsh, so no MSYS arg
        mangling applies at call time.
    .PARAMETER SituationsPath
        Path to the on-disk situations.json (its directory locates the git work tree).
    .PARAMETER BaseRef
        Baseline git ref to diff against.
    .PARAMETER CurrentNodes
        The already-parsed current situation node array (from the on-disk file).
    .OUTPUTS
        [string[]] of changed situation ids, or $null if the baseline is unresolvable.
    #>
    [CmdletBinding()]
    [OutputType([string[]])]
    param(
        [Parameter(Mandatory)]
        [string]$SituationsPath,

        [Parameter(Mandatory)]
        [string]$BaseRef,

        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [object[]]$CurrentNodes
    )

    Set-StrictMode -Version Latest

    $dir  = Split-Path -Parent $SituationsPath
    $leaf = Split-Path -Leaf   $SituationsPath

    # Baseline must be a real commit in a git work tree, else fail safe (-> $null).
    $null = & git -C $dir rev-parse --verify --quiet "$BaseRef^{commit}" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Verbose "Get-ChangedSituationId: baseline '$BaseRef' does not resolve to a commit in '$dir' — returning null (fail-safe full scan)."
        return $null
    }

    # File content at the baseline. A miss (file absent at BaseRef) means every
    # current situation is new — return all current ids.
    $baseText = & git -C $dir show "${BaseRef}:./$leaf" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Verbose "Get-ChangedSituationId: '$leaf' absent at '$BaseRef' — treating all current situations as new."
        return @($CurrentNodes | Where-Object { $_.PSObject.Properties['id'] } | ForEach-Object { [string]$_.id })
    }

    try {
        $baseJson = (@($baseText) -join "`n") | ConvertFrom-Json
    }
    catch {
        # Baseline file present but unparseable — fail safe to full scan.
        Write-Verbose "Get-ChangedSituationId: situations.json at '$BaseRef' did not parse — returning null (fail-safe full scan)."
        return $null
    }

    $baseMap = @{}
    if ($baseJson.PSObject.Properties['nodes']) {
        foreach ($n in @($baseJson.nodes)) {
            if ($n.PSObject.Properties['id']) {
                $baseMap[[string]$n.id] = ($n | ConvertTo-Json -Depth 30 -Compress)
            }
        }
    }

    $changed = [System.Collections.Generic.List[string]]::new()
    foreach ($n in @($CurrentNodes)) {
        if (-not $n.PSObject.Properties['id']) { continue }
        $id  = [string]$n.id
        $cur = $n | ConvertTo-Json -Depth 30 -Compress
        if (-not $baseMap.ContainsKey($id) -or $baseMap[$id] -ne $cur) {
            $changed.Add($id)
        }
    }
    return $changed.ToArray()
}
