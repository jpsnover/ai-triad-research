# Repository Map

Auto-generated from import graph. Files ranked by import count within each directory.

## ../lib/
- **npy.ts** (4) — parseNpy, extractNodeVectors

## ../lib/ai-client/
- **types.ts** (18) — ToolDefinition, ToolCall, ToolResult, GenerateOptions, ProviderResult +7 more
- **retry.ts** (12) — withTimeout, parseRateLimitType, RetryConfig, CLI_RETRY_CONFIG, SERVER_RETRY_CONFIG +2 more
- **index.ts** (7) — resolveBackend, resolveModel, buildModelIdMap, getApiModelId, getDefaultTimeout +35 more
- **registry.ts** (7) — ModelEntry, ModelRegistry, resolveBackend, resolveModel, getDefaultTimeout +4 more
- **defaults.ts** (4) — DEFAULT_MODEL, DEFAULT_TEMPERATURE
- **modelRouter.ts** (2) — TaskTier, TaskPurpose, PURPOSE_TIER_MAP, RouterConfig, probeOllama +7 more
- **client.ts** (1) — AIClientDeps, AIClient, callProvider, createAIClient

## ../lib/ai-client/providers/
- **gemini.ts** (4) — GEMINI_BASE, GEMINI_SAFETY_SETTINGS, toGeminiSchema, generateViaGemini
- **azure.ts** (3) — generateViaAzure
- **ollama.ts** (3) — OLLAMA_BASE, isOllamaAvailable, generateViaOllama
- **claude.ts** (2) — generateViaClaude
- **deepseek.ts** (2) — generateViaDeepSeek, generateViaDeepSeekStream
- **gemini-embeddings.ts** (2) — callGeminiBatchEmbed
- **gemini-search.ts** (2) — GroundingSegment, GroundingCitation, GroundedSearchResult, geminiGroundedSearch
- **groq.ts** (2) — generateViaGroq

## ../lib/debate/
- **types.ts** (97) — SpeakerId, LEGACY_SPEAKER_MAP, migrateSpeakerId, normalizeActivePovers, DebatePhase +140 more
- **taxonomyTypes.ts** (38) — Pov, Category, FallacyTier, PossibleFallacy, GraphAttributes +21 more
- **errors.ts** (31) — ActionableError, errorMessage
- **helpers.ts** (22) — generateId, nowISO, stripCodeFences, stripExcludes, parseAIJson +21 more
- **taxonomyRelevance.ts** (18) — NodeRelevanceScore, ScoredPovNode, ScoredSituationNode, RelevanceOptions, SituationBranchBoostConfig +22 more
- **aiAdapter.ts** (14) — GenerateOptions, AIAdapter, ExtendedAIAdapter, countTokens, createCLIAdapter
- **qbaf.ts** (13) — QbafNode, QbafEdge, QbafOptions, QbafResult, computeQbafStrengths +8 more
- **prompts.ts** (12) — setPromptCompact, isCompactModel, setTopicScope, extractSpeakerVocabulary, formatVocabularyExclusion +77 more

## ../lib/dictionary/
- **types.ts** (14) — CampOrigin, CoinageStatus, ColloquialStatus, ConfidenceLevel, StandardizedTerm +14 more
- **quotation.ts** (4) — QuotationSpan, QuotationParseResult, QuotationParseError, parseQuotationMarkers, isInsideQuotation +1 more
- **loader.ts** (3) — DictionaryLoader, createLoader
- **render.ts** (2) — renderDisplay, reverseRender, buildReverseMap
- **lint.ts** (1) — lintDictionary, lintText, lintNodes
- **index.ts** (0) — DictionaryLoader, createLoader, renderDisplay, reverseRender, buildReverseMap +6 more

## ../lib/diff/
- **lineDiff.ts** (1) — DiffLine, DiffResult, lineDiff

## ../lib/electron-shared/components/
- **ErrorBoundary.tsx** (2) — default
- **ResizeHandle.tsx** (0) — default

