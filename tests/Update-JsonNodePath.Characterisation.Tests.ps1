# Tag: summary (t/3878)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Characterisation suite for Update-JsonNodePath (t/3878), pinning behavior
    byte-for-byte against the CURRENT implementation (complexity 78) before any
    structural decomposition begins, per TL ruling (t/3874#2/p/360#496).
.DESCRIPTION
    Existing coverage (tests/Update-JsonNodePath.Tests.ps1, 26 tests) is a
    starting point, not an exhaustive baseline. This file fills the gaps: every
    mode's -DeferVerify arm (untested anywhere before this), every top-level
    guard (missing Value, invalid JSON input, no nodes[] array, -Upsert scalar-
    only leaf), multi-level -Upsert container creation (2+ missing segments),
    the -Remove navigation-phase (separate from the main-loop navigation) wrong-
    type and out-of-range arms, and fault-injection for REPLACE's and -Upsert's
    own re-parse-verify nets (only -Remove's had one before this).

    Decomposition must keep every test in BOTH this file and the original green,
    byte-identical, after each extraction.
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

Describe '-DeferVerify: every mode skips the re-parse-verify step entirely (t/3878)' -Tag 'summary' {

    It 'REPLACE: -DeferVerify returns the patched text even when the verify helper would have failed' {
        InModuleScope AITriad -Parameters @{ Raw = $script:Fixture } {
            param($Raw)
            Mock Test-JsonSemanticEqual { $false }   # would fail a non-deferred call
            $out = Update-JsonNodePath -RawText $Raw -NodeId 'acc-001' -Path @('graph_attributes','type') -Value 'desire' -DeferVerify
            $out | Should -Not -BeNullOrEmpty
            (@($out | ConvertFrom-Json).nodes | Where-Object { $_.id -eq 'acc-001' })[0].graph_attributes.type | Should -Be 'desire'
            Should -Invoke Test-JsonSemanticEqual -Times 0   # verify never ran
        }
    }

    It '-Upsert: -DeferVerify returns the patched text even when the verify helper would have failed' {
        InModuleScope AITriad -Parameters @{ Raw = $script:Fixture } {
            param($Raw)
            Mock Test-JsonSemanticEqual { $false }
            $out = Update-JsonNodePath -RawText $Raw -NodeId 'acc-003' -Path @('graph_attributes','debate_grounding') -Value 'Y' -Upsert -DeferVerify
            (@($out | ConvertFrom-Json).nodes | Where-Object { $_.id -eq 'acc-003' })[0].graph_attributes.debate_grounding | Should -Be 'Y'
            Should -Invoke Test-JsonSemanticEqual -Times 0
        }
    }

    It '-Remove: -DeferVerify returns the patched text even when the verify helper would have failed' {
        InModuleScope AITriad -Parameters @{ Raw = $script:Fixture } {
            param($Raw)
            Mock Test-JsonSemanticEqual { $false }
            $out = Update-JsonNodePath -RawText $Raw -NodeId 'acc-001' -Path @('graph_attributes','type') -Remove -DeferVerify
            $ga = (@($out | ConvertFrom-Json).nodes | Where-Object { $_.id -eq 'acc-001' })[0].graph_attributes
            $ga.PSObject.Properties['type'] | Should -BeNullOrEmpty
            Should -Invoke Test-JsonSemanticEqual -Times 0
        }
    }

    It '-DeferVerify also skips the input-side parse/node-lookup guard (caller is trusted to have already validated)' {
        InModuleScope AITriad -Parameters @{ Raw = $script:Fixture } {
            param($Raw)
            # acc-999 does not exist; a non-deferred call would throw at the node-lookup guard.
            # With -DeferVerify the pre-parse step is skipped entirely, so the call proceeds to
            # the raw-text locate (Find-JsonIdTokenIndex), which ALSO fails for a missing id --
            # pinning that -DeferVerify does not create a blind-write path, it only removes the
            # redundant ConvertFrom-Json + node-lookup pre-check.
            { Update-JsonNodePath -RawText $Raw -NodeId 'acc-999' -Path @('graph_attributes','type') -Value 'x' -DeferVerify } | Should -Throw -ExpectedMessage '*id token for*not found*'
        }
    }
}

Describe 'Top-level guards (t/3878)' -Tag 'summary' {

    It 'throws when Value is omitted under replace (not -Remove)' {
        InModuleScope AITriad -Parameters @{ Raw = $script:Fixture } {
            param($Raw)
            { Update-JsonNodePath -RawText $Raw -NodeId 'acc-001' -Path @('graph_attributes','type') } | Should -Throw -ExpectedMessage '*Value is required*'
        }
    }

    It 'throws on an empty Path array -- at PARAMETER BINDING, before the function body''s own "Path is empty" guard ever runs (Mandatory rejects an empty array; that guard at line 124 is unreachable via normal invocation)' {
        InModuleScope AITriad -Parameters @{ Raw = $script:Fixture } {
            param($Raw)
            { Update-JsonNodePath -RawText $Raw -NodeId 'acc-001' -Path @() -Value 'x' } | Should -Throw -ExpectedMessage '*Cannot bind argument to parameter ''Path''*'
        }
    }

    It 'throws on malformed input JSON (not -DeferVerify)' {
        InModuleScope AITriad {
            { Update-JsonNodePath -RawText '{ not json' -NodeId 'acc-001' -Path @('x') -Value 'y' } | Should -Throw -ExpectedMessage '*not valid JSON*'
        }
    }

    It 'throws when the JSON has no top-level nodes[] array' {
        InModuleScope AITriad {
            { Update-JsonNodePath -RawText '{ "other": [] }' -NodeId 'acc-001' -Path @('x') -Value 'y' } | Should -Throw -ExpectedMessage '*No nodes*array*'
        }
    }

    It '-Upsert REFUSES an object-valued leaf (scalar-only, even under insert)' {
        InModuleScope AITriad -Parameters @{ Raw = $script:Fixture } {
            param($Raw)
            { Update-JsonNodePath -RawText $Raw -NodeId 'acc-003' -Path @('graph_attributes','nested') -Value @{ a = 1 } -Upsert } | Should -Throw -ExpectedMessage '*must be a scalar*'
        }
    }

    It '-Upsert REFUSES an array-valued leaf without -ArrayValue (scalar-only by default, even under insert; t/3969 widened this to an opt-in, not a removal)' {
        InModuleScope AITriad -Parameters @{ Raw = $script:Fixture } {
            param($Raw)
            { Update-JsonNodePath -RawText $Raw -NodeId 'acc-003' -Path @('graph_attributes','nested') -Value @(1, 2) -Upsert } | Should -Throw -ExpectedMessage '*-ArrayValue*'
        }
    }

    It '-Upsert allows an explicit $null leaf value (null is a valid scalar)' {
        InModuleScope AITriad -Parameters @{ Raw = $script:Fixture } {
            param($Raw)
            $out = Update-JsonNodePath -RawText $Raw -NodeId 'acc-003' -Path @('graph_attributes','maybe') -Value $null -Upsert
            $n = (@($out | ConvertFrom-Json).nodes | Where-Object { $_.id -eq 'acc-003' })[0]
            $n.graph_attributes.PSObject.Properties['maybe'].Value | Should -BeNullOrEmpty
        }
    }
}

Describe '-Upsert: multi-level container creation (t/3878, 2+ missing segments)' -Tag 'summary' {

    It 'creates TWO nested missing object containers + the leaf in one call; node siblings preserved' {
        InModuleScope AITriad -Parameters @{ Raw = $script:Fixture } {
            param($Raw)
            # acc-003 has neither 'extra' nor 'extra.inner'.
            $out = Update-JsonNodePath -RawText $Raw -NodeId 'acc-003' -Path @('extra','inner','leaf') -Value 'deep' -Upsert
            $n = (@($out | ConvertFrom-Json).nodes | Where-Object { $_.id -eq 'acc-003' })[0]
            $n.extra.inner.leaf                | Should -Be 'deep'
            $n.interpretations.skeptic.summary | Should -Be 'sumS'   # sibling preserved
        }
    }

    It 'creates a missing container nested below an EXISTING container, preserving the existing container''s other keys' {
        InModuleScope AITriad -Parameters @{ Raw = $script:Fixture } {
            param($Raw)
            # acc-001.graph_attributes EXISTS; 'extra' under it does not.
            $out = Update-JsonNodePath -RawText $Raw -NodeId 'acc-001' -Path @('graph_attributes','extra','inner') -Value 'val' -Upsert
            $ga = (@($out | ConvertFrom-Json).nodes | Where-Object { $_.id -eq 'acc-001' })[0].graph_attributes
            $ga.extra.inner       | Should -Be 'val'
            $ga.type              | Should -Be 'belief'      # pre-existing sibling preserved
            @($ga.assumes).Count  | Should -Be 2
        }
    }
}

Describe '-Remove: navigation-phase guards separate from the main replace/-Upsert loop (t/3878)' -Tag 'summary' {

    It 'REFUSES when an intermediate segment expects an array but finds an object' {
        InModuleScope AITriad -Parameters @{ Raw = $script:Fixture } {
            param($Raw)
            # graph_attributes is an object; path treats it as an array via an int segment.
            { Update-JsonNodePath -RawText $Raw -NodeId 'acc-001' -Path @('graph_attributes', 0, 'x') -Remove } | Should -Throw -ExpectedMessage '*expects an array*'
        }
    }

    It 'REFUSES when an intermediate segment expects an object but finds an array' {
        InModuleScope AITriad -Parameters @{ Raw = $script:Fixture } {
            param($Raw)
            # graph_attributes.assumes is an array; path treats it as an object via a key segment.
            { Update-JsonNodePath -RawText $Raw -NodeId 'acc-001' -Path @('graph_attributes','assumes','x','y') -Remove } | Should -Throw -ExpectedMessage '*expects an object*'
        }
    }

    It 'REFUSES an out-of-range intermediate array index (path-not-found during -Remove navigation)' {
        InModuleScope AITriad -Parameters @{ Raw = $script:Fixture } {
            param($Raw)
            { Update-JsonNodePath -RawText $Raw -NodeId 'acc-001' -Path @('graph_attributes','assumes', 9, 'x') -Remove } | Should -Throw -ExpectedMessage '*out of range*'
        }
    }

    It 'removes a key reached by navigating THROUGH an intermediate array index' {
        InModuleScope AITriad -Parameters @{ Raw = $script:Fixture } {
            param($Raw)
            # graph_attributes.policy_actions[0].action -- navigates an object, then an array index, then removes a key.
            $out = Update-JsonNodePath -RawText $Raw -NodeId 'acc-001' -Path @('graph_attributes','policy_actions', 0, 'action') -Remove
            $pa = (@($out | ConvertFrom-Json).nodes | Where-Object { $_.id -eq 'acc-001' })[0].graph_attributes.policy_actions
            $pa[0].PSObject.Properties['action'] | Should -BeNullOrEmpty
            $pa[0].framing | Should -Be 'frame0'    # sibling field on the SAME array element preserved
            $pa[1].action  | Should -Be 'act1'      # sibling array element fully preserved
        }
    }
}

Describe 'Fault-injection: REPLACE''s and -Upsert''s own re-parse-verify nets (t/3878, -Remove''s had one before this)' -Tag 'summary' {

    It 'REPLACE: re-parse-verify reporting a mismatch is caught -- throws, no corrupt output returned' {
        InModuleScope AITriad -Parameters @{ Raw = $script:Fixture } {
            param($Raw)
            # Get-JsonValueSpan is reused for KEY-token scanning too (Find-JsonMemberAt), so
            # corrupting it breaks member lookup itself rather than isolating the final splice --
            # it can't be used to inject a "wrong splice, otherwise-valid navigation" fault.
            # Mocking the verify comparator directly exercises the net's response to a mismatch
            # regardless of how one could arise, matching the -DeferVerify tests' approach above.
            Mock Test-JsonSemanticEqual { $false }
            { Update-JsonNodePath -RawText $Raw -NodeId 'acc-001' -Path @('graph_attributes','type') -Value 'desire' } | Should -Throw -ExpectedMessage '*re-parse-verify FAILED*'
            Should -Invoke Test-JsonSemanticEqual -Times 1 -Exactly
        }
    }

    It '-Upsert: a corrupted insert splice is caught by re-parse-verify -- throws, no corrupt output' {
        InModuleScope AITriad -Parameters @{ Raw = $script:Fixture } {
            param($Raw)
            # Force the member-value-start locator to report a hit (at a bogus offset) for the
            # FIRST segment ('graph_attributes'), which is actually absent on acc-003 -- Update-
            # JsonNodePath then takes the normal-descend path instead of the -Upsert insert path,
            # and ends up splicing/parsing from a nonsensical location. A different, but still
            # safety-net, failure mode than the "changed more than intended" FAILED message.
            Mock Find-JsonMemberValueStart { 5 }
            { Update-JsonNodePath -RawText $Raw -NodeId 'acc-003' -Path @('graph_attributes','debate_grounding') -Value 'Y' -Upsert } | Should -Throw
        }
    }
}

Describe 'ConvertTo-JsonPathDisplay (t/3878, direct characterisation of the error-display helper)' -Tag 'summary' {

    It 'renders a mixed key/index path with dot-before-key and bracket-for-index' {
        InModuleScope AITriad {
            ConvertTo-JsonPathDisplay -Path @('graph_attributes','policy_actions', 2, 'framing') | Should -Be 'graph_attributes.policy_actions[2].framing'
        }
    }

    It 'renders a path that starts with an array index with no leading dot' {
        InModuleScope AITriad {
            ConvertTo-JsonPathDisplay -Path @(0, 'key') | Should -Be '[0].key'
        }
    }

    It 'renders a single-segment key path with no dots' {
        InModuleScope AITriad {
            ConvertTo-JsonPathDisplay -Path @('type') | Should -Be 'type'
        }
    }
}
