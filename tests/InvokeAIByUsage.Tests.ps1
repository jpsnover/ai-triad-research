# Tag: enrichment (t/1186, t/1261)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

# ─────────────────────────────────────────────────────────────────────────────
# UsageRegistry helpers
# ─────────────────────────────────────────────────────────────────────────────
Describe 'UsageRegistry loader (t/1261)' -Tag 'enrichment' {

    It 'Get-UsageRegistry loads ai-usages.json and returns a PSCustomObject' {
        InModuleScope AITriad {
            $r = Get-UsageRegistry
            $r | Should -Not -BeNullOrEmpty
            $r.PSObject.Properties['_schema_version'] | Should -Not -BeNullOrEmpty
            $r._schema_version | Should -Be '1.0.0'
        }
    }

    It 'Registry contains seed enrichment.metadata-extraction and new edge-discovery entries' {
        InModuleScope AITriad {
            $r = Get-UsageRegistry
            $r.PSObject.Properties['enrichment.metadata-extraction']    | Should -Not -BeNullOrEmpty
            $r.PSObject.Properties['enrichment.edge-discovery.classify'] | Should -Not -BeNullOrEmpty
            $r.PSObject.Properties['enrichment.edge-discovery.screen']   | Should -Not -BeNullOrEmpty
        }
    }

    It 'Cache invalidates when a fresh -Path is supplied' {
        InModuleScope AITriad {
            $tmp = [System.IO.Path]::GetTempFileName()
            try {
                $payload = @{
                    '_schema_version' = '1.0.0'
                    'unit.test' = @{
                        description = 'x'
                        model = 'gemini-3.1-flash-lite'
                        messageTemplate = '{{p}}'
                    }
                } | ConvertTo-Json -Depth 6
                Set-Content -Path $tmp -Value $payload -Encoding utf8NoBOM

                $live = Get-UsageRegistry
                $live.PSObject.Properties['unit.test'] | Should -BeNullOrEmpty

                $fixture = Get-UsageRegistry -Path $tmp
                $fixture.PSObject.Properties['unit.test'] | Should -Not -BeNullOrEmpty

                # After the fixture, live path re-resolves cleanly (cache keyed by path)
                Clear-UsageRegistryCache
                $liveAgain = Get-UsageRegistry
                $liveAgain.PSObject.Properties['unit.test'] | Should -BeNullOrEmpty
            } finally {
                Clear-UsageRegistryCache
                Remove-Item $tmp -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

Describe 'Get-UsageConfig (_extends resolution) (t/1261)' -Tag 'enrichment' {

    It 'Returns a hashtable with the resolved config fields' {
        InModuleScope AITriad {
            $cfg = Get-UsageConfig -UsageId 'enrichment.metadata-extraction'
            $cfg              | Should -BeOfType [hashtable]
            $cfg['model']     | Should -Not -BeNullOrEmpty
            $cfg['messageTemplate'] | Should -Not -BeNullOrEmpty
        }
    }

    It 'Applies _extends: child fields override parent' {
        InModuleScope AITriad {
            # turn.brief:experiment-claude extends turn.brief with a claude model
            $parent = Get-UsageConfig -UsageId 'turn.brief'
            $child  = Get-UsageConfig -UsageId 'turn.brief:experiment-claude'
            $child['model'] | Should -Not -Be $parent['model']
            # Fields present in parent but not in child are inherited
            $child['maxTokens'] | Should -Be $parent['maxTokens']
        }
    }

    It 'Throws ActionableError on unknown UsageID' {
        InModuleScope AITriad {
            { Get-UsageConfig -UsageId 'not.a.real.usage.id.xyz' } |
                Should -Throw -ExpectedMessage '*not found*'
        }
    }

    It 'Refuses to resolve an _extends cycle' {
        InModuleScope AITriad {
            $tmp = [System.IO.Path]::GetTempFileName()
            try {
                $payload = @{
                    '_schema_version' = '1.0.0'
                    'a' = @{ '_extends' = 'b'; model = 'gemini-3.1-flash-lite'; messageTemplate = '{{p}}' }
                    'b' = @{ '_extends' = 'a'; model = 'gemini-3.1-flash-lite'; messageTemplate = '{{p}}' }
                } | ConvertTo-Json -Depth 6
                Set-Content -Path $tmp -Value $payload -Encoding utf8NoBOM
                $reg = Get-UsageRegistry -Path $tmp
                { Get-UsageConfig -UsageId 'a' -Registry $reg } |
                    Should -Throw -ExpectedMessage '*cycle*'
            } finally {
                Clear-UsageRegistryCache
                Remove-Item $tmp -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

Describe 'Convert-UsageTemplate (t/1261)' -Tag 'enrichment' {

    It 'Substitutes {{var}} placeholders with values' {
        InModuleScope AITriad {
            $out = Convert-UsageTemplate -Template 'hello {{name}}, id={{id}}' -Values @{ name = 'world'; id = 42 }
            $out | Should -Be 'hello world, id=42'
        }
    }

    It 'Handles whitespace within braces: {{ name }}' {
        InModuleScope AITriad {
            $out = Convert-UsageTemplate -Template 'hi {{ name }}' -Values @{ name = 'x' }
            $out | Should -Be 'hi x'
        }
    }

    It 'Returns empty string for empty template' {
        InModuleScope AITriad {
            (Convert-UsageTemplate -Template '' -Values @{}) | Should -Be ''
        }
    }

    It 'Throws ActionableError on missing placeholder' {
        InModuleScope AITriad {
            { Convert-UsageTemplate -Template 'hi {{name}} — {{email}}' -Values @{ name = 'x' } } |
                Should -Throw -ExpectedMessage '*Missing template value*email*'
        }
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# Invoke-AIByUsage
# ─────────────────────────────────────────────────────────────────────────────
Describe 'Invoke-AIByUsage (t/1261)' -Tag 'enrichment' {

    It 'Is exported from the AITriad module' {
        Get-Command Invoke-AIByUsage -Module AITriad -ErrorAction Stop | Should -Not -BeNullOrEmpty
    }

    It 'Resolves config, renders template, and forwards to Invoke-AIApi with the expected splat' {
        InModuleScope AITriad {
            $script:capturedPrompt = $null
            $script:capturedModel = $null
            $script:capturedTemperature = $null
            $script:capturedMaxTokens = $null
            $script:capturedJsonMode = $null
            $script:capturedSystemInstruction = $null
            Mock Invoke-AIApi {
                $script:capturedPrompt      = $Prompt
                $script:capturedModel       = $Model
                $script:capturedTemperature = $Temperature
                $script:capturedMaxTokens   = $MaxTokens
                $script:capturedJsonMode    = $JsonMode.IsPresent
                $script:capturedSystemInstruction = if ($PSBoundParameters.ContainsKey('SystemInstruction')) { $SystemInstruction } else { $null }
                return [PSCustomObject]@{ Text = 'ok'; Backend = 'stub'; Model = $Model }
            }
            $r = Invoke-AIByUsage -UsageId 'enrichment.metadata-extraction' `
                -Values @{ prompt = 'BODY' } `
                -Override @{
                    messageTemplate = '{{prompt}}'
                    systemMessage   = ''
                    model           = 'gemini-3.1-flash-lite'
                    maxTokens       = 1024
                    temperature     = 0.1
                    jsonMode        = $true
                }
            $r.Text | Should -Be 'ok'
            $script:capturedPrompt      | Should -Be 'BODY'
            $script:capturedModel       | Should -Be 'gemini-3.1-flash-lite'
            $script:capturedTemperature | Should -Be 0.1
            $script:capturedMaxTokens   | Should -Be 1024
            $script:capturedJsonMode    | Should -Be $true
            $script:capturedSystemInstruction | Should -BeNullOrEmpty
        }
    }

    It '-Override merges into resolved config (temperature bump)' {
        InModuleScope AITriad {
            $script:capturedTemp = $null
            Mock Invoke-AIApi {
                $script:capturedTemp = $Temperature
                return [PSCustomObject]@{ Text = 'ok'; Backend = 'stub'; Model = $Model }
            }
            Invoke-AIByUsage -UsageId 'enrichment.metadata-extraction' `
                -Values @{ prompt = 'BODY' } `
                -Override @{
                    messageTemplate = '{{prompt}}'
                    systemMessage   = ''
                    temperature     = 0.7
                } | Out-Null
            $script:capturedTemp | Should -Be 0.7
        }
    }

    It 'Throws ActionableError on unknown UsageID' {
        InModuleScope AITriad {
            Mock Invoke-AIApi { throw 'should not be called' }
            { Invoke-AIByUsage -UsageId 'not.real' -Values @{} } |
                Should -Throw -ExpectedMessage '*not found*'
        }
    }

    It 'Throws ActionableError when template produces empty user message' {
        InModuleScope AITriad {
            Mock Invoke-AIApi { throw 'should not be called' }
            { Invoke-AIByUsage -UsageId 'enrichment.metadata-extraction' `
                -Values @{ prompt = '' } `
                -Override @{ messageTemplate = '{{prompt}}'; systemMessage = '' } } |
                Should -Throw -ExpectedMessage '*empty user message*'
        }
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# Migration shadow-parity tests — resolved params match legacy hard-coded values
# ─────────────────────────────────────────────────────────────────────────────
Describe 'Migration parity: metadata-extraction call site (t/1261 AC#7)' -Tag 'enrichment' {

    It 'metadata-extraction override splat matches the pre-migration Invoke-AIApi params' {
        InModuleScope AITriad {
            $script:captured = $null
            Mock Invoke-AIApi {
                $script:captured = @{
                    Prompt      = $Prompt
                    Model       = $Model
                    Temperature = $Temperature
                    MaxTokens   = $MaxTokens
                    JsonMode    = $JsonMode.IsPresent
                }
                return [PSCustomObject]@{ Text = '{}'; Backend = 'stub'; Model = $Model }
            }
            $legacyPrompt = "STATIC PROMPT`n`nSOURCE URL: https://x`nFALLBACK TITLE: T`n`nDOCUMENT EXCERPT:`nBody"
            Invoke-AIByUsage -UsageId 'enrichment.metadata-extraction' `
                -Values @{ prompt = $legacyPrompt } `
                -Override @{
                    messageTemplate = '{{prompt}}'
                    systemMessage   = ''
                    model           = 'gemini-2.5-flash-lite'
                    maxTokens       = 1024
                    temperature     = 0.1
                    jsonMode        = $true
                } | Out-Null

            # Byte-identical prompt reaches Invoke-AIApi
            $script:captured.Prompt      | Should -Be $legacyPrompt
            $script:captured.Model       | Should -Be 'gemini-2.5-flash-lite'
            $script:captured.Temperature | Should -Be 0.1
            $script:captured.MaxTokens   | Should -Be 1024
            $script:captured.JsonMode    | Should -Be $true
        }
    }
}

Describe 'Migration parity: edge-discovery.classify call site (t/1261 AC#7)' -Tag 'enrichment' {

    It 'classify rendering matches the legacy inline heredoc byte-for-byte' {
        InModuleScope AITriad {
            $script:captured = $null
            Mock Invoke-AIApi {
                $script:captured = @{
                    Prompt = $Prompt
                    Model = $Model
                    Temperature = $Temperature
                    MaxTokens = $MaxTokens
                    TimeoutSec = $TimeoutSec
                }
                return [PSCustomObject]@{ Text = '{"edges":[]}'; Backend = 'stub'; Model = $Model }
            }

            $EdgeTypeList = "SUPPORTS: A supports B`nCONTRADICTS: A contradicts B"
            $PairLines    = "1) acc-b-001 <-> saf-b-001`n2) acc-b-002 <-> saf-b-002"

            $legacyPrompt = @"
Classify the relationship between each pair of taxonomy nodes below. These pairs have high semantic similarity and likely have a meaningful relationship.

EDGE TYPES:
$EdgeTypeList

PAIRS TO CLASSIFY:
$PairLines

For each pair, determine:
1. The edge type (from the list above, or "NONE" if no meaningful relationship)
2. Direction: which node is source and which is target
3. Confidence (0.0-1.0)
4. Weight (0.0-1.0): strength of the relationship
5. Brief rationale

Return JSON: {"edges": [{"source": "id", "target": "id", "type": "TYPE", "confidence": 0.8, "weight": 0.7, "rationale": "..."}]}
Omit pairs with no relationship. No markdown fences.
"@

            Invoke-AIByUsage -UsageId 'enrichment.edge-discovery.classify' `
                -Values @{ edge_type_list = $EdgeTypeList; pair_lines = $PairLines } `
                -Override @{ model = 'gemini-2.5-flash'; temperature = 0.1 } | Out-Null

            # t/1287: normalize line endings before byte-for-byte comparison —
            # heredocs in this file get CRLF on Windows checkout but the rendered
            # template comes from JSON (LF), so the intent is content-parity, not EOL bytes.
            ($script:captured.Prompt -replace "`r`n", "`n") | Should -Be ($legacyPrompt -replace "`r`n", "`n")
            $script:captured.Model       | Should -Be 'gemini-2.5-flash'
            $script:captured.Temperature | Should -Be 0.1
            $script:captured.MaxTokens   | Should -Be 16384
            $script:captured.TimeoutSec  | Should -Be 120
        }
    }
}

Describe 'Migration parity: edge-discovery.screen call site (t/1261 AC#7)' -Tag 'enrichment' {

    It 'screen rendering matches the legacy screen prompt composition' {
        InModuleScope AITriad {
            $script:captured = $null
            Mock Invoke-AIApi {
                $script:captured = @{
                    Prompt         = $Prompt
                    Model          = $Model
                    Temperature    = $Temperature
                    MaxTokens      = $MaxTokens
                    TimeoutSec     = $TimeoutSec
                    JsonModeOn     = $JsonMode.IsPresent
                    HasSchema      = ($null -ne $ResponseSchema)
                }
                return [PSCustomObject]@{ Text = '{"related_ids":[]}'; Backend = 'stub'; Model = $Model }
            }
            $ScreenPrompt      = 'Filter the candidates below by semantic relevance to the source node.'
            $ScreenSourceJson  = '{"id":"acc-b-001","label":"Belief A"}'
            $ScreenCandJson    = '[{"id":"saf-b-001"},{"id":"saf-b-002"}]'
            $ScreenSchema      = @{
                type = 'object'
                properties = @{
                    related_ids = @{ type = 'array'; items = @{ type = 'string' } }
                }
                required = @('related_ids')
            }

            $legacyPrompt = @"
$ScreenPrompt

--- SOURCE NODE ---
$ScreenSourceJson

--- CANDIDATES ---
$ScreenCandJson
"@

            Invoke-AIByUsage -UsageId 'enrichment.edge-discovery.screen' `
                -Values @{
                    screen_prompt   = $ScreenPrompt
                    source_json     = $ScreenSourceJson
                    candidates_json = $ScreenCandJson
                } `
                -Override @{ model = 'gemini-3.1-flash-lite'; responseSchema = $ScreenSchema } | Out-Null

            # t/1287: line-ending-insensitive comparison (see classify test above).
            ($script:captured.Prompt -replace "`r`n", "`n") | Should -Be ($legacyPrompt -replace "`r`n", "`n")
            $script:captured.Model       | Should -Be 'gemini-3.1-flash-lite'
            $script:captured.Temperature | Should -Be 0.1
            $script:captured.MaxTokens   | Should -Be 4096
            $script:captured.TimeoutSec  | Should -Be 30
            $script:captured.JsonModeOn  | Should -Be $true
            $script:captured.HasSchema   | Should -Be $true
        }
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# Manifest exports
# ─────────────────────────────────────────────────────────────────────────────
Describe 'Invoke-AIByUsage - manifest export (t/1261)' -Tag 'enrichment' {
    It 'AITriad.psd1 FunctionsToExport includes Invoke-AIByUsage' {
        $manifestPath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psd1'
        $manifest = Test-ModuleManifest -Path $manifestPath
        $manifest.ExportedFunctions.Keys | Should -Contain 'Invoke-AIByUsage'
    }
}
