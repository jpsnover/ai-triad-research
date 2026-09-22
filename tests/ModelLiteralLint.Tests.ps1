# Tag: config (t/1858, t/3560)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Lint: every model-id literal must name a model registered in ai-models.json.
    Covers test fixtures (tests/, blocking) and production module source
    (scripts/AITriad/, WARN-only until the blocking flip is sequenced — t/3560).

.DESCRIPTION
    Guards against model-id staleness (t/1850 -> t/1858 -> t/3557): a literal that
    names a de-registered model id (e.g. after a migration drops it from ai-models.json)
    passes locally but represents a latent P0 — Invoke-AIApi returns $null before the
    parser runs, so the code path no longer does what it claims. Test-AIModelsConfig
    validates the config, not the call sites, so it structurally cannot catch this.

    Two scopes, two patterns, deliberately different (t/3560):

    - tests/ (blocking, unchanged from t/1858): matches a -Model parameter bound to a
      string literal. Requires the leading dash so it never matches a `Model = '...'`
      property on a mock return object — correct for fixtures, where such properties
      are expected and not model pins.

    - scripts/AITriad/ (WARN-only): production assigns model ids in more ways than a
      -Model binding, so the pattern is widened to also match `$...Model... = '...'`
      variable/default-parameter assignments and standalone `model = '...'` hashtable /
      API-body keys. That `Model = '...'` inclusion is the exact thing suppressed for
      tests, hence a separate pattern rather than one widened regex over both scopes.

    Production value-based exclusions (co-located reasoning, NOT predicate-weakening —
    these drop non-literal / non-single-id matches, never a real model id):
      * empty value            -> a runtime-resolved default (e.g. `[string]$Model = ''`)
      * value containing '$'   -> string interpolation, not a literal (e.g. `model='$Model'`)
      * value containing ','   -> an alias CSV, not a single id (e.g. `$Models='haiku,gemini'`)

    Suppression: a deliberately-invalid or intentionally-non-registry id (negative tests,
    mock-only backends, raw provider-API ids, non-LLM model families such as embedding /
    reranker / TTS models) is exempted by an inline trailing marker comment
    "# model-lint:allow <reason>" on the same physical line as the literal. The marker is
    co-located with the literal per gate-integrity (Sage #20/#46). Do not weaken the
    predicate to make an offender disappear — fix it, repoint it, or mark it with a reason.

    WARN-only vs blocking: production offenders currently WARN (they do not red the gate).
    Promotion to blocking is a deliberate step the Technical Lead sequences — both arms
    proven, Gate Verification, and a mandatory Second Opinion (blocking-gate promotion
    class, root AGENTS.md). Flip $script:ProductionModelLintBlocking to $true to enforce.
#>

BeforeAll {
    $script:RepoRoot   = Join-Path $PSScriptRoot '..'
    $ModulePath        = Join-Path $script:RepoRoot 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    # Registered set — the same list Test-AIModelId validates against (models[].id).
    $script:ValidIds = @(InModuleScope AITriad { $script:ValidModelIds })

    $script:SuppressMarker = '# model-lint:allow'

    # ── Blocking toggle (t/3560) ────────────────────────────────────────────────
    # Production scope is WARN-only until the TL sequences the blocking promotion
    # (blocking-gate class -> Second Opinion + Gate Verification, root AGENTS.md).
    # Flip to $true to make an unregistered production literal fail the gate.
    $script:ProductionModelLintBlocking = $false

    # tests/ pattern (t/1858): a -Model parameter bound to a literal. Group 2 = id.
    # Leading dash required, so it never matches a `Model = '...'` mock property.
    $script:TestModelPattern = '-Model(?::|\s+)([''"])([^''"]+)\1'

    # production pattern (t/3560): widened to three model-binding positions —
    #   -<*Model*> param binding | $<*Model*> = assignment | standalone model = key.
    # Group 2 = id in every alternation. The `(?<![\w$-])` on the bare-key arm keeps a
    # compound key like `ModelUnavailable = '...'` from matching (its value isn't an id).
    $script:ProdModelPattern = '(?:-[A-Za-z]*[Mm]odel[A-Za-z]*(?::|\s+)|\$[A-Za-z]*[Mm]odel[A-Za-z]*\s*=\s*|(?<![\w$-])[Mm]odel\s*=\s*)([''"])([^''"]+)\1'

    # Collect (file, line, id) for a scope. $Exclusions drops non-literal / non-single-id
    # values so the vacuous-lint guard counts only real literals.
    function script:Get-ModelLiterals {
        param([string]$Path, [string]$Pattern, [switch]$Exclusions)
        $out = [System.Collections.Generic.List[object]]::new()
        foreach ($file in Get-ChildItem -Path $Path -File -Recurse -Include '*.ps1', '*.psm1') {
            $lineNo = 0
            foreach ($line in [System.IO.File]::ReadAllLines($file.FullName)) {
                $lineNo++
                if ($line.Contains($script:SuppressMarker)) { continue }
                foreach ($match in [regex]::Matches($line, $Pattern)) {
                    $id = $match.Groups[2].Value
                    if ($Exclusions) {
                        if ([string]::IsNullOrWhiteSpace($id)) { continue }  # runtime-resolved default
                        if ($id.Contains('$'))                 { continue }  # interpolation, not a literal
                        if ($id.Contains(','))                 { continue }  # alias CSV, not a single id
                    }
                    $out.Add([PSCustomObject]@{ File = $file.Name; Line = $lineNo; Id = $id })
                }
            }
        }
        $out
    }

    # tests/ — the original t/1858 scope (blocking), -Model bindings only.
    $script:ModelLiterals = @(script:Get-ModelLiterals -Path $PSScriptRoot -Pattern $script:TestModelPattern)

    # scripts/AITriad/ — production scope (WARN-only), widened pattern + exclusions.
    $ProdRoot = Join-Path $script:RepoRoot 'scripts' 'AITriad'
    $script:ProdLiterals = @(script:Get-ModelLiterals -Path $ProdRoot -Pattern $script:ProdModelPattern -Exclusions)
}

Describe 'Model-id literals resolve to registered models' -Tag 'config' {

    It 'ai-models.json exposes a non-empty registered model set' {
        # False-green guard: if the module fails to load ids, this fails loudly here
        # rather than silently letting the resolutions below pass on an empty set.
        @($script:ValidIds).Count | Should -BeGreaterThan 0
    }

    It 'the tests/ scan detects -Model literals (guards against a vacuous lint)' {
        # If the parser regex ever breaks, it finds nothing and the resolution below
        # passes vacuously. This asserts the scan is actually seeing literals.
        @($script:ModelLiterals).Count | Should -BeGreaterThan 0
    }

    It 'the production scan detects model literals (guards against a vacuous lint)' {
        # Same false-green guard for the widened production pattern: a broadened regex
        # that breaks would otherwise let the production resolution pass on zero matches.
        @($script:ProdLiterals).Count | Should -BeGreaterThan 0
    }

    It 'every -Model literal in tests/ names a model registered in ai-models.json' {
        $offenders = @($script:ModelLiterals | Where-Object { $_.Id -notin $script:ValidIds })
        $report = ($offenders | ForEach-Object { "$($_.File):$($_.Line) names unregistered id '$($_.Id)'" }) -join "`n"
        $offenders.Count | Should -Be 0 -Because "test fixtures must mock only registered models. Fix each: register the id in ai-models.json, repoint to a valid id, or (if the id is intentionally invalid) append a model-lint:allow marker comment on that line.`n$report"
    }

    It 'every production model-id literal names a registered model (WARN-only — t/3560)' {
        $offenders = @($script:ProdLiterals | Where-Object { $_.Id -notin $script:ValidIds })
        $report = ($offenders | ForEach-Object { "$($_.File):$($_.Line) names unregistered id '$($_.Id)'" }) -join "`n"
        $remedy = "register the id in ai-models.json, repoint to a registered id, or append '$($script:SuppressMarker) <reason>' on that line (raw provider ids / embedding / reranker / TTS models are legitimate pins)."

        if ($script:ProductionModelLintBlocking) {
            # Blocking arm (TL flips the toggle after Second Opinion + GV).
            $offenders.Count | Should -Be 0 -Because "production code must name only registered models. $remedy`n$report"
        } else {
            # WARN-only arm: surface offenders without reding the gate. The assertion is
            # the vacuous-scan guard (non-empty scan), so this It still verifies work.
            if ($offenders.Count -gt 0) {
                Write-Warning "model-lint (WARN-only, t/3560): $($offenders.Count) production literal(s) name an unregistered model — $remedy`n$report"
            }
            @($script:ProdLiterals).Count | Should -BeGreaterThan 0
        }
    }
}
