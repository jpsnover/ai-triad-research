# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Measure-CodeComplexity {
    <#
    .SYNOPSIS
        McCabe (cyclomatic) complexity per function, over PowerShell source (p/550).
    .DESCRIPTION
        True AST-based measurement (System.Management.Automation.Language.Parser), not a
        regex heuristic — parses each file, walks the real syntax tree, and computes
        complexity = 1 + decision points, per function:

          if/elseif clause (each)         +1   (else does NOT add — not a branch point)
          while / do-while / do-until     +1
          for / foreach                   +1
          switch clause (each, non-default) +1 (default does NOT add — PS AST excludes
                                                   it from .Clauses, matching McCabe intent)
          catch block (each)              +1
          ternary ?: (PS7)                +1
          -and / -or (each occurrence)    +1   (short-circuit boolean ops are decision points)

        Nested functions are measured as their OWN separate entries — a nested function's
        decision points are subtracted from its containing function's count so nothing is
        double-counted (each branch belongs to exactly one function's complexity).

        A file that fails to parse is WARNED and skipped (fallback-path logging), not fatal —
        the scan continues over the remaining files.
    .PARAMETER Path
        Root directory to scan. Default: the scripts/ directory (covers scripts/AITriad/
        Public+Private and the top-level .psm1 modules) — production PS source, not tests/.
    .PARAMETER Include
        File glob patterns. Default: @('*.ps1', '*.psm1').
    .PARAMETER MinComplexity
        Only report functions at or above this complexity. Default: 0 (report everything).
    .PARAMETER AsObject
        Return structured output instead of formatted text.
    .OUTPUTS
        [pscustomobject[]] { File; Function; Complexity; StartLine }, sorted by Complexity
        descending within each file.
    .EXAMPLE
        Measure-CodeComplexity -MinComplexity 15
    .EXAMPLE
        Measure-CodeComplexity -Path ./scripts/AITriad/Public -Verbose -AsObject |
            Sort-Object Complexity -Descending | Select-Object -First 10
    .LINK
        Show-AITriadHelp
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject[]])]
    param(
        [Parameter()]
        [string]$Path,

        [Parameter()]
        [string[]]$Include = @('*.ps1', '*.psm1'),

        [Parameter()]
        [ValidateRange(0, [int]::MaxValue)]
        [int]$MinComplexity = 0,

        [Parameter()]
        [switch]$AsObject
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    if (-not $Path) {
        # scripts/AITriad/Public -> up two levels -> scripts/ (covers Public+Private+top-level .psm1)
        $Path = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path
    }
    if (-not (Test-Path -LiteralPath $Path)) {
        New-ActionableError `
            -Goal 'Measure cyclomatic complexity' `
            -Problem "Path not found: $Path" `
            -Location 'Measure-CodeComplexity' `
            -NextSteps @('Verify the -Path argument points to an existing directory') `
            -Throw
    }

    Write-Verbose "Scanning '$Path' for $($Include -join ', ')"
    $files = @(Get-ChildItem -LiteralPath $Path -Recurse -File -Include $Include)
    Write-Verbose "Found $($files.Count) file(s) to parse"

    # Node types that each represent a decision point; weight is usually 1, except
    # If/Switch where each branch clause is its own decision (weight = .Clauses.Count).
    function script:Get-DecisionNodes([object]$Ast) {
        $Ast.FindAll({
            param($node)
            ($node -is [System.Management.Automation.Language.IfStatementAst]) -or
            ($node -is [System.Management.Automation.Language.WhileStatementAst]) -or
            ($node -is [System.Management.Automation.Language.DoWhileStatementAst]) -or
            ($node -is [System.Management.Automation.Language.DoUntilStatementAst]) -or
            ($node -is [System.Management.Automation.Language.ForStatementAst]) -or
            ($node -is [System.Management.Automation.Language.ForEachStatementAst]) -or
            ($node -is [System.Management.Automation.Language.SwitchStatementAst]) -or
            ($node -is [System.Management.Automation.Language.CatchClauseAst]) -or
            ($node -is [System.Management.Automation.Language.TernaryExpressionAst]) -or
            (($node -is [System.Management.Automation.Language.BinaryExpressionAst]) -and
             ($node.Operator -in @([System.Management.Automation.Language.TokenKind]::And, [System.Management.Automation.Language.TokenKind]::Or)))
        }, $true)
    }
    function script:Get-DecisionWeight([object]$Node) {
        if ($Node -is [System.Management.Automation.Language.IfStatementAst]) { return $Node.Clauses.Count }
        if ($Node -is [System.Management.Automation.Language.SwitchStatementAst]) { return $Node.Clauses.Count }
        return 1
    }
    function script:Get-RawComplexity([object]$BodyAst) {
        $total = 0
        foreach ($n in (script:Get-DecisionNodes $BodyAst)) { $total += script:Get-DecisionWeight $n }
        return $total
    }

    $allResults = [System.Collections.Generic.List[object]]::new()

    foreach ($file in $files) {
        $tokens = $null
        $parseErrors = $null
        $ast = [System.Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$parseErrors)
        if ($parseErrors -and @($parseErrors).Count -gt 0) {
            Write-Warning "Measure-CodeComplexity: $($file.FullName) has $(@($parseErrors).Count) parse error(s) — skipped. First: $($parseErrors[0].Message)"
            continue
        }

        $fns = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true))
        if ($fns.Count -eq 0) { Write-Verbose "  $($file.Name): no functions"; continue }
        Write-Verbose "  $($file.Name): $($fns.Count) function(s)"

        # Raw (includes nested) complexity per function, keyed by reference identity via index.
        $raw = @($fns | ForEach-Object { script:Get-RawComplexity $_.Body })

        for ($i = 0; $i -lt $fns.Count; $i++) {
            $fn = $fns[$i]
            $fnStart = $fn.Extent.StartOffset
            $fnEnd = $fn.Extent.EndOffset

            # Direct children: other functions textually contained in this one's body, that
            # are not ALSO contained in some other (smaller) contained function — i.e. the
            # immediate nesting level only, so grandchildren aren't double-subtracted.
            $contained = [System.Collections.Generic.List[int]]::new()
            for ($j = 0; $j -lt $fns.Count; $j++) {
                if ($i -eq $j) { continue }
                $cand = $fns[$j]
                if ($cand.Extent.StartOffset -ge $fnStart -and $cand.Extent.EndOffset -le $fnEnd) { $contained.Add($j) }
            }
            $directChildren = $contained | Where-Object {
                $c = $_
                $isGrandchild = $false
                foreach ($other in $contained) {
                    if ($other -eq $c) { continue }
                    if ($fns[$c].Extent.StartOffset -ge $fns[$other].Extent.StartOffset -and
                        $fns[$c].Extent.EndOffset -le $fns[$other].Extent.EndOffset) { $isGrandchild = $true; break }
                }
                -not $isGrandchild
            }
            $childSum = 0
            foreach ($cj in $directChildren) { $childSum += $raw[$cj] }

            $own = ($raw[$i] - $childSum) + 1   # +1 baseline per McCabe (single linear path)
            $relFile = [System.IO.Path]::GetRelativePath($Path, $file.FullName)
            $allResults.Add([PSCustomObject]@{
                File        = $relFile
                Function    = $fn.Name
                Complexity  = $own
                StartLine   = $fn.Extent.StartLineNumber
            })
        }
    }

    $filtered = @($allResults | Where-Object { $_.Complexity -ge $MinComplexity } | Sort-Object File, @{Expression='Complexity'; Descending=$true})
    Write-Verbose "Reporting $($filtered.Count) of $($allResults.Count) function(s) at or above MinComplexity=$MinComplexity"

    if ($AsObject) { $filtered } else { _Format-CodeComplexity $filtered $MinComplexity }
}

function _Format-CodeComplexity {
    param([object[]]$Results, [int]$MinComplexity)

    $sb = [System.Text.StringBuilder]::new()
    [void]$sb.AppendLine("=== Cyclomatic Complexity ($($Results.Count) function(s) >= $MinComplexity) ===")
    if ($Results.Count -eq 0) {
        [void]$sb.AppendLine("  (none at or above threshold)")
        return $sb.ToString()
    }
    $byFile = $Results | Group-Object File
    foreach ($grp in $byFile) {
        [void]$sb.AppendLine("")
        [void]$sb.AppendLine("$($grp.Name):")
        foreach ($r in ($grp.Group | Sort-Object Complexity -Descending)) {
            [void]$sb.AppendLine("  [$($r.Complexity)] $($r.Function) (line $($r.StartLine))")
        }
    }
    $sb.ToString()
}
