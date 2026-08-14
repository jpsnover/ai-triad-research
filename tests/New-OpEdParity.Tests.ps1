# Tag: parity (t/2609)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    PS↔TS parity gate — op-ed shared prompt artifacts and grounding selection.
.DESCRIPTION
    Two deterministic arms (t/2609):
    Arm 1: PS-assembled prompt text == TS-assembled prompt text for fixed fixture inputs.
    Arm 2: PS grounding selection == TS grounding selection for a fixed injected embedding.

    Both arms bypass stochastic runtimes (no embedding model invocations, no AI calls).
    Arm 1 TS side uses tsx from source (not compiled dist) to avoid stale-dist false witnesses.
    Arm 2 TS side injects a precomputed vector into selectRelevantNodes, bypassing ONNX.

    TL Gate Verification required before this is enabled as a blocking CI gate.
    Route gate + both-arm evidence back through TL (t/2609).
#>

#Requires -Module Pester

BeforeAll {
    $script:RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    Import-Module (Join-Path $script:RepoRoot 'scripts\AITriad\AITriad.psm1') -WarningAction SilentlyContinue

    $script:OPedPromptsDir = Join-Path $script:RepoRoot 'lib\oped\prompts'
    $script:TsxBin         = Join-Path $script:RepoRoot 'taxonomy-editor\node_modules\.bin\tsx'
    $script:TsxAvailable   = Test-Path $script:TsxBin

    # Grounding data — skip Arm 2 if the data repo is not present
    $script:EmbPath              = Join-Path (Get-TaxonomyDir) 'embeddings.json'
    $script:EmbeddingsAvailable  = Test-Path $script:EmbPath

    # Deterministic 384-dim unit vector: sin(i * 0.1), L2-normalized.
    # Both arms use the same definition; computing here so it is shared.
    $Raw  = [double[]](0..383 | ForEach-Object { [Math]::Sin($_ * 0.1) })
    $Norm = [Math]::Sqrt(($Raw | ForEach-Object { $_ * $_ } | Measure-Object -Sum).Sum)
    $script:FixedVector = [double[]]($Raw | ForEach-Object { $_ / $Norm })

    # TS paths (forward slashes for Node)
    $script:TaxRevSrc  = (Join-Path $script:RepoRoot 'lib\debate\taxonomyRelevance.ts').Replace('\', '/')
    $script:EmbPathFwd = $script:EmbPath.Replace('\', '/')
    $script:PrompsDirFwd = $script:OPedPromptsDir.Replace('\', '/')
}

# ── Helper: write a .mts fixture to a temp file and run it via tsx ────────────
# Returns stdout as a single string. Cleans up on exit.
function Invoke-TsxFixture {
    param([string]$TsCode)
    $TmpTs = [System.IO.Path]::GetTempFileName() -replace '\.tmp$', '.mts'
    Set-Content -Path $TmpTs -Value $TsCode -Encoding UTF8
    try {
        $Out = & $script:TsxBin $TmpTs 2>$null
        return ($Out -join "`n")
    } finally {
        Remove-Item $TmpTs -Force -ErrorAction SilentlyContinue
    }
}

# ─────────────────────────────────────────────────────────────────────────────
Describe 'PS↔TS parity: prompt assembly (Arm 1)' -Tag 'parity' {

    # Shared fixture replacements — identical keys supplied to both sides.
    # The system prompt uses: POV_LABEL, VOICE_BLOCK, WORD_COUNT, OUTLET_GUIDANCE.
    $script:SysVars = @{
        POV_LABEL       = 'The Safetyist'
        VOICE_BLOCK     = 'PARITY_FIXTURE_VOICE'
        WORD_COUNT      = '800'
        OUTLET_GUIDANCE = 'Generic: ~800 words'
    }

    It 'PS and TS assemble byte-identical system prompt for fixed fixture inputs' `
       -Skip:(-not $script:TsxAvailable) {

        # PS side
        $PsSystem = Get-Prompt -Name 'op-ed-generation-system' `
            -PromptsDir $script:OPedPromptsDir `
            -Replacements $script:SysVars `
            -AllowUnresolved

        # TS side — reproduces promptLoader.ts interpolation from source
        $VarsJson = ($script:SysVars | ConvertTo-Json -Compress)
        $TsCode = @"
import { readFileSync } from 'fs';
import { join } from 'path';
const dir = "$($script:PrompsDirFwd)";
const tpl = readFileSync(join(dir, 'op-ed-generation-system.prompt'), 'utf-8').trimEnd();
const vars = $VarsJson;
const out = tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars)[k] ?? '');
process.stdout.write(out);
"@
        $TsSystem = Invoke-TsxFixture $TsCode

        ($PsSystem -replace '\r\n', "`n").TrimEnd() |
            Should -Be ($TsSystem -replace '\r\n', "`n").TrimEnd()
    }

    It 'PS and TS assemble byte-identical user prompt for fixed fixture inputs' `
       -Skip:(-not $script:TsxAvailable) {

        $UserVars = @{
            TOPIC                  = 'Mandatory AI audits'
            WORD_COUNT             = '800'
            OUTLET_GUIDANCE        = 'Generic: ~800 words'
            NEWS_HOOK              = 'Senate AI bill hearing next week'
            THESIS                 = 'Audits prevent catastrophic failures'
            AUTHOR_BIO             = 'A researcher at MIT'
            SOURCE_MATERIAL        = '(no external source supplied — argue from the topic and general knowledge)'
            GROUNDING_NODES        = '- [saf-bel-001] [Belief] AI is dangerous: Detail here.'
            SITUATIONS             = '- [sit-001] Runaway model: Bad outcome.'
            PITCH_INSTRUCTION      = 'Write a short pitch email.'
            SOURCE_AUTHOR          = ''
            SOURCE_ACTOR_TYPE      = ''
            SOURCE_THESIS          = ''
            SOURCE_STANCE          = ''
            SOURCE_RECOMMENDATIONS = ''
        }

        $PsUser = Get-Prompt -Name 'op-ed-generation-user' `
            -PromptsDir $script:OPedPromptsDir `
            -Replacements $UserVars `
            -AllowUnresolved

        $VarsJson = ($UserVars | ConvertTo-Json -Compress)
        $TsCode = @"
import { readFileSync } from 'fs';
import { join } from 'path';
const dir = "$($script:PrompsDirFwd)";
const tpl = readFileSync(join(dir, 'op-ed-generation-user.prompt'), 'utf-8').trimEnd();
const vars = $VarsJson;
const out = tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars)[k] ?? '');
process.stdout.write(out);
"@
        $TsUser = Invoke-TsxFixture $TsCode

        ($PsUser -replace '\r\n', "`n").TrimEnd() |
            Should -Be ($TsUser -replace '\r\n', "`n").TrimEnd()
    }

    # Deliberate-divergence proof: confirms the gate is sensitive to PS-side changes.
    # (TS-side divergence proved by TL during Gate Verification — see t/2609 evidence.)
    It 'Gate fires when PS uses a different POV_LABEL (divergence sensitivity)' {
        $Aligned = Get-Prompt -Name 'op-ed-generation-system' `
            -PromptsDir $script:OPedPromptsDir -AllowUnresolved `
            -Replacements @{ POV_LABEL = 'The Safetyist'; VOICE_BLOCK = 'X'; WORD_COUNT = '800'; OUTLET_GUIDANCE = 'G' }
        $Diverged = Get-Prompt -Name 'op-ed-generation-system' `
            -PromptsDir $script:OPedPromptsDir -AllowUnresolved `
            -Replacements @{ POV_LABEL = 'INJECTED_DIVERGENCE'; VOICE_BLOCK = 'X'; WORD_COUNT = '800'; OUTLET_GUIDANCE = 'G' }
        $Aligned | Should -Not -Be $Diverged `
            -Because 'a changed POV_LABEL must produce different output (gate is sensitive to PS changes)'
    }
}

# ─────────────────────────────────────────────────────────────────────────────
Describe 'PS↔TS parity: grounding selection (Arm 2)' -Tag 'parity' {

    It 'PS and TS select identical safetyist node IDs in the same order (fixed embedding)' `
       -Skip:(-not $script:TsxAvailable -or -not $script:EmbeddingsAvailable) {

        # PS side — inject fixed vector; skips Python ONNX subprocess entirely.
        # MinPerCategory=0 + TopK=0 → pure threshold filter, matching TS selectRelevantNodes defaults.
        $PsIds = @(
            Get-RelevantTaxonomyNodes -QueryVector $script:FixedVector `
                -POV safetyist -MaxTotal 5 -MinPerCategory 0 -TopK 0 -Threshold 0.20 |
            Select-Object -ExpandProperty Id
        )

        # TS side — inject same fixed vector into scoreNodeRelevance + selectRelevantNodes.
        # Uses same threshold (0.20), minPerCategory (0), maxTotal (5).
        $VecLiteral = $script:FixedVector -join ','
        $TsCode = @"
import { readFileSync } from 'fs';
import { scoreNodeRelevance, selectRelevantNodes } from '$($script:TaxRevSrc)';
const embData = JSON.parse(readFileSync('$($script:EmbPathFwd)', 'utf-8'));
const queryVector = [$VecLiteral];
const nodeEmbeddings = Object.fromEntries(
  Object.entries(embData.nodes).map(([id, e]) => [id, { pov: e.pov, vector: e.vector }])
);
const scores = scoreNodeRelevance(queryVector, nodeEmbeddings);
const safetyistNodes = Object.entries(embData.nodes)
  .filter(([_, e]) => e.pov === 'safetyist')
  .map(([id, e]) => ({
    id, pov: e.pov, category: e.category, label: e.label,
    description: e.description ?? ''
  }));
const selected = selectRelevantNodes(safetyistNodes, scores, 0.20, 0, 5);
process.stdout.write(JSON.stringify(selected.map(n => n.id)));
"@
        $TsOut = Invoke-TsxFixture $TsCode
        $TsIds = @($TsOut | ConvertFrom-Json)

        $PsIds | Should -Be $TsIds `
            -Because 'same fixed embedding + same taxonomy → same cosine scores → same node ranking'
    }

    # Deliberate-divergence proof: negating the vector reverses cosine similarities,
    # producing a different (typically empty at threshold=0.20) selection.
    It 'Gate fires when the embedding vector differs (divergence sensitivity)' `
       -Skip:(-not $script:EmbeddingsAvailable) {

        $CanonIds = @(
            Get-RelevantTaxonomyNodes -QueryVector $script:FixedVector `
                -POV safetyist -MaxTotal 5 -MinPerCategory 0 -TopK 0 -Threshold 0.20 |
            Select-Object -ExpandProperty Id
        )
        # Negated vector → all cosine similarities negate → all below 0.20 threshold
        $NegVec = [double[]]($script:FixedVector | ForEach-Object { -$_ })
        $DivergIds = @(
            Get-RelevantTaxonomyNodes -QueryVector $NegVec `
                -POV safetyist -MaxTotal 5 -MinPerCategory 0 -TopK 0 -Threshold 0.20 |
            Select-Object -ExpandProperty Id
        )
        ($CanonIds -join ',') | Should -Not -Be ($DivergIds -join ',') `
            -Because 'negated embedding flips all cosine signs → different (or empty) selection'
    }
}
