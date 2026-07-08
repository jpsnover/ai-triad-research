# Tag: enrichment (t/1404)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Coverage for the chunk+mean-pool embedding fix (t/1404).
.DESCRIPTION
    The critical property this suite guards (AC#2): for inputs longer than
    ~1000 chars, changing content past the ~1000-char boundary MUST change
    the returned embedding. Pre-fix, chars past ~1000 were silently dropped
    at the model tokenizer, so two 1500-char inputs identical in their first
    ~1000 chars produced identical vectors — a live retrieval-quality bug.

    Tests that need the Python `all-MiniLM-L6-v2` model self-skip with an
    ALARMING reason so a CI regression in the model install can't quietly
    pass-by-skip (t/1355 pattern).

    The pure-PS helper tests (Split-TextIntoEmbeddingChunks,
    Merge-EmbeddingChunks) always run and require no Python.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    # Detect Python + sentence-transformers availability for the end-to-end
    # AC#2 test. Missing environment triggers a LOUD skip, not a silent pass.
    $script:PythonMissing = $true
    $script:PythonSkipReason = ''
    $py = if (Get-Command python -ErrorAction SilentlyContinue) { 'python' }
          elseif (Get-Command python3 -ErrorAction SilentlyContinue) { 'python3' }
          else { $null }
    if (-not $py) {
        $script:PythonSkipReason = 'python missing on PATH — EMBEDDING PARITY GUARD NOT RUN (CI regression?)'
    } else {
        try {
            $null = & $py -c 'import sentence_transformers' 2>$null
            if ($LASTEXITCODE -eq 0) { $script:PythonMissing = $false }
            else { $script:PythonSkipReason = 'sentence-transformers not importable — EMBEDDING PARITY GUARD NOT RUN (CI regression?)' }
        } catch {
            $script:PythonSkipReason = 'python -c check threw — EMBEDDING PARITY GUARD NOT RUN (CI regression?)'
        }
    }
}

Describe 'Split-TextIntoEmbeddingChunks (t/1404, pure PS)' -Tag 'enrichment' {

    It 'Returns a single-element array for short input' {
        InModuleScope AITriad {
            $r = Split-TextIntoEmbeddingChunks -Text 'hello world' -MaxCharsPerChunk 900
            @($r).Count | Should -Be 1
            $r[0] | Should -Be 'hello world'
        }
    }

    It 'Returns empty single-element array for empty input' {
        InModuleScope AITriad {
            $r = Split-TextIntoEmbeddingChunks -Text '' -MaxCharsPerChunk 900
            @($r).Count | Should -Be 1
            $r[0] | Should -Be ''
        }
    }

    It 'Splits at word boundary near the max — no mid-word cuts' {
        InModuleScope AITriad {
            # 200 repetitions of 'word ' -> 1000 chars. With MaxCharsPerChunk=250,
            # every cut must land on a whitespace, so no chunk should end mid-word.
            $text = ('word ' * 200)
            $chunks = Split-TextIntoEmbeddingChunks -Text $text -MaxCharsPerChunk 250
            @($chunks).Count | Should -BeGreaterThan 1
            # No chunk should end mid-word (last char == ' ' when not the tail)
            for ($i = 0; $i -lt @($chunks).Count - 1; $i++) {
                $chunks[$i][-1] | Should -Match '\s'
            }
            # Reassembly must equal the original
            ($chunks -join '') | Should -Be $text
        }
    }

    It 'Covers the full input — reassembly matches original for a boundary-hostile input' {
        InModuleScope AITriad {
            # 5000 chars with no whitespace — forces hard-cut fallback
            $text = ('a' * 5000)
            $chunks = Split-TextIntoEmbeddingChunks -Text $text -MaxCharsPerChunk 900
            @($chunks).Count | Should -BeGreaterOrEqual 6
            # Every chunk must be <= max
            foreach ($c in $chunks) { $c.Length | Should -BeLessOrEqual 900 }
            ($chunks -join '') | Should -Be $text
        }
    }
}

