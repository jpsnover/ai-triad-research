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
        set explicitly with -WordCount). Optionally emits the standard pitch
        cover email (-IncludePitch) and writes a Markdown file (-OutputPath).

        Prompts are production artifacts: the structural rules live in
        Prompts/op-ed-generation-system.prompt and the task contract in
        Prompts/op-ed-generation-user.prompt; the voice block is built from the
        Soul document at lib/debate/soul-docs/<pov>.soul.json.
    .PARAMETER Topic
        The subject or angle for the essay, as free text. Mandatory in the
        default 'FromTopic' parameter set; optional alongside -Url to steer the
        angle of a fetched source.
    .PARAMETER Url
        A web page to use as source material. The page is fetched and converted
        to Markdown, then handed to the model as factual grounding. Mandatory in
        the 'FromUrl' parameter set.
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
    .PARAMETER IncludePitch
        Also generate the standard pitch cover email (subject line, thesis
        summary, credentials) per the submission protocol.
    .PARAMETER OutputPath
        If supplied, writes the headline, body, and any pitch to a Markdown file
        at this path (UTF-8, no BOM).
    .PARAMETER Model
        AI model to use. Defaults to gemini-3.6-flash — a deliberate step up from
        the flash-lite enrichment default because long-form persuasive prose needs
        a stronger tier; a GA model is preferred over a preview as a default. For
        maximum polish, pass -Model gemini-3.1-pro-preview.
    .PARAMETER Temperature
        Sampling temperature. Defaults to 0.8 for creative prose.
    .OUTPUTS
        [PSCustomObject] with Headline, Subtitle, Body, Pitch, WordCount, Pov,
        Outlet, Model, and Backend.
    .EXAMPLE
        New-OpEd -Topic 'Mandatory pre-deployment audits for frontier AI models' `
            -Pov safetyist -Outlet WashingtonPost `
            -NewsHook 'the Senate AI oversight bill scheduled for a floor vote next week'

        Drafts an 800-word Washington Post-length guest essay in the Safetyist voice.
    .EXAMPLE
        New-OpEd -Url 'https://example.com/ai-jobs-report' -Pov accelerationist `
            -Outlet WallStreetJournal -IncludePitch -OutputPath ./oped.md

        Fetches the article as source material, writes a WSJ-length essay in the
        Accelerationist voice, includes a pitch email, and saves it to disk.
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
        [ValidateNotNullOrEmpty()]
        [string]$Topic,

        [Parameter(Mandatory, ParameterSetName = 'FromUrl')]
        [ValidateNotNullOrEmpty()]
        [string]$Url,

        [Parameter(Mandatory)]
        [ValidateSet('accelerationist', 'safetyist', 'skeptic', 'acc', 'saf', 'skp')]
        [string]$Pov,

        [ValidateSet('WashingtonPost', 'NYTimes', 'WallStreetJournal', 'USAToday',
            'ForeignAffairs', 'Politico', 'Regional', 'Generic')]
        [string]$Outlet = 'Generic',

        [ValidateRange(300, 2000)]
        [int]$WordCount,

        [string]$NewsHook = '',

        [string]$Thesis = '',

        [string]$AuthorBio = '',

        [switch]$IncludePitch,

        [string]$OutputPath,

        [ValidateScript({ Test-AIModelId $_ })]
        [string]$Model = 'gemini-3.6-flash',

        [ValidateRange(0.0, 2.0)]
        [double]$Temperature = 0.8
    )

    Set-StrictMode -Version Latest

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
    }
    $Band = $OutletBands[$Outlet]
    $TargetWords = if ($PSBoundParameters.ContainsKey('WordCount')) { $WordCount } else { $Band.Words }

    # ── Resolve source material: fetch + convert the URL if given ────────────
    $SourceMaterial = '(no external source supplied — argue from the topic and general knowledge)'
    if ($PSCmdlet.ParameterSetName -eq 'FromUrl') {
        Write-Verbose "Fetching source material from $Url"
        try {
            $Resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 30
        } catch {
            throw (New-ActionableError -PassThru `
                -Goal 'Generate an op-ed from a URL' `
                -Problem "Failed to fetch source URL '$Url': $($_.Exception.Message)" `
                -Location 'New-OpEd' `
                -NextSteps @(
                    'Confirm the URL is reachable and returns HTML',
                    'Supply the material via -Topic text instead, or try a different URL'
                ))
        }
        $Markdown = ConvertFrom-Html -Html ([string]$Resp.Content) -SourceUrl $Url
        # Cap the source to keep the prompt within a sane token budget.
        $MaxChars = 12000
        if ($Markdown.Length -gt $MaxChars) {
            $Markdown = $Markdown.Substring(0, $MaxChars) + "`n`n[... source truncated ...]"
        }
        $SourceMaterial = $Markdown
        if (-not $PSBoundParameters.ContainsKey('Topic') -or [string]::IsNullOrWhiteSpace($Topic)) {
            $Topic = "Write an op-ed responding to the source material below (from $Url). Choose the sharpest angle consistent with your camp's convictions."
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

    $PitchInstruction = if ($IncludePitch) {
        'ALSO write a pitch cover email in "pitch_email". Use this layout: a subject line "Op-Ed Submission: [Headline]"; one or two sentences opening with the news hook and summarizing the thesis and proposed solution; one sentence of author credentials; and a closing note that the full draft is pasted below. Keep it under 150 words and do not paste the essay itself into the pitch.'
    } else {
        'No pitch email is needed; return an empty string for "pitch_email".'
    }

    # ── Load prompt templates ────────────────────────────────────────────────
    $SystemPrompt = Get-Prompt -Name 'op-ed-generation-system' -Replacements @{
        POV_LABEL       = $Soul.label
        VOICE_BLOCK     = $VoiceBlock
        WORD_COUNT      = "$TargetWords"
        OUTLET_GUIDANCE = $Band.Guidance
    }
    $UserPrompt = Get-Prompt -Name 'op-ed-generation-user' -Replacements @{
        TOPIC             = $Topic
        WORD_COUNT        = "$TargetWords"
        OUTLET_GUIDANCE   = $Band.Guidance
        NEWS_HOOK         = $NewsHookText
        THESIS            = $ThesisText
        AUTHOR_BIO        = $AuthorBioText
        SOURCE_MATERIAL   = $SourceMaterial
        PITCH_INSTRUCTION = $PitchInstruction
    }

    # ── Response schema — structured output for clean field extraction ───────
    $Schema = @{
        type       = 'object'
        properties = @{
            headline      = @{ type = 'string' }
            subtitle      = @{ type = 'string' }
            body_markdown = @{ type = 'string' }
            word_count    = @{ type = 'integer' }
            pitch_email   = @{ type = 'string' }
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
    $Headline = ''
    $Subtitle = ''
    $Body     = ''
    $Pitch    = ''
    $ReportedWords = 0
    try {
        $Parsed = $Result.Text | ConvertFrom-Json
        $Headline = [string]$Parsed.headline
        if ($Parsed.PSObject.Properties.Name -contains 'subtitle')    { $Subtitle = [string]$Parsed.subtitle }
        $Body = [string]$Parsed.body_markdown
        # -IncludePitch deterministically controls the pitch field; never surface
        # a pitch the caller did not ask for, even if the model volunteered one.
        if ($IncludePitch -and $Parsed.PSObject.Properties.Name -contains 'pitch_email') { $Pitch = [string]$Parsed.pitch_email }
        if ($Parsed.PSObject.Properties.Name -contains 'word_count')  { $ReportedWords = [int]$Parsed.word_count }
    } catch {
        Write-Warning "Response was not valid JSON; returning raw text as the body. ($($_.Exception.Message))"
        $Body = [string]$Result.Text
    }

    # Prefer an actual count over the model's self-report.
    $ActualWords = if ([string]::IsNullOrWhiteSpace($Body)) { 0 } else {
        @($Body -split '\s+' | Where-Object { $_ -ne '' }).Count
    }

    $Output = [PSCustomObject]@{
        Headline  = $Headline
        Subtitle  = $Subtitle
        Body      = $Body
        Pitch     = $Pitch
        WordCount = $ActualWords
        Pov       = $PovKey
        Outlet    = $Outlet
        Model     = $Model
        Backend   = $Result.Backend
    }

    # ── Optionally write a Markdown file ─────────────────────────────────────
    if (-not [string]::IsNullOrWhiteSpace($OutputPath)) {
        $md = [System.Text.StringBuilder]::new()
        if ($Headline) { [void]$md.AppendLine("# $Headline"); [void]$md.AppendLine() }
        if ($Subtitle) { [void]$md.AppendLine("*$Subtitle*"); [void]$md.AppendLine() }
        [void]$md.AppendLine($Body)
        if ($Pitch) {
            [void]$md.AppendLine()
            [void]$md.AppendLine('---')
            [void]$md.AppendLine()
            [void]$md.AppendLine('## Pitch cover email')
            [void]$md.AppendLine()
            [void]$md.AppendLine($Pitch)
        }
        $Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
        [System.IO.File]::WriteAllText($OutputPath, $md.ToString(), $Utf8NoBom)
        Write-Verbose "Wrote op-ed to $OutputPath"
    }

    return $Output
}