## ../lib/electron-shared/hooks/
- **useResizablePanes.ts** (0) — useResizablePanes

## ../lib/electron-shared/utils/
- **searchRegex.ts** (1) — CoreSearchMode, buildSearchRegex
- **validatedIpc.ts** (0) — validatedHandle, noArgs, oneString, twoStrings, stringArray +8 more

## ../lib/embeddings/
- **onnxEmbedding.ts** (1) — warmup, tryWarmup, isReady, getExecutionProvider, computeEmbedding +2 more

## ../lib/flight-recorder/
- **index.ts** (57) — getGlobalRecorder, setGlobalRecorder, FlightRecorder, Dictionary, RingBuffer +5 more
- **types.ts** (6) — EventType, EventLevel, ErrorCategory, FlightRecorderEvent, RecordInput +11 more
- **dictionary.ts** (4) — Dictionary
- **flightRecorder.ts** (3) — FlightRecorder
- **redact.ts** (3) — redactString, redactFieldValue, redactRecord
- **ringBuffer.ts** (3) — RingBuffer
- **serializer.ts** (3) — serializeDump

## ../lib/search/
- **tavily.ts** (3) — TavilySearchResult, TavilySearchResponse, TavilySearchOptions, tavilySearch, buildSearchAugmentedPrompt

## ../lib/translation/
- **types.ts** (5) — TranslationConfidence, TranslationMethod, PhraseMatch, SenseSignal, TranslationRecord +8 more
- **ensemble.ts** (2) — EnsembleInput, EnsembleOutput, resolveWithEnsemble
- **llmFallback.ts** (2) — LlmFallbackInput, LlmFallbackResult, LlmAdapter, buildFallbackPrompt, resolveFallback
- **locator.ts** (2) — locateOccurrences
- **phraseMatch.ts** (2) — tokenSortRatio, jaccardSimilarity, levenshteinRatio
- **pipeline.ts** (1) — TranslationPipelineOptions, translateDocument
- **index.ts** (0) — locateOccurrences, resolveWithEnsemble, resolveFallback, buildFallbackPrompt, translateDocument +3 more

## src/main/
- **fileIO.ts** (8) — loadDataConfig, isDataAvailable, getDataRootPath, setDataRootPath, getSourcesDir +36 more
- **apiKeyStore.ts** (3) — loadApiKeys, addApiKey, removeApiKey, storeApiKey, loadApiKey +9 more
- **embeddings.ts** (2) — warmupEmbeddingModel, disposeEmbeddingModel, getEmbeddingInfo, computeEmbeddings, computeQueryEmbedding +14 more
- **chatIO.ts** (1) — ChatSessionSummary, listChatSessions, loadChatSession, saveChatSession, deleteChatSession
- **communityReviewIO.ts** (1) — isAzureReviewConfigured, adminReviewQueue, adminReviewStats, adminReviewDetail, adminReviewAction +1 more
- **dataUpdateChecker.ts** (1) — DataUpdateStatus, checkForDataUpdates, ChangedFileInfo, getChangedFiles, getFileDiff +1 more
- **debateExport.ts** (1) — debateToPdf, debateToText, debateToMarkdown, debateToPackage, debateExportFilename
- **debateIO.ts** (1) — DebateSessionSummary, listDebateSessions, loadDebateSession, saveDebateSession, deleteDebateSession +2 more

## src/renderer/
- **constants.ts** (3) — TOAST_DURATION_SUCCESS, TOAST_DURATION_FEEDBACK
- **App.tsx** (1) — App

## src/renderer/bridge/
- **index.ts** (86) — api, setActiveDebateId, isElectronMode
- **web-bridge.ts** (14) — setActiveDebateId, api, isElectronMode, getResilienceState, subscribeResilience +5 more
- **resilience.ts** (5) — EndpointCategory, CircuitState, ThrottleState, ResilienceStatus, ResilientFetchOptions +6 more
- **types.ts** (5) — GroundingSegment, SourceDocumentResolution, GroundingCitation, AppAPI
- **instrumentBridge.ts** (2) — instrumentBridge
- **electron-bridge.ts** (1) — api
- **healthProbe.ts** (1) — initHealthProbe, stopHealthProbe, getProbeState

