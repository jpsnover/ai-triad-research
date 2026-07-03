# Repository Map

Auto-generated from import graph. Files ranked by import count within each directory (top 8 per directory — leaf components with no importers are omitted).

**Coverage:** taxonomy-editor + lib only. poviewer and summary-viewer are NOT indexed here.

## ../lib/
- **npy.ts** (4) — parseNpy, extractNodeVectors

## ../lib/ai-client/
- **types.ts** (20) — ToolDefinition, ToolCall, ToolResult, GenerateOptions, ProviderResult +8 more
- **retry.ts** (13) — withTimeout, parseRateLimitType, parseRateLimitHeaders, RetryConfig, CLI_RETRY_CONFIG +3 more
- **registry.ts** (11) — ModelEntry, ModelPricing, ModelRegistry, resolveBackend, resolveModel +7 more
- **index.ts** (7) — resolveBackend, resolveModel, buildModelIdMap, getApiModelId, getDefaultTimeout +45 more
- **defaults.ts** (4) — DEFAULT_MODEL, DEFAULT_TEMPERATURE
- **usageRegistry.ts** (4) — UsageCallDeps, clearUsageRegistryCache, getUsage, listUsages, callByUsage
- **usageTypes.ts** (4) — UsageConfig, UsageRegistry, UsageValidationError, renderTemplate, loadUsageRegistry +1 more
- **client.ts** (3) — AIClientDeps, AIClient, callProvider, createAIClient

## ../lib/ai-client/providers/
- **gemini.ts** (4) — GEMINI_BASE, GEMINI_SAFETY_SETTINGS, toGeminiSchema, generateViaGemini
- **azure.ts** (3) — generateViaAzure
- **gemini-embeddings.ts** (3) — callGeminiBatchEmbed
- **ollama.ts** (3) — OLLAMA_BASE, isOllamaAvailable, generateViaOllama
- **claude.ts** (2) — generateViaClaude
- **deepseek.ts** (2) — generateViaDeepSeek, generateViaDeepSeekStream
- **gemini-search.ts** (2) — GroundingSegment, GroundingCitation, GroundedSearchResult, geminiGroundedSearch
- **groq.ts** (2) — generateViaGroq

## ../lib/debate/
- **types.ts** (103) — SpeakerId, LEGACY_SPEAKER_MAP, migrateSpeakerId, normalizeActivePovers, DebatePhase +140 more
- **taxonomyTypes.ts** (38) — Pov, Category, FallacyTier, PossibleFallacy, GraphAttributes +21 more
- **errors.ts** (35) — ActionableError, errorMessage
- **helpers.ts** (22) — generateId, nowISO, stripCodeFences, stripExcludes, sanitizeTurnSymbols +22 more
- **taxonomyRelevance.ts** (18) — NodeRelevanceScore, ScoredPovNode, ScoredSituationNode, RelevanceOptions, CorpusCoverageConfig +24 more
- **aiAdapter.ts** (14) — GenerateOptions, AIAdapter, ExtendedAIAdapter, countTokens, createCLIAdapter
- **qbaf.ts** (13) — QbafNode, QbafEdge, QbafOptions, QbafResult, computeQbafStrengths +8 more
- **prompts.ts** (12) — setPromptCompact, isCompactModel, setTopicScope, extractSpeakerVocabulary, formatVocabularyExclusion +78 more

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
- **onnxEmbedding.ts** (2) — warmup, tryWarmup, isReady, getExecutionProvider, computeEmbedding +2 more

## ../lib/flight-recorder/
- **index.ts** (61) — getGlobalRecorder, setGlobalRecorder, clearGlobalRecorder, FlightRecorder, Dictionary +6 more
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
- **index.ts** (98) — api, setActiveDebateId, isElectronMode
- **web-bridge.ts** (14) — setActiveDebateId, api, isElectronMode, getResilienceState, subscribeResilience +5 more
- **types.ts** (12) — GroundingSegment, SourceDocumentResolution, GroundingCitation, SupportCaseCreatePayload, SupportCaseSummary +7 more
- **resilience.ts** (5) — EndpointCategory, CircuitState, ThrottleState, ResilienceStatus, ResilientFetchOptions +6 more
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
- **helpers.tsx** (18) — DiagSearchContext, speakerLabel, AifBadge, TrafficLight, CopyButton +5 more
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
- **AffectTab.tsx** (1) — AffectTabProps, AffectTab
- **BriefTab.tsx** (1) — BriefTabProps, BriefTab

