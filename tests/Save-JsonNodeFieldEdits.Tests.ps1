# Tag: summary (t/2916)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Save-JsonNodeFieldEdits — the Public durable batch writer (t/2916 Fork 1,
    TL ruling t/2916#8). It reads the target fresh, applies each edit via the Private
    Update-JsonNodeField (chaining RawText->next), writes once via the guarded sink with
    the surgical exemption, and returns a result summary (Applied + NotFound) so a
    not-found node never vanishes silently. TestDrive targets are outside the data root,
    so the dirty-tree guard no-ops here — the exemption itself is proved in
    SurgicalWriteExemption.Tests.ps1.
#>

BeforeAll {
    . (Join-Path $PSScriptRoot 'TestModuleBootstrap.ps1'); Enter-AITriadTestModule
}

Describe 'Save-JsonNodeFieldEdits — durable batch writer (t/2916)' -Tag 'summary' {

    BeforeEach {
        $script:fixture = @'
{
  "nodes": [
    { "id": "sit-001", "type": "situation", "disagreement_type": "empirical" },
    { "id": "sit-002", "label": "no dtype yet" },
    { "id": "sit-003", "disagreement_type": "empirical", "resolved_node_id": "sit-477", "ratio": 3.0 }
  ]
}
'@ -replace "`r`n", "`n"
        $script:path = Join-Path $TestDrive 'situations-fixture.json'
        [System.IO.File]::WriteAllText($script:path, $script:fixture, (New-Object System.Text.UTF8Encoding $false))
    }

    It 'applies multiple edits (read-fresh + chained splice) and preserves foreign WIP byte-identical' {
        $edits = @(
            @{ NodeId = 'sit-001'; Field = 'disagreement_type'; Value = 'normative' }
            @{ NodeId = 'sit-002'; Field = 'disagreement_type'; Value = 'interpretive' }
        )
        $result = Save-JsonNodeFieldEdits -Path $script:path -Edits $edits
        $result.Applied | Should -Be 2

        $after = Get-Content -Raw -Path $script:path
        $o = @(($after | ConvertFrom-Json).nodes)
        (@($o | Where-Object { $_.id -eq 'sit-001' })[0]).disagreement_type | Should -Be 'normative'
        (@($o | Where-Object { $_.id -eq 'sit-002' })[0]).disagreement_type | Should -Be 'interpretive'
        (@($o | Where-Object { $_.id -eq 'sit-002' })[0]).label             | Should -Be 'no dtype yet'
        # foreign WIP on the untouched node survives byte-identical (the sit-477 shape)
        $after | Should -BeLike '*"resolved_node_id": "sit-477"*'
        $after | Should -BeLike '*"ratio": 3.0*'
        # exactly two lines differ from the original — no whole-file churn
        $origLines = @($script:fixture -split "`n")
        $newLines  = @($after -split "`n")
        $newLines.Count | Should -Be $origLines.Count
        $diff = for ($i = 0; $i -lt $origLines.Count; $i++) { if ($origLines[$i] -ne $newLines[$i]) { $i } }
        @($diff).Count | Should -Be 2
    }

    It 'surfaces not-found NodeIds in the result summary (no silent skip) and still lands the valid edits' {
        $edits = @(
            @{ NodeId = 'sit-001'; Field = 'disagreement_type'; Value = 'normative' }
            @{ NodeId = 'sit-999'; Field = 'disagreement_type'; Value = 'x' }   # absent node
        )
        $result = Save-JsonNodeFieldEdits -Path $script:path -Edits $edits
        $result.Applied  | Should -Be 1
        $result.NotFound | Should -Contain 'sit-999'
        (@((Get-Content -Raw -Path $script:path | ConvertFrom-Json).nodes | Where-Object { $_.id -eq 'sit-001' })[0]).disagreement_type | Should -Be 'normative'
    }

    It 'is a no-op write when no edit resolves (empty list leaves bytes untouched)' {
        $before = Get-Content -Raw -Path $script:path
        $result = Save-JsonNodeFieldEdits -Path $script:path -Edits @()
        $result.Applied | Should -Be 0
        (Get-Content -Raw -Path $script:path) | Should -Be $before
    }

    It 'aborts the whole batch and writes NOTHING when an edit hits the scalar-only limitation' {
        # An object-valued field trips Update-JsonNodeField's re-parse-verify (duplicate key)
        # -> throw. The batch is atomic on unexpected failure: nothing is written.
        $objFixture = @'
{
  "nodes": [
    { "id": "sit-001", "meta": { "a": 1 }, "note": "object-valued field" }
  ]
}
'@ -replace "`r`n", "`n"
        $p = Join-Path $TestDrive 'obj-fixture.json'
        [System.IO.File]::WriteAllText($p, $objFixture, (New-Object System.Text.UTF8Encoding $false))
        { Save-JsonNodeFieldEdits -Path $p -Edits @(@{ NodeId='sit-001'; Field='meta'; Value='scalar' }) } | Should -Throw
        (Get-Content -Raw -Path $p) | Should -Be $objFixture   # unchanged
    }

    It 'throws New-ActionableError when the target file does not exist' {
        { Save-JsonNodeFieldEdits -Path (Join-Path $TestDrive 'missing.json') -Edits @(@{ NodeId='x'; Field='y'; Value='z' }) } |
            Should -Throw
    }

    It 'throws when an edit hashtable is missing a required key' {
        { Save-JsonNodeFieldEdits -Path $script:path -Edits @(@{ NodeId='sit-001' }) } | Should -Throw
    }
}

