# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-SituationBdiDecomposition {
    <#
    .SYNOPSIS
        Pure per-POV BDI-decomposition compliance logic for situation nodes.
    .DESCRIPTION
        Extracted from Test-OntologyCompliance (t/1312) so the check logic can be
        unit-tested against synthetic fixtures independent of the live corpus
        (t/2332 — decouple the live-data baseline from the required CI gate).

        Every non-deprecated situation must carry an interpretations block where
        {accelerationist, safetyist, skeptic} each hold a nested object with
        non-empty belief + desire + intention. A situation is exempt when its
        description starts with the '[DEPRECATED]' prefix (CL confirmed t/1312#2).

        No I/O, no host output — callers format the pass/fail Detail line. This
        keeps the CL-approved wording in Test-OntologyCompliance while the
        classification logic lives here where it can be exercised directly.
    .PARAMETER Node
        Situation node object(s) (as parsed from situations.json). Accepts an
        array or pipeline input; each must expose .id, and optionally
        .description / .interpretations.
    .OUTPUTS
        [pscustomobject] with counts (Pass, NonDeprecated, Deprecated,
        NonDecomposed, Empty, Fail) and capped id samples (NonDecomposedIds,
        EmptyIds — first 10 each, matching the cmdlet's Detail sampling).
    .EXAMPLE
        $r = Test-SituationBdiDecomposition -Node $situations.nodes
        if ($r.Fail -gt 0) { ... }
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(ValueFromPipeline = $true)]
        [AllowNull()]
        [object[]]$Node
    )

    begin {
        Set-StrictMode -Version Latest

        $pass = 0; $empty = 0; $nonDecomposed = 0; $nonDep = 0; $deprecated = 0
        $nonDecomposedIds = [System.Collections.Generic.List[string]]::new()
        $emptyIds         = [System.Collections.Generic.List[string]]::new()
    }

    process {
        foreach ($N in @($Node)) {
            if ($null -eq $N) { continue }

            # Exemption: [DEPRECATED] description prefix (CL confirmed t/1312#2)
            $desc = if ($N.PSObject.Properties['description']) { [string]$N.description } else { '' }
            if ($desc.TrimStart().StartsWith('[DEPRECATED]')) {
                $deprecated++
                continue
            }
            $nonDep++

            $interps = if ($N.PSObject.Properties['interpretations']) { $N.interpretations } else { $null }

            # 'empty': block missing/null, or all three POV entries are falsy/blank
            $hasAnyPov = $false
            if ($interps) {
                foreach ($pov in 'accelerationist', 'safetyist', 'skeptic') {
                    if ($interps.PSObject.Properties[$pov]) {
                        $val = $interps.$pov
                        if ($val) { $hasAnyPov = $true; break }
                    }
                }
            }
            if (-not $hasAnyPov) {
                $empty++
                if ($emptyIds.Count -lt 10) { $emptyIds.Add([string]$N.id) }
                continue
            }

            # Full-BDI: each POV entry must be a dict with non-empty belief/desire/intention
            $allOk = $true
            foreach ($pov in 'accelerationist', 'safetyist', 'skeptic') {
                if (-not $interps.PSObject.Properties[$pov]) { $allOk = $false; break }
                $p = $interps.$pov
                # Reject strings (legacy flat text) — must be a nested object
                if ($p -is [string]) { $allOk = $false; break }
                if (-not $p -or -not $p.PSObject.Properties['belief'] -or -not $p.PSObject.Properties['desire'] -or -not $p.PSObject.Properties['intention']) {
                    $allOk = $false; break
                }
                $b = if ($p.belief)    { [string]$p.belief    } else { '' }
                $d = if ($p.desire)    { [string]$p.desire    } else { '' }
                $i = if ($p.intention) { [string]$p.intention } else { '' }
                if (-not $b.Trim() -or -not $d.Trim() -or -not $i.Trim()) { $allOk = $false; break }
            }
            if ($allOk) {
                $pass++
            } else {
                $nonDecomposed++
                if ($nonDecomposedIds.Count -lt 10) { $nonDecomposedIds.Add([string]$N.id) }
            }
        }
    }

    end {
        [pscustomobject][ordered]@{
            Pass             = $pass
            NonDeprecated    = $nonDep
            Deprecated       = $deprecated
            NonDecomposed    = $nonDecomposed
            Empty            = $empty
            Fail             = $nonDecomposed + $empty
            NonDecomposedIds = $nonDecomposedIds.ToArray()
            EmptyIds         = $emptyIds.ToArray()
        }
    }
}
