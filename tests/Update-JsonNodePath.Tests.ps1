# Tag: summary (t/2921)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Adversarial suite for the nested-path surgical writer Update-JsonNodePath (t/2921, TL
    ruling t/2921#2). Written FIRST (TDD). Segment-array addressing (key=string, index=int),
    in-place scalar replacement only, re-parse-verify backstop. The written text must be
    byte-preserving everywhere except the target value, so concurrent WIP elsewhere cannot
    ride into the write (the sit-477 sweep).

    Each node is on its OWN line so a nested edit changes exactly that node's line — the
    byte-preservation / line-diff assertions depend on that layout.
#>

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue

    $script:Fixture = @'
{
  "nodes": [
    { "id": "acc-001", "graph_attributes": { "assumes": ["a0", "a1"], "policy_actions": [ { "action": "act0", "framing": "frame0" }, { "action": "act1", "framing": "frame1" } ], "type": "belief", "disagreement_type": "empirical" }, "interpretations": { "accelerationist": { "summary": "sumA" } } },
    { "id": "acc-002", "note": "keep", "resolved_node_id": "sit-477", "ratio": 3.0 },
    { "id": "acc-003", "interpretations": { "skeptic": { "summary": "sumS" } } }
  ]
}
'@ -replace "`r`n", "`n"
}

