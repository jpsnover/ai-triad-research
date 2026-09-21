# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    C5 hygiene lint for `.trivyignore` (t/3539): every active suppression directive
    must sit in a block that carries a `REVISIT:` re-review trigger (t/2006).

.DESCRIPTION
    `.trivyignore` suppresses a BLOCKING Trivy gate (t/3520) — it is a gate-bypass
    surface, so its hygiene must be continuously enforced, not audited point-in-time.
    This file is dot-sourced by tests/TrivyIgnoreRevisitLint.Tests.ps1, which runs
    inside the already-required `test-powershell` CI gate (TL ruling t/3539#2, Option
    C — an assertion inside an existing blocking suite, not a new gate).

    GROUPING RULE (documented at point of use, per t/3539#2) — LOAD-BEARING:
      A GROUP is a blank-line-delimited block: a maximal run of consecutive
      NON-BLANK lines. A DIRECTIVE is a non-comment line matching CVE-/TEMP-/GHSA-
      (a leading `#` makes it an annotation, not a directive). A directive is
      COVERED iff SOME line in its own block matches `REVISIT`.

      Why blank-line grouping is deliberately strict: in `.trivyignore` each package
      block holds its `# REVISIT:` comment lines and its bare directive lines with NO
      blank line between them. A STRAY BLANK LINE inserted between a `REVISIT:` comment
      and the directives it covers would split them into two blocks and silently orphan
      those directives from their trigger — which is EXACTLY the decay this lint exists
      to catch. So a blank line is treated as a hard block boundary, on purpose.

    Get-TrivyIgnoreRevisitGap returns the list of UNCOVERED directives (empty = clean).
    Format-TrivyIgnoreGapMessage renders an actionable failure message from that list.
#>

Set-StrictMode -Version Latest

function Get-TrivyIgnoreRevisitGap {
    <#
    .SYNOPSIS
        Returns uncovered directives (a directive whose block has no REVISIT trigger).
        Empty result = the file is clean. Pass -Line for fixture content, else -Path.
    #>
    [CmdletBinding()]
    param(
        [string[]]$Line,
        [string]$Path
    )

    if ($null -eq $Line) {
        if ([string]::IsNullOrEmpty($Path)) {
            # repo-root .trivyignore, resolved relative to this script (operations/devops/)
            $Path = Join-Path $PSScriptRoot '..' | Join-Path -ChildPath '..' | Join-Path -ChildPath '.trivyignore'
        }
        $Line = @(Get-Content -LiteralPath $Path)
    }

    $gaps = [System.Collections.Generic.List[object]]::new()

    # Accumulate blank-line-delimited blocks; process each closed block.
    $block = [System.Collections.Generic.List[object]]::new()

    $flush = {
        if ($block.Count -eq 0) { return }
        $hasRevisit = @($block | Where-Object { $_.Text -match 'REVISIT' }).Count -gt 0
        if (-not $hasRevisit) {
            foreach ($entry in $block) {
                # DIRECTIVE = non-comment line beginning with a CVE-/TEMP-/GHSA- token.
                # A leading '#' fails '^\s*(CVE-...)' since '#' is not whitespace, so
                # comment-form annotations ('# CVE-1234 ...') are correctly excluded.
                if ($entry.Text -match '^\s*(CVE-|TEMP-|GHSA-)\S') {
                    $gaps.Add([pscustomobject]@{
                        LineNumber = $entry.Num
                        Directive  = $entry.Text.Trim()
                    })
                }
            }
        }
        $block.Clear()
    }

    for ($i = 0; $i -lt $Line.Count; $i++) {
        $text = $Line[$i]
        if ([string]::IsNullOrWhiteSpace($text)) {
            & $flush
        } else {
            $block.Add([pscustomobject]@{ Num = $i + 1; Text = $text })
        }
    }
    & $flush   # close the final block at EOF

    return $gaps.ToArray()
}

function Format-TrivyIgnoreGapMessage {
    <#
    .SYNOPSIS
        Actionable message naming each uncovered directive + the t/2006 requirement.
    #>
    [CmdletBinding()]
    param([object[]]$Gap)

    if ($null -eq $Gap -or $Gap.Count -eq 0) {
        return '.trivyignore: all suppression directives carry a REVISIT trigger.'
    }
    $lines = $Gap | ForEach-Object { "  line $($_.LineNumber): $($_.Directive)" }
    return @(
        ".trivyignore: $($Gap.Count) suppression directive(s) have NO REVISIT trigger in their block:"
        $lines
        "Every suppression must carry: CVE/package + fix-state + reachability rationale + a concrete"
        "REVISIT: re-review trigger (t/2006). Add a 'REVISIT:' line to the offending block, or (if a"
        "stray blank line split the block) rejoin the directive(s) with their REVISIT comment."
    ) -join [Environment]::NewLine
}