Describe 'Save-JsonNodeFieldEdits — nested Path/Upsert dispatch (t/3438)' -Tag 'summary' {

    BeforeEach {
        $script:pfx = @'
{
  "nodes": [
    { "id": "acc-001", "graph_attributes": { "type": "belief" }, "label": "keep" },
    { "id": "acc-002", "label": "no ga" }
  ]
}
'@ -replace "`r`n", "`n"
        $script:ppath = Join-Path $TestDrive 'pov-fixture.json'
        [System.IO.File]::WriteAllText($script:ppath, $script:pfx, (New-Object System.Text.UTF8Encoding $false))
    }

    It 'dispatches Path/Upsert edits (nested insert + container-create) alongside a flat Field edit' {
        $edits = @(
            @{ NodeId = 'acc-001'; Path = @('graph_attributes', 'debate_grounding'); Value = 'We hold A.'; Upsert = $true }  # insert into existing ga
            @{ NodeId = 'acc-002'; Path = @('graph_attributes', 'debate_grounding'); Value = 'We hold B.'; Upsert = $true }  # create ga + leaf
            @{ NodeId = 'acc-001'; Field = 'label'; Value = 'changed' }                                                       # flat Field still works
        )
        $result = Save-JsonNodeFieldEdits -Path $script:ppath -Edits $edits
        $result.Applied | Should -Be 3
        $o = @((Get-Content -Raw $script:ppath | ConvertFrom-Json).nodes)
        $n1 = @($o | Where-Object { $_.id -eq 'acc-001' })[0]
        $n2 = @($o | Where-Object { $_.id -eq 'acc-002' })[0]
        $n1.graph_attributes.debate_grounding | Should -Be 'We hold A.'
        $n1.graph_attributes.type             | Should -Be 'belief'    # sibling preserved
        $n1.label                             | Should -Be 'changed'   # flat Field edit applied in the same batch
        $n2.graph_attributes.debate_grounding | Should -Be 'We hold B.'  # container created
    }

    It 'throws when an edit has BOTH Field and Path' {
        { Save-JsonNodeFieldEdits -Path $script:ppath -Edits @(@{ NodeId = 'acc-001'; Field = 'label'; Path = @('graph_attributes', 'x'); Value = 'y' }) } | Should -Throw
    }

    It 'throws when an edit has NEITHER Field nor Path' {
        { Save-JsonNodeFieldEdits -Path $script:ppath -Edits @(@{ NodeId = 'acc-001'; Value = 'y' }) } | Should -Throw
    }

    It 'accumulates across SEQUENTIAL same-file writes (read-fresh) — the checkpoint-flush durability guarantee (t/3457)' {
        # Incremental checkpoint writers (Invoke-DebateGroundingBatch t/3457) call Save-JsonNodeFieldEdits
        # once per batch on the SAME file with DISJOINT node subsets. Because each call re-reads the file
        # fresh, a later call must preserve the earlier call's landed edit rather than overwrite it — so a
        # mid-run kill after batch 1 leaves batch 1 durably on disk.
        $r1 = Save-JsonNodeFieldEdits -Path $script:ppath -Edits @(
            @{ NodeId = 'acc-001'; Path = @('graph_attributes', 'debate_grounding'); Value = 'batch-1 statement.'; Upsert = $true }
        )
        $r1.Applied | Should -Be 1
        # Second batch touches a DIFFERENT node in the same file — simulates the next checkpoint flush.
        $r2 = Save-JsonNodeFieldEdits -Path $script:ppath -Edits @(
            @{ NodeId = 'acc-002'; Path = @('graph_attributes', 'debate_grounding'); Value = 'batch-2 statement.'; Upsert = $true }
        )
        $r2.Applied | Should -Be 1

        $o  = @((Get-Content -Raw $script:ppath | ConvertFrom-Json).nodes)
        $n1 = @($o | Where-Object { $_.id -eq 'acc-001' })[0]
        $n2 = @($o | Where-Object { $_.id -eq 'acc-002' })[0]
        $n1.graph_attributes.debate_grounding | Should -Be 'batch-1 statement.'   # batch-1 survived batch-2's write
        $n2.graph_attributes.debate_grounding | Should -Be 'batch-2 statement.'
    }
}

