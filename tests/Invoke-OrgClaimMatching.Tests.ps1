# Tag: taxonomy (t/1553 Stages 2+3)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Covers Invoke-OrgClaimMatching — Stages 2+3 of t/1553.
.DESCRIPTION
    Focus: the family-independence rule (t/1553#12), the two-part gate
    (multi-agreement OR high-cosine), polarity→edge-type mapping,
    per-org cap accounting, negation-slice reporting (t/1553#18), and
    the existing-edge skip. The python subprocess for batch-encode is
    stubbed via a function shadow that echoes canned unit vectors keyed
    to the claim's index — the test controls cosine outcomes by choosing
    which unit vector each claim gets versus which unit vector each node
    gets. Live embed_taxonomy.py path was smoke-verified against the
    real corpus (81 claims → 29 dry-run proposals) before this suite
    landed.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    # Two orthogonal 384-d unit vectors — dot product = 1 (identical) or 0
    # (orthogonal). Ensures we can drive cosine deterministically.
    $script:dim = 384
    $script:vecA = @(0) * $script:dim; $script:vecA[0] = 1.0
    $script:vecB = @(0) * $script:dim; $script:vecB[1] = 1.0
    # Diagonal mid-vector — dot with vecA is 0.7071 (below 0.60 gate? no,
    # above), dot with a rotated-close vector we craft below.
    $script:vecC = @(0) * $script:dim; $script:vecC[0] = 0.5; $script:vecC[1] = 0.5
    $script:vecCn = @($script:vecC | ForEach-Object { $_ / [math]::Sqrt(0.5) })  # unit-norm
}

Describe 'Invoke-OrgClaimMatching (t/1553 Stages 2+3)' -Tag 'taxonomy' {

    BeforeEach {
        $script:workDir = Join-Path ([System.IO.Path]::GetTempPath()) "orgmatch-t1553-$(Get-Random)"
        $null = New-Item -ItemType Directory -Path $script:workDir -Force
        $script:claimsPath     = Join-Path $script:workDir 'claims.json'
        $script:embeddingsPath = Join-Path $script:workDir 'embeddings.json'

        # Synthetic embeddings for nodes: node-1 gets vecA, node-2 gets vecB,
        # node-3 gets vecC-normalized. Everything else in the file is
        # non-pov-taxonomy junk to prove the id-filter works.
        $embStore = [ordered]@{
            metadata = @{ dim = $script:dim; note = 'test-fixture' }
            nodes = [ordered]@{
                'acc-beliefs-001'    = @{ pov = 'acc'; vector = $script:vecA }
                'saf-desires-002'    = @{ pov = 'saf'; vector = $script:vecB }
                # No node at VecCn — the family tests feed VecCn as the claim
                # so cosine with any node caps at 1/sqrt(2)=0.7071 (below the
                # 0.75 test threshold), letting us isolate the multi-agreement
                # gate from the high-cosine gate.
                'skp-intentions-003' = @{ pov = 'skp'; vector = $script:vecA }
                'pol-999'            = @{ vector = $script:vecA }   # ignored: not a POV node id
                'sit-100'            = @{ vector = $script:vecA }   # ignored: not a POV node id
            }
        }
        $embStore | ConvertTo-Json -Depth 6 | Set-Content -Path $script:embeddingsPath -Encoding utf8NoBOM
    }

    AfterEach {
        if ($script:workDir -and (Test-Path $script:workDir)) {
            Remove-Item -Recurse -Force $script:workDir -ErrorAction SilentlyContinue
        }
    }

    Context 'Family-independence rule (t/1553#12)' {

        It 'Two variants of the same doc (rmf-1.0-2024 vs rmf-1.0-2024-1) collapse to ONE family — sub-threshold cosine, so no proposal without multi-agreement' {
            InModuleScope AITriad -Parameters @{
                ClaimsPath = $script:claimsPath
                EmbPath    = $script:embeddingsPath
                VecA       = [double[]]$script:vecA
                VecC       = [double[]]$script:vecCn
            } {
                param($ClaimsPath, $EmbPath, $VecA, $VecC)

                # Two claims from the same doc family, both point at acc-beliefs-001,
                # both sub-threshold cosine (0.7071 < the 0.75 test threshold).
                $claims = @(
                    [PSCustomObject]@{
                        org_id = 'org-014'; source_id = 'rmf-1.0-2024'
                        polarity = 'asserts'; canonical_proposition = 'p0'
                        extraction_confidence = 0.9
                    }
                    [PSCustomObject]@{
                        org_id = 'org-014'; source_id = 'rmf-1.0-2024-1'
                        polarity = 'asserts'; canonical_proposition = 'p1'
                        extraction_confidence = 0.9
                    }
                )
                @{ claims = $claims } | ConvertTo-Json -Depth 5 | Set-Content -Path $ClaimsPath -Encoding utf8NoBOM

                # Shadow python + Get-OrganizationEdgesStore.
                $vecCref = $VecC
                function python {
                    process {
                        $payload = $input | Out-String | ConvertFrom-Json
                        $out = [ordered]@{}
                        foreach ($item in $payload) { $out[$item.id] = $vecCref }
                        $out | ConvertTo-Json -Depth 5 -Compress
                    }
                }
                Mock Get-OrganizationEdgesStore { [PSCustomObject]@{ edges = @() } }

                $r = Invoke-OrgClaimMatching -ClaimsPath $ClaimsPath -EmbeddingsPath $EmbPath `
                    -MatchThreshold 0.75 -MinAgreement 2 -Verbose:$false 6>$null

                $r.ClaimsProcessed    | Should -Be 2
                $r.ProposalsWouldEmit | Should -Be 0 -Because 'both claims collapse to family "rmf-1.0" — only 1 independent family, so multi-agreement fails; and cosine 0.7071 < threshold 0.75'
            }
        }

        It 'Two DIFFERENT doc families with matching (node, polarity) DO propose under multi-agreement, even sub-threshold' {
            InModuleScope AITriad -Parameters @{
                ClaimsPath = $script:claimsPath
                EmbPath    = $script:embeddingsPath
                VecC       = [double[]]$script:vecCn
            } {
                param($ClaimsPath, $EmbPath, $VecC)

                $claims = @(
                    [PSCustomObject]@{
                        org_id = 'org-014'; source_id = 'rmf-1.0-2024'
                        polarity = 'asserts'; canonical_proposition = 'p0'; extraction_confidence = 0.9
                    }
                    [PSCustomObject]@{
                        org_id = 'org-014'; source_id = 'ai-usages-2023'
                        polarity = 'asserts'; canonical_proposition = 'p1'; extraction_confidence = 0.9
                    }
                )
                @{ claims = $claims } | ConvertTo-Json -Depth 5 | Set-Content -Path $ClaimsPath -Encoding utf8NoBOM

                $vecCref = $VecC
                function python {
                    process {
                        $payload = $input | Out-String | ConvertFrom-Json
                        $out = [ordered]@{}
                        foreach ($item in $payload) { $out[$item.id] = $vecCref }
                        $out | ConvertTo-Json -Depth 5 -Compress
                    }
                }
                Mock Get-OrganizationEdgesStore { [PSCustomObject]@{ edges = @() } }

                $r = Invoke-OrgClaimMatching -ClaimsPath $ClaimsPath -EmbeddingsPath $EmbPath `
                    -MatchThreshold 0.75 -MinAgreement 2 -Verbose:$false 6>$null

                $r.ProposalsWouldEmit           | Should -Be 1
                $r.Proposals[0].Reason          | Should -Be 'multi-claim-agreement'
                $r.Proposals[0].Independent     | Should -Be 2 -Because 'rmf-1.0 and ai-usages are distinct families'
                $r.Proposals[0].EdgeType        | Should -Be 'ADVOCATES_FOR'
            }
        }
    }

    Context 'Gate rule: single-claim high-cosine floor' {

        It 'One claim above -MatchThreshold produces one proposal — high-cosine rule' {
            InModuleScope AITriad -Parameters @{
                ClaimsPath = $script:claimsPath
                EmbPath    = $script:embeddingsPath
                VecA       = [double[]]$script:vecA
            } {
                param($ClaimsPath, $EmbPath, $VecA)

                $claims = @(
                    [PSCustomObject]@{
                        org_id = 'org-002'; source_id = 'src-x'
                        polarity = 'opposes'; canonical_proposition = 'p0'; extraction_confidence = 0.8
                    }
                )
                @{ claims = $claims } | ConvertTo-Json -Depth 5 | Set-Content -Path $ClaimsPath -Encoding utf8NoBOM

                $vecAref = $VecA
                function python {
                    process {
                        $payload = $input | Out-String | ConvertFrom-Json
                        $out = [ordered]@{}
                        foreach ($item in $payload) { $out[$item.id] = $vecAref }
                        $out | ConvertTo-Json -Depth 5 -Compress
                    }
                }
                Mock Get-OrganizationEdgesStore { [PSCustomObject]@{ edges = @() } }

                $r = Invoke-OrgClaimMatching -ClaimsPath $ClaimsPath -EmbeddingsPath $EmbPath `
                    -MatchThreshold 0.60 -Verbose:$false 6>$null

                $r.ProposalsWouldEmit    | Should -Be 1
                $r.Proposals[0].Reason   | Should -Match 'high-cosine'
                $r.Proposals[0].EdgeType | Should -Be 'OPPOSES' -Because 'polarity=opposes → OPPOSES'
                $r.Proposals[0].NodeId   | Should -Be 'acc-beliefs-001' -Because 'vecA lives at acc-beliefs-001'
                $r.Proposals[0].BestCosine | Should -BeGreaterOrEqual 0.99
            }
        }
    }

    Context 'Existing-edge skip' {

        It 'Skips (org, node, type) tuples that already exist in any status unless -Force' {
            InModuleScope AITriad -Parameters @{
                ClaimsPath = $script:claimsPath
                EmbPath    = $script:embeddingsPath
                VecA       = [double[]]$script:vecA
            } {
                param($ClaimsPath, $EmbPath, $VecA)

                $claims = @(
                    [PSCustomObject]@{
                        org_id = 'org-014'; source_id = 'src-x'
                        polarity = 'asserts'; canonical_proposition = 'p0'; extraction_confidence = 0.9
                    }
                )
                @{ claims = $claims } | ConvertTo-Json -Depth 5 | Set-Content -Path $ClaimsPath -Encoding utf8NoBOM

                $vecAref = $VecA
                function python {
                    process {
                        $payload = $input | Out-String | ConvertFrom-Json
                        $out = [ordered]@{}
                        foreach ($item in $payload) { $out[$item.id] = $vecAref }
                        $out | ConvertTo-Json -Depth 5 -Compress
                    }
                }
                Mock Get-OrganizationEdgesStore {
                    [PSCustomObject]@{ edges = @(
                        [PSCustomObject]@{ source='org-014'; target='acc-beliefs-001'; type='ADVOCATES_FOR'; status='proposed' }
                    )}
                }

                # Default: skipped
                $r1 = Invoke-OrgClaimMatching -ClaimsPath $ClaimsPath -EmbeddingsPath $EmbPath `
                    -MatchThreshold 0.60 -Verbose:$false 6>$null
                $r1.ProposalsWouldEmit | Should -Be 0 -Because 'tuple already exists — default skip'

                # -Force: emitted
                $r2 = Invoke-OrgClaimMatching -ClaimsPath $ClaimsPath -EmbeddingsPath $EmbPath `
                    -MatchThreshold 0.60 -Force -Verbose:$false 6>$null
                $r2.ProposalsWouldEmit | Should -Be 1 -Because '-Force overrides the skip'
            }
        }
    }

    Context 'Negation-slice (t/1553#18)' {

        It 'Every claim with a negated-deontic or oppose-lexicon token lands in .NegationSlice regardless of polarity' {
            InModuleScope AITriad -Parameters @{
                ClaimsPath = $script:claimsPath
                EmbPath    = $script:embeddingsPath
                VecA       = [double[]]$script:vecA
            } {
                param($ClaimsPath, $EmbPath, $VecA)

                $claims = @(
                    [PSCustomObject]@{
                        org_id='org-x'; source_id='src-1'
                        polarity='asserts'
                        canonical_proposition='Foreign governments ought not to impose regulations'
                        extraction_confidence=0.9
                    }
                    [PSCustomObject]@{
                        org_id='org-x'; source_id='src-2'
                        polarity='asserts'
                        canonical_proposition='CAISI ought to oppose implementation of foreign regulations'
                        extraction_confidence=0.9
                    }
                    [PSCustomObject]@{
                        org_id='org-x'; source_id='src-3'
                        polarity='asserts'
                        canonical_proposition='Mandatory pre-deployment safety evaluations should be required'
                        extraction_confidence=0.9
                    }
                )
                @{ claims = $claims } | ConvertTo-Json -Depth 5 | Set-Content -Path $ClaimsPath -Encoding utf8NoBOM

                $vecAref = $VecA
                function python {
                    process {
                        $payload = $input | Out-String | ConvertFrom-Json
                        $out = [ordered]@{}
                        foreach ($item in $payload) { $out[$item.id] = $vecAref }
                        $out | ConvertTo-Json -Depth 5 -Compress
                    }
                }
                Mock Get-OrganizationEdgesStore { [PSCustomObject]@{ edges = @() } }

                $r = Invoke-OrgClaimMatching -ClaimsPath $ClaimsPath -EmbeddingsPath $EmbPath `
                    -MatchThreshold 0.60 -Verbose:$false 6>$null

                @($r.NegationSlice).Count | Should -Be 2 -Because 'the two negation/oppose-lexicon claims land in the slice; the clean "should be required" one does not'
                ($r.NegationSlice.Proposition -join '|') | Should -Match 'ought not to impose'
                ($r.NegationSlice.Proposition -join '|') | Should -Match 'oppose implementation'
                ($r.NegationSlice.Proposition -join '|') | Should -Not -Match 'pre-deployment'
            }
        }
    }

    Context 'Per-org cap' {

        It 'Respects -PerOrgCap and reports the drop count' {
            # Override the default embeddings fixture: this test needs 3
            # distinct-argmax nodes to produce 3 buckets, so we put a real
            # VecC node in place of the family-tests' placeholder.
            $capEmbPath = Join-Path $script:workDir 'embeddings-captest.json'
            @{
                metadata = @{ dim = $script:dim }
                nodes = [ordered]@{
                    'acc-beliefs-001'    = @{ vector = $script:vecA }
                    'saf-desires-002'    = @{ vector = $script:vecB }
                    'skp-intentions-003' = @{ vector = $script:vecCn }
                }
            } | ConvertTo-Json -Depth 6 | Set-Content -Path $capEmbPath -Encoding utf8NoBOM

            InModuleScope AITriad -Parameters @{
                ClaimsPath = $script:claimsPath
                EmbPath    = $capEmbPath
                VecA       = [double[]]$script:vecA
                VecB       = [double[]]$script:vecB
                VecC       = [double[]]$script:vecCn
            } {
                param($ClaimsPath, $EmbPath, $VecA, $VecB, $VecC)

                # 3 claims → 3 (org, node, polarity) buckets, all above threshold.
                $claims = @(
                    [PSCustomObject]@{ org_id='org-014'; source_id='s1'; polarity='asserts'; canonical_proposition='p1'; extraction_confidence=0.9 }
                    [PSCustomObject]@{ org_id='org-014'; source_id='s2'; polarity='asserts'; canonical_proposition='p2'; extraction_confidence=0.9 }
                    [PSCustomObject]@{ org_id='org-014'; source_id='s3'; polarity='asserts'; canonical_proposition='p3'; extraction_confidence=0.9 }
                )
                @{ claims = $claims } | ConvertTo-Json -Depth 5 | Set-Content -Path $ClaimsPath -Encoding utf8NoBOM

                # Route each claim to a different node's vector by keying on index
                # (embed_taxonomy.py's real batch-encode does this via the id).
                $vA = $VecA; $vB = $VecB; $vC = $VecC
                function python {
                    process {
                        $payload = $input | Out-String | ConvertFrom-Json
                        $out = [ordered]@{}
                        for ($i = 0; $i -lt $payload.Count; $i++) {
                            $vec = switch ($i) { 0 { $vA } 1 { $vB } 2 { $vC } }
                            $out[$payload[$i].id] = $vec
                        }
                        $out | ConvertTo-Json -Depth 5 -Compress
                    }
                }
                Mock Get-OrganizationEdgesStore { [PSCustomObject]@{ edges = @() } }

                $r = Invoke-OrgClaimMatching -ClaimsPath $ClaimsPath -EmbeddingsPath $EmbPath `
                    -MatchThreshold 0.60 -PerOrgCap 2 -Verbose:$false 6>$null

                $r.ProposalsWouldEmit | Should -Be 2 -Because '3 candidates → PerOrgCap 2 keeps top 2 by cosine'
                @($r.DroppedByCap).Count | Should -Be 1
            }
        }
    }
}
