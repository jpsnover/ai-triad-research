#Requires -Version 7
# Fork-B contradiction-classifier bridge (t/3302, TL-approved seam t/3302#16).
#
# Python (enrich_conflicts_qbaf.py) writes the pair texts to a temp JSON file and passes the PATH
# here — NOT inline as args/stdin text. Assertion texts carry quotes/newlines, the #1 shell-corruption
# hazard (TL load-bearing condition: FILE-BASED marshaling across the Python<->pwsh boundary).
#
# Classifies each within-conflict assertion pair as contradict|entail|neutral via Invoke-AIByUsage
# (reuses the module's key-mgmt / rate-limiting / AI-call-log). Per-conflict BATCH first; on a
# malformed/incomplete batch response, FALL BACK to per-pair for the missing ids — a pair is NEVER
# silently dropped (unclassifiable -> label 'unresolved', which the caller treats as "no edge").
# Temperature pinned 0 for determinism.
#
# Input file JSON:  { "conflicts": [ { "cid": "<id>", "pairs": [ {"id","a","b"}, ... ] }, ... ] }
# stdout JSON:      { "results": [ {"id","label","confidence","method"}, ... ] }
#   label  : contradict | entail | neutral | unresolved
#   method : llm-batch | llm-perpair | unresolved
[CmdletBinding()]
param(
    # Non-mandatory so the file can be dot-sourced for unit tests (a Mandatory param blocks
    # dot-source with a missing-parameter error). main() validates it below.
    [string]$InputPath = '',
    [ValidateSet('per-conflict', 'per-pair')][string]$Mode = 'per-conflict',
    [ValidateRange(0.0, 2.0)][double]$Temperature = 0.0,
    # When set, JSON results are written to this FILE instead of stdout. Callers should prefer this:
    # PowerShell's Write-Warning fallback notices render onto the captured stdout stream ahead of the
    # JSON line, corrupting a caller's ConvertFrom-Json/json.loads (t/3302 live-run failure). A file is
    # the clean data channel; warnings stay on the console for the operator. Empty => stdout (legacy).
    [string]$OutPath = ''
)

Set-StrictMode -Version Latest

$script:CC_VALID_LABELS = @('contradict', 'entail', 'neutral')

function Format-CCPairsBlock {
    # Render pairs into the prompt's {{pairs_block}}. PS string only — no shell — so quotes/newlines
    # in the assertion texts are safe.
    param([object[]]$Pairs)
    $sb = [System.Text.StringBuilder]::new()
    foreach ($p in $Pairs) {
        [void]$sb.AppendLine("### pair $($p.id)")
        [void]$sb.AppendLine("A: $([string]$p.a)")
        [void]$sb.AppendLine("B: $([string]$p.b)")
        [void]$sb.AppendLine("")
    }
    return $sb.ToString().TrimEnd()
}

