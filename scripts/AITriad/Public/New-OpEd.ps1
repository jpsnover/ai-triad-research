# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function New-OpEd {
    <#
    .SYNOPSIS
        Generates a publication-ready op-ed (guest essay) on a topic or URL,
        written in the authentic voice of one of the AI Triad POV camps.
    .DESCRIPTION
        New-OpEd assembles a system prompt from two sources — the OpEd Project /
        Harvard Kennedy School structural blueprint (lede + news hook, early
        thesis, two-to-three evidence pillars, a "To Be Sure" counterargument,
        and a solution that names specific actors) and the camp's Soul document
        (disposition, rhetorical style, signature move, prose-style and
        voice-hygiene rules, value hierarchy, epistemic stance, and
        anti-patterns) — then asks the model to draft the essay in that voice.

        The subject can be supplied as free text (-Topic) or fetched from a URL
        (-Url), which is converted to Markdown and passed as source material. The
        target length is derived from the chosen -Outlet's editorial limits (or
        set explicitly with -WordCount). Optionally writes a Markdown file
        (-OutputPath).

        The substance is grounded (by default) in the project taxonomy: the POV's
        most topic-relevant BDI nodes (its actual beliefs / desires / intentions)
        and situation-library stress cases are retrieved via the same embedding
        relevance the debate engine uses (Get-RelevantTaxonomyNodes) and injected
        as the positions the essay must argue from — so the op-ed reflects THIS
        project's registered camp, not the model's generic priors. The elements
        used and their relevance scores are returned on the Grounding field, each
        annotated (via a second lightweight AI call that reads the finished essay)
        with a Reflection explaining how and where it is reflected in the draft.
        Pass -VoiceOnly (or set the counts to 0) to write from voice alone; if the
        taxonomy / embeddings / Python are unavailable, retrieval degrades to
        voice-only with a warning rather than failing.

        Prompts are production artifacts: the structural rules live in
        Prompts/op-ed-generation-system.prompt and the task contract in
        Prompts/op-ed-generation-user.prompt; the voice block is built from the
        Soul document at lib/debate/soul-docs/<pov>.soul.json.
    .PARAMETER Topic
        The subject or angle for the essay, as free text. Mandatory in the
        default 'FromTopic' parameter set; optional alongside -Url to steer the
        angle of a fetched source.
    .PARAMETER Url
        A web page to use as source material. Fetched and converted to Markdown
        via Get-OpEdSource (with format detection and readability gate), then
        handed to the model as factual grounding. Mandatory in 'FromUrl'.
    .PARAMETER SourcePrep
        A pre-built SourcePrep object from Get-OpEdSource. Use this in the
        multi-POV orchestrated path so the fetch/convert/gate work happens once
        and is reused per voice. Mandatory in 'FromPrep'.
    .PARAMETER Pov
        The camp voice to write in. One of accelerationist, safetyist, skeptic
        (short forms acc / saf / skp accepted). Loads the matching Soul document.
    .PARAMETER Outlet
        Target publication category. Sets the default word-count band and
        audience/tone guidance from real editorial specifications. Overridden by
        an explicit -WordCount.
    .PARAMETER WordCount
        Explicit target length (300-2000 words). Overrides the -Outlet default.
    .PARAMETER NewsHook
        The timely peg (a pending vote, ruling, report, or milestone) that
        justifies publishing now. Strongly recommended — op-eds without a news
        hook are routinely rejected. If omitted, the model constructs a plausible
        hook and the draft should be re-checked against real current events.
    .PARAMETER Thesis
        An explicit stance to argue. If omitted, the model derives a thesis
        consistent with the camp's value hierarchy.
    .PARAMETER AuthorBio
        Author credentials for the authority line / bio (e.g.,
        'a health economist at ...').
    .PARAMETER OutputPath
        If supplied, writes the headline and body to a Markdown file
        at this path (UTF-8, no BOM).
    .PARAMETER Model
        AI model to use. Defaults to gemini-3.7-flash — a deliberate step up from
        the flash-lite enrichment default because long-form persuasive prose needs
        a stronger tier; a GA model is preferred over a preview as a default. For
        maximum polish, pass -Model gemini-3.1-pro-preview.
    .PARAMETER Temperature
        Sampling temperature. Defaults to 0.8 for creative prose.
    .PARAMETER VoiceOnly
        Skip taxonomy grounding and write from the camp voice + general knowledge
        alone. By default the essay is grounded in retrieved BDI nodes and
        situations.
    .PARAMETER MaxGroundingNodes
        Maximum POV BDI nodes to retrieve and inject as registered positions
        (0-40, default 12). 0 disables BDI grounding.
    .PARAMETER MaxSituations
        Maximum situation-library stress cases to retrieve and inject (0-15,
        default 3). 0 disables situation grounding.
    .OUTPUTS
        [PSCustomObject] with Headline, Subtitle, Body, WordCount, Pov,
        Outlet, Model, Backend, Grounding, StanceRelationship, SourceFormat,
        SourceExtractionTool, ReadableWords, ReadableRatio, and SourceUnderstanding.
        Grounding is an array of taxonomy elements injected (Id, Type [bdi|situation],
        POV, Category, Label, RelevanceScore, Reflection). SourceUnderstanding is
        the CL source_brief object (thesis/author/actor_type/stance/
        primary_recommendations/key_claims/readable) or null if no source was supplied.
    .EXAMPLE
        New-OpEd -Topic 'Mandatory pre-deployment audits for frontier AI models' `
            -Pov safetyist -Outlet WashingtonPost `
            -NewsHook 'the Senate AI oversight bill scheduled for a floor vote next week'

        Drafts an 800-word Washington Post-length guest essay in the Safetyist
        voice, grounded in the Safetyist camp's most relevant belief/desire/
        intention nodes and situations.
    .EXAMPLE
        $oped = New-OpEd -Topic 'Open-weight models and biosecurity' -Pov skeptic
        $oped.Grounding | Format-Table Id, Category, RelevanceScore, Reflection

        Inspects which taxonomy nodes and situations grounded the essay, how
        relevant each was, and how/where each is reflected in the draft.
    .EXAMPLE
        New-OpEd -Url 'https://example.com/ai-jobs-report' -Pov accelerationist `
            -Outlet WallStreetJournal -OutputPath ./oped.md

        Fetches the article as source material, writes a WSJ-length essay in the
        Accelerationist voice, and saves it to disk.
    .LINK
        Invoke-AIApi
    .LINK
        Show-TriadDialogue
    #>
    [CmdletBinding(DefaultParameterSetName = 'FromTopic')]
    [OutputType([PSCustomObject])]
    param(
        [Parameter(Mandatory, Position = 0, ParameterSetName = 'FromTopic')]
        [Parameter(Position = 0, ParameterSetName = 'FromUrl')]
        [Parameter(ParameterSetName = 'FromPrep')]
        [ValidateNotNullOrEmpty()]
        [string]$Topic,

        [Parameter(Mandatory, ParameterSetName = 'FromUrl')]
        [ValidateNotNullOrEmpty()]
        [string]$Url,

        [Parameter(Mandatory, ParameterSetName = 'FromPrep')]
        [ValidateNotNullOrEmpty()]
        [PSObject]$SourcePrep,

        [Parameter(Mandatory)]
        [ValidateSet('accelerationist', 'safetyist', 'skeptic', 'acc', 'saf', 'skp')]
        [string]$Pov,

        [ValidateSet('WashingtonPost', 'NYTimes', 'WallStreetJournal', 'USAToday',
            'ForeignAffairs', 'Politico', 'Regional', 'Generic', 'TechPolicyPress')]
        [string]$Outlet = 'TechPolicyPress',

        [ValidateRange(300, 2000)]
        [int]$WordCount,

        [string]$NewsHook = '',

        [string]$Thesis = '',

        [string]$AuthorBio = '',

        [string]$OutputPath,

        [ValidateScript({ Test-AIModelId $_ })]
        [string]$Model = 'gemini-3.7-flash',

        [ValidateRange(0.0, 2.0)]
        [double]$Temperature = 0.8,

        [switch]$VoiceOnly,

        [ValidateRange(0, 40)]
        [int]$MaxGroundingNodes = 12,

        [ValidateRange(0, 15)]
        [int]$MaxSituations = 3
    )

    Set-StrictMode -Version Latest

    # Shared prompt artifacts live in lib/oped/prompts/ (canonical TS-core location, t/2609).
    $OPedPromptsDir = [System.IO.Path]::GetFullPath((Join-Path $script:ModuleRoot '..\..\lib\oped\prompts'))

    # ── Normalize the POV to its canonical Soul-document name ────────────────
    $PovMap = @{
        acc = 'accelerationist'; accelerationist = 'accelerationist'
        saf = 'safetyist';       safetyist       = 'safetyist'
        skp = 'skeptic';         skeptic         = 'skeptic'
    }
    $PovKey = $PovMap[$Pov.ToLowerInvariant()]

    # ── Load the Soul document (lives in the code repo, not the data repo) ───
    # $script:ModuleRoot is scripts/AITriad; soul docs live at
    # <repo-root>/lib/debate/soul-docs/<pov>.soul.json.
    $RepoRoot = Split-Path -Parent (Split-Path -Parent $script:ModuleRoot)
    $SoulPath = Join-Path $RepoRoot (Join-Path 'lib/debate/soul-docs' "$PovKey.soul.json")
    if (-not (Test-Path $SoulPath)) {
        throw (New-ActionableError -PassThru `
            -Goal 'Generate an op-ed in a POV voice' `
            -Problem "Soul document not found for POV '$PovKey': $SoulPath" `
            -Location 'New-OpEd' `
            -NextSteps @(
                "Confirm lib/debate/soul-docs/$PovKey.soul.json exists in the repo",
                'Run from a full checkout; Soul documents ship with the code repo, not the data repo'
            ))
    }
    try {
        $Soul = Get-Content -Path $SoulPath -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        throw (New-ActionableError -PassThru `
            -Goal 'Generate an op-ed in a POV voice' `
            -Problem "Soul document at $SoulPath is not valid JSON: $($_.Exception.Message)" `
            -Location 'New-OpEd' `
            -NextSteps 'Validate the Soul document JSON and retry.')
    }

    # ── Build the voice block from the Soul document ─────────────────────────
    $v = $Soul.voice
    $VoiceLines = [System.Collections.Generic.List[string]]::new()
    $VoiceLines.Add("PERSONALITY: $($Soul.personality)")
    $VoiceLines.Add("DISPOSITION: $($v.disposition)")
    $VoiceLines.Add("RHETORICAL STYLE: $($v.style)")
    $VoiceLines.Add("REASONING MODE: $($v.reasoning)")
    $VoiceLines.Add("PREFERRED EVIDENCE: $($v.evidence)")
    $VoiceLines.Add("SIGNATURE MOVE: $($v.signature)")
    $VoiceLines.Add('')
    $VoiceLines.Add([string]$v.prose_style)
    $VoiceLines.Add('')
    $VoiceLines.Add([string]$v.voice_hygiene)
    $VoiceLines.Add('')
    $VoiceLines.Add('VALUE HIERARCHY (in priority order):')
    $rank = 1
    foreach ($val in @($Soul.value_hierarchy)) { $VoiceLines.Add("  $rank. $val"); $rank++ }
    $VoiceLines.Add('')
    $VoiceLines.Add('EPISTEMIC STANCE:')
    foreach ($e in @($Soul.epistemic_stance)) { $VoiceLines.Add("  - $e") }
    $VoiceLines.Add('')
    $VoiceLines.Add('ANTI-PATTERNS (never do these):')
    foreach ($a in @($Soul.anti_patterns)) { $VoiceLines.Add("  - $a") }
    $VoiceBlock = $VoiceLines -join "`n"

    # ── Resolve the target word count from the outlet band (unless explicit) ─
    $OutletBands = @{
        WashingtonPost    = @{ Words = 800;  Guidance = 'The Washington Post: max 800 words, strong news hook, hyperlink-able sources, zero jargon; national public audience.' }
        NYTimes           = @{ Words = 800;  Guidance = 'The New York Times Guest Essay: ~800 words, sharp thesis, general national readership.' }
        WallStreetJournal = @{ Words = 900;  Guidance = 'The Wall Street Journal: 600-1200 words, rapid thesis, business/policy relevance, market and regulatory framing, zero jargon; executives, investors, policymakers.' }
        USAToday          = @{ Words = 650;  Guidance = 'USA Today: 550-750 words, embed verifiable source references, plain and direct; broad national audience.' }
        ForeignAffairs    = @{ Words = 1200; Guidance = 'Foreign Affairs / policy platform: 800-1500 words, deeper structural analysis permitted; subject specialists, Hill staff, agency officials.' }
        Politico          = @{ Words = 1000; Guidance = 'Politico: ~1000 words, policy-mechanics focus, timely; Hill and agency audience.' }
        Regional          = @{ Words = 650;  Guidance = 'Regional / local daily: 500-800 words, direct regional relevance, local anecdotes, state-level calls to action; municipal voters and state legislators.' }
        Generic           = @{ Words = 800;  Guidance = 'General-interest opinion desk: ~800 words, strong news hook, plain language, broad public audience.' }
        TechPolicyPress   = @{
            Words    = 1500
            Guidance = 'Tech Policy Press (Perspective/Analysis): 1200-2000 words in 3-5 subheaded sections. Analytical and evidence-grounded with a clear argumentative throughline; sophisticated but clear (college-level register, precise policy vocabulary — do NOT dumb down, but keep sentences disciplined). Anchor in a specific, current policy development (named legislation, institution, or event) and draw out the broader governance/democratic stakes — concrete-first, not abstract theory. Sparing first person from a stated vantage; rhetorical questions and concrete hypotheticals used sparingly; cite verifiable sources. Audience: policymakers, technologists, researchers, and informed advocates at the tech-and-democracy intersection.'
            Style    = @{
                Audience          = 'persuade an informed policy audience — policymakers, technologists, researchers, and advocates at the tech-and-democracy intersection'
                ReadingLevel      = 'Write for a college-educated policy audience — Flesch-Kincaid grade ~13 (no higher than 14). Achieve clarity through sentence discipline, NOT by simplifying vocabulary: keep the precise policy and technical terms your expert readers expect.'
                SentenceMechanics = 'average under ~24 words; no sentence over 40 words. Vary length; after a long sentence, a short one.'
                ParagraphMechanics = 'at most ~120 words per paragraph.'
                JargonGuidance    = 'Use the precise policy/technical vocabulary your expert audience expects; define only genuinely obscure terms. Do NOT flatten specialized terms into lay paraphrase.'
                BodyFormat        = 'Organize the body into **3-5 sections with short Markdown `##` subheadings**; each section advances one part of the argument. Do NOT repeat the headline inside the body.'
            }
            Readability = @{ fkMax = 16.0; maxSentWords = 40; maxParaWords = 120 }
        }
    }
    $Band = $OutletBands[$Outlet]
    $TargetWords = if ($PSBoundParameters.ContainsKey('WordCount')) { $WordCount } else { $Band.Words }

    # ── Resolve source material via Get-OpEdSource ───────────────────────────
    # -Url builds a SourcePrep internally (single-voice path); -SourcePrep
    # accepts one from the ElectronMain orchestrator (3-POV path). Both then
    # follow the identical draft path — one implementation, two entry points.
    $Prep = $null
    if ($PSCmdlet.ParameterSetName -eq 'FromPrep') {
        $Prep = $SourcePrep
    } elseif ($PSCmdlet.ParameterSetName -eq 'FromUrl') {
        Write-Verbose "Fetching + converting source material from $Url"
        # Get-OpEdSource is convert-only (t/3307); the CLI's best-effort fetch lives in the localized
        # Private helper Get-OpEdSourceFromUrl (WAF-limited interim, migrates to the shared Node
        # fetch-CLI under t/3312 — one entry point for the migration + any WAF-fetch prevention guard).
        $Prep = Get-OpEdSourceFromUrl -Url $Url -Verbose:($VerbosePreference -ne 'SilentlyContinue')
    }

    $SourceMaterial = '(no external source supplied — argue from the topic and general knowledge)'
    if ($null -ne $Prep) {
        $SourceMaterial = [string]$Prep.SourceMarkdown
        if (-not $PSBoundParameters.ContainsKey('Topic') -or [string]::IsNullOrWhiteSpace($Topic)) {
            $Topic = "Write an op-ed responding to the source material below (from $($Prep.SourceUrl)). Choose the sharpest angle consistent with your camp's convictions."
        }
    }

    # ── Ground the essay in the camp's registered taxonomy ───────────────────
    # Retrieve the POV's most topic-relevant BDI nodes (its actual beliefs /
    # desires / intentions) and situation-library stress cases via the same
    # embedding relevance the debate engine uses, and inject them as the
    # substance the essay must argue from. This is what makes the op-ed reflect
    # THIS project's taxonomy rather than the model's generic priors. Grounded by
    # default; -VoiceOnly (or zeroed counts) skips it. Retrieval failure (data
    # repo / embeddings.json / Python unavailable) degrades to voice-only with a
    # warning rather than failing the whole generation.
    $Grounding = [System.Collections.Generic.List[PSObject]]::new()
    $GroundingNodesText = '(none — argue from your camp voice and general knowledge)'
    $SituationsText     = '(none supplied)'
    if (-not $VoiceOnly -and ($MaxGroundingNodes -gt 0 -or $MaxSituations -gt 0)) {
        # Query = the topic signal, plus the hook/thesis and a slice of any source.
        $QueryParts = @($Topic, $NewsHook, $Thesis) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
        if ($PSCmdlet.ParameterSetName -eq 'FromUrl' -and $SourceMaterial.Length -gt 0) {
            $QueryParts += $SourceMaterial.Substring(0, [Math]::Min(1500, $SourceMaterial.Length))
        }
        $RetrievalQuery = $QueryParts -join '. '

        try {
            $WantSituations = $MaxSituations -gt 0
            $PovArg = if ($WantSituations) { @($PovKey, 'situations') } else { @($PovKey) }
            $Relevant = Get-RelevantTaxonomyNodes -Query $RetrievalQuery -POV $PovArg `
                -IncludeSituations:$WantSituations -MaxTotal 50 -MinPerCategory 2

            $BdiNodes = @($Relevant | Where-Object { $_.POV -eq $PovKey } |
                Sort-Object Score -Descending | Select-Object -First $MaxGroundingNodes)
            $SitNodes = @($Relevant | Where-Object { $_.POV -eq 'situations' } |
                Sort-Object Score -Descending | Select-Object -First $MaxSituations)

            if (@($BdiNodes).Count -gt 0) {
                $sb = [System.Text.StringBuilder]::new()
                foreach ($n in $BdiNodes) {
                    $desc = [string]$n.Description
                    if ($desc.Length -gt 240) { $desc = $desc.Substring(0, 240) + '…' }
                    # Prefix the node id so the model can reference it back in grounding_usage.
                    [void]$sb.AppendLine("- [$($n.Id)] [$($n.Category)] $($n.Label): $desc")
                    $Grounding.Add([PSCustomObject]@{
                        Id = $n.Id; Type = 'bdi'; POV = $n.POV; Category = $n.Category
                        Label = $n.Label; RelevanceScore = $n.Score; Reflection = ''
                    })
                }
                $GroundingNodesText = $sb.ToString().TrimEnd()
            }

            if (@($SitNodes).Count -gt 0) {
                $sb2 = [System.Text.StringBuilder]::new()
                foreach ($s in $SitNodes) {
                    $desc = [string]$s.Description
                    if ($desc.Length -gt 300) { $desc = $desc.Substring(0, 300) + '…' }
                    [void]$sb2.AppendLine("- [$($s.Id)] $($s.Label): $desc")
                    $Grounding.Add([PSCustomObject]@{
                        Id = $s.Id; Type = 'situation'; POV = $s.POV; Category = 'Situation'
                        Label = $s.Label; RelevanceScore = $s.Score; Reflection = ''
                    })
                }
                $SituationsText = $sb2.ToString().TrimEnd()
            }

            Write-Verbose "Grounding: $(@($BdiNodes).Count) BDI nodes + $(@($SitNodes).Count) situations retrieved"
        } catch {
            Write-Warning "Taxonomy grounding unavailable — writing voice-only. ($($_.Exception.Message))"
        }
    }

    # ── Source comprehension pass (best-effort) ───────────────────────────────
    # Populates SOURCE_* prompt placeholders from the CL-owned op-ed-source-brief
    # prompt. If the orchestrator pre-populated SourceBrief on the prep object,
    # use it directly (saves a second AI call). If the prompt file is not yet
    # deployed (CL lands it separately), silently degrades — SOURCE_* will be
    # empty strings, which the prompt treats as "(not supplied)".
    $SBrief = $null
    if ($null -ne $Prep -and -not [string]::IsNullOrWhiteSpace($Prep.SourceMarkdown)) {
        if ($Prep.PSObject.Properties.Name -contains 'SourceBrief' -and $null -ne $Prep.SourceBrief) {
            $SBrief = $Prep.SourceBrief
        } else {
            try {
                $BriefSchema = @{
                    type       = 'object'
                    properties = @{
                        author                  = @{ type = 'string' }
                        actor_type              = @{ type = 'string' }
                        thesis                  = @{ type = 'string' }
                        stance                  = @{ type = 'string' }
                        primary_recommendations = @{ type = 'array'; items = @{ type = 'string' } }
                        key_claims              = @{ type = 'array'; items = @{ type = 'string' } }
                        readable                = @{ type = 'string' }
                    }
                    required   = @('thesis', 'readable')
                }
                $BriefPrompt = Get-Prompt -Name 'op-ed-source-brief' -PromptsDir $OPedPromptsDir -Replacements @{
                    SOURCE_MATERIAL = [string]$Prep.SourceMarkdown
                }
                $BriefResult = Invoke-AIApi -Prompt $BriefPrompt -Model $Model -Temperature 0.2 `
                    -MaxTokens 4000 -JsonMode -ResponseSchema $BriefSchema
                if ($null -ne $BriefResult -and -not [string]::IsNullOrWhiteSpace($BriefResult.Text)) {
                    $SBrief = $BriefResult.Text | ConvertFrom-Json
                    $Prep.SourceBrief = $SBrief
                }
            } catch {
                Write-Warning "Source comprehension pass skipped — SOURCE_* placeholders will be empty. ($($_.Exception.Message))"
            }
        }
    }

    # ── Assemble prompt-fill values for the optional fields ──────────────────
    $NewsHookText = if ([string]::IsNullOrWhiteSpace($NewsHook)) {
        '(none supplied — invent a plausible current news hook and make clear in the lede what timely event it assumes, so the author can verify it against real events before submitting)'
    } else { $NewsHook }

    $ThesisText = if ([string]::IsNullOrWhiteSpace($Thesis)) {
        '(none supplied — derive a clear, arguable thesis that follows from your camp value hierarchy)'
    } else { $Thesis }

    $AuthorBioText = if ([string]::IsNullOrWhiteSpace($AuthorBio)) {
        '(none supplied — write a generic authority line the author can replace, e.g. "[Author], [affiliation]")'
    } else { $AuthorBio }

    # ── Resolve per-outlet style vars (mirrors promptLoader.ts defaults) ────────
    $s = $Band['Style']
    $StyleAudience   = if ($null -ne $s -and $s.ContainsKey('Audience'))          { $s.Audience }          else { 'persuade a broad, non-specialist public to act' }
    $StyleReadLevel  = if ($null -ne $s -and $s.ContainsKey('ReadingLevel'))       { $s.ReadingLevel }      else { 'write for a general newspaper audience at roughly a 10th-grade reading level (Flesch-Kincaid grade ~10, and no higher than 11). This is the single most important constraint. If a passage would make a smart non-specialist reread it, simplify it.' }
    $StyleSentence   = if ($null -ne $s -and $s.ContainsKey('SentenceMechanics')) { $s.SentenceMechanics } else { 'average under 18 words per sentence; NO sentence over 30 words. One idea per sentence. When a sentence carries two or three claims, split it into two or three sentences. Long, clause-chained sentences are the main reason these essays read as hard.' }
    $StyleParagraph  = if ($null -ne $s -and $s.ContainsKey('ParagraphMechanics')){ $s.ParagraphMechanics } else { 'at most four sentences AND at most ~90 words per paragraph. The word cap matters as much as the sentence count, four long sentences is still a wall. Break a longer paragraph in two.' }
    $StyleJargon     = if ($null -ne $s -and $s.ContainsKey('JargonGuidance'))    { $s.JargonGuidance }    else { 'Eliminate jargon and specialized acronyms. Translate every technical term into plain language without losing its meaning (e.g., "new governmental restrictions," not "legislative encroachment"; "federal engineers," not "USACE"). If a term is not universally understood by a general reader, replace it. Avoid abstract-noun pileups ("sociotechnical complexity reduced to a frictionless slogan"); say it plainly.' }
    $StyleBodyFormat = if ($null -ne $s -and $s.ContainsKey('BodyFormat'))        { $s.BodyFormat }        else { 'No section labels or headers inside the body — it must read as continuous prose. Do NOT repeat the headline inside the body.' }

    # ── Load prompt templates ────────────────────────────────────────────────
    $SystemPrompt = Get-Prompt -Name 'op-ed-generation-system' -PromptsDir $OPedPromptsDir -Replacements @{
        POV_LABEL           = $Soul.label
        VOICE_BLOCK         = $VoiceBlock
        WORD_COUNT          = "$TargetWords"
        OUTLET_GUIDANCE     = $Band.Guidance
        STYLE_AUDIENCE      = $StyleAudience
        STYLE_READING_LEVEL = $StyleReadLevel
        STYLE_SENTENCE      = $StyleSentence
        STYLE_PARAGRAPH     = $StyleParagraph
        STYLE_JARGON        = $StyleJargon
    }
    $UserPrompt = Get-Prompt -Name 'op-ed-generation-user' -PromptsDir $OPedPromptsDir -Replacements @{
        TOPIC               = $Topic
        WORD_COUNT          = "$TargetWords"
        OUTLET_GUIDANCE     = $Band.Guidance
        NEWS_HOOK           = $NewsHookText
        THESIS              = $ThesisText
        AUTHOR_BIO          = $AuthorBioText
        SOURCE_MATERIAL     = $SourceMaterial
        GROUNDING_NODES     = $GroundingNodesText
        SITUATIONS          = $SituationsText
        SOURCE_AUTHOR       = if ($null -ne $SBrief -and $SBrief.PSObject.Properties.Name -contains 'author') { [string]$SBrief.author } else { '' }
        SOURCE_ACTOR_TYPE   = if ($null -ne $SBrief -and $SBrief.PSObject.Properties.Name -contains 'actor_type') { [string]$SBrief.actor_type } else { '' }
        SOURCE_THESIS       = if ($null -ne $SBrief -and $SBrief.PSObject.Properties.Name -contains 'thesis') { [string]$SBrief.thesis } else { '' }
        SOURCE_STANCE       = if ($null -ne $SBrief -and $SBrief.PSObject.Properties.Name -contains 'stance') { [string]$SBrief.stance } else { '' }
        SOURCE_RECOMMENDATIONS = if ($null -ne $SBrief -and $SBrief.PSObject.Properties.Name -contains 'primary_recommendations') {
            (@($SBrief.primary_recommendations) -join '; ')
        } else { '' }
        # Mirror promptLoader.ts SOURCE_KEY_CLAIMS: numbered list "  {i+1}. {claim}"
        # joined by LF, falling back to "(none extracted)" when empty (t/2721 parity).
        SOURCE_KEY_CLAIMS   = if ($null -ne $SBrief -and $SBrief.PSObject.Properties.Name -contains 'key_claims' -and $null -ne $SBrief.key_claims -and @($SBrief.key_claims).Count -gt 0) {
            $Claims = @($SBrief.key_claims)
            (0..($Claims.Count - 1) | ForEach-Object { "  $($_ + 1). $($Claims[$_])" }) -join "`n"
        } else { '(none extracted)' }
        STYLE_BODY_FORMAT   = $StyleBodyFormat
    }

    # ── Response schema — structured output for clean field extraction ───────
    $Schema = @{
        type       = 'object'
        properties = @{
            headline      = @{ type = 'string' }
            subtitle      = @{ type = 'string' }
            body_markdown = @{ type = 'string' }
            word_count    = @{ type = 'integer' }
            stance        = @{ type = 'string'; description = 'How the camp engages the source: agree/extend/rebut (or empty if no source)' }
        }
        required   = @('headline', 'body_markdown', 'word_count')
    }

    # Budget output tokens generously. The default model is a "thinking" model
    # (gemini-3.x pro/flash) whose reasoning tokens are billed against the same
    # output budget — too small a cap starves the visible response and truncates
    # the JSON mid-string (parse then falls back to raw text). Allow ~3 tokens
    # per target word for prose plus a large fixed reserve for reasoning, the
    # optional pitch, and JSON overhead.
    $MaxTokens = [int]([math]::Ceiling($TargetWords * 3)) + 5000

    Write-Verbose "Generating op-ed: pov='$PovKey' outlet='$Outlet' words=$TargetWords model='$Model' temp=$Temperature"

    $Result = Invoke-AIApi `
        -Prompt $UserPrompt `
        -SystemInstruction $SystemPrompt `
        -Model $Model `
        -Temperature $Temperature `
        -MaxTokens $MaxTokens `
        -JsonMode `
        -ResponseSchema $Schema

    if ($null -eq $Result -or [string]::IsNullOrWhiteSpace($Result.Text)) {
        throw (New-ActionableError -PassThru `
            -Goal 'Generate an op-ed in a POV voice' `
            -Problem 'The AI backend returned no text.' `
            -Location 'New-OpEd' `
            -NextSteps @(
                'Confirm an API key is registered for the selected model backend',
                'Retry, or try a different -Model'
            ))
    }

    # ── Parse the structured response, degrading gracefully to raw text ──────
    $Headline           = ''
    $Subtitle           = ''
    $Body               = ''
    $StanceRelationship = ''
    $ReportedWords      = 0
    try {
        $Parsed = $Result.Text | ConvertFrom-Json
        $Headline = [string]$Parsed.headline
        if ($Parsed.PSObject.Properties.Name -contains 'subtitle')    { $Subtitle = [string]$Parsed.subtitle }
        $Body = [string]$Parsed.body_markdown
        if ($Parsed.PSObject.Properties.Name -contains 'word_count')  { $ReportedWords = [int]$Parsed.word_count }
        if ($Parsed.PSObject.Properties.Name -contains 'stance')      { $StanceRelationship = [string]$Parsed.stance }
    } catch {
        Write-Warning "Response was not valid JSON; returning raw text as the body. ($($_.Exception.Message))"
        $Body = [string]$Result.Text
    }

    # ── Readability edit pass (mirrors generate.ts t/3707) ───────────────────
    # Outlet-aware targets; grade-10 defaults for outlets without a Readability block.
    $ReadTarget    = $Band['Readability']
    $RtFkMax       = if ($null -ne $ReadTarget) { [double]$ReadTarget['fkMax']       } else { 11.0 }
    $RtSentWords   = if ($null -ne $ReadTarget) { [int]   $ReadTarget['maxSentWords'] } else { 30 }
    $RtParaWords   = if ($null -ne $ReadTarget) { [int]   $ReadTarget['maxParaWords'] } else { 90 }

    $FinalBody   = $Body
    $EditingMeta = $null

    if (-not [string]::IsNullOrWhiteSpace($Body)) {
        # Measure readability: FK grade, max-sentence words, max-paragraph words.
        $MeasureBody = {
            param([string]$Txt)
            $sylW = {
                param([string]$W)
                $c = $W.ToLower() -replace '[^a-z]', ''
                if (-not $c) { return 0 }
                $g = ([regex]::Matches($c, '[aeiouy]+')).Count
                if ($c.EndsWith('e') -and $g -gt 1) { $g-- }
                [Math]::Max(1, $g)
            }
            $words = [regex]::Matches($Txt, "\b[a-zA-Z'-]+\b")
            $sents = @($Txt -split '[.!?]+' | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '[a-zA-Z]' })
            $paras = @($Txt -split '\n\n+' | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '[a-zA-Z]' })
            $fk    = if ($words.Count -gt 0 -and @($sents).Count -gt 0) {
                $syl = ($words | ForEach-Object { & $sylW $_.Value } | Measure-Object -Sum).Sum
                0.39 * ($words.Count / @($sents).Count) + 11.8 * ($syl / $words.Count) - 15.59
            } else { 0.0 }
            $maxSW = if (@($sents).Count -gt 0) { ($sents | ForEach-Object { ([regex]::Matches($_, '\b\S+\b')).Count } | Measure-Object -Maximum).Maximum } else { 0 }
            $maxPW = if (@($paras).Count -gt 0) { ($paras | ForEach-Object { ([regex]::Matches($_, '\b\S+\b')).Count } | Measure-Object -Maximum).Maximum } else { 0 }
            [PSCustomObject]@{ FkGrade = $fk; MaxSentWords = $maxSW; MaxParaWords = $maxPW }
        }

        $Checks = & $MeasureBody $Body

        if ($Checks.FkGrade -gt $RtFkMax -or $Checks.MaxSentWords -gt $RtSentWords -or $Checks.MaxParaWords -gt $RtParaWords) {
            $ViolParts = [System.Collections.Generic.List[string]]::new()
            if ($Checks.FkGrade     -gt $RtFkMax)    { [void]$ViolParts.Add("Flesch-Kincaid grade: $([Math]::Round($Checks.FkGrade,1)) (target: no higher than $RtFkMax)") }
            if ($Checks.MaxParaWords -gt $RtParaWords) { [void]$ViolParts.Add("Longest paragraph: $($Checks.MaxParaWords) words (target: at most ~$RtParaWords words)") }
            if ($Checks.MaxSentWords  -gt $RtSentWords) { [void]$ViolParts.Add("Longest sentence: $($Checks.MaxSentWords) words (target: no sentence over $RtSentWords words)") }
            $Violations    = $ViolParts -join "`n"
            $OrigWordCount = @($Body -split '\s+' | Where-Object { $_ -ne '' }).Count
            $EditSchema    = @{
                type = 'object'
                properties = @{
                    body_markdown = @{ type = 'string' }
                    changed       = @{ type = 'boolean' }
                    edit_notes    = @{ type = 'string' }
                }
                required = @('body_markdown', 'changed', 'edit_notes')
            }
            $BannedTells = @('in conclusion','furthermore','moreover','ultimately',
                'it is important to note','mitigate','robust','leverage','utilize','ensure')
            $BodyLower = $Body.ToLower()

            $AttemptEdit = {
                param([double]$Temp)
                $EP = Get-Prompt -Name 'op-ed-readability-edit' -PromptsDir $OPedPromptsDir `
                    -Replacements @{ BODY = $Body; VIOLATIONS = $Violations }
                $ER = Invoke-AIApi -Prompt $EP -Model $Model -Temperature $Temp `
                    -MaxTokens $MaxTokens -JsonMode -ResponseSchema $EditSchema
                if (-not $ER -or [string]::IsNullOrWhiteSpace($ER.Text)) { return $null }
                $Ep = $ER.Text | ConvertFrom-Json
                $Cand = [string]$Ep.body_markdown
                if (-not $Cand.Trim()) { return $null }
                $CW = @($Cand -split '\s+' | Where-Object { $_ -ne '' }).Count
                if ($CW -lt ($OrigWordCount * 0.6)) { return $null }  # collapse guard
                return $Cand
            }

            try {
                $FirstCand = & $AttemptEdit 0.3
                if ($null -eq $FirstCand) {
                    Write-Warning 'Op-ed edit pass discarded (word-count collapse) — using original body'
                    $EditingMeta = [PSCustomObject]@{ edited = $false; fk_before = $Checks.FkGrade; fk_after = $Checks.FkGrade; checks_failed_after = @(); reverted_reason = 'word-count-collapse' }
                } else {
                    $FirstLower  = $FirstCand.ToLower()
                    $IntrTells   = @($BannedTells | Where-Object { $BodyLower -notlike "*$_*" -and $FirstLower -like "*$_*" })
                    if ($IntrTells.Count -gt 0) {
                        Write-Warning "Op-ed edit pass introduced banned tells [$($IntrTells -join ', ')] — reverting"
                        $EditingMeta = [PSCustomObject]@{ edited = $false; fk_before = $Checks.FkGrade; fk_after = $Checks.FkGrade; checks_failed_after = @(); reverted_reason = "introduced-banned-tells: $($IntrTells -join ', ')" }
                    } else {
                        $ChosenBody  = $FirstCand
                        $FirstChecks = & $MeasureBody $FirstCand
                        if ($FirstChecks.FkGrade -gt $Checks.FkGrade) {
                            try {
                                $RetryCand = & $AttemptEdit 0.2
                                if ($null -ne $RetryCand) {
                                    $RetryLower  = $RetryCand.ToLower()
                                    $RetryTells  = @($BannedTells | Where-Object { $BodyLower -notlike "*$_*" -and $RetryLower -like "*$_*" })
                                    $RetryChecks = & $MeasureBody $RetryCand
                                    if ($RetryTells.Count -eq 0 -and $RetryChecks.FkGrade -le $FirstChecks.FkGrade) {
                                        $ChosenBody = $RetryCand
                                    }
                                }
                            } catch { <# retry failed — keep first attempt #> }
                        }

                        $FinalBody   = $ChosenBody
                        $AfterChecks = & $MeasureBody $ChosenBody
                        $FailedChecks = [System.Collections.Generic.List[string]]::new()
                        if ($AfterChecks.FkGrade     -gt $RtFkMax)    { [void]$FailedChecks.Add("fk_grade=$([Math]::Round($AfterChecks.FkGrade,1))") }
                        if ($AfterChecks.MaxParaWords -gt $RtParaWords) { [void]$FailedChecks.Add("max_para_words=$($AfterChecks.MaxParaWords)") }
                        if ($AfterChecks.MaxSentWords  -gt $RtSentWords) { [void]$FailedChecks.Add("max_sent_words=$($AfterChecks.MaxSentWords)") }

                        # Deterministic para-split backstop (t/3710)
                        if ($AfterChecks.MaxParaWords -gt $RtParaWords) {
                            $SplitResult = ($FinalBody -split '\n\n+') | ForEach-Object {
                                $Para = $_
                                if (([regex]::Matches($Para, '\b\S+\b')).Count -le $RtParaWords) {
                                    $Para
                                } else {
                                    $Sents  = @($Para -split '(?<=[.!?])\s+' | Where-Object { $_.Trim() })
                                    $Chunks = [System.Collections.Generic.List[string]]::new()
                                    $Chunk  = ''; $CW2 = 0
                                    foreach ($S in $Sents) {
                                        $SW2 = ([regex]::Matches($S, '\b\S+\b')).Count
                                        if ($Chunk -and ($CW2 + $SW2) -gt $RtParaWords) {
                                            $Chunks.Add($Chunk.Trim()); $Chunk = $S; $CW2 = $SW2
                                        } else {
                                            $Chunk = if ($Chunk) { "$Chunk $S" } else { $S }; $CW2 += $SW2
                                        }
                                    }
                                    if ($Chunk.Trim()) { $Chunks.Add($Chunk.Trim()) }
                                    if ($Chunks.Count -gt 0) { $Chunks } else { $Para }
                                }
                            }
                            $FinalBody   = $SplitResult -join "`n`n"
                            $AfterChecks = & $MeasureBody $FinalBody
                            $FailedChecks.Clear()
                            if ($AfterChecks.FkGrade     -gt $RtFkMax)    { [void]$FailedChecks.Add("fk_grade=$([Math]::Round($AfterChecks.FkGrade,1))") }
                            if ($AfterChecks.MaxParaWords -gt $RtParaWords) { [void]$FailedChecks.Add("max_para_words=$($AfterChecks.MaxParaWords)") }
                            if ($AfterChecks.MaxSentWords  -gt $RtSentWords) { [void]$FailedChecks.Add("max_sent_words=$($AfterChecks.MaxSentWords)") }
                        }

                        if ($FailedChecks.Count -gt 0) {
                            Write-Warning "Op-ed edit pass still misses target: $($FailedChecks -join ', ') (FK before=$([Math]::Round($Checks.FkGrade,1)) after=$([Math]::Round($AfterChecks.FkGrade,1)))"
                        }
                        $EditingMeta = [PSCustomObject]@{
                            edited              = $true
                            fk_before           = [Math]::Round($Checks.FkGrade, 2)
                            fk_after            = [Math]::Round($AfterChecks.FkGrade, 2)
                            checks_failed_after = $FailedChecks.ToArray()
                        }
                    }
                }
            } catch {
                Write-Warning "Op-ed edit pass failed — using original body. ($($_.Exception.Message))"
                $EditingMeta = [PSCustomObject]@{ edited = $false; fk_before = $Checks.FkGrade; fk_after = $Checks.FkGrade; checks_failed_after = @(); reverted_reason = "error: $($_.Exception.Message.Substring(0, [Math]::Min(120, $_.Exception.Message.Length)))" }
            }
        }
    }

    # Prefer an actual count over the model's self-report.
    $ActualWords = if ([string]::IsNullOrWhiteSpace($FinalBody)) { 0 } else {
        @($FinalBody -split '\s+' | Where-Object { $_ -ne '' }).Count
    }

    # ── Reflection pass: map each grounding element to how/where it's reflected ──
    # A separate lightweight call that reads the FINISHED essay. Deliberately NOT
    # folded into the main call: asking for the essay AND per-element usage in one
    # JSON response makes the metadata contend with the body for the output token
    # budget and truncates the essay (observed). Judging against the real text
    # also yields truthful placements rather than mid-write predictions.
    # Best-effort — any failure leaves Reflection as '(not reported)'.
    if (@($Grounding).Count -gt 0 -and -not [string]::IsNullOrWhiteSpace($FinalBody)) {
        foreach ($g in $Grounding) { $g.Reflection = '(not reported)' }
        try {
            $glb = [System.Text.StringBuilder]::new()
            foreach ($g in $Grounding) {
                [void]$glb.AppendLine("- [$($g.Id)] ($($g.Type)/$($g.Category)) $($g.Label)")
            }
            $ReflPrompt = Get-Prompt -Name 'op-ed-grounding-reflection' -PromptsDir $OPedPromptsDir -Replacements @{
                OPED_BODY      = $FinalBody
                GROUNDING_LIST = $glb.ToString().TrimEnd()
                # Mirror generate.ts:291-293 reflection pass: numbered key_claims list,
                # "(none)" fallback when absent. Without this the shared prompt's
                # {{SOURCE_CLAIMS}} slot (t/2890) rendered literally on the PS path (t/2911).
                SOURCE_CLAIMS  = if ($null -ne $SBrief -and $SBrief.PSObject.Properties.Name -contains 'key_claims' -and $null -ne $SBrief.key_claims -and @($SBrief.key_claims).Count -gt 0) {
                    $ReflClaims = @($SBrief.key_claims)
                    (0..($ReflClaims.Count - 1) | ForEach-Object { "  $($_ + 1). $($ReflClaims[$_])" }) -join "`n"
                } else { '(none)' }
            }
            $ReflSchema = @{
                type       = 'object'
                properties = @{
                    grounding_usage = @{
                        type  = 'array'
                        items = @{
                            type       = 'object'
                            properties = @{ id = @{ type = 'string' }; reflection = @{ type = 'string' } }
                            required   = @('id', 'reflection')
                        }
                    }
                }
                required   = @('grounding_usage')
            }
            $ReflMax = [Math]::Max(4000, (@($Grounding).Count * 150) + 3000)
            $ReflResult = Invoke-AIApi -Prompt $ReflPrompt -Model $Model -Temperature 0.2 `
                -MaxTokens $ReflMax -JsonMode -ResponseSchema $ReflSchema
            if ($ReflResult -and -not [string]::IsNullOrWhiteSpace($ReflResult.Text)) {
                $ReflParsed = $ReflResult.Text | ConvertFrom-Json
                if ($ReflParsed.PSObject.Properties.Name -contains 'grounding_usage') {
                    $UsageMap = @{}
                    foreach ($u in @($ReflParsed.grounding_usage)) {
                        if ($null -ne $u -and $u.PSObject.Properties.Name -contains 'id') {
                            $UsageMap[[string]$u.id] = [string]$u.reflection
                        }
                    }
                    foreach ($g in $Grounding) {
                        if ($UsageMap.ContainsKey($g.Id)) { $g.Reflection = $UsageMap[$g.Id] }
                    }
                }
            }
        } catch {
            Write-Warning "Grounding-reflection pass failed; Grounding.Reflection left as '(not reported)'. ($($_.Exception.Message))"
        }
    }

    $Output = [PSCustomObject]@{
        Headline             = $Headline
        Subtitle             = $Subtitle
        Body                 = $FinalBody
        WordCount            = $ActualWords
        Pov                  = $PovKey
        Outlet               = $Outlet
        Model                = $Model
        Backend              = $Result.Backend
        Grounding            = $Grounding.ToArray()
        StanceRelationship   = $StanceRelationship
        SourceFormat         = if ($null -ne $Prep) { $Prep.SourceFormat } else { $null }
        SourceExtractionTool = if ($null -ne $Prep) { $Prep.SourceExtractionTool } else { $null }
        ReadableWords        = if ($null -ne $Prep) { $Prep.ReadableWords } else { $null }
        ReadableRatio        = if ($null -ne $Prep) { $Prep.ReadableRatio } else { $null }
        SourceUnderstanding  = $SBrief
        EditingMeta          = $EditingMeta
    }

    # ── Optionally write a Markdown file ─────────────────────────────────────
    if (-not [string]::IsNullOrWhiteSpace($OutputPath)) {
        $md = [System.Text.StringBuilder]::new()
        if ($Headline) { [void]$md.AppendLine("# $Headline"); [void]$md.AppendLine() }
        if ($Subtitle) { [void]$md.AppendLine("*$Subtitle*"); [void]$md.AppendLine() }
        [void]$md.AppendLine($Body)
        if (@($Grounding).Count -gt 0) {
            [void]$md.AppendLine()
            [void]$md.AppendLine('---')
            [void]$md.AppendLine()
            [void]$md.AppendLine('## Taxonomy grounding (relevance + how it is reflected)')
            [void]$md.AppendLine()
            [void]$md.AppendLine('| Element | Type | Category | Relevance | Reflected in the op-ed |')
            [void]$md.AppendLine('|---|---|---|---|---|')
            foreach ($g in $Grounding) {
                $refl = ([string]$g.Reflection) -replace '\|', '\|'
                [void]$md.AppendLine("| $($g.Id) — $($g.Label) | $($g.Type) | $($g.Category) | $([Math]::Round([double]$g.RelevanceScore, 4)) | $refl |")
            }
        }
        $Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
        [System.IO.File]::WriteAllText($OutputPath, $md.ToString(), $Utf8NoBom)
        Write-Verbose "Wrote op-ed to $OutputPath"
    }

    return $Output
}
