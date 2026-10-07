# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Characterization tests for Update-EntityMentionIndex (t/3910), written BEFORE its complexity
    refactor and required to pass unchanged after it.
.DESCRIPTION
    Pins, on one rich fixture:
      - the WRITTEN entity_mentions.json, byte-for-byte against a golden (newlines normalized to LF:
        ConvertTo-Json emits the platform newline, and CI runs on Linux), with Get-Date frozen;
      - the returned result object, against a golden;
      - the grounding-lock contract (t/3163/t/3203): the source scan runs OUTSIDE the lock, the
        existing-index read runs INSIDE it, and the lockfile is gone after success, -WhatIf and a throw;
      - the write-failure ActionableError, the unreadable-index rebuild, and the verbose fallbacks.
    Regenerate the goldens ONLY on pre-refactor code: set $env:EMI_REGEN_GOLDEN = '1' and run once.
#>

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue
    $script:GoldenDir = Join-Path $PSScriptRoot 'fixtures' 'entity-mention-index'
    $script:T1 = [datetime]::new(2026, 10, 1, 9, 0, 0, [DateTimeKind]::Utc)
    $script:T2 = [datetime]::new(2026, 10, 7, 12, 30, 0, [DateTimeKind]::Utc)

    function script:Write-Json([string]$Path, $Obj) {
        ($Obj | ConvertTo-Json -Depth 12) | Set-Content -LiteralPath $Path -Encoding utf8NoBOM
    }

    # One fixture exercising every container source and skip path.
    function script:New-EmiFixture {
        $root = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $root -Force | Out-Null
        $f = [pscustomobject]@{
            Root = $root
            Ent  = Join-Path $root 'entities.json'
            Sei  = Join-Path $root 'source_evidence_index.json'
            Out  = Join-Path $root 'entity_mentions.json'
            Lock = Join-Path $root 'entity_mentions.lock'
            Doc1 = Join-Path $root 'doc1.json'
            Doc2 = Join-Path $root 'doc2-no-docid.json'
            Gone = Join-Path $root 'missing.json'
        }
        script:Write-Json $f.Ent ([ordered]@{
                _schema_version = '1.0.0'; _doc = 'fixture'; entity_count = 5; last_modified = '2026-09-01'
                entities        = @(
                    [ordered]@{ id = 'ent-001'; name = 'Apollo Project'; aliases = @('Apollo Program'); status = 'approved' }
                    [ordered]@{ id = 'ent-002'; name = 'Apollo'; aliases = $null; status = 'approved' }
                    [ordered]@{ id = 'ent-003'; name = 'GPT-4o'; aliases = @(); status = 'approved' }
                    [ordered]@{ id = 'ent-004'; name = 'Moonshot'; aliases = @('Moon Shot'); status = 'proposed' }
                    [ordered]@{ id = 'ent-005'; name = 'Statusless' }
                )
            })
        script:Write-Json $f.Sei ([ordered]@{
                'sei-a' = @{ facts = @(@{ claim = 'The Apollo Project reshaped ambition.' }, @{ claim = '' }, @{ claim = 'GPT-4o and Apollo again; Moonshot too.' }) }
                'sei-b' = @{ facts = @(@{ claim = 'Nothing to link here.' }) }
                'sei-c' = @{ note = 'no facts key' }
            })
        script:Write-Json $f.Doc1 ([ordered]@{
                doc_id         = 'doc1'
                pov_summaries  = [ordered]@{
                    accelerationist = @{ key_points = @(@{ point = 'Apollo Program funding grew.' }, @{ point = '' }, @{ point = 'Moonshot thinking about Apollo.' }) }
                    safetyist       = @{ key_points = @(@{ point = 'GPT-4o raises risk.' }) }
                }
                factual_claims = @(@{ claim = 'Apollo landed.' }, @{ claim = $null }, @{ claim = 'GPT-4o, then Apollo Project.' })
            })
        script:Write-Json $f.Doc2 ([ordered]@{ pov_summaries = @{ safetyist = @{ key_points = @(@{ point = 'Apollo' }) } } })
        return $f
    }

    function script:Invoke-Emi($f, [datetime]$Now, [hashtable]$Extra = @{}) {
        $script:FrozenNow = $Now
        $splat = @{
            EntitiesPath = $f.Ent; SourceEvidenceIndexPath = $f.Sei; OutputPath = $f.Out
            SummariesPath = @($f.Doc1, $f.Doc2, $f.Gone)
        }
        foreach ($k in $Extra.Keys) { $splat[$k] = $Extra[$k] }
        Update-EntityMentionIndex @splat
    }

    # Phase 1 at T1, then hand-edit the file the way the shared world does, then phase 2 at T2.
    function script:Invoke-TwoPhase($f) {
        script:Invoke-Emi $f $script:T1 | Out-Null
        $file = Get-Content -Raw -LiteralPath $f.Out -Encoding utf8 | ConvertFrom-Json
        # (1) a reconciler-owned node:* container (must be preserved verbatim)
        $file.containers | Add-Member -NotePropertyName 'node:acc-beliefs-001' -NotePropertyValue ([pscustomobject]@{
                text_sha256 = 'deadbeef'; extracted_at = '2026-09-15T00:00:00Z'
                mentions    = @([pscustomobject]@{ entity_ref = 'ent-001'; quote = 'Apollo Project'; offset = 0; discovered_by = 'alias' })
            })
        # (2) a human mention overlapping the alias hit at offset 4, plus a malformed human mention
        $file.containers.'sei:sei-a'.mentions = @(
            [pscustomobject]@{ entity_ref = 'ent-999'; quote = 'Apollo Project'; offset = 4; discovered_by = 'human' }
            [pscustomobject]@{ entity_ref = 'ent-998'; discovered_by = 'human' }
        )
        # (3) an owned container no source produces any more (must be dropped)
        $file.containers | Add-Member -NotePropertyName 'summary:gone#fc-0' -NotePropertyValue ([pscustomobject]@{
                text_sha256 = 'abc'; extracted_at = '2026-09-15T00:00:00Z'
                mentions    = @([pscustomobject]@{ entity_ref = 'ent-002'; quote = 'Apollo'; offset = 0; discovered_by = 'alias' })
            })
        # (4) a stale sha on an own container (must be superseded with a fresh extracted_at)
        $file.containers.'summary:doc1#fc-0'.text_sha256 = 'stale'
        ($file | ConvertTo-Json -Depth 12) | Set-Content -LiteralPath $f.Out -Encoding utf8NoBOM
        return script:Invoke-Emi $f $script:T2
    }

    function script:Get-Lf([string]$Path) { (Get-Content -Raw -LiteralPath $Path -Encoding utf8) -replace "`r`n", "`n" }

    function script:Assert-Golden([string]$Name, [string]$Actual) {
        $g = Join-Path $script:GoldenDir $Name
        if ($env:EMI_REGEN_GOLDEN -eq '1') {
            New-Item -ItemType Directory -Path $script:GoldenDir -Force | Out-Null
            [System.IO.File]::WriteAllText($g, $Actual)
        }
        $Actual | Should -BeExactly (script:Get-Lf $g)
    }
}