Describe 'Merge-EmbeddingChunks (t/1404, pure PS)' -Tag 'enrichment' {

    It 'Mean-pools two orthogonal unit vectors and re-normalizes to a unit vector' {
        InModuleScope AITriad {
            $vecs = @{
                'a::0' = [double[]]@(1.0, 0.0, 0.0)
                'a::1' = [double[]]@(0.0, 1.0, 0.0)
            }
            $groups = @{ 'a' = 2 }
            $out = Merge-EmbeddingChunks -Ids @('a') -ChunkGroups $groups -ChunkVectors $vecs
            # Mean = (0.5, 0.5, 0); L2-norm = sqrt(0.5) ≈ 0.7071
            [Math]::Abs($out['a'][0] - 0.70710678) | Should -BeLessThan 1e-6
            [Math]::Abs($out['a'][1] - 0.70710678) | Should -BeLessThan 1e-6
            [Math]::Abs($out['a'][2] - 0.0)        | Should -BeLessThan 1e-6
            # Unit length
            $n = 0.0; foreach ($v in $out['a']) { $n += $v * $v }
            [Math]::Abs([Math]::Sqrt($n) - 1.0)    | Should -BeLessThan 1e-9
        }
    }

    It 'Passes through a single-chunk unit vector unchanged' {
        InModuleScope AITriad {
            $vecs = @{ 'b::0' = [double[]]@(0.6, 0.8, 0.0) }
            $out = Merge-EmbeddingChunks -Ids @('b') -ChunkGroups @{ 'b' = 1 } -ChunkVectors $vecs
            [Math]::Abs($out['b'][0] - 0.6) | Should -BeLessThan 1e-9
            [Math]::Abs($out['b'][1] - 0.8) | Should -BeLessThan 1e-9
        }
    }

    It 'Returns an empty vector for zero-chunk group (empty original input)' {
        InModuleScope AITriad {
            $out = Merge-EmbeddingChunks -Ids @('x') -ChunkGroups @{ 'x' = 0 } -ChunkVectors @{}
            @($out['x']).Count | Should -Be 0
        }
    }
}

Describe 'Get-TextEmbedding chunk+mean-pool AC#2 (t/1404, requires Python)' -Tag 'enrichment' {

    It 'ACROSS the ~1000-char boundary: two 1500-char texts identical in first 1000 chars but different past 1000 chars produce DIFFERENT embeddings' {
        if ($script:PythonMissing) {
            Set-ItResult -Skipped -Because $script:PythonSkipReason
            return
        }

        # Pre-fix: both texts truncated to first 1000 chars before encoding —
        # embeddings would be identical (cosine = 1.0). Post-fix: chunk 2
        # (chars 900+) differs between A and B, so the mean-pooled + re-normalized
        # vector differs. This is the exact case the ticket calls out.
        # (Get-TextEmbedding is a Private helper — must run inside InModuleScope.
        # $using: doesn't work here since InModuleScope isn't a remoting context;
        # constructing the texts inline is simplest.)
        InModuleScope AITriad {
            $shared  = ('The quick brown fox jumps over the lazy dog. ' * 25)  # ~1125 chars
            $sharedFirst1000 = $shared.Substring(0, 1000)
            $tailA = ' Machine learning models generalize from training data. ' * 10
            $tailB = ' Regulatory oversight of frontier AI systems is a live debate. ' * 10
            $textA = $sharedFirst1000 + $tailA
            $textB = $sharedFirst1000 + $tailB

            $r = Get-TextEmbedding -Texts @($textA, $textB) -Ids @('A', 'B')
            $r | Should -Not -BeNullOrEmpty
            $r.ContainsKey('A') | Should -Be $true
            $r.ContainsKey('B') | Should -Be $true
            @($r['A']).Count | Should -Be 384
            @($r['B']).Count | Should -Be 384

            # Cosine similarity between the two — must be <1 with meaningful margin.
            # If the past-boundary content had no effect, cosine would be exactly 1.
            # We assert strictly less than 0.999 — a mean-pooled distinction on a
            # 550+ char tail with distinct topics comfortably exceeds this.
            $dot = 0.0
            for ($i = 0; $i -lt 384; $i++) { $dot += $r['A'][$i] * $r['B'][$i] }
            Write-Verbose "cosine(A,B) = $dot"
            $dot | Should -BeLessThan 0.999 -Because 'past-boundary content must influence the embedding (t/1404 AC#2)'
        }
    }

    It 'Returns 384-dim vectors and honors the id map' {
        if ($script:PythonMissing) {
            Set-ItResult -Skipped -Because $script:PythonSkipReason
            return
        }
        InModuleScope AITriad {
            $r = Get-TextEmbedding -Texts @('AI governance frameworks', 'Governance frameworks for AI') -Ids @('q1', 'q2')
            $r | Should -Not -BeNullOrEmpty
            @($r['q1']).Count | Should -Be 384
            @($r['q2']).Count | Should -Be 384
        }
    }
}
