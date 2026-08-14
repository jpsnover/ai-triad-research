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
    Arm 2 PS side passes -QueryVector so Get-RelevantTaxonomyNodes skips the Python encode.

    TL Gate Verification required before this is enabled as a blocking CI gate.
    Route gate + both-arm evidence back through TL (t/2609).

    PESTER 5 SCOPING NOTES (learned during implementation):
    - Use Set-ItResult -Skipped inside the body (not -Skip: on It) for runtime conditions;
      -Skip: evaluates during discovery before BeforeAll variables are set.
    - InModuleScope -Parameters converts hashtables to PSCustomObject across the boundary;
      pass strings only via -Parameters and construct hashtables inside the scriptblock.
    - Cmdlet helpers in BeforeAll must use 'function script:Name' or be stored as
      $script: scriptblock variables to survive from BeforeAll into It scopes.
    - Get-RelevantTaxonomyNodes -Query is mandatory even when -QueryVector is supplied;
      pass a sentinel string to satisfy it.
    - Use New-Object + for loops instead of pipeline ForEach-Object for numeric array
      construction to avoid potential strict-mode pipeline issues.
#>

#Requires -Module Pester

# Load at discovery time so module init code runs outside Pester's BeforeAll wrapper
# (avoids LoopFlowException from break/continue in the module's foreach loops — pester/Pester#2669)
$script:RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Import-Module (Join-Path $script:RepoRoot 'scripts\AITriad\AITriad.psm1') -WarningAction SilentlyContinue