function Invoke-CCModel {
    # One AI call over a pair list. Returns a hashtable id -> @{label; confidence}, or $null on any
    # failure (unavailable / non-JSON / no results). Fallback-path failures are the caller's problem.
    param([object[]]$Pairs, [double]$Temperature)
    if (-not $Pairs -or @($Pairs).Count -eq 0) { return @{} }
    try {
        $block    = Format-CCPairsBlock -Pairs $Pairs
        $rendered = Get-Prompt -Name 'contradiction-classify' -Replacements @{ pairs_block = $block }
        $resp     = Invoke-AIByUsage -UsageId 'enrichment.contradiction-classify' `
            -Values @{ prompt = $rendered } -Override @{ temperature = $Temperature } -ErrorAction Stop
        if (-not $resp -or -not $resp.PSObject.Properties['Text'] -or [string]::IsNullOrWhiteSpace($resp.Text)) {
            Write-Warning "contradiction-classify: backend returned no Text for $(@($Pairs).Count) pair(s) — check the model/key for usage 'enrichment.contradiction-classify'."
            return $null
        }
        $parsed = $resp.Text | ConvertFrom-Json -ErrorAction Stop
        if (-not $parsed.PSObject.Properties['results']) {
            Write-Warning "contradiction-classify: backend Text was not the expected { results: [...] } JSON."
            return $null
        }
        $map = @{}
        foreach ($r in @($parsed.results)) {
            # Positive guard (no `continue`): a `continue` inside a function escapes to Pester's
            # enclosing loop under issue #2669 and silently aborts the run.
            if ($r.PSObject.Properties['id'] -and $r.PSObject.Properties['label']) {
                $label = [string]$r.label
                if ($label -in $script:CC_VALID_LABELS) {
                    $conf = if ($r.PSObject.Properties['confidence']) { [double]$r.confidence } else { 0.0 }
                    $map[[string]$r.id] = @{ label = $label; confidence = [Math]::Round($conf, 4) }
                }
            }
        }
        return $map
    }
    catch {
        # Log the WHY (project rule: log every fallback path + reason). The underlying exception here is
        # usually a missing/invalid key or an unregistered model for usage 'enrichment.contradiction-classify'.
        Write-Warning "contradiction-classify: model call failed: $($_.Exception.Message)"
        return $null
    }
}

function Convert-ContradictionPairs {
    # Classify one conflict's pairs. Batch-first with per-pair fallback on missing/malformed ids.
    # Returns [{id; label; confidence; method}] — one entry per input pair, never fewer.
    param(
        [object[]]$Pairs,
        [ValidateSet('per-conflict', 'per-pair')][string]$Mode = 'per-conflict',
        [double]$Temperature = 0.0
    )
    $out = [System.Collections.Generic.List[object]]::new()
    if (-not $Pairs -or @($Pairs).Count -eq 0) { return @($out) }

    $batchMap = @{}
    if ($Mode -eq 'per-conflict') {
        $r = Invoke-CCModel -Pairs $Pairs -Temperature $Temperature
        if ($null -ne $r) { $batchMap = $r }
        else {
            Write-Warning "contradiction-classify: batch call failed/empty for a conflict of $(@($Pairs).Count) pair(s) — falling back to per-pair (t/3302)."
        }
    }

    # Positive-guard branches only (no `continue`) — see Invoke-CCModel note re: Pester #2669.
    foreach ($p in $Pairs) {
        # NB: $pairId, not $pid — $PID is a read-only PowerShell automatic variable (the process id).
        $pairId = [string]$p.id
        if ($batchMap.ContainsKey($pairId)) {
            $out.Add([ordered]@{ id = $pairId; label = $batchMap[$pairId].label; confidence = $batchMap[$pairId].confidence; method = 'llm-batch' })
        }
        else {
            # Missing from the batch (or per-pair mode) -> classify this single pair on its own.
            $single = Invoke-CCModel -Pairs @($p) -Temperature $Temperature
            if ($null -ne $single -and $single.ContainsKey($pairId)) {
                $out.Add([ordered]@{ id = $pairId; label = $single[$pairId].label; confidence = $single[$pairId].confidence; method = 'llm-perpair' })
            }
            else {
                # Never silently drop — emit an explicit unresolved (caller adds no edge) + WARN.
                Write-Warning "contradiction-classify: pair '$pairId' unresolved after batch + per-pair fallback — emitting 'unresolved' (no edge, t/3302)."
                $out.Add([ordered]@{ id = $pairId; label = 'unresolved'; confidence = 0.0; method = 'unresolved' })
            }
        }
    }
    return @($out)
}

function Write-CCResult {
    <#
    .SYNOPSIS
        Emit the results object. When -OutPath is given, JSON goes to that FILE (the clean data channel);
        otherwise to stdout (legacy). Callers should prefer -OutPath: PowerShell's Write-Warning fallback
        notices render onto captured stdout ahead of the JSON and break a caller's parse (t/3302 live-run
        failure). Pure apart from the single Set-Content write — dot-source unit-tested.
    #>
    [CmdletBinding()]
    param([object[]]$Results, [string]$OutPath = '')
    $json = [ordered]@{ results = @($Results) } | ConvertTo-Json -Depth 6 -Compress
    if (-not [string]::IsNullOrWhiteSpace($OutPath)) {
        Set-Content -LiteralPath $OutPath -Value $json -Encoding utf8
    }
    else {
        $json | Write-Output
    }
}

# ── main (skipped when dot-sourced for unit tests: $env:CC_CLASSIFIER_NOEXEC) ──
if (-not $env:CC_CLASSIFIER_NOEXEC) {
    $ErrorActionPreference = 'Stop'

    if ([string]::IsNullOrWhiteSpace($InputPath)) {
        throw "invoke-contradiction-classifier: -InputPath is required."
    }
    if (-not (Test-Path -LiteralPath $InputPath -PathType Leaf)) {
        throw "invoke-contradiction-classifier: input file not found: '$InputPath'"
    }
    $batch = Get-Content -LiteralPath $InputPath -Raw | ConvertFrom-Json

    $ModulePath = Join-Path $PSScriptRoot 'AITriad' 'AITriad.psd1'
    Import-Module $ModulePath -Force -ErrorAction Stop

    # Get-Prompt is a module-PRIVATE helper — Import-Module does NOT expose it to this standalone
    # script's scope, so a bare call fails with 'Get-Prompt is not recognized' (t/3302 live-run root
    # cause). Dot-source it here and set $script:ModuleRoot so its default Prompts/ dir resolves.
    # (Invoke-AIByUsage IS exported, so it needs no such handling.)
    $script:ModuleRoot = Join-Path $PSScriptRoot 'AITriad'
    . (Join-Path $PSScriptRoot 'AITriad' 'Private' 'Get-Prompt.ps1')

    $allResults = [System.Collections.Generic.List[object]]::new()
    if ($batch.PSObject.Properties['conflicts']) {
        foreach ($c in @($batch.conflicts)) {
            $pairs = if ($c.PSObject.Properties['pairs']) { @($c.pairs) } else { @() }
            foreach ($res in (Convert-ContradictionPairs -Pairs $pairs -Mode $Mode -Temperature $Temperature)) {
                $allResults.Add($res)
            }
        }
    }

    Write-CCResult -Results @($allResults) -OutPath $OutPath
}