Describe 'Update-JsonNodePath — nested surgical replacement (t/2921)' -Tag 'summary' {

    It '1. nested object field replace (interpretations.accelerationist.summary)' {
        InModuleScope AITriad -Parameters @{ Raw = $script:Fixture } {
            param($Raw)
            $out = Update-JsonNodePath -RawText $Raw -NodeId 'acc-001' -Path @('interpretations','accelerationist','summary') -Value 'NEWSUM'
            $o = @($out | ConvertFrom-Json | Select-Object -ExpandProperty nodes | Where-Object { $_.id -eq 'acc-001' })[0]
            $o.interpretations.accelerationist.summary | Should -Be 'NEWSUM'
        }
    }

    It '2. string-array element replace (graph_attributes.assumes[1])' {
        InModuleScope AITriad -Parameters @{ Raw = $script:Fixture } {
            param($Raw)
            $out = Update-JsonNodePath -RawText $Raw -NodeId 'acc-001' -Path @('graph_attributes','assumes',1) -Value 'A1X'
            $ga = (@($out | ConvertFrom-Json | Select-Object -ExpandProperty nodes | Where-Object { $_.id -eq 'acc-001' })[0]).graph_attributes
            $ga.assumes[1] | Should -Be 'A1X'
            $ga.assumes[0] | Should -Be 'a0'   # sibling element untouched
        }
    }

    It '3. array-element object field replace (graph_attributes.policy_actions[1].framing)' {
        InModuleScope AITriad -Parameters @{ Raw = $script:Fixture } {
            param($Raw)
            $out = Update-JsonNodePath -RawText $Raw -NodeId 'acc-001' -Path @('graph_attributes','policy_actions',1,'framing') -Value 'FRAME1X'
            $pa = (@($out | ConvertFrom-Json | Select-Object -ExpandProperty nodes | Where-Object { $_.id -eq 'acc-001' })[0]).graph_attributes.policy_actions
            $pa[1].framing | Should -Be 'FRAME1X'
            $pa[1].action  | Should -Be 'act1'   # sibling field untouched
            $pa[0].framing | Should -Be 'frame0'  # sibling element untouched
        }
    }

    It '4. nested field-name collision: replacing ga.type does not touch ga.disagreement_type' {
        InModuleScope AITriad -Parameters @{ Raw = $script:Fixture } {
            param($Raw)
            $out = Update-JsonNodePath -RawText $Raw -NodeId 'acc-001' -Path @('graph_attributes','type') -Value 'desire'
            $ga = (@($out | ConvertFrom-Json | Select-Object -ExpandProperty nodes | Where-Object { $_.id -eq 'acc-001' })[0]).graph_attributes
            $ga.type              | Should -Be 'desire'
            $ga.disagreement_type | Should -Be 'empirical'   # substring-collider untouched
        }
    }

    It '5. escaping: quotes / backslash / newline round-trip exactly at a nested path' {
        InModuleScope AITriad -Parameters @{ Raw = $script:Fixture } {
            param($Raw)
            $tricky = 'He said "hi"' + "`n" + 'C:\path\to'
            $out = Update-JsonNodePath -RawText $Raw -NodeId 'acc-001' -Path @('interpretations','accelerationist','summary') -Value $tricky
            (@($out | ConvertFrom-Json | Select-Object -ExpandProperty nodes | Where-Object { $_.id -eq 'acc-001' })[0]).interpretations.accelerationist.summary | Should -Be $tricky
        }
    }

    It '6. anti-sweep: a nested edit leaves foreign WIP on another node byte-identical' {
        InModuleScope AITriad -Parameters @{ Raw = $script:Fixture } {
            param($Raw)
            $out = Update-JsonNodePath -RawText $Raw -NodeId 'acc-001' -Path @('interpretations','accelerationist','summary') -Value 'NEWSUM'
            $out | Should -BeLike '*"resolved_node_id": "sit-477"*'
            $out | Should -BeLike '*"ratio": 3.0*'   # NOT churned to 3
            $origLines = @($Raw -split "`n")
            $newLines  = @($out -split "`n")
            $newLines.Count | Should -Be $origLines.Count
            $diff = for ($i = 0; $i -lt $origLines.Count; $i++) { if ($origLines[$i] -ne $newLines[$i]) { $i } }
            @($diff).Count | Should -Be 1   # only the acc-001 line changed
        }
    }

    It '7. multi-node sequential composition: chained nested edits land AND foreign WIP survives' {
        InModuleScope AITriad -Parameters @{ Raw = $script:Fixture } {
            param($Raw)
            $out1 = Update-JsonNodePath -RawText $Raw  -NodeId 'acc-001' -Path @('interpretations','accelerationist','summary') -Value 'S1'
            $out2 = Update-JsonNodePath -RawText $out1 -NodeId 'acc-003' -Path @('interpretations','skeptic','summary')       -Value 'S3'
            $nodes = @($out2 | ConvertFrom-Json | Select-Object -ExpandProperty nodes)
            (@($nodes | Where-Object { $_.id -eq 'acc-001' })[0]).interpretations.accelerationist.summary | Should -Be 'S1'
            (@($nodes | Where-Object { $_.id -eq 'acc-003' })[0]).interpretations.skeptic.summary          | Should -Be 'S3'
            $out2 | Should -BeLike '*"resolved_node_id": "sit-477"*'
            $out2 | Should -BeLike '*"ratio": 3.0*'
            $origLines = @($Raw  -split "`n"); $newLines = @($out2 -split "`n")
            $diff = for ($i = 0; $i -lt $origLines.Count; $i++) { if ($origLines[$i] -ne $newLines[$i]) { $i } }
            @($diff).Count | Should -Be 2   # exactly the two edited node lines
        }
    }

    It '8. path-not-found (bad key and out-of-range index) throws and writes nothing' {
        InModuleScope AITriad -Parameters @{ Raw = $script:Fixture } {
            param($Raw)
            { Update-JsonNodePath -RawText $Raw -NodeId 'acc-001' -Path @('graph_attributes','nonexistent') -Value 'x' } | Should -Throw
            { Update-JsonNodePath -RawText $Raw -NodeId 'acc-001' -Path @('graph_attributes','assumes',9) -Value 'x' }   | Should -Throw
            { Update-JsonNodePath -RawText $Raw -NodeId 'acc-999' -Path @('graph_attributes','type') -Value 'x' }        | Should -Throw
        }
    }

    It '9. wrong-type-at-path: object/array target and mid-path type mismatch safe-throw' {
        InModuleScope AITriad -Parameters @{ Raw = $script:Fixture } {
            param($Raw)
            # target is an object (graph_attributes) — scalar-only replacement refuses
            { Update-JsonNodePath -RawText $Raw -NodeId 'acc-001' -Path @('graph_attributes') -Value 'scalar' } | Should -Throw
            # mid-path descends into a scalar with a further key segment
            { Update-JsonNodePath -RawText $Raw -NodeId 'acc-001' -Path @('graph_attributes','type','x') -Value 'y' } | Should -Throw
            # index segment against an object container
            { Update-JsonNodePath -RawText $Raw -NodeId 'acc-001' -Path @('graph_attributes',0) -Value 'y' } | Should -Throw
        }
    }
}