## src/renderer/components/
- **OnboardingTour.tsx** (1) — OnboardingTour

## src/renderer/components/PovProgression/
- **PovProgressionView.tsx** (3) — PovProgressionView
- **PovProgressionWindow.tsx** (0) — PovProgressionWindow

## src/renderer/components/analysis/
- **FallacyPanel.tsx** (6) — FallacyPanel, FallacyDetailPanel
- **ConvergenceSignalsPanel.tsx** (3) — ConvergenceSignalsPanel
- **NeutralEvaluationPanel.tsx** (3) — NeutralEvaluationPanel
- **ParameterHistoryPanel.tsx** (3) — ParameterHistoryPanel
- **AICostCard.tsx** (2) — AICostCard
- **AnalysisPanel.tsx** (2) — AnalysisPanel
- **AnalyticsDashboard.tsx** (2) — AICostBreakdown, AICostAggregate, AnalyticsDashboard
- **AttributeFilterPanel.tsx** (2) — AttributeFilterPanel

## src/renderer/components/chat/
- **PromptsPanel.tsx** (8) — PromptsPanel, PromptDetailPanel
- **ChatWorkspace.tsx** (3) — ChatWorkspace
- **CommentSidebar.tsx** (3) — CommentSidebar
- **PromptDiffTree.tsx** (3) — DiffViewMode, ValidationDetail, DirectiveCompliance, StageValidation, QualityCheck +6 more
- **PromptInspector.tsx** (3) — PromptInspector
- **ChatTab.tsx** (2) — ChatTab
- **ChatWindow.tsx** (2) — ChatWindow
- **CommentCreationPopover.tsx** (2) — CommentPopoverState, CommentCreationPopover

## src/renderer/components/community/
- **AnonymousBanner.tsx** (3) — AnonymousBanner
- **CommunityLibrary.tsx** (1) — CommunityLibrary

## src/renderer/components/conflict/
- **ConflictDetail.tsx** (4) — ConflictDetail
- **ConflictInstanceForm.tsx** (2) — ConflictInstanceForm, newEmptyInstance
- **ConflictNoteForm.tsx** (2) — ConflictNoteForm, newEmptyNote
- **ConflictsTab.tsx** (1) — ConflictsTab

## src/renderer/components/conflict/edit-conflicts/
- **nodeConflictsApi.ts** (4) — NodeConflict, NodeConflictsResponse, DISABLED_NODE_CONFLICTS, getNodeConflicts
- **EditConflictBadge.tsx** (2) — EditConflictBadge
- **useNodeConflicts.ts** (2) — UseNodeConflicts, useNodeConflicts

## src/renderer/components/debate/
- **SituationDetail.tsx** (7) — SituationDetail, CrossCuttingDetail
- **communityFilter.ts** (2) — filterCommunityDebates
- **CruxesTab.tsx** (2) — CruxesTab, CruxDetail
- **cruxState.ts** (2) — CruxResolutionSummary, cruxDominantState
- **DebateSourceViewer.tsx** (2) — DebateSourceViewer
- **ExportDropdown.tsx** (2) — ExportDropdown
- **NewDebateDialog.tsx** (2) — DialecticalStyle, NewDebateDialog
- **popoutLoad.ts** (2) — DebateLoadTarget, parseDebateHash, shouldShowLoadError

## src/renderer/components/debate-diagnostics/
- **index.ts** (0) — DiagnosticsWindow, DiagnosticsPanel, DiagnosticsChatSidebar

## src/renderer/components/debate-diagnostics/chat/
- **DiagnosticsChatSidebar.tsx** (2) — NavigateCommand, DiagnosticsChatSidebar
- **index.ts** (0) — DiagnosticsChatSidebar