## src/renderer/components/debate-diagnostics/window/overview-tabs/
- **AdaptiveStagingTab.tsx** (2) — AdaptiveStagingTab
- **ArgumentNetworkTab.tsx** (2) — ArgumentNetworkTab
- **EmotionalRegisterTab.tsx** (1) — EmotionalRegisterTab
- **ReflectionsTab.tsx** (1) — ReflectionsTab
- **UtilityTab.tsx** (1) — UtilityTab
- **index.ts** (0) — AdaptiveStagingTab, ReflectionsTab, ArgumentNetworkTab, UtilityTab, EmotionalRegisterTab

## src/renderer/components/debate-diagnostics/window/shared/
- **constants.ts** (10) — SUPPRESSION_REASON_TOOLTIPS, AIF_TOOLTIPS, POV_NODE_COLOR, DEBATER_COLORS, debaterColor +4 more
- **ScoreBreakdown.tsx** (3) — ScoreBreakdown, OutcomeBadge
- **CommitmentsPanel.tsx** (2) — CommitmentsPanel
- **DebateExchangeRich.tsx** (2) — DebateExchangeRich
- **EdgesUsed.tsx** (2) — edgeNodeColor, truncateLabel, EdgeUsed, EdgesUsedDetail, EdgesUsedGrouped
- **INodeRow.tsx** (2) — subScoreTip, INodeRow, SUB_SCORE_TIPS, BELIEF_KEYS
- **TensionsListDetail.tsx** (2) — TensionsListDetail
- **TurnValidation.tsx** (2) — CITE_HINT_RE, classifyHintTarget, HINT_TARGET_STYLE, TurnValidationAttemptRow, sanitizeTurnValidation +1 more

## src/renderer/components/debate-workspace/
- **utils.ts** (9) — speakerLabel, speakerColor, getPolicyAction, groundingLabel, GROUNDING_COLORS +18 more
- **ClaimsView.tsx** (3) — ClaimNodeRow, ClaimsView
- **TaxonomyRefs.tsx** (3) — CoverageBadge, TaxonomyPill, TaxonomyRefsSection
- **VocabularyPanel.tsx** (3) — LineageTermsView, VocabTermCard, VocabTermsView
- **ClarificationPanel.tsx** (2) — ClarificationCard, ClaimsEditor, ClarificationActions, RefinedTopicEditor, TopicScoreComparison
- **DebateActionBar.tsx** (2) — ProgressIndicator, TokenBudgetIndicator, PhaseProgressBar, SessionPhaseStepper, DebaterToggles +1 more
- **DebateWorkspace.tsx** (2) — DebateWorkspace
- **ExplorationSummaryCard.tsx** (2) — ExplorationSummaryCard

## src/renderer/components/debate-workspace/TopicCritique/
- **constants.ts** (4) — DIMENSION_LABELS, DIMENSION_TOOLTIPS, RATING_COLORS
- **CritiqueColumn.tsx** (2) — CritiqueColumn
- **RadarChart.tsx** (2) — RadarChart
- **TopicCritiqueCard.tsx** (2) — TopicCritiqueCard
- **index.ts** (0) — RadarChart, CritiqueColumn, TopicCritiqueCard, DIMENSION_LABELS, DIMENSION_TOOLTIPS +1 more

## src/renderer/components/edge-browser/
- **SearchPreview.tsx** (7) — SearchPreview
- **EdgeDetailPanel.tsx** (5) — useEdgeRationale, EdgeDetailPanel
- **RelatedEdgesPanel.tsx** (3) — RelatedEdgesPanel
- **EdgeBrowser.tsx** (2) — EdgeBrowser
- **SearchPanel.tsx** (2) — SearchPanel
- **FindBar.tsx** (1) — FindBar
- **SearchBar.tsx** (1) — SearchBar
- **SimilarSearchPanel.tsx** (1) — SimilarSearchPanel

