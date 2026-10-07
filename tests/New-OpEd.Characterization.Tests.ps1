# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Characterization tests for New-OpEd (t/3910), written BEFORE its complexity refactor and required
    to pass unchanged after it.
.DESCRIPTION
    Each scenario runs New-OpEd end to end against mocks and compares a full transcript to a golden in
    tests/fixtures/new-oped/<scenario>.json:
      - every Invoke-AIApi call (kind, prompt, system instruction, model, temperature, max tokens,
        JSON mode, response schema), every retrieval call and every URL fetch, in order;
      - every warning and verbose message;
      - the thrown error's message (rendered Goal:/Error:/Location:/Resolve: labels), if any;
      - the returned object, the SourcePrep's SourceBrief after the call, and the -OutputPath file's
        exact contents (plus the count of files written).
    The goldens are hermetic: Get-Prompt, the Soul-document read and Get-OpEdOutletsData are mocked
    with fixtures here, so edits to the real prompts, soul docs or outlets.json cannot move them.
    Newlines are normalized to LF (ConvertTo-Json emits the platform newline; CI runs on Linux) and
    the repo root / output path are masked.
    New-OpEd has no -WhatIf (no SupportsShouldProcess), so there is no -WhatIf arm.
    Known pre-existing bugs pinned as-is: t/4069.
    Regenerate the goldens ONLY on pre-refactor code: set $env:OPED_REGEN_GOLDEN = '1' and run once.
#>

# Scenario table. Defined at discovery time because It -ForEach is evaluated before BeforeAll runs.
# Responses: per AI-call kind (brief | essay | edit | reflection), a queue of replies. A reply is the
# response text, $null (Invoke-AIApi returns $null), or 'THROW:<message>'.
$script:Bodies = @{
    Orig      = "Frontier laboratories keep shipping larger systems while regulators wait for evidence that only arrives after the damage is done and the public is left to absorb the costs of a gamble it never agreed to take on behalf of companies that profit from speed.`n`nWe should require independent audits before release."
    Good      = "Labs ship big new models each year. The tests come too late. By then the harm is done. The public pays the cost.`n`nWe can fix this. Each lab should test its model first. A third party should check the work. The law can set the bar."
    Worse     = "Institutional accountability necessitates comprehensive evaluation methodologies, independent verification infrastructure, and transparent documentation obligations for organizations deploying increasingly capable computational systems across consequential societal domains.`n`nRegulatory authorities possess insufficient investigatory capacity and inadequate technical expertise."
    Better    = "Labs ship big new models each year and the tests come too late, so the harm is done.`n`nThe public pays. We can fix this if each lab tests its model and a third party checks the work first."
    LongPara  = "Labs ship big new models each year. The tests come too late. By then the harm is done. The public pays the cost. We can fix this. Each lab should test its model first. A third party should check the work. The law can set the bar. Then we can all trust the tools we use."
    StillMiss = "We need one rule that says each lab must test the new model and show the test to a judge who is not on its pay roll.`n`nThat is all. It is not hard. We can do it this year."
    Short     = 'Audit the labs now.'
}
function script:EssayJson([string]$Body, [switch]$Minimal, [string]$Headline = 'Audit Before You Ship', [string]$Subtitle = 'Waiting for harm is not a policy') {
    if ($Minimal) { return (@{ headline = $Headline; body_markdown = $Body } | ConvertTo-Json -Compress) }
    [ordered]@{ headline = $Headline; subtitle = $Subtitle; body_markdown = $Body; word_count = 999; stance = 'rebut' } | ConvertTo-Json -Compress
}
function script:EditJson([string]$Body) { [ordered]@{ body_markdown = $Body; changed = $true; edit_notes = 'tightened' } | ConvertTo-Json -Compress }
$script:ReflPartial = [ordered]@{ grounding_usage = @(
        [ordered]@{ id = 'saf-beliefs-001'; reflection = 'Anchors the thesis | in paragraph two.' }
        [ordered]@{ id = 'sit-012'; reflection = 'Opens the lede.' }
    ) } | ConvertTo-Json -Depth 5 -Compress