## src/renderer/components/debate-diagnostics/panel/
- **helpers.tsx** (6) — speakerLabel, CollapsibleSection
- **EntryView.tsx** (3) — EntryView
- **VerificationSection.tsx** (3) — VerificationSectionProps, VerificationSection
- **WhatIfSection.tsx** (3) — WhatIfSection
- **DocumentCoverageSection.tsx** (2) — DocumentCoverageSection
- **OverviewView.tsx** (2) — OverviewView
- **DiagnosticsPanel.tsx** (1) — DiagnosticsPanel
- **index.ts** (0) — DiagnosticsPanel, EntryView, OverviewView, WhatIfSection, DocumentCoverageSection +3 more

## src/renderer/components/debate-diagnostics/window/
- **helpers.tsx** (17) — DiagSearchContext, speakerLabel, AifBadge, TrafficLight, CopyButton +5 more
- **types.ts** (13) — OverviewTab, EntryTab, AgentUtilityLocal, UtilitySnapshot, UTILITY_WEIGHTS +1 more
- **EntryDetailRouter.tsx** (3) — EntryDetailRouterProps, EntryDetailRouter
- **OverviewTabRouter.tsx** (3) — OverviewTabRouter
- **useDiagnosticsState.ts** (3) — useDiagnosticsState, DiagnosticsState
- **DiagnosticsWindow.tsx** (1) — DiagnosticsWindow
- **index.ts** (0) — DiagnosticsWindow, OverviewTabRouter, EntryDetailRouter, useDiagnosticsState

## src/renderer/components/debate-diagnostics/window/entry-tabs/
- **CitationsTab.tsx** (2) — CitationsTabProps, CitationsTab
- **ClaimsTab.tsx** (2) — ClaimsTabProps, ClaimsTab
- **DetailsTab.tsx** (2) — DetailsTabProps, DetailsTab
- **DraftTab.tsx** (2) — DraftTabProps, DraftTab
- **EvidenceTab.tsx** (2) — EvidenceTabProps, EvidenceTab
- **ExclusionGuardTab.tsx** (2) — ExclusionGuardTabProps, ExclusionGuardTab
- **BriefTab.tsx** (1) — BriefTabProps, BriefTab
- **CiteTab.tsx** (1) — CiteTabProps, CiteTab

## src/renderer/components/debate-diagnostics/window/overview-tabs/
- **AdaptiveStagingTab.tsx** (2) — AdaptiveStagingTab
- **ArgumentNetworkTab.tsx** (2) — ArgumentNetworkTab
- **ReflectionsTab.tsx** (1) — ReflectionsTab
- **UtilityTab.tsx** (1) — UtilityTab
- **index.ts** (0) — AdaptiveStagingTab, ReflectionsTab, ArgumentNetworkTab, UtilityTab

## src/renderer/components/debate-diagnostics/window/shared/
- **constants.ts** (10) — SUPPRESSION_REASON_TOOLTIPS, AIF_TOOLTIPS, POV_NODE_COLOR, DEBATER_COLORS, debaterColor +4 more
- **ScoreBreakdown.tsx** (3) — ScoreBreakdown, OutcomeBadge
- **CommitmentsPanel.tsx** (2) — CommitmentsPanel
- **DebateExchangeRich.tsx** (2) — DebateExchangeRich
- **EdgesUsed.tsx** (2) — edgeNodeColor, truncateLabel, EdgeUsed, EdgesUsedDetail, EdgesUsedGrouped
- **INodeRow.tsx** (2) — subScoreTip, INodeRow, SUB_SCORE_TIPS, BELIEF_KEYS
- **TensionsListDetail.tsx** (2) — TensionsListDetail
- **TurnValidation.tsx** (2) — CITE_HINT_RE, classifyHintTarget, HINT_TARGET_STYLE, TurnValidationAttemptRow, sanitizeTurnValidation +1 more

_... truncated at 200 lines_