## src/renderer/components/organizations/
- **StakeholderSection.tsx** (2) — StakeholderSection
- **OrganizationDetail.tsx** (1) — OrganizationDetail
- **OrganizationsTab.tsx** (0) — OrganizationsTab

## src/renderer/components/policy/
- **SourcesPanel.tsx** (4) — SourceReference, SourcesPanel
- **PhrasesPanel.tsx** (2) — PhrasesPanel
- **PolicySourcesPanel.tsx** (2) — PolicySourceReference, PolicySourcesPanel, getPolicySourceIndex

## src/renderer/components/settings/
- **SettingsDialog.tsx** (5) — SettingsDialog
- **ApiKeyDialog.tsx** (4) — ApiKeyDialog
- **ApiKeyErrorMessage.tsx** (4) — ApiKeyErrorMessage
- **HelpDialog.tsx** (4) — HelpTab, HelpDialog
- **GeminiOnboardingModal.tsx** (3) — GeminiOnboardingModal, shouldShowGeminiOnboarding, clearSessionDismiss
- **AdminPanel.tsx** (2) — AdminPanel
- **FirstRunDialog.tsx** (2) — FirstRunDialog
- **KeySharingDialog.tsx** (2) — KeySharingDialog

## src/renderer/components/shared/
- **DescriptionToggle.tsx** (11) — DescriptionMode, useDescriptionMode, resolveDescription, DescriptionToggle
- **ToolbarPaneRenderer.tsx** (7) — isFullWidthPanel, ToolbarPaneRenderer, PhoneToolClose
- **FieldHelp.tsx** (6) — FieldHelp
- **HighlightedField.tsx** (6) — HighlightedInput, HighlightedTextarea
- **DeleteConfirmDialog.tsx** (5) — DeleteConfirmDialog
- **LinkedChip.tsx** (4) — LinkedChip
- **PinnedPanel.tsx** (4) — PinnedPanel
- **TypeaheadSelect.tsx** (4) — TypeaheadSelect

## src/renderer/components/support/
- **CaseDetail.tsx** (1) — CaseDetail
- **MyCases.tsx** (1) — MyCases
- **SupportCaseForm.tsx** (1) — SupportCaseForm

## src/renderer/components/sync/
- **GitProgressBanner.tsx** (4) — GitProgressBanner
- **TaxonomyDiffPanel.tsx** (3) — NodeFieldChange, NodeDiffEntry, FileNodeDiff, NodeDiffResponse, TaxonomyDiffPanel
- **TaxonomyUpdateToast.tsx** (3) — TaxonomyUpdatedEvent, TaxonomyUpdateToast
- **RebaseConflictModal.tsx** (2) — RebaseConflictModal
- **SaveBar.tsx** (2) — SaveBar
- **SyncDiagnosticsDialog.tsx** (2) — SyncDiagnosticsDialog
- **UnsyncedChangesDrawer.tsx** (2) — UnsyncedChangesDrawer

## src/renderer/components/taxonomy/
- **TaxonomyRefDetail.tsx** (12) — TaxRefNode, TaxRefEdge, TaxonomyRefDetail, EDGE_TYPE_COLORS
- **NodeDetail.tsx** (6) — NodeDetail
- **QbafOverlay.tsx** (4) — QbafClaimBadge, QbafScoreSlider, QbafEdgeIndicator, QbafSummary
- **GraphAttributesPanel.tsx** (3) — GraphAttributesPanel
- **NodeTree.tsx** (3) — SortMode, ClusterGroup, getOrderedNodeIds, NodeTree
- **ArgumentGraph.tsx** (2) — ArgumentGraph, GraphNodeDetailPanel
- **NodeEditHistory.tsx** (2) — NodeEditHistory
- **PovTab.tsx** (2) — PovTab

