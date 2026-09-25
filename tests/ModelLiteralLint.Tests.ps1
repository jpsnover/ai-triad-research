# Tag: config (t/1858, t/3560)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Lint: every model-id literal must name a model registered in ai-models.json.
    Covers test fixtures (tests/) and production module source (scripts/AITriad/).
    BOTH scopes are BLOCKING as of t/3557 condition 5 (production flipped from
    WARN-only; see the Blocking toggle block below for the promotion evidence).

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
    reranker / TTS models) is exempted by an inline trailing marker comment on the same
    physical line as the literal. The typed grammar (t/3657, shared with
    lib/ai-config/modelLiteralLint.ts) is "# model-lint:allow-<kind> <reason>", kind ∈
    {pin, external, nonselect}, both kind and reason MANDATORY. Bare "# model-lint:allow"
    and any typed marker with no reason are INVALID (deprecated) and do NOT exempt. A valid
    marker on an id that IS registered is a contradiction and is flagged as an offender. The
    marker is co-located with the literal per gate-integrity (Sage #20/#46). Do not weaken
    the predicate to make an offender disappear — fix it, repoint it, or mark it with a reason.

    Blocking: production offenders RED the gate (t/3557 condition 5). They previously only
    WARNed; the promotion followed the blocking-gate class in root AGENTS.md — both arms
    proven on the pure predicate, TL Gate Verification (t/3557#8), and a mandatory Second
    Opinion (e/195#2). Full evidence is co-located at $script:ProductionModelLintBlocking.

    Taking production back to WARN-only is a gate DEMOTION, not a config tweak: record why.
    The exemption ratchet (fail-on-mismatch, t/3658) and the typed marker grammar both
    assume enforcement, so a silent demotion leaves them asserting against nothing.
#>

BeforeAll {
    $script:RepoRoot   = Join-Path $PSScriptRoot '..'
    $ModulePath        = Join-Path $script:RepoRoot 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    # Registered set — the same list Test-AIModelId validates against (models[].id).
    $script:ValidIds = @(InModuleScope AITriad { $script:ValidModelIds })

    # Canonical valid suppression form (t/3657 typed grammar). Bare `# model-lint:allow`
    # is now INVALID (deprecated) — a suppression must name a kind + reason.
    $script:SuppressMarker = '# model-lint:allow-pin'

    # ── Blocking toggle (t/3560; FLIPPED to blocking t/3557 condition 5) ────────
    # Production scope now BLOCKS: an unregistered production literal reds the gate.
    #
    # Promotion evidence (root AGENTS.md blocking-gate class), all satisfied before the flip:
    #   - Mandatory Second Opinion: e/195#2, approve-with-conditions (6 conditions).
    #   - Conditions 1-4 landed: typed marker grammar (t/3657/t/3658), exemption ratchet
    #     with per-kind baseline, registry-unreadable discrimination, and the shared
    #     conformance corpus with its marker layer WIRED (not skipped) on both sides.
    #   - TL Gate Verification: t/3557#8.
    #   - Both arms: the pure predicate below exercises the blocking logic directly, so
    #     this assertion was never unproven while the toggle sat at $false (t/2971).
    #   - Live-fire on the real tree with this toggle at $true: 32/32 green, zero
    #     offenders, ratchet at baseline (pin=12 external=0 nonselect=0) — verified
    #     BEFORE landing, so the flip could not red main.
    #
    # To take production back to WARN-only, flip to $false — but that is a gate
    # DEMOTION: record why, because the ratchet and the typed grammar assume enforcement.
    $script:ProductionModelLintBlocking = $true

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

    # Pure: registry-usability guard (t/3657 cond 3). Empty/unreadable registry is an
    # INFRA error, distinct from "unregistered literal" — throw a typed ActionableError
    # so a flood of false offenders never masquerades as drift.
    # New-ActionableError is a PRIVATE module function (not exported), so it is not in the
    # test's script scope. Invoke it inside the module's own scope with `& (Get-Module) {}`,
    # which reaches private functions; the module is imported by the BeforeAll above and
    # persists for the whole run. Yields the same typed error the production guard raises.
    function script:Assert-ModelRegistryUsable {
        param([string[]]$ValidIds)
        if (@($ValidIds).Count -eq 0) {
            throw (& (Get-Module AITriad) {
                New-ActionableError -PassThru `
                    -Goal 'Resolve model-id literals against the registry' `
                    -Problem 'ai-models.json unreadable/empty — infra condition, not an unregistered literal' `
                    -Location 'ModelLiteralLint / Assert-ModelRegistryUsable' `
                    -NextSteps @('Confirm ai-models.json loads (Import-Module AITriad; InModuleScope AITriad { $script:ValidModelIds })', 'Re-run once the registry is readable')
            })
        }
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
        $offenders.Count | Should -Be 0 -Because "test fixtures must mock only registered models. Fix each: register the id in ai-models.json, repoint to a valid id, or (if the id is intentionally invalid) append a typed '# model-lint:allow-<pin|external|nonselect> <reason>' marker on that line.`n$report"
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

    It 'MARKER: a valid typed marker on an unregistered id is collected but exempted (not an offender)' {
        # t/3657: marked lines are now COLLECTED (carry a parsed Marker), no longer skipped
        # at parse time — the marker validity is what exempts them from the offender set.
        $lines = @("        model = 'retired-model-999'  $($script:SuppressMarker) intentional pin")
        $lits  = @(script:Get-ModelLiteralsFromLines -Lines $lines -Pattern $script:ProdModelPattern -Exclusions)
        $lits.Count           | Should -Be 1
        $lits[0].Marker.Valid | Should -BeTrue
        $lits[0].Marker.Kind  | Should -Be 'pin'
        @(script:Get-ModelLintOffenders -Literals $lits -ValidIds $script:FakeValid).Count | Should -Be 0
    }

    It 'MARKER: a valid marker on a REGISTERED id is a contradiction -> offender (t/3657)' {
        # A pin/external/nonselect marker claims the id is intentionally-unregistered; if the
        # id IS registered the marker is spurious and must be flagged, not silently honoured.
        $lines = @("        model = 'gemini-3.5-flash-lite'  # model-lint:allow-pin bogus pin on a live id")
        $lits  = @(script:Get-ModelLiteralsFromLines -Lines $lines -Pattern $script:ProdModelPattern -Exclusions)
        $off   = @(script:Get-ModelLintOffenders -Literals $lits -ValidIds $script:FakeValid)
        $off.Count | Should -Be 1
        $off[0].Id | Should -Be 'gemini-3.5-flash-lite'
    }

    It 'MARKER: a bare / no-reason marker is INVALID -> does not exempt an unregistered id (t/3657)' {
        # Bare `model-lint:allow` (no kind) and typed-with-no-reason are deprecated/invalid;
        # they fall through to normal resolution, so an unregistered id stays an offender.
        foreach ($mk in @('# model-lint:allow intentional', '# model-lint:allow-pin')) {
            $lines = @("        model = 'retired-model-999'  $mk")
            $lits  = @(script:Get-ModelLiteralsFromLines -Lines $lines -Pattern $script:ProdModelPattern -Exclusions)
            $lits[0].Marker.Valid | Should -BeFalse -Because "'$mk' lacks a kind and/or a reason"
            @(script:Get-ModelLintOffenders -Literals $lits -ValidIds $script:FakeValid).Count | Should -Be 1 -Because "'$mk' must not exempt"
        }
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
            "        Find-Thing -Model 'retired-b'",                               # model-lint:allow-nonselect test-fixture literal, not a runtime selection
            "        [string]`$Model = 'gemini-3.5-flash-lite'",                   # registered -> not an offender
            "        model = 'retired-c'  $($script:SuppressMarker) pinned",       # marked -> excluded
            "        `$Models = 'a,b'"                                             # CSV -> excluded
        )
        $lits = @(script:Get-ModelLiteralsFromLines -Lines $lines -Pattern $script:ProdModelPattern -Exclusions)
        $off  = @(script:Get-ModelLintOffenders -Literals $lits -ValidIds $script:FakeValid)
        @($off.Id) | Should -Be @('retired-a', 'retired-b')
    }

    It 'the seeded scan itself is non-vacuous (a broken pattern would surface here too)' {
        $lines = @("        -Model 'anything-at-all'")  # model-lint:allow-nonselect test-fixture literal, not a runtime selection
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
               marker = $_.marker; registeredIds = @($_.registeredIds); reason = $_.reason }
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
                # Parse the co-located marker + resolve with marker semantics (t/3657):
                # valid marker + unregistered -> exempt; valid + registered -> contradiction;
                # bare/no-reason -> not exempt -> normal resolution.
                $rec = [pscustomobject]@{ File = 'conformance'; Line = 0; Id = $id; Marker = (script:Get-ModelLintMarker -Line $marker) }
                $off = @(script:Get-ModelLintOffenders -Literals @($rec) -ValidIds $registeredIds)
                if ($expect -eq 'pass') { $off.Count | Should -Be 0 -Because $reason }
                else                    { $off.Count | Should -Be 1 -Because $reason }
            }
            'registry' {
                # Guard/loader-level (t/3657 cond 3): empty/unreadable registry -> typed
                # ActionableError, distinct from 'unregistered literal'.
                { script:Assert-ModelRegistryUsable -ValidIds $registeredIds } | Should -Throw -ExpectedMessage '*unreadable/empty*' -Because $reason
            }
            default {
                Set-ItResult -Inconclusive -Because "unknown layer '$layer' in the conformance corpus — $name"
            }
        }
    }
}