$script:BriefFull = [ordered]@{
    author = 'Jane Roe'; actor_type = 'think tank'; thesis = 'Audits slow innovation.'; stance = 'oppose audits'
    primary_recommendations = @('voluntary codes', 'sandbox pilots'); key_claims = @('Audits cost millions.', 'Most harms are speculative.')
    readable = 'true'
} | ConvertTo-Json -Compress
$script:LongError = 'edit backend exploded: ' + ('x' * 150)

$script:Scenarios = @(
    @{ Name = 'topic-grounded-file'; Nodes = 'Mixed'; OutputPath = $true
       Params = @{ Topic = 'Pre-deployment audits'; Pov = 'saf'; Outlet = 'WashingtonPost'; NewsHook = 'the Senate vote next week'; Thesis = 'Audits now'; AuthorBio = 'a policy fellow' }
       Responses = @{ essay = @((EssayJson $script:Bodies.Orig)); reflection = @($script:ReflPartial) } }
    @{ Name = 'voiceonly-minimal-json'
       Params = @{ Topic = 'Open weights'; Pov = 'skeptic'; Outlet = 'WashingtonPost'; VoiceOnly = $true; WordCount = 500; Model = 'gemini-3.1-pro-preview'; Temperature = 0.5 }
       Responses = @{ essay = @((EssayJson $script:Bodies.Orig -Minimal)) } }
    @{ Name = 'nonjson-response'
       Params = @{ Topic = 'x'; Pov = 'acc'; Outlet = 'WashingtonPost'; VoiceOnly = $true }
       Responses = @{ essay = @('Just some prose, not JSON.') } }
    @{ Name = 'empty-response'
       Params = @{ Topic = 'x'; Pov = 'skp'; Outlet = 'WashingtonPost'; VoiceOnly = $true }
       Responses = @{ essay = @('') } }
    @{ Name = 'null-result'
       Params = @{ Topic = 'x'; Pov = 'skp'; Outlet = 'WashingtonPost'; VoiceOnly = $true }
       Responses = @{ essay = @($null) } }
    @{ Name = 'soul-missing'; Soul = 'missing'
       Params = @{ Topic = 'x'; Pov = 'skeptic'; Outlet = 'WashingtonPost'; VoiceOnly = $true }
       Responses = @{} }
    @{ Name = 'soul-invalid-json'; Soul = 'invalid'
       Params = @{ Topic = 'x'; Pov = 'skeptic'; Outlet = 'WashingtonPost'; VoiceOnly = $true }
       Responses = @{} }
    @{ Name = 'outlet-vanished'; Outlets = 'NoWashingtonPost'
       Params = @{ Topic = 'x'; Pov = 'skeptic'; Outlet = 'WashingtonPost'; VoiceOnly = $true }
       Responses = @{} }
    @{ Name = 'default-outlet-strict-good-edit'; Nodes = 'Mixed'; OutputPath = $true
       Params = @{ Topic = 'Audits'; Pov = 'safetyist' }
       Responses = @{ essay = @((EssayJson $script:Bodies.Orig)); edit = @((EditJson $script:Bodies.Good)); reflection = @($script:ReflPartial) } }
    @{ Name = 'grounding-throws'; Nodes = 'Throw'
       Params = @{ Topic = 'x'; Pov = 'safetyist'; Outlet = 'WashingtonPost' }
       Responses = @{ essay = @((EssayJson $script:Bodies.Orig)) } }
    @{ Name = 'grounding-empty'; Nodes = 'Empty'
       Params = @{ Topic = 'x'; Pov = 'safetyist'; Outlet = 'WashingtonPost'; MaxGroundingNodes = 2; MaxSituations = 1 }
       Responses = @{ essay = @((EssayJson $script:Bodies.Orig)) } }
    @{ Name = 'url-bdi-only-brief'; Nodes = 'Mixed'; UrlPrep = $true
       Params = @{ Url = 'https://example.com/article'; Pov = 'safetyist'; Outlet = 'WashingtonPost'; MaxSituations = 0; MaxGroundingNodes = 1 }
       Responses = @{ brief = @($script:BriefFull); essay = @((EssayJson $script:Bodies.Orig)); reflection = @('{"grounding_usage":[]}') } }
    @{ Name = 'situations-only'; Nodes = 'Mixed'
       Params = @{ Topic = 'x'; Pov = 'safetyist'; Outlet = 'WashingtonPost'; MaxGroundingNodes = 0; MaxSituations = 2 }
       Responses = @{ essay = @((EssayJson $script:Bodies.Orig)); reflection = @('{}') } }
    @{ Name = 'prep-with-brief'; Prep = 'WithBrief'
       Params = @{ Topic = 'Steer the angle'; Pov = 'skeptic'; Outlet = 'WashingtonPost'; VoiceOnly = $true }
       Responses = @{ essay = @((EssayJson $script:Bodies.Orig)) } }
    @{ Name = 'prep-brief-throws'; Prep = 'NullBrief'
       Params = @{ Pov = 'skeptic'; Outlet = 'WashingtonPost'; VoiceOnly = $true }
       Responses = @{ brief = @('THROW:brief backend down'); essay = @((EssayJson $script:Bodies.Orig)) } }
    @{ Name = 'prep-brief-empty'; Prep = 'NullBrief'
       Params = @{ Pov = 'skeptic'; Outlet = 'WashingtonPost'; VoiceOnly = $true }
       Responses = @{ brief = @(''); essay = @((EssayJson $script:Bodies.Orig)) } }
    @{ Name = 'prep-brief-ok'; Prep = 'NullBrief'
       Params = @{ Pov = 'skeptic'; Outlet = 'WashingtonPost'; VoiceOnly = $true }
       Responses = @{ brief = @($script:BriefFull); essay = @((EssayJson $script:Bodies.Orig)) } }
    @{ Name = 'prep-no-sourcebrief-property'; Prep = 'NoBriefProp'
       Params = @{ Pov = 'skeptic'; Outlet = 'WashingtonPost'; VoiceOnly = $true }
       Responses = @{ brief = @($script:BriefFull); essay = @((EssayJson $script:Bodies.Orig)) } }
    @{ Name = 'prep-blank-markdown'; Prep = 'Blank'
       Params = @{ Pov = 'skeptic'; Outlet = 'WashingtonPost'; VoiceOnly = $true }
       Responses = @{ essay = @((EssayJson $script:Bodies.Orig)) } }
    @{ Name = 'edit-null'
       Params = @{ Topic = 'x'; Pov = 'safetyist'; VoiceOnly = $true }
       Responses = @{ essay = @((EssayJson $script:Bodies.Orig)); edit = @('') } }
    @{ Name = 'edit-collapse'
       Params = @{ Topic = 'x'; Pov = 'safetyist'; VoiceOnly = $true }
       Responses = @{ essay = @((EssayJson $script:Bodies.Orig)); edit = @((EditJson $script:Bodies.Short)) } }
    @{ Name = 'edit-banned-tells'
       Params = @{ Topic = 'x'; Pov = 'safetyist'; VoiceOnly = $true }
       Responses = @{ essay = @((EssayJson $script:Bodies.Orig)); edit = @((EditJson ('Moreover, ' + $script:Bodies.Good))) } }
    @{ Name = 'edit-throws'
       Params = @{ Topic = 'x'; Pov = 'safetyist'; VoiceOnly = $true }
       Responses = @{ essay = @((EssayJson $script:Bodies.Orig)); edit = @("THROW:$script:LongError") } }
    @{ Name = 'edit-retry-chosen'
       Params = @{ Topic = 'x'; Pov = 'safetyist'; VoiceOnly = $true }
       Responses = @{ essay = @((EssayJson $script:Bodies.Orig)); edit = @((EditJson $script:Bodies.Worse), (EditJson $script:Bodies.Better)) } }
    @{ Name = 'edit-retry-tells'
       Params = @{ Topic = 'x'; Pov = 'safetyist'; VoiceOnly = $true }
       Responses = @{ essay = @((EssayJson $script:Bodies.Orig)); edit = @((EditJson $script:Bodies.Worse), (EditJson ('Furthermore, ' + $script:Bodies.Better))) } }
    @{ Name = 'edit-retry-throws'
       Params = @{ Topic = 'x'; Pov = 'safetyist'; VoiceOnly = $true }
       Responses = @{ essay = @((EssayJson $script:Bodies.Orig)); edit = @((EditJson $script:Bodies.Worse), 'THROW:retry down') } }
    @{ Name = 'edit-retry-null'
       Params = @{ Topic = 'x'; Pov = 'safetyist'; VoiceOnly = $true }
       Responses = @{ essay = @((EssayJson $script:Bodies.Orig)); edit = @((EditJson $script:Bodies.Worse), '') } }
    @{ Name = 'edit-para-split'
       Params = @{ Topic = 'x'; Pov = 'safetyist'; VoiceOnly = $true }
       Responses = @{ essay = @((EssayJson $script:Bodies.Orig)); edit = @((EditJson $script:Bodies.LongPara)) } }
    @{ Name = 'edit-still-misses'
       Params = @{ Topic = 'x'; Pov = 'safetyist'; VoiceOnly = $true }
       Responses = @{ essay = @((EssayJson $script:Bodies.Orig)); edit = @((EditJson $script:Bodies.StillMiss)) } }
    @{ Name = 'edit-readable-no-pass'
       Params = @{ Topic = 'x'; Pov = 'safetyist'; VoiceOnly = $true }
       Responses = @{ essay = @((EssayJson $script:Bodies.Good)) } }
    @{ Name = 'reflection-throws'; Nodes = 'Mixed'
       Params = @{ Topic = 'x'; Pov = 'safetyist'; Outlet = 'WashingtonPost' }
       Responses = @{ essay = @((EssayJson $script:Bodies.Orig)); reflection = @('THROW:reflection down') } }
    @{ Name = 'reflection-empty-text'; Nodes = 'Mixed'
       Params = @{ Topic = 'x'; Pov = 'safetyist'; Outlet = 'WashingtonPost' }
       Responses = @{ essay = @((EssayJson $script:Bodies.Orig)); reflection = @('') } }
    @{ Name = 'reflection-odd-entries'; Nodes = 'Mixed'
       Params = @{ Topic = 'x'; Pov = 'safetyist'; Outlet = 'WashingtonPost' }
       Responses = @{ essay = @((EssayJson $script:Bodies.Orig)); reflection = @('{"grounding_usage":[null,{"reflection":"no id"},{"id":"saf-intentions-004","reflection":"Closes the piece."}]}') } }
    @{ Name = 'empty-body-grounded-file'; Nodes = 'Mixed'; OutputPath = $true
       Params = @{ Topic = 'x'; Pov = 'safetyist'; Outlet = 'WashingtonPost' }
       Responses = @{ essay = @((EssayJson '' -Headline '' -Subtitle '')) } }
    @{ Name = 'no-headline-file'; OutputPath = $true
       Params = @{ Topic = 'x'; Pov = 'safetyist'; Outlet = 'WashingtonPost'; VoiceOnly = $true }
       Responses = @{ essay = @((EssayJson $script:Bodies.Good -Headline '' -Subtitle '')) } }
)

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue
    $script:GoldenDir = Join-Path $PSScriptRoot 'fixtures' 'new-oped'
    $script:RepoRootFull = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\', '/')

    $script:SoulJson = [ordered]@{
        label = 'Fixture Safetyist'; personality = 'a careful, evidence-first fixture voice'
        voice = [ordered]@{
            disposition = 'cautious'; style = 'plain and direct'; reasoning = 'precautionary'; evidence = 'incident reports'
            signature = 'names the irreversible harm'; prose_style = 'PROSE STYLE: short sentences.'; voice_hygiene = 'VOICE HYGIENE: no hedging.'
        }
        value_hierarchy = @('safety', 'accountability'); epistemic_stance = @('uncertainty favors caution')
        anti_patterns = @('doom without a remedy', 'jargon')
    } | ConvertTo-Json -Depth 5

    # Hermetic outlets SSOT: WashingtonPost reads styleDefaults with loose readability (no edit pass);
    # TechPolicyPress (the default) carries its own style and STRICT readability, so the edit pass runs.
    function script:New-OutletsFixture([switch]$NoWashingtonPost) {
        $o = [ordered]@{
            defaultOutlet = 'TechPolicyPress'
            styleDefaults = [ordered]@{
                audience = 'general readers'; readingLevel = 'grade 10'; sentenceMechanics = 'short'; paragraphMechanics = 'brief'
                jargonGuidance = 'none'; bodyFormat = 'prose'; readability = [ordered]@{ fkMax = 99; maxSentWords = 999; maxParaWords = 999 }
            }
            outlets = [ordered]@{
                TechPolicyPress = [ordered]@{
                    words = 1500; guidance = 'TPP guidance'
                    readability = [ordered]@{ fkMax = 8; maxSentWords = 20; maxParaWords = 40 }
                    style = [ordered]@{ audience = 'policy experts'; readingLevel = 'grade 13'; sentenceMechanics = 'disciplined'; paragraphMechanics = 'up to 120'; jargonGuidance = 'precise'; bodyFormat = 'sections' }
                }
                WashingtonPost  = [ordered]@{ words = 800; guidance = 'WaPo guidance' }
            }
        }
        if ($NoWashingtonPost) { $o.outlets.Remove('WashingtonPost') }
        $o | ConvertTo-Json -Depth 6 | ConvertFrom-Json
    }

    function script:Get-MixedNodes {
        @(
            [pscustomobject]@{ Id = 'saf-beliefs-001'; POV = 'safetyist'; Category = 'Beliefs'; Label = 'Irreversibility demands caution'
                Description = ('Some harms cannot be undone and so caution must come first. ' * 6).Trim() + "`nEncompasses: frontier model releases`nExcludes: narrow tools"; Score = 0.71 }
            [pscustomobject]@{ Id = 'saf-intentions-004'; POV = 'safetyist'; Category = 'Intentions'; Label = 'Mandate audits'; Description = 'Independent audits before release.'; Score = 0.66 }
            [pscustomobject]@{ Id = 'acc-beliefs-009'; POV = 'accelerationist'; Category = 'Beliefs'; Label = 'Foreign node'; Description = 'x'; Score = 0.99 }
            [pscustomobject]@{ Id = 'sit-012'; POV = 'situations'; Category = 'Situations'; Label = 'Undetected jailbreak'; Description = ('A model bypasses filters after release. ' * 9).Trim(); Score = 0.58 }
            [pscustomobject]@{ Id = 'sit-020'; POV = 'situations'; Category = 'Situations'; Label = 'Second case'; Description = 'Short.'; Score = 0.40 }
        )
    }

    function script:New-PrepFixture([string]$Kind) {
        $base = [ordered]@{
            Url = 'https://example.com/doc.pdf'; SourceUrl = 'https://example.com/doc.pdf'
            SourceMarkdown = 'Audits will slow innovation and cost millions, the report argues.'
            SourceFormat = 'pdf'; SourceExtractionTool = 'ConvertFrom-Pdf'; ReadableWords = 11; ReadableRatio = 0.9
        }
        switch ($Kind) {
            'WithBrief'   { $base.SourceBrief = [pscustomobject]@{ thesis = 'Audits slow innovation.'; readable = 'true'; author = 'Jane Roe'; primary_recommendations = @('voluntary codes') } }
            'NullBrief'   { $base.SourceBrief = $null }
            'NoBriefProp' { }
            'Blank'       { $base.SourceMarkdown = '   '; $base.SourceBrief = $null }
        }
        [pscustomobject]$base
    }

    # Canonical, order-stable form: hashtable keys sorted (their order is randomized per process),
    # ordered dictionaries and PSCustomObjects kept in their own order, strings masked.
    function script:ConvertTo-Canonical($Obj) {
        if ($null -eq $Obj) { return $null }
        if ($Obj -is [string]) { return (script:Format-Masked $Obj) }
        if ($Obj -is [System.Collections.Specialized.OrderedDictionary]) {
            $o = [ordered]@{}; foreach ($k in $Obj.Keys) { $o[[string]$k] = script:ConvertTo-Canonical $Obj[$k] }; return $o
        }
        if ($Obj -is [System.Collections.IDictionary]) {
            $o = [ordered]@{}; foreach ($k in @($Obj.Keys | Sort-Object)) { $o[[string]$k] = script:ConvertTo-Canonical $Obj[$k] }; return $o
        }
        if ($Obj -is [System.Collections.IEnumerable]) { return , @(foreach ($i in $Obj) { script:ConvertTo-Canonical $i }) }
        if ($Obj -is [pscustomobject]) {
            $o = [ordered]@{}; foreach ($p in $Obj.PSObject.Properties) { $o[$p.Name] = script:ConvertTo-Canonical $p.Value }; return $o
        }
        return $Obj
    }
    function script:Format-Masked([string]$s) {
        $r = $s
        if ($script:OutPathCurrent) { $r = $r.Replace($script:OutPathCurrent, '<OUT>') }
        foreach ($root in @($script:RepoRootFull, $script:RepoRootFull.Replace('\', '/'))) { $r = $r.Replace($root, '<REPO>') }
        if ($r.Contains('<REPO>')) { $r = $r.Replace('\', '/') }
        $r
    }
    function script:Get-CallKind($Schema) {
        $props = $Schema.properties
        if ($props.ContainsKey('headline'))        { return 'essay' }
        if ($props.ContainsKey('changed'))         { return 'edit' }
        if ($props.ContainsKey('grounding_usage')) { return 'reflection' }
        if ($props.ContainsKey('thesis'))          { return 'brief' }
        'unknown'
    }

    function script:Invoke-Scenario($S) {
        $script:Calls = [System.Collections.Generic.List[object]]::new()
        $script:Queues = @{}
        foreach ($k in $S.Responses.Keys) { $script:Queues[$k] = [System.Collections.Generic.Queue[object]]::new([object[]]@($S.Responses[$k])) }
        $script:OutPathCurrent = $null

        # 'NoWashingtonPost' drops the outlet only for the read inside New-OpEd's body, so the -Outlet
        # ValidateSet (which reads the same SSOT at binding, before New-OpEd is on the stack) still passes
        # and the body's "SSOT changed between binding and this read" refusal is the branch exercised.
        Mock Get-OpEdOutletsData -ModuleName AITriad {
            $inBody = @(Get-PSCallStack | Where-Object FunctionName -eq 'New-OpEd').Count -gt 0
            script:New-OutletsFixture -NoWashingtonPost:($script:CurrentOutlets -eq 'NoWashingtonPost' -and $inBody)
        }
        Mock Get-Prompt -ModuleName AITriad {
            $dir = ([string]$PromptsDir).Replace('\', '/').TrimEnd('/')
            $leaf = ($dir -split '/')[-2..-1] -join '/'
            $lines = foreach ($k in @($Replacements.Keys | Sort-Object)) { "{{$k}}=$($Replacements[$k])" }
            "<<$Name @ $leaf>>`n" + ($lines -join "`n")
        }
        Mock Get-Content -ModuleName AITriad { [System.IO.File]::ReadAllText([string]@($LiteralPath + $Path)[0]) }
        Mock Get-Content -ModuleName AITriad -ParameterFilter { "$Path" -like '*.soul.json' } {
            if ($script:CurrentSoul -eq 'invalid') { '{ not json' } else { $script:SoulJson }
        }
        if ($S['Soul'] -eq 'missing') {
            Mock Test-Path -ModuleName AITriad { [System.IO.File]::Exists([string]$Path) -or [System.IO.Directory]::Exists([string]$Path) }
            Mock Test-Path -ModuleName AITriad -ParameterFilter { "$Path" -like '*.soul.json' } { $false }
        }
        Mock Get-RelevantTaxonomyNodes -ModuleName AITriad {
            $script:Calls.Add([ordered]@{ call = 'retrieval'; query = $Query; pov = @($POV); includeSituations = [bool]$IncludeSituations; maxTotal = $MaxTotal; minPerCategory = $MinPerCategory })
            switch ($script:CurrentNodes) {
                'Throw' { throw 'embeddings.json not found' }
                'Empty' { @() }
                default { script:Get-MixedNodes }
            }
        }
        Mock Get-OpEdSourceFromUrl -ModuleName AITriad {
            $script:Calls.Add([ordered]@{ call = 'fetch'; url = $Url })
            script:New-PrepFixture 'NullBrief'
        }
        Mock Invoke-AIApi -ModuleName AITriad {
            $kind = script:Get-CallKind $ResponseSchema
            $script:Calls.Add([ordered]@{
                    call = 'ai'; kind = $kind; prompt = $Prompt; system = $SystemInstruction; model = $Model
                    temperature = $Temperature; maxTokens = $MaxTokens; jsonMode = [bool]$JsonMode; schema = $ResponseSchema
                })
            $reply = $script:Queues[$kind].Dequeue()
            if ($reply -is [string] -and $reply.StartsWith('THROW:')) { throw $reply.Substring(6) }
            if ($null -eq $reply) { return $null }
            [pscustomobject]@{ Text = $reply; Backend = 'gemini' }
        }

        $script:CurrentSoul    = $S['Soul']
        $script:CurrentNodes   = $S['Nodes']
        $script:CurrentOutlets = $S['Outlets']

        $p = @{} + $S.Params
        $prep = $null
        if ($S['Prep']) { $prep = script:New-PrepFixture $S.Prep; $p.SourcePrep = $prep }
        $outDir = $null
        if ($S['OutputPath']) {
            $outDir = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
            New-Item -ItemType Directory -Path $outDir -Force | Out-Null
            $p.OutputPath = Join-Path $outDir 'oped.md'
            $script:OutPathCurrent = $p.OutputPath
        }

        $records = [System.Collections.Generic.List[object]]::new()
        $err = $null
        $w = $null
        try {
            New-OpEd @p -Verbose -WarningVariable w -WarningAction SilentlyContinue 4>&1 | ForEach-Object { $records.Add($_) }
        } catch {
            $err = $_.Exception.Message
        }
        $verbose = @($records | Where-Object { $_ -is [System.Management.Automation.VerboseRecord] } | ForEach-Object { $_.Message })
        $output  = @($records | Where-Object { $_ -isnot [System.Management.Automation.VerboseRecord] })

        $file = $null; $fileCount = 0
        if ($outDir) {
            $fileCount = @(Get-ChildItem -LiteralPath $outDir -File).Count
            if (Test-Path -LiteralPath $p.OutputPath) { $file = [System.IO.File]::ReadAllText($p.OutputPath) }
        }
        $t = [ordered]@{
            scenario    = $S.Name
            calls       = $script:Calls.ToArray()
            warnings    = @($w | ForEach-Object { [string]$_ })
            verbose     = $verbose
            error       = $err
            output      = if ($output.Count -eq 1) { $output[0] } else { $output }
            prepBriefAfter = if ($prep -and $prep.PSObject.Properties['SourceBrief']) { $prep.SourceBrief } else { '(no SourceBrief property)' }
            fileCount   = $fileCount
            file        = $file
        }
        ((script:ConvertTo-Canonical $t) | ConvertTo-Json -Depth 30) -replace "`r`n", "`n"
    }
}

Describe 'New-OpEd characterization (t/3910)' -Tag 'oped' {

    It 'matches the golden transcript: <Name>' -ForEach $script:Scenarios {
        $actual = script:Invoke-Scenario $_
        $golden = Join-Path $script:GoldenDir "$($_.Name).json"
        if ($env:OPED_REGEN_GOLDEN -eq '1') {
            New-Item -ItemType Directory -Path $script:GoldenDir -Force | Out-Null
            [System.IO.File]::WriteAllText($golden, $actual + "`n", [System.Text.UTF8Encoding]::new($false))
        }
        $expected = ([System.IO.File]::ReadAllText($golden) -replace "`r`n", "`n").TrimEnd("`n")
        $actual | Should -BeExactly $expected
    }

    # Branch witnesses: each golden is only as good as the branch it actually exercised, so pin the
    # discriminating fact per scenario independently of the golden text.
    It 'exercises the intended branch: <Name>' -ForEach @(
        @{ Name = 'edit-null';           Warn = 'word-count collapse' }
        @{ Name = 'edit-collapse';       Warn = 'word-count collapse' }
        @{ Name = 'edit-banned-tells';   Warn = 'introduced banned tells \[moreover\]' }
        @{ Name = 'edit-throws';         Warn = 'edit pass failed' }
        @{ Name = 'edit-still-misses';   Warn = 'still misses target: max_sent_words=27' }
        @{ Name = 'edit-retry-tells';    Warn = 'still misses target' }
        @{ Name = 'grounding-throws';    Warn = 'Taxonomy grounding unavailable' }
        @{ Name = 'nonjson-response';    Warn = 'was not valid JSON' }
        @{ Name = 'prep-brief-throws';   Warn = 'Source comprehension pass skipped' }
        @{ Name = 'reflection-throws';   Warn = 'Grounding-reflection pass failed' }
    ) {
        $g = [System.IO.File]::ReadAllText((Join-Path $script:GoldenDir "$Name.json")) | ConvertFrom-Json
        ($g.warnings -join "`n") | Should -Match $Warn
    }

    # $script:Bodies is a discovery-time variable, so it reaches these run-time blocks through -ForEach.
    It 'edit retry: the retry candidate is chosen only when it is clean and no worse' -ForEach @(@{ B = $script:Bodies }) {
        $chosen = [System.IO.File]::ReadAllText((Join-Path $script:GoldenDir 'edit-retry-chosen.json')) | ConvertFrom-Json
        @($chosen.calls | Where-Object kind -eq 'edit').Count | Should -Be 2
        $chosen.output.Body | Should -BeExactly $B.Better
        $kept = [System.IO.File]::ReadAllText((Join-Path $script:GoldenDir 'edit-retry-throws.json')) | ConvertFrom-Json
        $kept.output.Body | Should -BeExactly $B.Worse
    }

    It 'edit para-split backstop splits the long paragraph and the edit counts as clean' -ForEach @(@{ B = $script:Bodies }) {
        $g = [System.IO.File]::ReadAllText((Join-Path $script:GoldenDir 'edit-para-split.json')) | ConvertFrom-Json
        $g.output.Body | Should -Not -BeExactly $B.LongPara
        @($g.warnings).Count | Should -Be 0
        $g.output.EditingMeta.edited | Should -BeTrue
    }

    It 'pins current behaviour: the -OutputPath file carries the PRE-edit body, not the returned edited Body' -ForEach @(@{ B = $script:Bodies }) {
        $g = [System.IO.File]::ReadAllText((Join-Path $script:GoldenDir 'default-outlet-strict-good-edit.json')) | ConvertFrom-Json
        $g.output.Body | Should -BeExactly $B.Good
        $g.file | Should -Match ([regex]::Escape($B.Orig.Split("`n")[0]))
        $g.fileCount | Should -Be 1
    }
}