## src/renderer/data/
- **lineageCategories.ts** (10) — LineageCategory, L2Category, getL2Categories, getLineageMapping, isLineageDataLoaded +11 more
- **promptCatalog.ts** (10) — PromptGroup, DataSourceId, PromptCatalogEntry, PROMPT_CATALOG
- **lineageLookup.ts** (9) — initLineageData, isLineageDataInitialized, getAllLineages, canonicalizeLineageKey, LineageLookupResult +3 more
- **epistemicTypeInfo.ts** (3) — AttributeInfoLink, AttributeInfo, EPISTEMIC_TYPES
- **debateProtocols.ts** (2) — 
- **fallacyInfo.ts** (2) — FallacyEntry, FALLACY_CATALOG
- **emotionalRegisterInfo.ts** (1) — EMOTIONAL_REGISTERS
- **rhetoricalStrategyInfo.ts** (1) — StrategyInfo, RHETORICAL_STRATEGIES

## src/renderer/hooks/
- **useFeatureFlags.ts** (20) — useFeatureFlagStore, useFlag
- **useBreakpoint.ts** (12) — Breakpoint, useBreakpoint
- **useResizablePanel.ts** (11) — useResizablePanel, useResizableRightPanel, useResizableVerticalSplit
- **useAuthStatus.ts** (7) — AuthInfo, QuotaLimits, UserProfile, useAuthStatus, useUserProfile
- **useCommunityStore.ts** (7) — CommunityItem, CommunityChat, CommunityDebate, Submission, useCommunityStore
- **useCommentStore.ts** (6) — CommentTypeMeta, COMMENT_TYPE_META, CommentFilters, useCommentStore, COMMENT_TYPES
- **useChatStore.ts** (5) — useChatStore
- **usePromptConfigStore.ts** (5) — PROMPT_CONFIG_DEFAULTS, usePromptConfigStore

## src/renderer/hooks/useDebateStore/
- **types.ts** (11) — DebateStore, ReflectionEdit, ReflectionResult, ConsensusProposal, ConsensusCluster +2 more
- **helpers.ts** (9) — _doctrinalAnchoringApplied, _boundaryEmbeddingsCache, resetDoctrinalAnchoringCache, _signalHistory, recordSignalHistory +65 more
- **store.ts** (2) — useDebateStore, initDebateSessions
- **index.ts** (0) — useDebateStore, initDebateSessions

## src/renderer/hooks/useDebateStore/slices/
- **argumentNetworkSlice.ts** (2) — ArgumentNetworkSlice, createArgumentNetworkSlice
- **clarificationSlice.ts** (2) — ClarificationSlice, createClarificationSlice
- **configSlice.ts** (2) — ConfigSlice, createConfigSlice
- **debateLoopSlice.ts** (2) — DebateLoopSlice, createDebateLoopSlice
- **explorationSlice.ts** (2) — ExplorationSlice, createExplorationSlice, EXPLORATION_PRESET
- **sessionSlice.ts** (2) — SessionSlice, createSessionSlice
- **synthesisSlice.ts** (2) — SynthesisSlice, createSynthesisSlice
- **topicCritiqueSlice.ts** (2) — TopicCritiqueSlice, createTopicCritiqueSlice

## src/renderer/hooks/useTaxonomyStore/
- **types.ts** (6) — TaxonomyStore, ToolbarPanel
- **index.ts** (1) — useTaxonomyStore, initAIModels, backendForModel, AI_BACKENDS, MODELS_BY_BACKEND +3 more
- **store.ts** (1) — useTaxonomyStore

## src/renderer/hooks/useTaxonomyStore/slices/
- **settingsSlice.ts** (4) — ColorScheme, AIBackend, GeminiModel, ClaudeModel, GroqModel +14 more
- **analysisSlice.ts** (3) — AnalysisElement, AnalysisSlice, createAnalysisSlice
- **searchSlice.ts** (3) — SearchMode, SearchSlice, createSearchSlice
- **taxonomyDataSlice.ts** (3) — PinnedData, PolicyRegistryEntry, CruxSource, AggregatedCrux, TaxonomyDataSlice +1 more

