# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

# t/4037: verify:config's warn-only calibration-epoch lane. A changed defaults/debateTiers model needs a
# register §17 row (Slot = dotted slot, Old → new matching). Both arms: changed + no row -> gap;
# changed + matching row -> clean.

BeforeAll {
    . (Join-Path $PSScriptRoot '..' 'scripts' 'CalibrationEpochCheck.ps1')

    function New-Config([hashtable]$Defaults, [hashtable]$Advanced) {
        [pscustomobject]@{
            defaults    = [pscustomobject]$Defaults
            debateTiers = [pscustomobject]@{
                _comment = 'ignored'
                advanced = [pscustomobject]$Advanced
            }
        }
    }
    function New-Register([string[]]$Rows, [string]$OtherSectionRow = '') {
        @(
            '## 16. Something else'
            '| Date | Slot | Old → new | How | Authorization |'
            '|---|---|---|---|---|'
            $OtherSectionRow
            '## 17. Calibration epochs: model changes behind debate defaults and tiers (t/3553, e/263)'
            '| Date | Slot | Old → new | How | Authorization |'
            '|---|---|---|---|---|'
            '| — | — | — | — | *(no epoch boundary recorded yet)* |'
            $Rows
            '## Maintenance'
        ) -join "`n"
    }
    $script:Base = New-Config @{ gemini = 'gem-a'; claude = 'cl-a' } @{ gemini = 'gem-pro-a' }
}

Describe 'Calibration-epoch register check (t/4037)' -Tag 'config' {

    It 'reports nothing when no model slot changed' {
        $gaps = Find-UnrecordedEpochChanges -BaseConfig $Base -HeadConfig $Base -RegisterRows @(Get-EpochRegisterRows (New-Register @()))
        @($gaps).Count | Should -Be 0
    }

    It 'WARN arm: a changed default with no §17 row is reported' {
        $head = New-Config @{ gemini = 'gem-b'; claude = 'cl-a' } @{ gemini = 'gem-pro-a' }
        $gaps = @(Find-UnrecordedEpochChanges -BaseConfig $Base -HeadConfig $head -RegisterRows @(Get-EpochRegisterRows (New-Register @())))
        $gaps.Count | Should -Be 1
        $gaps[0].Slot | Should -Be 'defaults.gemini'
        $gaps[0].Old | Should -Be 'gem-a'
        $gaps[0].New | Should -Be 'gem-b'
    }

    It 'PASS arm: a changed default with a matching §17 row (backticks allowed) is clean' {
        $head = New-Config @{ gemini = 'gem-b'; claude = 'cl-a' } @{ gemini = 'gem-pro-a' }
        $reg = New-Register @('| 2026-10-07 | `defaults.gemini` | `gem-a` → `gem-b` | manual edit | t/9999 |')
        @(Find-UnrecordedEpochChanges -BaseConfig $Base -HeadConfig $head -RegisterRows @(Get-EpochRegisterRows $reg)).Count | Should -Be 0
    }

    It 'a row for the right slot but the wrong Old → new does not satisfy it' {
        $head = New-Config @{ gemini = 'gem-b'; claude = 'cl-a' } @{ gemini = 'gem-pro-a' }
        $reg = New-Register @('| 2026-10-07 | defaults.gemini | gem-x -> gem-b | manual | t/9999 |')
        @(Find-UnrecordedEpochChanges -BaseConfig $Base -HeadConfig $head -RegisterRows @(Get-EpochRegisterRows $reg)).Count | Should -Be 1
    }

    It 'covers debateTiers slots by dotted path and skips _comment' {
        $head = New-Config @{ gemini = 'gem-a'; claude = 'cl-a' } @{ gemini = 'gem-pro-b' }
        $gaps = @(Find-UnrecordedEpochChanges -BaseConfig $Base -HeadConfig $head -RegisterRows @())
        $gaps.Count | Should -Be 1
        $gaps[0].Slot | Should -Be 'debateTiers.advanced.gemini'
        (Get-EpochModelSlots -Config $Base).Keys | Should -Not -Contain 'debateTiers._comment'
    }

    It 'reports an added slot, satisfied by a row whose Old is a placeholder' {
        $head = New-Config @{ gemini = 'gem-a'; claude = 'cl-a'; xai = 'grok-1' } @{ gemini = 'gem-pro-a' }
        $gaps = @(Find-UnrecordedEpochChanges -BaseConfig $Base -HeadConfig $head -RegisterRows @())
        $gaps[0].Slot | Should -Be 'defaults.xai'
        $gaps[0].Old | Should -Be ''
        $reg = New-Register @('| 2026-10-07 | defaults.xai | — → grok-1 | manual | t/9999 |')
        @(Find-UnrecordedEpochChanges -BaseConfig $Base -HeadConfig $head -RegisterRows @(Get-EpochRegisterRows $reg)).Count | Should -Be 0
    }

    It 'reads rows only from §17: a matching row in another section does not count' {
        $head = New-Config @{ gemini = 'gem-b'; claude = 'cl-a' } @{ gemini = 'gem-pro-a' }
        $reg = New-Register @() -OtherSectionRow '| 2026-10-07 | defaults.gemini | gem-a → gem-b | manual | t/9999 |'
        @(Get-EpochRegisterRows $reg).Count | Should -Be 0
        @(Find-UnrecordedEpochChanges -BaseConfig $Base -HeadConfig $head -RegisterRows @(Get-EpochRegisterRows $reg)).Count | Should -Be 1
    }

    It 'parses the real register and the real ai-models.json without error' {
        $root = Join-Path $PSScriptRoot '..'
        { Get-EpochRegisterRows (Get-Content -Raw (Join-Path $root 'research/comp-linguist/docs/metric-provenance-register.md')) } | Should -Not -Throw
        $slots = Get-EpochModelSlots -Config (Get-Content -Raw (Join-Path $root 'ai-models.json') | ConvertFrom-Json)
        $slots.Keys | Should -Contain 'defaults.gemini'
        $slots.Keys | Should -Contain 'debateTiers.advanced.gemini'
    }
}

