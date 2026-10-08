# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# The PowerShell model-literal lint's scan, extracted so it has exactly ONE implementation (t/3553, SO e/271).
# Dot-sourced by tests/ModelLiteralLint.Tests.ps1 (the lint) and scripts/Get-CodeReferencedModels.ps1 (the
# generator's PS emitter), so the generator and the lint can never disagree about which literals exist.
# These are the lint's functions moved verbatim from the test's BeforeAll; the only additions are the
# scope table (Get-ModelLiteralScopeScan) and the registered-hit projection (Get-CodeReferencedModelIds).
# Rules and both scopes' rationale: see the header of tests/ModelLiteralLint.Tests.ps1.

# tests/ pattern (t/1858): a -Model parameter bound to a literal. Group 2 = id.
# Leading dash required, so it never matches a `Model = '...'` mock property.
$script:TestModelPattern = '-Model(?::|\s+)([''"])([^''"]+)\1'

# production pattern (t/3560): widened to three model-binding positions —
#   -<*Model*> param binding | $<*Model*> = assignment | standalone model = key.
# Group 2 = id in every alternation. The `(?<![\w$-])` on the bare-key arm keeps a
# compound key like `ModelUnavailable = '...'` from matching (its value isn't an id).
$script:ProdModelPattern = '(?:-[A-Za-z]*[Mm]odel[A-Za-z]*(?::|\s+)|\$[A-Za-z]*[Mm]odel[A-Za-z]*\s*=\s*|(?<![\w$-])[Mm]odel\s*=\s*)([''"])([^''"]+)\1'

# Pure: parse a line's co-located model-lint marker (t/3657 grammar, shared with
# lib/ai-config/modelLiteralLint.ts). Grammar: `model-lint:allow-<kind> <reason>`,
# kind ∈ {pin, external, nonselect} MANDATORY, reason MANDATORY (≥1 non-ws).
# Bare `model-lint:allow` and `allow-<kind>` with no reason are INVALID (not exempt).
# Returns { Present, Valid, Kind, Reason }. Anchored at $ so a trailing comment
# captures its reason to EOL; callers pass line-terminator-stripped lines.
function script:Get-ModelLintMarker {
    param([string]$Line)
    $m = [regex]::Match($Line, 'model-lint:allow(?:-(pin|external|nonselect))?(?:\s+(\S.*))?$')
    if (-not $m.Success) { return [PSCustomObject]@{ Present = $false; Valid = $false; Kind = $null; Reason = $null } }
    $kind   = if ($m.Groups[1].Success -and $m.Groups[1].Value) { $m.Groups[1].Value } else { $null }
    $reason = if ($m.Groups[2].Success -and -not [string]::IsNullOrWhiteSpace($m.Groups[2].Value)) { $m.Groups[2].Value.Trim() } else { $null }
    [PSCustomObject]@{ Present = $true; Valid = ($null -ne $kind -and $null -ne $reason); Kind = $kind; Reason = $reason }
}

# Pure: parse in-memory lines -> literal records, each carrying its co-located Marker
# (t/3657 — no longer skips marked lines; the marker's validity is resolved downstream).
# (when -Exclusions) drops non-literal / non-single-id values. No file IO.
function script:Get-ModelLiteralsFromLines {
    param([string[]]$Lines, [string]$Pattern, [switch]$Exclusions, [string]$FileName = '(memory)')
    $out = [System.Collections.Generic.List[object]]::new()
    $lineNo = 0
    foreach ($line in $Lines) {
        $lineNo++
        $marker = script:Get-ModelLintMarker -Line $line
        foreach ($match in [regex]::Matches($line, $Pattern)) {
            $id = $match.Groups[2].Value
            if ($Exclusions) {
                if ([string]::IsNullOrWhiteSpace($id)) { continue }  # runtime-resolved default
                if ($id.Contains('$'))                 { continue }  # interpolation, not a literal
                if ($id.Contains(','))                 { continue }  # alias CSV, not a single id
            }
            $out.Add([PSCustomObject]@{ File = $FileName; Line = $lineNo; Id = $id; Marker = $marker })
        }
    }
    $out
}

# Pure: offenders per the t/3657 shared predicate (marker semantics + registry).
#   valid marker + UNregistered id  -> exempt (legitimate pin/external/nonselect)
#   valid marker + REGISTERED id     -> OFFENDER (contradiction — pin/etc. on a live id)
#   invalid / no marker              -> OFFENDER iff the id is NOT registered
# A record with no Marker property (e.g. seeded resolution-only cases) resolves normally.
function script:Get-ModelLintOffenders {
    param([object[]]$Literals, [string[]]$ValidIds)
    @($Literals | Where-Object {
        $registered = ($_.Id -in $ValidIds)
        $mk = if ($_.PSObject.Properties['Marker']) { $_.Marker } else { $null }
        if ($mk -and $mk.Present -and $mk.Valid) { $registered }   # valid marker: offender only if it's a contradiction
        else { -not $registered }                                  # no/invalid marker: normal resolution
    })
}

# Impure shell: read each file's lines and delegate to the pure parser above.
function script:Get-ModelLiterals {
    param([string]$Path, [string]$Pattern, [switch]$Exclusions)
    $out = [System.Collections.Generic.List[object]]::new()
    foreach ($file in Get-ChildItem -Path $Path -File -Recurse -Include '*.ps1', '*.psm1') {
        $lines = [System.IO.File]::ReadAllLines($file.FullName)
        foreach ($rec in (script:Get-ModelLiteralsFromLines -Lines $lines -Pattern $Pattern -Exclusions:$Exclusions -FileName $file.Name)) {
            $out.Add($rec)
        }
    }
    $out
}

# The two lint scopes, defined ONCE (t/3553): path, pattern and exclusions per scope. The lint and the
# generator's emitter both go through this, so "what the lint scans" and "what gets pinned" are the same set.
function script:Get-ModelLiteralScopeScan {
    param(
        [Parameter(Mandatory)][string]$RepoRoot,
        [Parameter(Mandatory)][ValidateSet('Tests', 'Production')][string]$Scope
    )
    switch ($Scope) {
        'Tests'      { script:Get-ModelLiterals -Path (Join-Path $RepoRoot 'tests') -Pattern $script:TestModelPattern }
        'Production' { script:Get-ModelLiterals -Path (Join-Path $RepoRoot 'scripts' 'AITriad') -Pattern $script:ProdModelPattern -Exclusions }
    }
}

# Pure: the code-referenced model ids for the registry refresh's pin set (SO e/271 ruling (c)): a literal
# is included iff its id is REGISTERED, whatever marker it carries — a registered `allow-pin` literal is a
# deliberate pin and must stay; an `allow-external` id is unregistered and so is out. Order is not
# significant: the generator sorts and de-duplicates once over the union of both emitters (SO e/271#6).
function script:Get-CodeReferencedModelIds {
    param([AllowEmptyCollection()][object[]]$Literals, [string[]]$ValidIds)
    @($Literals | Where-Object { $_.Id -in $ValidIds } | ForEach-Object { [string]$_.Id } | Select-Object -Unique)
}
