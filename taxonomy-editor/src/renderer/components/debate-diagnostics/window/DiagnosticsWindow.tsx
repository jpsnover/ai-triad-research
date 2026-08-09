// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Standalone diagnostics window — always-on-top popout that receives
 * state updates from the main window via IPC.
 *
 * Phase 2 shell: state lives in useDiagnosticsState, tab content in
 * OverviewTabRouter / EntryDetailRouter, shared components in ./shared.
 */

import { api } from '@bridge';
import { triggerManualDump } from '../../../lib/flightRecorderInit';
import { DiagnosticsChatSidebar } from '../chat';
import { useDiagnosticsState } from './useDiagnosticsState';
import { DiagSearchContext, SearchBar, speakerLabel } from './helpers';
import { OverviewTabRouter } from './OverviewTabRouter';
import { EntryDetailRouter } from './EntryDetailRouter';
import { CopyLinkButton } from '../../shared/CopyLinkButton';
import { BookmarkLink } from '../../shared';
import type { OverviewTab } from './types';
import type { DebateSession } from '../../../types/debate';
import type { RefObject } from 'react';
import './DiagnosticsWindow.css';

// ---------------------------------------------------------------------------
// HelpContent — static reference panel
// ---------------------------------------------------------------------------

function HelpContent() {
  return (
    <div className="diag-help">
      <h3>Argument Interchange Format (AIF)</h3>
      <p>
        The AIF is a formal ontology for representing argumentation, established by
        Chesnevar et al. (2006). It provides a shared vocabulary for describing how
        arguments are constructed, how they relate to each other, and how conflicts
        between them are resolved.
      </p>
      <p className="diag-help-ref">
        Reference: Chesnevar, C., McGinnis, J., Modgil, S., Rahwan, I., Reed, C., Simari, G., South, M., Vreeswijk, G., &amp; Willmott, S. (2006).
        &quot;Towards an Argument Interchange Format.&quot; <em>The Knowledge Engineering Review</em>, 21(4), 293-316.
        [<a href="#" onClick={(e) => { e.preventDefault(); void api.openExternal('https://jmvidal.cse.sc.edu/library/chesnevar06a.pdf'); }}>PDF</a>]
      </p>
      <p>The core building blocks are:</p>
      <ul>
        <li><strong>I-nodes (Information nodes)</strong> — claims, propositions, or data points.
          These are the passive content of arguments: &quot;Scaling compute is sufficient for AGI&quot;
          or &quot;Current AI systems exhibit bias.&quot; In this tool, each <strong>AN-</strong> entry
          in the Argument Network is an I-node.</li>
        <li><strong>RA-nodes (Rule Application)</strong> — inference schemes that explain WHY
          one claim supports another. When you see a <span className="diag-help-support">support</span> edge
          with a <em>warrant</em>, that warrant is the RA-node: the reasoning pattern connecting
          evidence to conclusion.</li>
        <li><strong>CA-nodes (Conflict Application)</strong> — attack relationships between claims.
          Three types:
          <ul>
            <li><strong className="diag-help-attack">Rebut</strong> — directly contradicts the conclusion
              (&quot;No, scaling is NOT sufficient&quot;)</li>
            <li><strong className="diag-help-attack">Undercut</strong> — accepts the evidence but denies the
              inference (&quot;The evidence is real but doesn&apos;t prove what you claim&quot;)</li>
            <li><strong className="diag-help-attack">Undermine</strong> — attacks the credibility of the
              premise itself (&quot;That study was flawed&quot;)</li>
          </ul>
        </li>
        <li><strong>PA-nodes (Preference Application)</strong> — resolve conflicts by determining
          which argument prevails. In this tool, these appear in the synthesis as
          <em>Preference Verdicts</em> with criteria like empirical evidence strength or
          logical validity.</li>
      </ul>

      <h3>The Argument Network</h3>
      <p>
        The Argument Network is built incrementally during the debate. After each debater
        speaks, the tool extracts 1-4 key claims from their statement and maps how those
        claims relate to prior claims.
      </p>
      <p>Reading the network:</p>
      <ul>
        <li><strong>AN-1, AN-2, ...</strong> — claim identifiers, in order of appearance</li>
        <li><strong>(Accelerationist), (Safetyist), (Skeptic)</strong> — who made the claim</li>
        <li><span className="diag-help-attack">&larr; AN-6 rebut via REFRAME</span> — claim AN-6 attacks
          this claim. &quot;rebut&quot; is the attack type; &quot;REFRAME&quot; is the dialectical scheme
          (the argumentative strategy used)</li>
        <li><span className="diag-help-support">&larr; AN-3 supports</span> — claim AN-3 provides evidence
          or reasoning for this claim</li>
        <li><strong>Warrant</strong> — the reasoning link explaining WHY the support or attack
          relationship holds. This is the AIF S-node made visible.</li>
      </ul>

      <h3>Dialectical Schemes</h3>
      <table>
        <thead>
          <tr>
            <th>Scheme</th>
            <th>AIF Type</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>CONCEDE</td><td>Support (RA)</td><td>Accept opponent&apos;s point</td></tr>
          <tr><td>DISTINGUISH</td><td>Undercut (CA)</td><td>Accept evidence, deny it applies here</td></tr>
          <tr><td>REFRAME</td><td>Scheme shift</td><td>Shift the interpretive frame</td></tr>
          <tr><td>COUNTEREXAMPLE</td><td>Rebut (CA)</td><td>Specific case contradicting the claim</td></tr>
          <tr><td>REDUCE</td><td>Rebut (CA)</td><td>Show the logic leads to absurdity</td></tr>
          <tr><td>ESCALATE</td><td>Scheme shift</td><td>Connect to a broader principle</td></tr>
        </tbody>
      </table>

      <h3>Commitment Stores</h3>
      <p>
        Each debater has a commitment store tracking what they&apos;ve <strong>asserted</strong> (claimed
        to be true), <strong>conceded</strong> (accepted from an opponent), and <strong>challenged</strong> (questioned
        or attacked). Contradictions between assertions and concessions are flagged.
        Commitments are injected into each debater&apos;s prompt to enforce consistency.
      </p>

      <h3>Methodology: AIF-Informed, Not AIF-Formal</h3>
      <p>
        This tool adopts AIF <strong>vocabulary</strong> (I-nodes, CA-nodes, RA-nodes,
        attack types, schemes, warrants) but deliberately does not implement the full
        formal <strong>bipartite graph</strong> that AIF specifies. In a fully
        AIF-compliant system, I-nodes never connect directly — every support and attack
        relationship passes through an intermediate S-node (scheme node) that carries
        the reasoning pattern. Our system stores scheme, warrant, and attack type as
        properties on the edge connecting two I-nodes.
      </p>

      <h4>Why not the full bipartite graph?</h4>

      <p><strong>LLM extraction reliability.</strong> Claims are extracted from debate
        statements by a background AI call after each turn. Asking the LLM to produce
        bipartite JSON (I-node &rarr; S-node &rarr; I-node triples) significantly increases
        the structured-output complexity and error rate. The current flat format (I-node
        &rarr; I-node with typed edges) is validated at 40% word-overlap against the
        original statement text. Adding intermediate nodes would roughly triple the
        output surface for hallucination and parse failures, without improving the
        information captured.</p>

      <p><strong>No consumer requires it.</strong> The moderator&apos;s cross-respond selection,
        commitment tracking, synthesis argument maps, and harvest pipeline all work on
        the flat I-node + typed-edge model. S-node content (scheme, warrant, critical
        questions) is captured — it&apos;s just stored on the edge rather than as a separate
        node. Every query the system needs to answer (&quot;what claims has the Accelerationist
        made?&quot;, &quot;what attacks are unaddressed?&quot;, &quot;which rebuts used COUNTEREXAMPLE?&quot;)
        is answerable from the current structure.</p>

      <p><strong>Visualization simplicity.</strong> Most argument visualization tools
        (Argdown, Kialo, Dialectica) hide S-nodes from users because the bipartite
        indirection makes graphs harder to read. Our diagnostics panel displays
        I-nodes directly with their attack/support relationships — adding
        intermediate S-nodes would double the visual elements without improving
        comprehension.</p>

      <p><strong>Extraction architecture.</strong> Claims are extracted by an independent
        &quot;analyst&quot; AI call, separate from the debater that produced the statement.
        This separation matters: the debater knows what it intended to argue, but
        self-assessment is biased (debaters overclaim the strength of their own
        attacks). The independent extractor provides a second opinion on relationship
        types. A bipartite graph would not change this architecture but would make
        the extractor&apos;s job harder.</p>

      <h4>What we preserve from AIF</h4>
      <table className="diag-help-table-spaced">
        <thead>
          <tr>
            <th>AIF Concept</th>
            <th>How We Implement It</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>I-nodes (claims)</td><td>AN-1, AN-2, ... in argument_network.nodes</td></tr>
          <tr><td>CA-nodes (conflict)</td><td>attack_type (rebut/undercut/undermine) on edges</td></tr>
          <tr><td>RA-nodes (inference)</td><td>warrant + scheme on support edges</td></tr>
          <tr><td>PA-nodes (preference)</td><td>Synthesis preferences (prevails, criterion, rationale)</td></tr>
          <tr><td>Schemes</td><td>COUNTEREXAMPLE, DISTINGUISH, etc. on edges</td></tr>
          <tr><td>Commitment stores</td><td>Per-debater asserted/conceded/challenged</td></tr>
          <tr><td>Locutions</td><td>Transcript entry types (statement, question, probing)</td></tr>
        </tbody>
      </table>

      <p>
        The guiding principle is <strong>vocabulary over formalism</strong>: use AIF&apos;s
        analytical distinctions to improve debate quality and transparency, but keep
        the data in simple JSON structures that LLMs can reliably produce and the UI
        can directly render. If external AIF tool interoperability becomes a
        requirement, a bipartite export layer can be added without changing the
        internal representation.
      </p>

      <h3>Methods and Algorithms</h3>
      <p>
        The debate engine uses a <strong>neural-symbolic architecture</strong>: LLMs generate
        content and make soft judgments while symbolic components (QBAF propagation, BFS graph
        traversal, deterministic validation, move-edge classification) provide structure,
        verification, and explanation.
      </p>
      <p>Key algorithms and methods:</p>
      <ul>
        <li><strong>QBAF (Quantitative Bipolar Argumentation Frameworks)</strong> — DF-QuAD gradual
          semantics propagate argument strength through attack/support networks. BDI-aware base
          score calibration handles the asymmetry between empirical and normative claims.</li>
        <li><strong>FIRE (Confidence-gated Iterative Extraction)</strong> — Replaces single-shot
          claim extraction with per-claim confidence assessment and iterative refinement.
          Addresses specificity collapse, warrant deficit, and claim clustering.</li>
        <li><strong>4-Stage Turn Pipeline (BRIEF &rarr; PLAN &rarr; DRAFT &rarr; CITE)</strong> — Each turn is
          decomposed into four stages with per-stage temperatures and deterministic JSON
          chaining between stages.</li>
        <li><strong>Adaptive Staging</strong> — Seven convergence diagnostics (computed
          deterministically from the argument network) track debate health and trigger
          phase transitions (confrontation &rarr; argumentation &rarr; concluding).</li>
        <li><strong>Dialectic Traces</strong> — Deterministic BFS traversal through the argument
          network produces human-readable narrative chains explaining why a position prevailed.</li>
        <li><strong>13-Scheme Taxonomy</strong> — Derived from Walton&apos;s argumentation schemes,
          each with scheme-specific critical questions that guide moderator steering.</li>
        <li><strong>14-Move Moderator Intervention</strong> — Six families (procedural through
          synthesis) governed by a neural-symbolic trigger architecture: the LLM recommends,
          the engine validates against deterministic constraints.</li>
      </ul>
      <p className="diag-help-ref">
        Full methodology: see <code>docs/academic-paper-draft.md</code> in the project repository
        for the complete technical paper describing all algorithms, evaluation results, and
        theoretical grounding. Additional detail in <code>docs/debate-engine-design.md</code>,{' '}
        <code>docs/document-processing-pipeline.md</code>, and <code>docs/design/adaptive-debate-staging.md</code>.
      </p>

      <h3>Per-Entry Diagnostics</h3>
      <p>
        Click any transcript entry to see its internals: each pipeline stage (Brief, Plan, Draft, Cite),
        the raw response, which claims were extracted (with validation scores), the taxonomy
        context injected, and what commitments were active at that point.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar tab model + per-section builders (split to keep each ≤ complexity 15)
// ---------------------------------------------------------------------------

type SidebarTab = { id: OverviewTab; label: string; badge?: string; visible: boolean };
type SidebarSection = { header: string; tabs: SidebarTab[] };

function buildDebateSection(debate: DebateSession, hasAn: boolean, hasCommitments: boolean): SidebarSection {
  return { header: 'DEBATE', tabs: [
    { id: 'topic-scope', label: 'Topic Scope', visible: !!debate.topic?.scope },
    { id: 'argument-network', label: 'Arg Net', visible: hasAn },
    { id: 'commitments', label: 'Commitments', visible: hasCommitments },
    { id: 'transcript', label: `Transcript (${debate.transcript.filter(e => e.type === 'statement' || e.type === 'opening').length} stmts / ${debate.transcript.length} total)`, visible: true },
    { id: 'convergence', label: `Convergence (${debate.convergence_signals?.length ?? 0})`, visible: !!(debate.convergence_signals && debate.convergence_signals.length > 0) },
    { id: 'gaps', label: 'Gaps', visible: !!(debate.taxonomy_gap_analysis || (debate.gap_injections && debate.gap_injections.length > 0) || (debate.cross_cutting_proposals && debate.cross_cutting_proposals.length > 0)) },
    { id: 'pov-progression', label: 'Perspective Progression', visible: true },
    { id: 'reflections', label: 'Post-Debate Reflections', visible: debate.transcript.some(e => e.type === 'reflection') },
  ]};
}

function buildEvidenceSection(debate: DebateSession, plateau: boolean): SidebarSection {
  return { header: 'EVIDENCE', tabs: [
    { id: 'extraction', label: 'Extraction', badge: plateau ? '⚠' : undefined, visible: true },
    { id: 'grounding', label: `Grounding (${debate.transcript.reduce((n, e) => n + (e.taxonomy_refs?.length ? 1 : 0), 0)})`, visible: debate.transcript.some(e => e.taxonomy_refs && e.taxonomy_refs.length > 0) },
    { id: 'lineage', label: `Lineage (${debate.topic.critique?.lineage_frame?.length ?? 0})`, visible: !!(debate.topic.critique?.lineage_frame && debate.topic.critique.lineage_frame.length > 0) },
  ]};
}

function buildEngineSection(debate: DebateSession, hasAn: boolean): SidebarSection {
  return { header: 'ENGINE', tabs: [
    { id: 'utility', label: 'Agent Utility', visible: hasAn },
    { id: 'exclusion-overview', label: 'Exclusion Guard', visible: true },
    { id: 'emotional-register', label: 'Emotional Register', visible: true },
    { id: 'adaptive', label: 'Adaptive', visible: !!(debate as unknown as Record<string, unknown>).adaptive_staging_diagnostics },
    { id: 'prompt-diff', label: 'Prompt Diff', visible: true },
    { id: 'fr-context', label: 'Flight Recorder', visible: true },
  ]};
}

// ---------------------------------------------------------------------------
// DiagnosticsHeader — header bar (extracted to keep DiagnosticsWindow ≤ complexity 15)
// ---------------------------------------------------------------------------

function DiagnosticsHeader({
  debate, showHelp, setShowHelp, searchQuery, setSearchQuery, matchCount, searchInputRef,
}: {
  debate: DebateSession | null;
  showHelp: boolean;
  setShowHelp: (v: boolean) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  matchCount: number;
  searchInputRef?: RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="diag-window-header">
      <h2 className="diag-window-title">Debate Diagnostics</h2>
      {debate && (
        <>
          <span className="diag-window-debate-title" title={debate.title}>
            {debate.title}
          </span>
          <button
            onClick={() => { void api.clipboardWriteText(debate.id); }}
            className="diag-window-id-suffix"
            title={`Copy full debate ID: ${debate.id}`}
          >…{debate.id.slice(-6)} ⧉</button>
          <span className="diag-window-ts" title={`Session start — matches flight recorder filename`}>
            {new Date(debate.created_at).toISOString().replace(/\.\d{3}Z$/, 'Z')}
          </span>
        </>
      )}
      {debate && !showHelp && <SearchBar query={searchQuery} setQuery={setSearchQuery} matchCount={matchCount} inputRef={searchInputRef} />}
      {(!debate || showHelp) && <div style={{ flex: 1 }} />}
      <button
        onClick={() => { void triggerManualDump(); }}
        title="Dump flight recorder to disk (Ctrl+Alt+D)"
        className="diag-dump-btn"
      >
        Dump Log
      </button>
      <button
        onClick={() => setShowHelp(!showHelp)}
        className="diag-help-btn"
        style={{ background: showHelp ? 'var(--warning, var(--warning))' : 'none', color: showHelp ? '#000' : 'var(--warning, var(--warning))' }}
      >
        {showHelp ? 'Close Help' : 'Help'}
      </button>
      <BookmarkLink docPath="docs/debate-diagnostics-field-guide.md" size="xs" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// DiagnosticsWindow — thin shell
// ---------------------------------------------------------------------------

export function DiagnosticsWindow({ initialData }: { initialData?: Record<string, unknown> } = {}) {
  const state = useDiagnosticsState(initialData);
  const {
    debate,
    selectedEntry, setSelectedEntry,
    setLocalOverride,
    showHelp, setShowHelp,
    searchQuery, setSearchQuery,
    entryTab, setEntryTab,
    overviewTab, setOverviewTab,
    transcriptSpeakerFilter, setTranscriptSpeakerFilter,
    focusedNodeId, setFocusedNodeId,
    anFilterNodeId, setAnFilterNodeId,
    anFilterMode, setAnFilterMode,
    taxNodeMap, policyMap, allEdges,
    selectedTaxRefId, setSelectedTaxRefId,
    selectedPolicyId, setSelectedPolicyId,
    textCopyMenu, setTextCopyMenu,
    nodeLabels,
    tabContentRef, searchInputRef, sidebarTranscriptRef,
    handleUpdateSubScore, handleChatNavigate,
    entry, diag, turnValTrail, meta,
    an, commitments,
    nodeWeights, proxiedModeratorTrace,
    effectiveOverviewTab, perTurnUtilities, matchCount, sq,
    deepLinkError,
  } = state;

  const entryIdx = entry ? debate?.transcript.findIndex(e => e.id === entry.id) ?? -1 : -1;

  return (
    <DiagSearchContext.Provider value={sq}>
    <div className="diag-window">
    <div className="diag-window-content">

      {/* ── Header bar ── */}
      <DiagnosticsHeader
        debate={debate}
        showHelp={showHelp}
        setShowHelp={setShowHelp}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        matchCount={matchCount}
        searchInputRef={searchInputRef}
      />

      {showHelp && <HelpContent />}
      {!debate && !showHelp && (
        deepLinkError
          ? <p style={{ color: 'var(--error, var(--danger))', padding: '1rem' }}>{deepLinkError}</p>
          : (
            <div className="diag-loading" role="status" aria-live="polite">
              <span className="diag-loading-spinner" aria-hidden="true" />
              <span>Loading debate data… large debates may take a while.</span>
            </div>
          )
      )}

      {/* ── Main content area ── */}
      {debate && (
        <div className="diag-window-body">

          {/* Vertical tab sidebar — always visible */}
          {(() => {
            const hasAn = !!(an && an.nodes.length > 0);
            const hasCommitments = !!(commitments && Object.keys(commitments).length > 0);
            const plateau = debate.extraction_summary?.plateau_detected === true;
            const sections: SidebarSection[] = [
              buildDebateSection(debate, hasAn, hasCommitments),
              buildEvidenceSection(debate, plateau),
              buildEngineSection(debate, hasAn),
            ];
            return (
              <div className="diag-tab-sidebar">
                {sections.map(section => {
                  const visibleTabs = section.tabs.filter(t => t.visible);
                  if (visibleTabs.length === 0) return null;
                  return (
                    <div key={section.header}>
                      <div className="diag-sidebar-section-header">{section.header}</div>
                      {visibleTabs.map(t => (
                  <div key={t.id}>
                    <button
                      onClick={() => { setOverviewTab(t.id); setSelectedEntry(null); setLocalOverride(true); }}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '4px 8px', fontSize: 'var(--text-2xs)', fontWeight: 600,
                        borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                        border: 'none',
                        background: t.id === effectiveOverviewTab ? 'var(--warning, var(--warning))' : 'transparent',
                        color: t.id === effectiveOverviewTab ? '#000' : 'var(--text-primary)',
                      }}
                    >
                      {t.label}{t.badge ? ` ${t.badge}` : ''}
                    </button>
                    {t.id === 'transcript' && effectiveOverviewTab === 'transcript' && (
                      <div ref={sidebarTranscriptRef} className="diag-sidebar-transcript">
                        {debate.transcript.map((e, i) => {
                          const stmtId = `S${i + 1}`;
                          return (
                            <div
                              key={e.id}
                              data-entry-id={e.id}
                              onClick={() => { setSelectedEntry(e.id); setLocalOverride(true); }}
                              className="diag-sidebar-entry"
                              style={{
                                background: selectedEntry === e.id ? 'color-mix(in srgb, var(--accent, var(--color-acc)) 12%, transparent)' : 'transparent',
                              }}
                              title={`${speakerLabel(e.speaker)} [${e.type}]: ${e.content.slice(0, 80)}`}
                            >
                              <span className="diag-sidebar-stmt-id">{stmtId}</span>
                              <span className="diag-sidebar-speaker">{speakerLabel(e.speaker)}</span>
                              <span onClick={(ev) => ev.stopPropagation()} className="diag-sidebar-copylink">
                                <CopyLinkButton hash={`#diagnostics-window?debateId=${debate.id}&entry=${i}&tab=${entryTab}`} title="Copy link to this entry" />
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {/* Content area — side-by-side master-detail on desktop */}
          {(() => {
            const hideOverviewForEntry = effectiveOverviewTab === 'transcript' && !!selectedEntry;
            return (
          <div className="diag-window-master-detail">
            {/* Overview pane — hidden when a transcript child is selected */}
            {!hideOverviewForEntry && (
            <div style={{
              flex: selectedEntry ? '0 0 35%' : '1 1 auto',
              minWidth: selectedEntry ? 280 : 0,
              maxWidth: selectedEntry ? '45%' : 'none',
              overflow: 'hidden', display: 'flex', flexDirection: 'column',
              borderRight: selectedEntry ? '1px solid var(--border)' : 'none',
              marginRight: selectedEntry ? 8 : 0,
            }}>
              <OverviewTabRouter
                debate={debate}
                an={an}
                commitments={commitments}
                effectiveOverviewTab={effectiveOverviewTab}
                selectedEntry={selectedEntry}
                setSelectedEntry={setSelectedEntry}
                setOverviewTab={setOverviewTab}
                setLocalOverride={setLocalOverride}
                focusedNodeId={focusedNodeId}
                setFocusedNodeId={setFocusedNodeId}
                anFilterMode={anFilterMode}
                anFilterNodeId={anFilterNodeId}
                setAnFilterMode={setAnFilterMode}
                setAnFilterNodeId={setAnFilterNodeId}
                handleUpdateSubScore={handleUpdateSubScore}
                transcriptSpeakerFilter={transcriptSpeakerFilter}
                setTranscriptSpeakerFilter={setTranscriptSpeakerFilter}
                perTurnUtilities={perTurnUtilities}
                nodeLabels={nodeLabels}
                searchQuery={sq}
              />
            </div>
            )}

            {/* Entry detail pane */}
            {selectedEntry && entry && effectiveOverviewTab !== 'prompt-diff' && effectiveOverviewTab !== 'utility' && (
              <div className="diag-window-entry-pane">
                <EntryDetailRouter
                  debate={debate}
                  entry={entry}
                  entryIdx={entryIdx}
                  diag={diag}
                  meta={meta}
                  turnValTrail={turnValTrail}
                  an={an}
                  commitments={commitments}
                  entryTab={entryTab}
                  setEntryTab={setEntryTab}
                  effectiveOverviewTab={effectiveOverviewTab}
                  selectedEntry={selectedEntry}
                  setSelectedEntry={setSelectedEntry}
                  setOverviewTab={setOverviewTab}
                  setLocalOverride={setLocalOverride}
                  proxiedModeratorTrace={proxiedModeratorTrace}
                  taxNodeMap={taxNodeMap}
                  policyMap={policyMap}
                  allEdges={allEdges}
                  nodeWeights={nodeWeights}
                  selectedTaxRefId={selectedTaxRefId}
                  setSelectedTaxRefId={setSelectedTaxRefId}
                  selectedPolicyId={selectedPolicyId}
                  setSelectedPolicyId={setSelectedPolicyId}
                  textCopyMenu={textCopyMenu}
                  setTextCopyMenu={setTextCopyMenu}
                  tabContentRef={tabContentRef}
                  searchQuery={sq}
                  perTurnUtilities={perTurnUtilities}
                  nodeLabels={nodeLabels}
                />
              </div>
            )}
          </div>
            );
          })()}

        </div>
      )}

    </div>
      <DiagnosticsChatSidebar
        debate={debate}
        selectedEntry={selectedEntry}
        currentTab={entryTab}
        onNavigate={handleChatNavigate}
      />
    </div>
    </DiagSearchContext.Provider>
  );
}