Describe 'Update-EntityMentionIndex characterization (t/3910)' -Tag 'unit' {

    BeforeEach {
        Mock Get-Date -ModuleName AITriad { $script:FrozenNow }
    }

    It 'two-phase rebuild writes entity_mentions.json byte-identical to the golden' {
        $f = script:New-EmiFixture
        script:Invoke-TwoPhase $f | Out-Null
        script:Assert-Golden 'expected-entity_mentions.json' (script:Get-Lf $f.Out)
    }

    It 'returns the result object recorded in the golden' {
        $f = script:New-EmiFixture
        $r = script:Invoke-TwoPhase $f
        $r.OutputPath = '<OUT>'
        script:Assert-Golden 'expected-result.json' ((($r | ConvertTo-Json -Depth 4) -replace "`r`n", "`n") + "`n")
    }

    It 'a third run on unchanged inputs is a no-op: Unchanged, not Written, file bytes identical' {
        $f = script:New-EmiFixture
        script:Invoke-TwoPhase $f | Out-Null
        $before = (Get-FileHash -LiteralPath $f.Out).Hash
        $r = script:Invoke-Emi $f ([datetime]::new(2026, 12, 31, 0, 0, 0, [DateTimeKind]::Utc))
        $r.Unchanged | Should -BeTrue
        $r.Written | Should -BeFalse
        (Get-FileHash -LiteralPath $f.Out).Hash | Should -Be $before
        Test-Path $f.Lock | Should -BeFalse
    }

    It 'lock order: source scan OUTSIDE the lock, existing-index read INSIDE it, released after' {
        $f = script:New-EmiFixture
        script:Invoke-Emi $f $script:T1 | Out-Null    # so an existing index exists to be read
        $script:Seen = @{}
        $script:LockFile = $f.Lock; $script:SeiFile = $f.Sei; $script:OutFile = $f.Out
        # Pass-through default, so the summary/entities reads keep working unchanged.
        Mock Get-Content -ModuleName AITriad { Microsoft.PowerShell.Management\Get-Content @PesterBoundParameters }
        Mock Get-Content -ModuleName AITriad -ParameterFilter { $LiteralPath -eq $script:SeiFile -or $LiteralPath -eq $script:OutFile } {
            $script:Seen[[string]$LiteralPath] = Test-Path -LiteralPath $script:LockFile
            Microsoft.PowerShell.Management\Get-Content @PesterBoundParameters
        }
        script:Invoke-Emi $f $script:T2 @{ Force = $true } | Out-Null
        $script:Seen[$f.Sei] | Should -BeFalse -Because 'the read-only source scan runs outside the grounding lock (t/3163)'
        $script:Seen[$f.Out] | Should -BeTrue -Because 'the existing-index read is the lost-update surface and must be inside the lock'
        Test-Path $f.Lock | Should -BeFalse
    }

    It '-WhatIf writes nothing' {
        $f = script:New-EmiFixture
        $r = script:Invoke-Emi $f $script:T1 @{ WhatIf = $true }
        $r.Written | Should -BeFalse
        Test-Path $f.Out | Should -BeFalse
    }

    It '-WhatIf currently LEAVES the lockfile behind (pinned pre-existing bug t/4047; flip to BeFalse when fixed)' {
        # Exit-GroundingLock's Remove-Item inherits the ambient WhatIfPreference, so the release is a
        # "What if" no-op. Pinned here so the t/3910 refactor provably does not change it either way.
        $f = script:New-EmiFixture
        script:Invoke-Emi $f $script:T1 @{ WhatIf = $true } | Out-Null
        Test-Path $f.Lock | Should -BeTrue
    }

    It 'a write failure throws the ActionableError, removes the temp file, keeps the old index, and releases the lock' {
        $f = script:New-EmiFixture
        script:Invoke-Emi $f $script:T1 | Out-Null
        $before = (Get-FileHash -LiteralPath $f.Out).Hash
        Mock Set-Content -ModuleName AITriad -ParameterFilter { $LiteralPath -like '*.tmp' } { throw 'disk full' }
        $err = $null
        try { script:Invoke-Emi $f $script:T2 @{ Force = $true } | Out-Null } catch { $err = $_ }
        $err | Should -Not -BeNullOrEmpty
        $msg = $err.Exception.Message
        $msg | Should -Match 'Write the entity mention index'
        $msg | Should -Match ([regex]::Escape("Failed to write $($f.Out): disk full"))
        $msg | Should -Match 'Verify the data-repo path is writable'
        Test-Path "$($f.Out).tmp" | Should -BeFalse
        (Get-FileHash -LiteralPath $f.Out).Hash | Should -Be $before
        Test-Path $f.Lock | Should -BeFalse
    }

    It 'an unreadable existing index is rebuilt from scratch (verbose fallback)' {
        $f = script:New-EmiFixture
        Set-Content -LiteralPath $f.Out -Value '{ not json' -Encoding utf8NoBOM
        $verbose = script:Invoke-Emi $f $script:T1 @{ Verbose = $true } 4>&1 | Where-Object { $_ -is [System.Management.Automation.VerboseRecord] } | ForEach-Object { $_.Message }
        ($verbose -join "`n") | Should -Match 'unreadable .*rebuilding from scratch'
        $file = Get-Content -Raw -LiteralPath $f.Out | ConvertFrom-Json
        @($file.containers.PSObject.Properties.Name) | Should -Contain 'sei:sei-a'
    }

    It 'emits the verbose fallbacks: missing summary file, malformed human mention, absent SEI' {
        $f = script:New-EmiFixture
        $script:FrozenNow = $script:T1
        Update-EntityMentionIndex -EntitiesPath $f.Ent -SourceEvidenceIndexPath $f.Sei -OutputPath $f.Out -SummariesPath @($f.Doc1) | Out-Null
        $file = Get-Content -Raw -LiteralPath $f.Out | ConvertFrom-Json
        $file.containers.'sei:sei-a'.mentions = @([pscustomobject]@{ entity_ref = 'ent-998'; discovered_by = 'human' })
        ($file | ConvertTo-Json -Depth 12) | Set-Content -LiteralPath $f.Out -Encoding utf8NoBOM
        $v1 = Update-EntityMentionIndex -EntitiesPath $f.Ent -SourceEvidenceIndexPath $f.Sei -OutputPath $f.Out -SummariesPath @($f.Gone) -Verbose 4>&1 |
            Where-Object { $_ -is [System.Management.Automation.VerboseRecord] } | ForEach-Object { $_.Message }
        ($v1 -join "`n") | Should -Match ([regex]::Escape("Summary file not found: $($f.Gone); skipping."))
        ($v1 -join "`n") | Should -Match ([regex]::Escape("Skipping malformed human mention in container 'sei:sei-a' (missing offset/quote/entity_ref)."))
        $v2 = Update-EntityMentionIndex -EntitiesPath $f.Ent -SourceEvidenceIndexPath (Join-Path $f.Root 'nope.json') -OutputPath $f.Out -SummariesPath @() -Verbose 4>&1 |
            Where-Object { $_ -is [System.Management.Automation.VerboseRecord] } | ForEach-Object { $_.Message }
        ($v2 -join "`n") | Should -Match 'SEI not found at .*skipping fact containers\.'
    }
}