## src/renderer/lib/
- **analyticsEmitter.ts** (8) — initAnalytics, trackTabSwitch, trackNodeSelect, trackPanelOpen, trackSearch +11 more
- **flightRecorderInit.ts** (7) — initFlightRecorder, triggerManualDump, dumpOnReactError
- **clientConfig.ts** (6) — ClientConfig, getClientConfig, isClientConfigInitialized, onClientConfigRefresh, initClientConfig +1 more
- **parseHash.ts** (3) — parseHashParams
- **dumpToast.ts** (1) — showDumpToast, showDumpErrorToast
- **swEventListener.ts** (1) — initSwEventListener
- **trace.ts** (1) — TraceEvent, TraceEventName, newCallId, trace, flush

## src/renderer/prompts/
- **debate.ts** (7) — 
- **argumentNetwork.ts** (5) — 
- **research.ts** (4) — researchPrompt, conflictResearchPrompt
- **analysis.ts** (3) — distinctionAnalysisPrompt, NodeCritiqueContext, nodeCritiquePrompt, reflectionNodeEnrichmentPrompt, clusterLabelPrompt
- **chat.ts** (2) — CHAT_MODE_TEMPERATURE, chatSystemPrompt, chatOpeningPrompt, chatContinuationPrompt
- **vernacular.ts** (1) — VERNACULAR_MODEL, VERNACULAR_TEMPERATURE, VERNACULAR_TIMEOUT, VERNACULAR_VERSION, vernacularPrompt

## src/renderer/types/
- **debate.ts** (83) — 
- **taxonomy.ts** (47) — Pov, Category, FallacyTier, PossibleFallacy, GraphAttributes +34 more
- **chat.ts** (5) — ChatMode, ChatEntry, ChatSession, ChatSessionSummary, CHAT_MODE_INFO
- **validation.ts** (3) — Verdict, SecondaryRef, GoldenClaim, GoldenSetFile, ValidationResult +5 more
- **electron.d.ts** (0) — ElectronAPI

## src/renderer/utils/
- **errorMessages.ts** (10) — mapErrorToUserMessage
- **humanizeSpeakers.ts** (9) — humanizeSpeakerIds
- **syncApi.ts** (7) — SyncStatus, ResyncMode, CreatePrSuccess, ResyncSuccess, RebaseState +29 more
- **taxonomyContext.ts** (7) — 
- **regeneratePlainDescription.ts** (6) — regeneratePlainDescription, triggerPovNodeRegeneration, generatePlainPreview, triggerSituationNodeRegeneration
- **dolceCompliance.ts** (4) — ComplianceViolation, checkDolceCompliance
- **lineageMatcher.ts** (4) — invalidateLineageMatcherCache, extractLineageNames, injectLineageLinks, lineageMarkdownComponents, getLineageMarkdownComponents
- **searchRegex.ts** (4) — buildSearchRegex

## src/server/
- **logger.ts** (16) — RequestContext, runWithRequestContext, getRequestId, getRequestContext, generateRequestId +2 more
- **config.ts** (12) — loadDataConfig, getDataRoot, resolveDataPath, getSourcesRoot, getProjectRoot +21 more
- **runtimeConfig.ts** (11) — TierConfig, FreeTierConfig, RuntimeConfig, KNOWN_BACKENDS, validateAndMerge +10 more
- **serverLogBuffer.ts** (2) — MAX_LOG_LINES, recordServerLog, drainServerLogLines, _resetServerLogBuffer
- **errorAggregation.ts** (1) — ErrorEntry, TopError, ErrorSummary, normalizeMessage, summarizeErrors +2 more
- **featureFlags.ts** (1) — FlagDef, FlagAuditEntry, FlagUserContext, evaluateScope, getFlag +7 more
- **flightRecorderDumps.ts** (1) — MAX_DUMP_GROUPS, MAX_DUMP_BYTES, isValidDumpId, dumpsDir, DumpFileInfo +5 more
- **flightRecorderViewer.ts** (1) — escapeForInlineScript

