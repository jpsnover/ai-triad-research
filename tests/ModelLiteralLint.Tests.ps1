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

    # ── Pure predicate (t/3565, Guard Testability t/2971) ───────────────────────
    # The offender resolution is factored into PURE functions that operate on
    # in-memory lines/records (no file IO), so the blocking arm's exact logic is
    # exercised by direct both-arms unit tests below EVEN while the toggle is $false.
    # Without this, flipping $ProductionModelLintBlocking would run the blocking
    # assertion on main for the first time ever (t/2971 clean-arm-never-exercised class).

    # Pure: parse in-memory lines -> literal records. Skips marked lines and (when
    # -Exclusions) drops non-literal / non-single-id values. No file IO.
    function script:Get-ModelLiteralsFromLines {
        param([string[]]$Lines, [string]$Pattern, [switch]$Exclusions, [string]$FileName = '(memory)')
        $out = [System.Collections.Generic.List[object]]::new()
        $lineNo = 0
        foreach ($line in $Lines) {
            $lineNo++
            if ($line.Contains($script:SuppressMarker)) { continue }
            foreach ($match in [regex]::Matches($line, $Pattern)) {
                $id = $match.Groups[2].Value
                if ($Exclusions) {
                    if ([string]::IsNullOrWhiteSpace($id)) { continue }  # runtime-resolved default
                    if ($id.Contains('$'))                 { continue }  # interpolation, not a literal
                    if ($id.Contains(','))                 { continue }  # alias CSV, not a single id
                }
                $out.Add([PSCustomObject]@{ File = $FileName; Line = $lineNo; Id = $id })
            }
        }
        $out
    }

    # Pure: offenders = literal records whose Id is not in the registered set. This is
    # the exact predicate the blocking assertion checks; tested directly below.
    function script:Get-ModelLintOffenders {
        param([object[]]$Literals, [string[]]$ValidIds)
        @($Literals | Where-Object { $_.Id -notin $ValidIds })
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
        $offenders = @(script:Get-ModelLintOffenders -Literals $script:ModelLiterals -ValidIds $script:ValidIds)
        $report = ($offenders | ForEach-Object { "$($_.File):$($_.Line) names unregistered id '$($_.Id)'" }) -join "`n"
        $offenders.Count | Should -Be 0 -Because "test fixtures must mock only registered models. Fix each: register the id in ai-models.json, repoint to a valid id, or (if the id is intentionally invalid) append a model-lint:allow marker comment on that line.`n$report"
    }

    It 'every production model-id literal names a registered model (WARN-only — t/3560)' {
        $offenders = @(script:Get-ModelLintOffenders -Literals $script:ProdLiterals -ValidIds $script:ValidIds)
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

Describe 'Offender-resolution predicate — direct both-arms tests (t/3565, Guard Testability t/2971)' -Tag 'config' {
    # Exercise the SAME pure functions the WARN/blocking arms use, on seeded in-memory
    # input, so the blocking assertion's logic runs in CI today (toggle $false) rather
    # than for the first time on main the moment the TL flips it. Uses a stand-in
    # registered set so the test is independent of ai-models.json churn.

    BeforeAll { $script:FakeValid = @('gemini-3.5-flash-lite', 'claude-sonnet-4-6') }

    It 'BLOCKING ARM: an unregistered, unmarked literal is reported as an offender (file:line:id)' {
        $lines = @("        `$ScreenModel = 'retired-model-999'")
        $lits  = @(script:Get-ModelLiteralsFromLines -Lines $lines -Pattern $script:ProdModelPattern -Exclusions -FileName 'Seed.ps1')
        $off   = @(script:Get-ModelLintOffenders -Literals $lits -ValidIds $script:FakeValid)
        $off.Count   | Should -Be 1
        $off[0].Id   | Should -Be 'retired-model-999'
        $off[0].Line | Should -Be 1
        $off[0].File | Should -Be 'Seed.ps1'
    }

    It 'PASS ARM: a registered literal reports no offender' {
        $lines = @("        [string]`$Model = 'gemini-3.5-flash-lite'")
        $lits  = @(script:Get-ModelLiteralsFromLines -Lines $lines -Pattern $script:ProdModelPattern -Exclusions)
        @(script:Get-ModelLintOffenders -Literals $lits -ValidIds $script:FakeValid).Count | Should -Be 0
    }

    It 'PASS ARM: an unregistered literal carrying the marker is not collected (marker filter)' {
        $lines = @("        model = 'retired-model-999'  $($script:SuppressMarker) intentional pin")
        $lits  = @(script:Get-ModelLiteralsFromLines -Lines $lines -Pattern $script:ProdModelPattern -Exclusions)
        $lits.Count | Should -Be 0
        @(script:Get-ModelLintOffenders -Literals $lits -ValidIds $script:FakeValid).Count | Should -Be 0
    }

    It 'EXCLUSIONS: interpolation ($), alias CSV (,), and empty values are not literals' {
        $lines = @(
            "        Write-Verbose `"model='`$Model'`"",   # $ interpolation
            "        `$Models = 'haiku,gemini'",           # , alias CSV
            "        [string]`$Model = ''"                 # empty (runtime default)
        )
        @(script:Get-ModelLiteralsFromLines -Lines $lines -Pattern $script:ProdModelPattern -Exclusions).Count | Should -Be 0
    }

    It 'END-TO-END: mixed input yields exactly the unregistered, unmarked, real literals' {
        $lines = @(
            "        `$ScreenModel = 'retired-a'",                                 # offender
            "        Find-Thing -Model 'retired-b'",                               # model-lint:allow test-fixture literal (offender, dash param), not a real pin
            "        [string]`$Model = 'gemini-3.5-flash-lite'",                   # registered -> not an offender
            "        model = 'retired-c'  $($script:SuppressMarker) pinned",       # marked -> excluded
            "        `$Models = 'a,b'"                                             # CSV -> excluded
        )
        $lits = @(script:Get-ModelLiteralsFromLines -Lines $lines -Pattern $script:ProdModelPattern -Exclusions)
        $off  = @(script:Get-ModelLintOffenders -Literals $lits -ValidIds $script:FakeValid)
        @($off.Id) | Should -Be @('retired-a', 'retired-b')
    }

    It 'the seeded scan itself is non-vacuous (a broken pattern would surface here too)' {
        $lines = @("        -Model 'anything-at-all'")  # model-lint:allow test-fixture literal, not a real pin
        @(script:Get-ModelLiteralsFromLines -Lines $lines -Pattern $script:ProdModelPattern -Exclusions).Count | Should -BeGreaterThan 0
    }
}

# ── Shared cross-toolchain conformance corpus (t/3656 / SO condition 4 of t/3557) ──
# Both lib/ai-config/modelLiteralLint.ts (TS) and this file consume the SAME corpus, so
# "same resolution predicate" is a test, not a claim (Shared Lib owns the data; PS wires
# the layers it implements). Only `resolution` is wired today; `marker` (typed-marker
# grammar) is the t/3557 cond-1 future contract and `registry` is guard/loader-level —
# both are VISIBLY skipped here (not silently passed), flipped to asserted as they land.
# Loaded at DISCOVERY (top-level, $PSScriptRoot only) so -TestCases can see it.
$script:ConformanceCases = @(
    (Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '..' 'lib' 'ai-config' 'modelLiteralLint.conformance.json') |
        ConvertFrom-Json).cases | ForEach-Object {
            @{ name = $_.name; layer = $_.layer; id = $_.id; expect = $_.expect
               registeredIds = @($_.registeredIds); reason = $_.reason }
        }
)