# ── Exemption ratchet (SO condition 2 — t/3658) ──────────────────────────────
# Stops silent GROWTH of the production exemption set. An "exemption" is a VALID
# `# model-lint:allow-<kind> <reason>` marker on an id that is NOT registered in
# ai-models.json (a valid marker on a REGISTERED id is a contradiction/offender,
# not an exemption — excluded, exactly as in Get-ModelLintOffenders). The gate
# fails if a kind's live count RISES above the committed baseline without the
# baseline bumped in the SAME commit; lowering is always allowed (the ratchet
# never auto-shrinks — periodic inventory review is a separate follow-up). WARN-
# only until the TL's condition-5 flip promotes it alongside the offender arm.
# PRODUCTION scope only (scripts/AITriad/); test-fixture markers are bounded
# scaffolding and deliberately NOT ratcheted (TL approval, t/3658; mirrors SL's
# TS ratchet lib/ai-config/modelLiteralLint.exemptions.baseline.json).
Describe 'Exemption ratchet — production model-lint exemptions do not grow silently (t/3658)' -Tag 'config' {

    BeforeAll {
        $script:ExemptionBaselinePath = Join-Path $PSScriptRoot 'modelLiteralLint.exemptions.baseline.json'

        # Pure: count VALID exemptions (valid marker on an UNregistered id) by kind.
        function script:Measure-ModelLintExemptions {
            param([object[]]$Literals, [string[]]$ValidIds)
            $counts = @{ pin = 0; external = 0; nonselect = 0 }
            foreach ($lit in $Literals) {
                $mk = if ($lit.PSObject.Properties['Marker']) { $lit.Marker } else { $null }
                if ($mk -and $mk.Present -and $mk.Valid -and ($lit.Id -notin $ValidIds)) {
                    if ($counts.ContainsKey($mk.Kind)) { $counts[$mk.Kind]++ }
                }
            }
            $counts
        }
    }

    It 'the baseline file exists and declares every kind (fails loudly, not silent-zero)' {
        Test-Path -LiteralPath $script:ExemptionBaselinePath | Should -BeTrue
        $b = Get-Content -Raw -LiteralPath $script:ExemptionBaselinePath | ConvertFrom-Json
        foreach ($k in 'pin', 'external', 'nonselect') {
            $b.PSObject.Properties[$k] | Should -Not -BeNullOrEmpty -Because "baseline must declare a '$k' count"
        }
    }

    It 'every kind''s production exemption count matches the baseline exactly (WARN-only — t/3560/t/3658)' {
        $baseline = Get-Content -Raw -LiteralPath $script:ExemptionBaselinePath | ConvertFrom-Json
        $current  = script:Measure-ModelLintExemptions -Literals $script:ProdLiterals -ValidIds $script:ValidIds
        Write-Host "model-lint exemptions (production): pin=$($current.pin) external=$($current.external) nonselect=$($current.nonselect) | baseline: pin=$($baseline.pin) external=$($baseline.external) nonselect=$($baseline.nonselect)"

        # Fail-on-MISMATCH (t/3658, TL pre-flip): a kind's live count must EQUAL its baseline.
        # Adding AND removing an exemption both require the baseline bumped in the SAME commit —
        # exact-match keeps the baseline honest so a stale-high baseline can't mask later growth.
        $mismatched = @(foreach ($k in 'pin', 'external', 'nonselect') {
            if ($current[$k] -ne $baseline.$k) { "$k differs: $($current[$k]) vs baseline $($baseline.$k)" }
        })
        $remedy = "update tests/modelLiteralLint.exemptions.baseline.json for that kind in the SAME commit so it matches — every add OR removal requires the bump. A rising 'nonselect' may instead mean the extraction regex is over-broad — narrow it, don't raise the baseline."

        if ($script:ProductionModelLintBlocking) {
            # Blocking arm (TL flips the toggle after Second Opinion + GV, condition 5).
            $mismatched.Count | Should -Be 0 -Because "exemption ratchet: $($mismatched -join '; '). $remedy"
        } else {
            # WARN-only arm: surface the drift without reding the gate. The assertion is the
            # non-vacuous guard (a broken prod scan would otherwise pass the ratchet on an
            # empty set — the t/2971 clean-arm-never-exercised class).
            if ($mismatched.Count -gt 0) {
                Write-Warning "exemption ratchet (WARN-only, t/3560): $($mismatched -join '; '). $remedy"
            }
            @($script:ProdLiterals).Count | Should -BeGreaterThan 0
        }
    }

    It 'RATCHET both-arms: seeded counts differing from baseline (higher OR lower) are flagged; exact match is not' {
        # Exercise the pure counter + rise-detection on seeded input, independent of the
        # live tree, so the blocking arm's logic runs today (toggle $false) — same t/2971
        # discipline as the offender-resolution direct tests.
        $fakeValid = @('gemini-3.5-flash-lite')
        $seed = @(
            [pscustomobject]@{ Id = 'raw-embed-x'; Marker = (script:Get-ModelLintMarker -Line '# model-lint:allow-pin embedding') }
            [pscustomobject]@{ Id = 'raw-embed-y'; Marker = (script:Get-ModelLintMarker -Line '# model-lint:allow-pin embedding') }
            [pscustomobject]@{ Id = 'azure-dep-z'; Marker = (script:Get-ModelLintMarker -Line '# model-lint:allow-external byok deployment') }
            # valid pin on a REGISTERED id -> contradiction, NOT an exemption -> excluded
            [pscustomobject]@{ Id = 'gemini-3.5-flash-lite'; Marker = (script:Get-ModelLintMarker -Line '# model-lint:allow-pin bogus pin') }
            # bare/no-kind -> invalid -> excluded
            [pscustomobject]@{ Id = 'bare-y'; Marker = (script:Get-ModelLintMarker -Line '# model-lint:allow no kind') }
        )
        $c = script:Measure-ModelLintExemptions -Literals $seed -ValidIds $fakeValid
        $c.pin        | Should -Be 2
        $c.external   | Should -Be 1
        $c.nonselect  | Should -Be 0

        # HIGHER than baseline -> flagged (silent growth)
        $lo = @{ pin = 1; external = 1; nonselect = 0 }
        @(foreach ($k in 'pin', 'external', 'nonselect') { if ($c[$k] -ne $lo[$k]) { $k } }) | Should -Be @('pin')

        # LOWER than baseline -> ALSO flagged (fail-on-mismatch: a removal must bump the baseline too)
        $hi = @{ pin = 5; external = 1; nonselect = 0 }
        @(foreach ($k in 'pin', 'external', 'nonselect') { if ($c[$k] -ne $hi[$k]) { $k } }) | Should -Be @('pin')

        # EXACT match -> not flagged
        $exact = @{ pin = 2; external = 1; nonselect = 0 }
        @(foreach ($k in 'pin', 'external', 'nonselect') { if ($c[$k] -ne $exact[$k]) { $k } }).Count | Should -Be 0
    }
}