## src/server/ai/
- **aiBackends.ts** (1) — BackendAvailability, computeAvailableBackends, setDebateTemperature, getDebateTemperature, GenerateTextProgress +17 more
- **providerBinding.ts** (1) — BindingResult, checkProviderBinding, _resetBindingsCache
- **proxyTiers.ts** (1) — TierLevel, TierLimits, ResolvedTier, isBackendAllowed, parseFreeTierKeys +4 more

## src/server/community/
- **community.ts** (4) — getAdminUsers, isAdmin, listCommunityChats, listCommunityDebates, loadCommunityItem +6 more
- **analytics.ts** (2) — AnalyticsEvent, AiCostBucket, AiCostSummary, QueryResult, AnalyticsBackend +5 more
- **edgesApi.ts** (1) — EdgesData, stripEdgeRationale
- **nodeConflicts.ts** (1) — TaxNode, NodeConflict, computeNodeConflicts

## src/server/community/admin/
- **types.ts** (4) — ReviewDomain, ReviewItem, ReviewAction, ReviewStats, ReviewDomainHandler
- **calibrationHandler.ts** (1) — calibrationReviewHandler
- **communityReviewHandler.ts** (1) — communityReviewHandler
- **reviewRegistry.ts** (1) — registerReviewHandler, getReviewHandler, listReviewHandlers, clearReviewHandlers, requireAdmin +4 more

## src/server/scripts/
- **migrateUserContentToBlob.ts** (0) — MigrationSummary, MigrateOptions, collectUserContentPaths, migrateUserContent

## src/server/security/
- **userContext.ts** (11) — UserContext, runWithUser, getCurrentUser, getCurrentUserId, getStorageUserId +5 more
- **githubAppAuth.ts** (3) — SyncCredentials, setRuntimeCredentials, clearRuntimeCredentials, getRepoSlug, getTokenExpiryMs +2 more
- **contentSanitizer.ts** (2) — sanitizeUserText, sanitizeDeep
- **quotas.ts** (2) — QuotaLimits, getQuotaLimits, QuotaCheckResult, checkQuota
- **accessControl.ts** (1) — invalidRouteParam, expiredAuthCookies, hasEasyAuthSessionCookie, TestPersona, resolveTestPersonaOverride +7 more
- **keyRotator.ts** (1) — isRateLimited, markRateLimited, clearExpiredLimits, getNextKey, _resetRotatorState
- **keyStore.ts** (1) — KeyRotationResult, KeyStore, parseKeys, getKeyStore
- **rateLimiter.ts** (1) — RateCheckResult, checkRequestRate, checkRate, TOKEN_MILESTONES, recordTokenUsage +3 more

## src/server/storage/
- **fileIO.ts** (6) — setBackend, getBackend, setTaxonomyBackend, setUserContentBackend, getUserContentBackend +87 more
- **storageBackend.ts** (5) — StorageBackend
- **editMeta.ts** (3) — nodeContentHash, diffNodes, changedFields, stampNodeAuthorship
- **anonymousSessionStore.ts** (2) — AnonymousSessionStore, initAnonymousSessionStore, getAnonymousSessionStore
- **githubAPIBackend.ts** (2) — SessionContext, TreeEntry, FileChange, CompareResult, GitHubAPIBackendConfig +1 more
- **feedbackStore.ts** (1) — FEEDBACK_CATEGORIES, FeedbackCategory, isFeedbackCategory, FeedbackQuery, FeedbackPage +2 more
- **filesystemBackend.ts** (1) — FilesystemBackend
- **sessionBranchManager.ts** (1) — sanitizeBranchName, SessionBranchState, SessionBranchManager

## src/server/support/
- **types.ts** (2) — CaseStatus, CasePriority, Attachment, CaseResponse, SupportCaseSystemInfo +7 more
- **supportStore.ts** (1) — attachmentBlobPath, createCase, getCase, listCasesForUser, listAllCases +6 more