Describe 'Save-JsonNodeFieldEdits — Remove dispatch (t/3460)' -Tag 'summary' {

    BeforeEach {
        $script:rfx = @'
{
  "nodes": [
    { "id": "acc-001", "graph_attributes": { "type": "belief", "synthetic_phrases": ["p0", "p1"] }, "label": "keep" },
    { "id": "acc-002", "note": "keep", "resolved_node_id": "sit-477" }
  ]
}
'@ -replace "`r`n", "`n"
        $script:rpath = Join-Path $TestDrive 'remove-fixture.json'
        [System.IO.File]::WriteAllText($script:rpath, $script:rfx, (New-Object System.Text.UTF8Encoding $false))
    }

    It 'dispatches a Remove edit — deletes graph_attributes.synthetic_phrases; siblings + other nodes preserved' {
        $result = Save-JsonNodeFieldEdits -Path $script:rpath -Edits @(
            @{ NodeId = 'acc-001'; Path = @('graph_attributes', 'synthetic_phrases'); Remove = $true }
        )
        $result.Applied | Should -Be 1
        $after = Get-Content -Raw $script:rpath
        $n1 = @(($after | ConvertFrom-Json).nodes | Where-Object { $_.id -eq 'acc-001' })[0]
        $n1.graph_attributes.PSObject.Properties['synthetic_phrases'] | Should -BeNullOrEmpty  # removed
        $n1.graph_attributes.type | Should -Be 'belief'                                        # sibling preserved
        $after | Should -BeLike '*"resolved_node_id": "sit-477"*'                              # other node byte-identical
    }

    It 'REFUSES a Remove edit carrying a Value (ambiguous intent) — throws, file untouched' {
        $before = Get-Content -Raw $script:rpath
        { Save-JsonNodeFieldEdits -Path $script:rpath -Edits @(@{ NodeId = 'acc-001'; Path = @('graph_attributes', 'synthetic_phrases'); Remove = $true; Value = 'x' }) } | Should -Throw
        (Get-Content -Raw $script:rpath) | Should -Be $before
    }

    It 'REFUSES a Remove edit combined with Field, and combined with Upsert' {
        { Save-JsonNodeFieldEdits -Path $script:rpath -Edits @(@{ NodeId = 'acc-001'; Field = 'label'; Remove = $true }) } | Should -Throw
        { Save-JsonNodeFieldEdits -Path $script:rpath -Edits @(@{ NodeId = 'acc-001'; Path = @('graph_attributes', 'synthetic_phrases'); Remove = $true; Upsert = $true }) } | Should -Throw
    }

    It 'REFUSES (strict) an absent-key Remove — throws, batch atomic, file untouched' {
        $before = Get-Content -Raw $script:rpath
        { Save-JsonNodeFieldEdits -Path $script:rpath -Edits @(@{ NodeId = 'acc-001'; Path = @('graph_attributes', 'not_there'); Remove = $true }) } | Should -Throw
        (Get-Content -Raw $script:rpath) | Should -Be $before
    }

    It 'FAULT-INJECTION: a corrupt splice never reaches disk — file byte-identical after the throw (the verify net at the sink)' {
        $before = Get-Content -Raw $script:rpath
        # Doctor the member locator so the splice deletes the wrong bytes; the re-parse-verify inside the
        # primitive must abort BEFORE Save's guarded write, leaving the file byte-identical.
        Mock Find-JsonMemberSpan { @{ KeyStart = 5; ValueEnd = 80 } } -ModuleName AITriad
        { Save-JsonNodeFieldEdits -Path $script:rpath -Edits @(@{ NodeId = 'acc-001'; Path = @('graph_attributes', 'synthetic_phrases'); Remove = $true }) } | Should -Throw
        (Get-Content -Raw $script:rpath) | Should -Be $before
    }
}