Describe 'Calibration-epoch register check: apiModelId repoints (t/4041)' -Tag 'config' {

    BeforeAll {
        # The served model is `id:apiModelId` (t/4040). Same slot id, repointed api id.
        function New-ServedConfig([string]$SlotId, [string]$ApiId) {
            [pscustomobject]@{
                defaults = [pscustomobject]@{ claude = $SlotId }
                models   = @(
                    [pscustomobject]@{ id = 'claude-haiku-4-5'; apiModelId = $ApiId }
                    [pscustomobject]@{ id = 'claude-sonnet-5'; apiModelId = 'claude-sonnet-5-20260101' }
                )
            }
        }
        $script:RepointBase = New-ServedConfig 'claude-haiku-4-5' 'claude-haiku-4-5-20251001'
        $script:RepointHead = New-ServedConfig 'claude-haiku-4-5' 'claude-haiku-4-5-20260301'
    }

    It 'WARN arm: a repoint under an unchanged slot id is reported as id:api' {
        $gaps = @(Find-UnrecordedEpochChanges -BaseConfig $RepointBase -HeadConfig $RepointHead -RegisterRows @())
        $gaps.Count | Should -Be 1
        $gaps[0].Slot | Should -Be 'defaults.claude'
        $gaps[0].Old | Should -Be 'claude-haiku-4-5:claude-haiku-4-5-20251001'
        $gaps[0].New | Should -Be 'claude-haiku-4-5:claude-haiku-4-5-20260301'
    }

    It 'PASS arm: a matching id:api row satisfies the repoint' {
        $reg = New-Register @('| 2026-10-07 | `defaults.claude` | `claude-haiku-4-5:claude-haiku-4-5-20251001` → `claude-haiku-4-5:claude-haiku-4-5-20260301` | manual | t/4041 |')
        @(Find-UnrecordedEpochChanges -BaseConfig $RepointBase -HeadConfig $RepointHead -RegisterRows @(Get-EpochRegisterRows $reg)).Count | Should -Be 0
    }

    It 'a bare-id row does not satisfy a repoint (it would read x → x)' {
        $reg = New-Register @('| 2026-10-07 | defaults.claude | claude-haiku-4-5 → claude-haiku-4-5 | manual | t/4041 |')
        @(Find-UnrecordedEpochChanges -BaseConfig $RepointBase -HeadConfig $RepointHead -RegisterRows @(Get-EpochRegisterRows $reg)).Count | Should -Be 1
    }

    It 'an id change is still satisfied by a bare-id row, and also by an id:api row' {
        $head = New-ServedConfig 'claude-sonnet-5' 'claude-haiku-4-5-20251001'
        $bare = New-Register @('| 2026-10-07 | defaults.claude | claude-haiku-4-5 → claude-sonnet-5 | manual | t/4041 |')
        @(Find-UnrecordedEpochChanges -BaseConfig $RepointBase -HeadConfig $head -RegisterRows @(Get-EpochRegisterRows $bare)).Count | Should -Be 0
        $served = New-Register @('| 2026-10-07 | defaults.claude | claude-haiku-4-5:claude-haiku-4-5-20251001 → claude-sonnet-5:claude-sonnet-5-20260101 | manual | t/4041 |')
        @(Find-UnrecordedEpochChanges -BaseConfig $RepointBase -HeadConfig $head -RegisterRows @(Get-EpochRegisterRows $served)).Count | Should -Be 0
        $gaps = @(Find-UnrecordedEpochChanges -BaseConfig $RepointBase -HeadConfig $head -RegisterRows @())
        $gaps[0].Old | Should -Be 'claude-haiku-4-5'   # reported with bare ids, as before
        $gaps[0].New | Should -Be 'claude-sonnet-5'
    }

    It 'a repoint of a model no slot uses is not reported' {
        $head = $RepointBase.PSObject.Copy()
        $head.models = @(
            [pscustomobject]@{ id = 'claude-haiku-4-5'; apiModelId = 'claude-haiku-4-5-20251001' }
            [pscustomobject]@{ id = 'claude-sonnet-5'; apiModelId = 'claude-sonnet-5-20270101' }
        )
        @(Find-UnrecordedEpochChanges -BaseConfig $RepointBase -HeadConfig $head -RegisterRows @()).Count | Should -Be 0
    }
}

Describe 'Calibration-epoch register check: real slots resolve to a served model (t/4043)' -Tag 'config' {

    It 'every real defaults/debateTiers slot resolves to a non-empty apiModelId' {
        # If a registry shape change leaves a slot's id without a models entry (or without apiModelId), the slot
        # would quietly resolve to 'id:' and the lane could no longer see a repoint. Fail loudly and name it.
        $config = Get-Content -Raw (Join-Path $PSScriptRoot '..' 'ai-models.json') | ConvertFrom-Json
        $slots = Get-EpochModelSlots -Config $config
        $apiIds = Get-EpochApiModelIds -Config $config
        $slots.Count | Should -BeGreaterThan 0 -Because 'an empty slot map would make this check vacuous'
        $unresolved = @($slots.Keys | Where-Object {
                $served = Get-EpochServedModel -Id $slots[$_] -ApiIds $apiIds
                $served -notmatch ':.+$'
            } | ForEach-Object { "$_ = $($slots[$_])" })
        $unresolved | Should -BeNullOrEmpty -Because "these slots don't resolve to an apiModelId: $($unresolved -join '; ')"
    }
}
