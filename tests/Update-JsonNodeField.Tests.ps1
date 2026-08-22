# Tag: summary (t/2916)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Adversarial anti-sweep suite for the field-surgical writer Update-JsonNodeField
    (t/2916, TL ruling t/2916#3). Written FIRST (TDD). The helper must:
      - parse-LOCATE the target node + field (not naive string-search),
      - minimal-SPLICE only that field's value (or insert an absent key at a
        parse-located point),
      - re-parse-VERIFY: the deep-diff vs the intended change must be EXACTLY the one
        field, else throw New-ActionableError and return nothing (write nothing).
    The written text must be byte-preserving everywhere except the target field, so
    concurrent WIP elsewhere in the file cannot ride into the write (the sit-477 sweep).
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    # A situations-like fixture. Deliberately adversarial:
    #  - sit-001 has both "type" and "disagreement_type" (substring collision) AND a
    #    "note" whose TEXT contains the literal string "disagreement_type".
    #  - sit-002 LACKS disagreement_type (absent-key insert case).
    #  - sit-003 carries unrelated concurrent WIP (resolved_node_id: sit-477, ratio: 3.0)
    #    AND the SAME field+value ("disagreement_type": "empirical") as sit-001 — proving
    #    the locate is node-scoped, not a global value replace.
    $script:Fixture = @'
{
  "nodes": [
    { "id": "sit-001", "type": "situation", "disagreement_type": "empirical", "note": "mentions disagreement_type in prose" },
    { "id": "sit-002", "label": "no dtype yet" },
    { "id": "sit-003", "disagreement_type": "empirical", "resolved_node_id": "sit-477", "ratio": 3.0 }
  ]
}
'@ -replace "`r`n", "`n"
}

Describe 'Update-JsonNodeField — adversarial anti-sweep (t/2916)' -Tag 'summary' {

    It '1. basic value replace: only the target node/field changes' {
        InModuleScope AITriad -Parameters @{ Raw = $script:Fixture } {
            param($Raw)
            $out = Update-JsonNodeField -RawText $Raw -NodeId 'sit-001' -Field 'disagreement_type' -Value 'normative'
            $o = $out | ConvertFrom-Json
            (@($o.nodes) | Where-Object { $_.id -eq 'sit-001' }).disagreement_type | Should -Be 'normative'
            (@($o.nodes) | Where-Object { $_.id -eq 'sit-003' }).disagreement_type | Should -Be 'empirical'  # untouched
        }
    }

    It '2. field-name-substring collision: "type" vs "disagreement_type" + prose mention are not confused' {
        InModuleScope AITriad -Parameters @{ Raw = $script:Fixture } {
            param($Raw)
            $out = Update-JsonNodeField -RawText $Raw -NodeId 'sit-001' -Field 'type' -Value 'crux'
            $o = @($out | ConvertFrom-Json | Select-Object -ExpandProperty nodes | Where-Object { $_.id -eq 'sit-001' })[0]
            $o.type              | Should -Be 'crux'
            $o.disagreement_type | Should -Be 'empirical'                    # collider untouched
            $o.note              | Should -Be 'mentions disagreement_type in prose'  # prose untouched
        }
    }

    It '3. absent-key insert (parse-located): adds the field, stays valid JSON' {
        InModuleScope AITriad -Parameters @{ Raw = $script:Fixture } {
            param($Raw)
            $out = Update-JsonNodeField -RawText $Raw -NodeId 'sit-002' -Field 'disagreement_type' -Value 'insufficient'
            $o = @($out | ConvertFrom-Json | Select-Object -ExpandProperty nodes | Where-Object { $_.id -eq 'sit-002' })[0]
            $o.disagreement_type | Should -Be 'insufficient'
            $o.label             | Should -Be 'no dtype yet'   # existing field preserved
        }
    }

    It '4. escaping: quotes / backslash / newline round-trip exactly' {
        InModuleScope AITriad -Parameters @{ Raw = $script:Fixture } {
            param($Raw)
            $tricky = 'He said "hi"' + "`n" + 'C:\path\to'
            $out = Update-JsonNodeField -RawText $Raw -NodeId 'sit-001' -Field 'disagreement_type' -Value $tricky
            (@($out | ConvertFrom-Json | Select-Object -ExpandProperty nodes | Where-Object { $_.id -eq 'sit-001' })[0]).disagreement_type | Should -Be $tricky
        }
    }

    It '5. anti-sweep: concurrent foreign WIP survives BYTE-IDENTICAL' {
        InModuleScope AITriad -Parameters @{ Raw = $script:Fixture } {
            param($Raw)
            $out = Update-JsonNodeField -RawText $Raw -NodeId 'sit-001' -Field 'disagreement_type' -Value 'normative'
            # sit-003's foreign WIP (the sit-477 add + the 3.0 float) must be untouched, byte-for-byte.
            $out | Should -BeLike '*"resolved_node_id": "sit-477"*'
            $out | Should -BeLike '*"ratio": 3.0*'   # NOT churned to 3
            # And ONLY the sit-001 disagreement_type line differs from the original.
            $origLines = @($Raw    -split "`n")
            $newLines  = @($out    -split "`n")
            $newLines.Count | Should -Be $origLines.Count
            $diff = for ($i = 0; $i -lt $origLines.Count; $i++) { if ($origLines[$i] -ne $newLines[$i]) { $i } }
            @($diff).Count | Should -Be 1   # exactly one changed line
        }
    }

    It '6. safety: unknown node id throws New-ActionableError and returns nothing' {
        InModuleScope AITriad -Parameters @{ Raw = $script:Fixture } {
            param($Raw)
            { Update-JsonNodeField -RawText $Raw -NodeId 'sit-999' -Field 'disagreement_type' -Value 'x' } |
                Should -Throw
        }
    }
}