Describe 'Shared conformance corpus — resolution predicate (t/3656, SO cond 4)' -Tag 'config' {

    It 'the corpus loaded and carries resolution cases (guards against a vacuous consume)' {
        # Re-read at run time — Pester binds -TestCases at discovery, but a Describe-scope
        # var set at discovery is not reliably available in the run phase, so read the file.
        $path = Join-Path $PSScriptRoot '..' 'lib' 'ai-config' 'modelLiteralLint.conformance.json'
        Test-Path -LiteralPath $path | Should -BeTrue
        $cases = @((Get-Content -Raw -LiteralPath $path | ConvertFrom-Json).cases)
        $cases.Count | Should -BeGreaterThan 0
        @($cases | Where-Object { $_.layer -eq 'resolution' }).Count | Should -BeGreaterThan 0
    }

    It '<name> [<layer>] -> <expect>' -TestCases $script:ConformanceCases {
        # Pester injects $name/$layer/$id/$expect/$registeredIds/$reason from the case.
        switch ($layer) {
            'resolution' {
                # Drive the SAME pure predicate the gate uses (id in registeredIds?).
                $rec = [pscustomobject]@{ File = 'conformance'; Line = 0; Id = $id }
                $off = @(script:Get-ModelLintOffenders -Literals @($rec) -ValidIds $registeredIds)
                if ($expect -eq 'pass') { $off.Count | Should -Be 0 -Because $reason }
                else                    { $off.Count | Should -Be 1 -Because $reason }
            }
            'marker' {
                Set-ItResult -Skipped -Because "pending t/3557 cond-1 typed-marker grammar (allow-pin/allow-external/bare-deprecated) — $name"
            }
            'registry' {
                Set-ItResult -Skipped -Because "registry-load is guard/loader-level (the empty-authority false-green guard), not the pure predicate — $name"
            }
            default {
                Set-ItResult -Inconclusive -Because "unknown layer '$layer' in the conformance corpus — $name"
            }
        }
    }
}