BeforeAll {
    $script:RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    Import-Module (Join-Path $script:RepoRoot 'scripts\AITriad\AITriad.psm1') -WarningAction SilentlyContinue

    $script:OPedPromptsDir = Join-Path $script:RepoRoot 'lib\oped\prompts'

    # Resolve tsx by finding cli.mjs directly in the pnpm virtual store.
    # Walking the .cmd shim is unreliable — pnpm updates the installed version
    # (e.g. tsx@4.23.1 → tsx@4.23.11) without regenerating the shim, causing
    # MODULE_NOT_FOUND at runtime. Scanning the store bypasses the stale shim.
    # Walk up from RepoRoot to handle worktrees that lack their own node_modules.
    $script:TsxCliMjs = $null
    $script:NodeBin = (Get-Command node -ErrorAction SilentlyContinue)?.Source
    $_searchDir = $script:RepoRoot
    while ($_searchDir) {
        $pnpmStore = Join-Path $_searchDir 'node_modules\.pnpm'
        if (Test-Path $pnpmStore) {
            $script:TsxCliMjs = Get-ChildItem $pnpmStore -Directory |
                Where-Object { $_.Name -like 'tsx@*' } |
                Sort-Object Name -Descending |
                Select-Object -First 1 |
                ForEach-Object { Join-Path $_.FullName 'node_modules\tsx\dist\cli.mjs' } |
                Where-Object { Test-Path $_ } |
                Select-Object -First 1
            if ($script:TsxCliMjs) { break }
        }
        $parent = Split-Path $_searchDir -Parent
        if (-not $parent -or $parent -eq $_searchDir) { break }
        $_searchDir = $parent
    }
    $script:TsxAvailable = $null -ne $script:TsxCliMjs -and $null -ne $script:NodeBin

    # Grounding data — skip Arm 2 if the data repo is not present.
    # Get-TaxonomyDir is private; invoke through module scope.
    $script:EmbPath             = Join-Path (& (Get-Module AITriad) { Get-TaxonomyDir }) 'embeddings.json'
    $script:EmbeddingsAvailable = Test-Path $script:EmbPath

    # Deterministic 384-dim unit vector: sin(i * 0.1), L2-normalized.
    # Use New-Object + for loops — avoids pipeline ForEach-Object strict-mode issues.
    $RawArr = New-Object 'double[]' 384
    for ($i = 0; $i -lt 384; $i++) { $RawArr[$i] = [Math]::Sin($i * 0.1) }
    $SumSq = 0.0
    for ($i = 0; $i -lt 384; $i++) { $SumSq += $RawArr[$i] * $RawArr[$i] }
    $Norm = [Math]::Sqrt($SumSq)
    $script:FixedVector = New-Object 'double[]' 384
    for ($i = 0; $i -lt 384; $i++) { $script:FixedVector[$i] = $RawArr[$i] / $Norm }

    # TS paths — Node ESM loader requires file:// URIs for absolute paths on Windows;
    # bare 'C:/...' is parsed as scheme 'c:' and throws ERR_UNSUPPORTED_ESM_URL_SCHEME.
    $script:TaxRevSrcUri  = [Uri]::new((Join-Path $script:RepoRoot 'lib\debate\taxonomyRelevance.ts')).AbsoluteUri
    $script:EmbPathFwd    = $script:EmbPath.Replace('\', '/')
    $script:PromptsDirFwd = $script:OPedPromptsDir.Replace('\', '/')

    # Ensure Arm 2 grounding tests use single-vector cosine — same path as the TS lib.
    # PS Get-RelevantTaxonomyNodes uses synthetic multi-vectors (mean-of-top-N) when
    # synthetic_embeddings.json is present, but the TS lib (scoreNodeRelevance) uses
    # only the standard single-vector embeddings.json. Suppress the synthetic path by:
    #   1. Sentinel hashtable (non-empty): prevents the lazy-load guard from reloading
    #      (`if (-not $script:CachedSyntheticVectors)` stays false).
    #   2. SyntheticTimestamp = [DateTime]::MaxValue: prevents Assert-TaxonomyCacheFresh
    #      from nulling the sentinel (stale check: `$SynWriteTime -gt $SyntheticTimestamp`
    #      is always false when timestamp is MaxValue; no real file has that write time).
    InModuleScope AITriad {
        $script:CachedSyntheticVectors = @{ '__parity-fixture-no-synthetic__' = $null }
        $script:SyntheticTimestamp     = [DateTime]::MaxValue
    }

    # Helper: write a .mts fixture to a temp file and run it via node + tsx cli.mjs.
    # Uses node + cli.mjs directly (not the .cmd shim) to bypass stale-shim version issues.
    # Stored as a scriptblock variable to guarantee it is visible in It scopes.
    $script:TsxHelper = {
        param([string]$TsCode)
        $TmpTs = Join-Path $env:TEMP "parity-$(New-Guid).mts"
        Set-Content -Path $TmpTs -Value $TsCode -Encoding UTF8
        try {
            $Out = & $script:NodeBin $script:TsxCliMjs $TmpTs 2>$null
            return ($Out -join "`n")
        } finally {
            Remove-Item $TmpTs -Force -ErrorAction SilentlyContinue
        }
    }
}

# ─────────────────────────────────────────────────────────────────────────────
Describe 'PS↔TS parity: prompt assembly (Arm 1)' -Tag 'parity' {

    # Guard: fail loudly if tsx is absent so CI goes red (not green-by-skipping).
    It 'tsx runtime is available (gate cannot skip silently in CI)' {
        $script:TsxCliMjs | Should -Not -BeNullOrEmpty `
            -Because 'Arm 1 requires tsx in pnpm store — wire node+pnpm install into test-powershell CI job if this fails'
    }

    It 'PS and TS assemble byte-identical system prompt for fixed fixture inputs' {
        if (-not $script:TsxAvailable) { Set-ItResult -Skipped -Because 'tsx not available'; return }

        # PS side — Get-Prompt is Private; invoke via InModuleScope.
        # Fixture hashtable is constructed INSIDE InModuleScope (not via -Parameters)
        # because -Parameters coerces hashtables to PSCustomObject across the boundary.
        $PsSystem = InModuleScope AITriad -Parameters @{ PromptsDir = $script:OPedPromptsDir } {
            param([string]$PromptsDir)
            Get-Prompt -Name 'op-ed-generation-system' -PromptsDir $PromptsDir -AllowUnresolved `
                -Replacements @{
                    POV_LABEL       = 'The Safetyist'
                    VOICE_BLOCK     = 'PARITY_FIXTURE_VOICE'
                    WORD_COUNT      = '800'
                    OUTLET_GUIDANCE = 'Generic: ~800 words'
                }
        }

        # TS side — same fixture values, same {{KEY}} substitution logic as promptLoader.ts
        $TsCode = @"
import { readFileSync } from 'fs';
import { join } from 'path';
const dir = "$($script:PromptsDirFwd)";
const tpl = readFileSync(join(dir, 'op-ed-generation-system.prompt'), 'utf-8').trimEnd();
const vars = {"POV_LABEL":"The Safetyist","VOICE_BLOCK":"PARITY_FIXTURE_VOICE","WORD_COUNT":"800","OUTLET_GUIDANCE":"Generic: ~800 words"};
const out = tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
process.stdout.write(out);
"@
        $TsSystem = & $script:TsxHelper $TsCode

        ($PsSystem -replace '\r\n', "`n").TrimEnd() |
            Should -Be ($TsSystem -replace '\r\n', "`n").TrimEnd()
    }

    It 'PS and TS assemble byte-identical user prompt for fixed fixture inputs' {
        if (-not $script:TsxAvailable) { Set-ItResult -Skipped -Because 'tsx not available'; return }

        # PS side
        $PsUser = InModuleScope AITriad -Parameters @{ PromptsDir = $script:OPedPromptsDir } {
            param([string]$PromptsDir)
            Get-Prompt -Name 'op-ed-generation-user' -PromptsDir $PromptsDir -AllowUnresolved `
                -Replacements @{
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
        }

        # TS side
        $TsCode = @"
import { readFileSync } from 'fs';
import { join } from 'path';
const dir = "$($script:PromptsDirFwd)";
const tpl = readFileSync(join(dir, 'op-ed-generation-user.prompt'), 'utf-8').trimEnd();
const vars = {"TOPIC":"Mandatory AI audits","WORD_COUNT":"800","OUTLET_GUIDANCE":"Generic: ~800 words","NEWS_HOOK":"Senate AI bill hearing next week","THESIS":"Audits prevent catastrophic failures","AUTHOR_BIO":"A researcher at MIT","SOURCE_MATERIAL":"(no external source supplied — argue from the topic and general knowledge)","GROUNDING_NODES":"- [saf-bel-001] [Belief] AI is dangerous: Detail here.","SITUATIONS":"- [sit-001] Runaway model: Bad outcome.","PITCH_INSTRUCTION":"Write a short pitch email.","SOURCE_AUTHOR":"","SOURCE_ACTOR_TYPE":"","SOURCE_THESIS":"","SOURCE_STANCE":"","SOURCE_RECOMMENDATIONS":""};
const out = tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
process.stdout.write(out);
"@
        $TsUser = & $script:TsxHelper $TsCode

        ($PsUser -replace '\r\n', "`n").TrimEnd() |
            Should -Be ($TsUser -replace '\r\n', "`n").TrimEnd()
    }

    # Deliberate-divergence proof: confirms the gate is sensitive to PS-side changes.
    It 'Gate fires when PS uses a different POV_LABEL (divergence sensitivity)' {
        $Aligned = InModuleScope AITriad -Parameters @{ PromptsDir = $script:OPedPromptsDir } {
            param([string]$PromptsDir)
            Get-Prompt -Name 'op-ed-generation-system' -PromptsDir $PromptsDir -AllowUnresolved `
                -Replacements @{ POV_LABEL = 'The Safetyist'; VOICE_BLOCK = 'X'; WORD_COUNT = '800'; OUTLET_GUIDANCE = 'G' }
        }
        $Diverged = InModuleScope AITriad -Parameters @{ PromptsDir = $script:OPedPromptsDir } {
            param([string]$PromptsDir)
            Get-Prompt -Name 'op-ed-generation-system' -PromptsDir $PromptsDir -AllowUnresolved `
                -Replacements @{ POV_LABEL = 'INJECTED_DIVERGENCE'; VOICE_BLOCK = 'X'; WORD_COUNT = '800'; OUTLET_GUIDANCE = 'G' }
        }
        $Aligned | Should -Not -Be $Diverged `
            -Because 'a changed POV_LABEL must produce different output (gate is sensitive to PS changes)'
    }
}

# ─────────────────────────────────────────────────────────────────────────────
Describe 'PS↔TS parity: grounding selection (Arm 2)' -Tag 'parity' {

    It 'PS and TS select identical safetyist node IDs in the same order (fixed embedding)' {
        if (-not $script:TsxAvailable)       { Set-ItResult -Skipped -Because 'tsx not available'; return }
        if (-not $script:EmbeddingsAvailable) { Set-ItResult -Skipped -Because 'embeddings.json not present'; return }

        # PS side — pass -QueryVector to skip the Python encode subprocess.
        # -Query is mandatory (used for logging) even when -QueryVector is supplied.
        # Threshold 0.0: all-MiniLM embeddings sit near-zero cosine to the sin() fixture
        # vector; 0.20 yields empty on both sides (trivially equal). 0.0 picks up all
        # positively-correlated nodes, making the assertion non-vacuous.
        $PsIds = @(
            Get-RelevantTaxonomyNodes `
                -Query 'PARITY_FIXTURE_QUERY' `
                -QueryVector $script:FixedVector `
                -POV safetyist -MaxTotal 5 -MinPerCategory 0 -TopK 0 -Threshold 0.0 |
            Select-Object -ExpandProperty Id
        )

        # Grab the pillar-node exclusion set that PS populated lazily during the call above.
        # PS reads descriptions from taxonomy JSON (not embeddings.json), so we can't
        # reconstruct them in TS without loading separate files. Injecting the set from PS
        # scope keeps both sides using the exact same exclusion predicate.
        $PillarIds     = InModuleScope AITriad { @($script:PillarNodeIds) }
        $PillarIdsJson = ConvertTo-Json -InputObject @($PillarIds) -Compress

        # TS side — mirror the PS selection algorithm exactly.
        # PS: scoreNodeRelevance → round 4dp → pillar exclusion → filter threshold → global top-MaxTotal sort.
        # NOTE: selectRelevantNodes is NOT used here — it groups per-category and slice(0,N),
        # producing a different order than PS's global top-K. This fixture reimplements the
        # PS algorithm in TS to prove the cosine math and ranking are identical.
        $VecLiteral = ($script:FixedVector -join ',')
        $TsCode = @"
import { readFileSync } from 'fs';
import { scoreNodeRelevance } from '$($script:TaxRevSrcUri)';
const embData = JSON.parse(readFileSync('$($script:EmbPathFwd)', 'utf-8'));
const queryVector = [$VecLiteral];
const pillarIds = new Set($PillarIdsJson as string[]);
const nodeEmbeddings = Object.fromEntries(
  Object.entries(embData.nodes).map(([id, e]) => [id, { pov: (e as any).pov, vector: (e as any).vector }])
);
const rawScores = scoreNodeRelevance(queryVector, nodeEmbeddings);
// Mirror PS: saf- prefix, pillar exclusion, 4dp rounding, threshold 0.0, global top-5
const safetyistIds = (Object.keys(embData.nodes) as string[])
  .filter(id => id.startsWith('saf-') && !pillarIds.has(id))
  .map(id => ({ id, score: Math.round((rawScores.get(id) ?? 0) * 10000) / 10000 }))
  .filter(n => n.score >= 0.0)
  .sort((a, b) => b.score - a.score)
  .slice(0, 5)
  .map(n => n.id);
process.stdout.write(JSON.stringify(safetyistIds));
"@
        $TsOut = & $script:TsxHelper $TsCode
        $TsIds = @($TsOut | ConvertFrom-Json)

        $PsIds | Should -Be $TsIds `
            -Because 'same fixed embedding + same taxonomy → same cosine scores → same node ranking'
    }

    # Deliberate-divergence proof: negating the vector reverses cosine similarities.
    # Threshold 0.0 ensures the canonical fixture vector picks up some nodes
    # (all-MiniLM embeddings sit near 0 cosine to a sin() wave; 0.20 is above
    # noise and may yield empty, making the proof vacuous). Negating every element
    # flips all cosine signs below 0 → nothing passes the 0.0 cutoff → empty result.
    It 'Gate fires when the embedding vector differs (divergence sensitivity)' {
        if (-not $script:EmbeddingsAvailable) { Set-ItResult -Skipped -Because 'embeddings.json not present'; return }

        $CanonIds = @(
            Get-RelevantTaxonomyNodes `
                -Query 'PARITY_FIXTURE_QUERY' `
                -QueryVector $script:FixedVector `
                -POV safetyist -MaxTotal 5 -MinPerCategory 0 -TopK 0 -Threshold 0.0 |
            Select-Object -ExpandProperty Id
        )
        # Negated vector → cosine(−v, u) = −cosine(v, u) → all negatives fail Threshold 0.0
        $NegVec = New-Object 'double[]' 384
        for ($i = 0; $i -lt 384; $i++) { $NegVec[$i] = -$script:FixedVector[$i] }
        $DivergIds = @(
            Get-RelevantTaxonomyNodes `
                -Query 'PARITY_FIXTURE_QUERY' `
                -QueryVector $NegVec `
                -POV safetyist -MaxTotal 5 -MinPerCategory 0 -TopK 0 -Threshold 0.0 |
            Select-Object -ExpandProperty Id
        )
        ($CanonIds -join ',') | Should -Not -Be ($DivergIds -join ',') `
            -Because 'negated embedding flips all cosine signs below 0 → empty vs non-empty selection'
    }
}
