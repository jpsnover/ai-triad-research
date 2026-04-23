// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Standalone diagnostics window — always-on-top popout that receives
 * state updates from the main window via IPC.
 */

import { useState, useEffect, useMemo, createContext, useContext } from 'react';
import { api } from '@bridge';
import { POVER_INFO } from '../types/debate';
import type { PoverId, DebateSession, EntryDiagnostics, ArgumentNetworkNode, ArgumentNetworkEdge, CommitmentStore, TurnValidationTrail, TurnValidation, TurnAttempt } from '../types/debate';
import { computeQbafStrengths } from '@lib/debate';
import type { QbafNode, QbafEdge } from '@lib/debate';
import { getMoveName } from '@lib/debate/helpers';
import type { MoveAnnotation } from '@lib/debate/helpers';
import { ExtractionTimelinePanel } from './ExtractionTimelinePanel';
import { ConvergenceSignalsPanel } from './ConvergenceSignalsPanel';
import { TaxonomyRefDetail, type TaxRefNode } from './TaxonomyRefDetail';

const DiagSearchContext = createContext('');

const AIF_TOOLTIPS: Record<string, string> = {
  'I-node': 'I-node (Information node) — a claim, proposition, or data point. These are the passive content of arguments: what is being asserted.',
  'CA-node': 'CA-node (Conflict Application) — an attack relationship. Three types: rebut (contradicts conclusion), undercut (denies the inference), undermine (attacks premise credibility).',
  'RA-node': 'RA-node (Rule Application) — an inference scheme explaining WHY one claim supports another. The warrant is the reasoning pattern connecting evidence to conclusion.',
  'PA-node': 'PA-node (Preference Application) — resolves conflicts by determining which argument prevails and why, based on criteria like evidence strength or logical validity.',
};

function AifBadge({ type, label }: { type: 'I-node' | 'CA-node' | 'RA-node' | 'PA-node'; label?: string }) {
  const [showTip, setShowTip] = useState(false);
  const colors: Record<string, { bg: string; fg: string }> = {
    'I-node': { bg: 'rgba(59,130,246,0.15)', fg: '#3b82f6' },
    'CA-node': { bg: 'rgba(239,68,68,0.15)', fg: '#ef4444' },
    'RA-node': { bg: 'rgba(34,197,94,0.15)', fg: '#22c55e' },
    'PA-node': { bg: 'rgba(139,92,246,0.15)', fg: '#8b5cf6' },
  };
  const c = colors[type] || colors['I-node'];
  return (
    <span
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setShowTip(true)}
      onMouseLeave={() => setShowTip(false)}
    >
      <span style={{ background: c.bg, color: c.fg, padding: '1px 5px', borderRadius: 3, fontSize: '0.6rem', fontWeight: 700, marginRight: 4, cursor: 'default' }}>
        {label || type}
      </span>
      {showTip && (
        <span style={{
          position: 'absolute', left: 0, top: '100%', marginTop: 4, zIndex: 1000,
          background: '#1a1a2e', color: '#e0e0e0', padding: '6px 10px', borderRadius: 6,
          fontSize: '0.7rem', lineHeight: 1.4, width: 320, whiteSpace: 'normal',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)', border: '1px solid #333',
        }}>
          {AIF_TOOLTIPS[type]}
        </span>
      )}
    </span>
  );
}

function speakerLabel(speaker: string): string {
  if (speaker === 'system') return 'Moderator';
  if (speaker === 'user') return 'You';
  return POVER_INFO[speaker as Exclude<PoverId, 'user'>]?.label || speaker;
}

function TrafficLight({ pass, label, tip }: { pass: boolean; label: string; tip: string }) {
  return (
    <span
      title={tip}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 6px', borderRadius: 10,
        background: pass ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
        color: pass ? '#16a34a' : '#dc2626',
        fontSize: '0.7rem', fontWeight: 600,
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'currentColor' }} />
      {label}
    </span>
  );
}

function OutcomeBadge({ outcome }: { outcome: TurnValidation['outcome'] }) {
  const palette: Record<TurnValidation['outcome'], { bg: string; fg: string; text: string }> = {
    pass:              { bg: 'rgba(34,197,94,0.15)',  fg: '#16a34a', text: 'PASS' },
    accept_with_flag:  { bg: 'rgba(234,179,8,0.18)',  fg: '#b45309', text: 'ACCEPT (flagged)' },
    retry:             { bg: 'rgba(239,68,68,0.15)',  fg: '#dc2626', text: 'RETRY' },
    skipped:           { bg: 'rgba(148,163,184,0.18)', fg: '#475569', text: 'SKIPPED' },
  };
  const c = palette[outcome] ?? palette.pass;
  return (
    <span style={{
      background: c.bg, color: c.fg, fontWeight: 700, fontSize: '0.7rem',
      padding: '2px 8px', borderRadius: 10, letterSpacing: 0.5,
    }}>{c.text}</span>
  );
}

function TurnValidationAttemptRow({ a }: { a: TurnAttempt }) {
  const [open, setOpen] = useState(false);
  const v = a.validation;
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 4, marginBottom: 6 }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          cursor: 'pointer', padding: '6px 8px', display: 'flex',
          alignItems: 'center', gap: 8, fontSize: '0.75rem',
        }}
      >
        <span style={{ color: 'var(--text-muted)' }}>{open ? '▾' : '▸'}</span>
        <strong>Attempt {a.attempt}{a.attempt === 0 ? ' (original)' : ''}</strong>
        <OutcomeBadge outcome={v.outcome} />
        <span style={{ color: 'var(--text-muted)' }}>score {v.score.toFixed(2)}</span>
        <span style={{ color: 'var(--text-muted)' }}>{(a.response_time_ms / 1000).toFixed(1)}s</span>
        {v.judge_used && <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>judge: {v.judge_model}</span>}
      </div>
      {open && (
        <div style={{ padding: '4px 10px 10px', fontSize: '0.72rem' }}>
          {v.repairHints.length > 0 && (
            <>
              <div style={{ fontWeight: 600, marginTop: 4 }}>Repair hints</div>
              <ul style={{ margin: '2px 0 6px 16px', padding: 0 }}>
                {v.repairHints.map((h, i) => <li key={i}>{h}</li>)}
              </ul>
            </>
          )}
          {v.clarifies_taxonomy.length > 0 && (
            <>
              <div style={{ fontWeight: 600, marginTop: 4 }}>Taxonomy clarification hints</div>
              <ul style={{ margin: '2px 0 6px 16px', padding: 0 }}>
                {v.clarifies_taxonomy.map((h, i) => (
                  <li key={i}>
                    <strong>{h.action}</strong>
                    {h.node_id ? ` ${h.node_id}` : h.label ? ` "${h.label}"` : ''}
                    {h.rationale ? ` — ${h.rationale}` : ''}
                  </li>
                ))}
              </ul>
            </>
          )}
          {a.prompt_delta && (
            <>
              <div style={{ fontWeight: 600, marginTop: 4 }}>Repair prompt delta</div>
              <pre style={{
                whiteSpace: 'pre-wrap', background: 'var(--bg-subtle)',
                padding: 6, borderRadius: 3, maxHeight: 200, overflow: 'auto',
                fontSize: '0.7rem',
              }}>{a.prompt_delta}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TurnValidationSection({ trail }: { trail: TurnValidationTrail }) {
  const f = trail.final;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <OutcomeBadge outcome={f.outcome} />
        <span style={{ fontSize: '0.8rem' }}>score <strong>{f.score.toFixed(2)}</strong></span>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {trail.attempts.length} attempt{trail.attempts.length === 1 ? '' : 's'}
        </span>
        {f.judge_used && (
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>judge: {f.judge_model}</span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <TrafficLight pass={f.dimensions.schema.pass}      label="schema"      tip={f.dimensions.schema.issues.join('\n') || 'OK'} />
        <TrafficLight pass={f.dimensions.grounding.pass}   label="grounding"   tip={f.dimensions.grounding.issues.join('\n') || 'OK'} />
        <TrafficLight pass={f.dimensions.advancement.pass} label="advancement" tip={f.dimensions.advancement.signals.join('\n') || 'OK'} />
        <TrafficLight pass={f.dimensions.clarifies.pass}   label="clarifies"   tip={f.dimensions.clarifies.signals.join('\n') || 'no taxonomy hints'} />
      </div>
      {f.repairHints.length > 0 && (
        <div style={{ fontSize: '0.75rem', marginBottom: 8 }}>
          <strong>Final repair hints</strong>
          <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
            {f.repairHints.map((h, i) => <li key={i}>{h}</li>)}
          </ul>
        </div>
      )}
      <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>Attempts</div>
      {trail.attempts.map((a, i) => <TurnValidationAttemptRow key={i} a={a} />)}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        api.clipboardWriteText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      style={{
        background: 'none', border: '1px solid var(--border)', borderRadius: 3,
        color: copied ? '#22c55e' : 'var(--text-muted)', cursor: 'pointer',
        fontSize: '0.6rem', padding: '1px 6px', marginLeft: 6, flexShrink: 0,
      }}
      title="Copy section content to clipboard"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function Section({ title, children, defaultOpen = false, copyText }: { title: string; children: React.ReactNode; defaultOpen?: boolean; copyText?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const sq = useContext(DiagSearchContext);
  const sectionMatches = sq && copyText ? countMatches(copyText, sq) : 0;
  // Auto-open sections with search matches
  const effectiveOpen = open || (sectionMatches > 0);
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <button
          onClick={() => setOpen(!open)}
          style={{ background: 'none', border: 'none', color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer', padding: '4px 0', flex: 1, textAlign: 'left' }}
        >
          {effectiveOpen ? '▼' : '▶'} {title}
          {sectionMatches > 0 && (
            <span style={{ marginLeft: 6, fontSize: '0.6rem', padding: '1px 5px', borderRadius: 3, background: 'rgba(245,158,11,0.2)', color: '#f59e0b', fontWeight: 700 }}>
              {sectionMatches} match{sectionMatches !== 1 ? 'es' : ''}
            </span>
          )}
        </button>
        {copyText && effectiveOpen && <CopyButton text={copyText} />}
      </div>
      {effectiveOpen && <div style={{ paddingLeft: 16, fontSize: '0.75rem' }}>{children}</div>}
    </div>
  );
}

function HelpContent() {
  return (
    <div style={{ fontSize: '0.8rem', lineHeight: 1.6, maxWidth: 650 }}>
      <h3 style={{ color: '#f59e0b', marginTop: 0 }}>Argument Interchange Format (AIF)</h3>
      <p>
        The AIF is a formal ontology for representing argumentation, established by
        Chesnevar et al. (2006). It provides a shared vocabulary for describing how
        arguments are constructed, how they relate to each other, and how conflicts
        between them are resolved.
      </p>
      <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
        Reference: Chesnevar, C., McGinnis, J., Modgil, S., Rahwan, I., Reed, C., Simari, G., South, M., Vreeswijk, G., & Willmott, S. (2006).
        "Towards an Argument Interchange Format." <em>The Knowledge Engineering Review</em>, 21(4), 293-316.
        [<a href="#" onClick={(e) => { e.preventDefault(); api.openExternal('https://jmvidal.cse.sc.edu/library/chesnevar06a.pdf'); }} style={{ color: '#f59e0b' }}>PDF</a>]
      </p>
      <p>The core building blocks are:</p>
      <ul>
        <li><strong>I-nodes (Information nodes)</strong> — claims, propositions, or data points.
          These are the passive content of arguments: "Scaling compute is sufficient for AGI"
          or "Current AI systems exhibit bias." In this tool, each <strong>AN-</strong> entry
          in the Argument Network is an I-node.</li>
        <li><strong>RA-nodes (Rule Application)</strong> — inference schemes that explain WHY
          one claim supports another. When you see a <span style={{ color: '#22c55e' }}>support</span> edge
          with a <em>warrant</em>, that warrant is the RA-node: the reasoning pattern connecting
          evidence to conclusion.</li>
        <li><strong>CA-nodes (Conflict Application)</strong> — attack relationships between claims.
          Three types:
          <ul>
            <li><strong style={{ color: '#ef4444' }}>Rebut</strong> — directly contradicts the conclusion
              ("No, scaling is NOT sufficient")</li>
            <li><strong style={{ color: '#ef4444' }}>Undercut</strong> — accepts the evidence but denies the
              inference ("The evidence is real but doesn't prove what you claim")</li>
            <li><strong style={{ color: '#ef4444' }}>Undermine</strong> — attacks the credibility of the
              premise itself ("That study was flawed")</li>
          </ul>
        </li>
        <li><strong>PA-nodes (Preference Application)</strong> — resolve conflicts by determining
          which argument prevails. In this tool, these appear in the synthesis as
          <em>Preference Verdicts</em> with criteria like empirical evidence strength or
          logical validity.</li>
      </ul>

      <h3 style={{ color: '#f59e0b' }}>The Argument Network</h3>
      <p>
        The Argument Network is built incrementally during the debate. After each debater
        speaks, the tool extracts 1-4 key claims from their statement and maps how those
        claims relate to prior claims.
      </p>
      <p>Reading the network:</p>
      <ul>
        <li><strong>AN-1, AN-2, ...</strong> — claim identifiers, in order of appearance</li>
        <li><strong>(Prometheus), (Sentinel), (Cassandra)</strong> — who made the claim</li>
        <li><span style={{ color: '#ef4444' }}>← AN-6 rebut via REFRAME</span> — claim AN-6 attacks
          this claim. "rebut" is the attack type; "REFRAME" is the dialectical scheme
          (the argumentative strategy used)</li>
        <li><span style={{ color: '#22c55e' }}>← AN-3 supports</span> — claim AN-3 provides evidence
          or reasoning for this claim</li>
        <li><strong>Warrant</strong> — the reasoning link explaining WHY the support or attack
          relationship holds. This is the AIF S-node made visible.</li>
      </ul>

      <h3 style={{ color: '#f59e0b' }}>Dialectical Schemes</h3>
      <table style={{ fontSize: '0.75rem', borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={{ textAlign: 'left', padding: '4px 8px' }}>Scheme</th>
            <th style={{ textAlign: 'left', padding: '4px 8px' }}>AIF Type</th>
            <th style={{ textAlign: 'left', padding: '4px 8px' }}>What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr><td style={{ padding: '3px 8px' }}>CONCEDE</td><td>Support (RA)</td><td>Accept opponent's point</td></tr>
          <tr><td style={{ padding: '3px 8px' }}>DISTINGUISH</td><td>Undercut (CA)</td><td>Accept evidence, deny it applies here</td></tr>
          <tr><td style={{ padding: '3px 8px' }}>REFRAME</td><td>Scheme shift</td><td>Shift the interpretive frame</td></tr>
          <tr><td style={{ padding: '3px 8px' }}>COUNTEREXAMPLE</td><td>Rebut (CA)</td><td>Specific case contradicting the claim</td></tr>
          <tr><td style={{ padding: '3px 8px' }}>REDUCE</td><td>Rebut (CA)</td><td>Show the logic leads to absurdity</td></tr>
          <tr><td style={{ padding: '3px 8px' }}>ESCALATE</td><td>Scheme shift</td><td>Connect to a broader principle</td></tr>
        </tbody>
      </table>

      <h3 style={{ color: '#f59e0b' }}>Commitment Stores</h3>
      <p>
        Each debater has a commitment store tracking what they've <strong>asserted</strong> (claimed
        to be true), <strong>conceded</strong> (accepted from an opponent), and <strong>challenged</strong> (questioned
        or attacked). Contradictions between assertions and concessions are flagged.
        Commitments are injected into each debater's prompt to enforce consistency.
      </p>

      <h3 style={{ color: '#f59e0b' }}>Methodology: AIF-Informed, Not AIF-Formal</h3>
      <p>
        This tool adopts AIF <strong>vocabulary</strong> (I-nodes, CA-nodes, RA-nodes,
        attack types, schemes, warrants) but deliberately does not implement the full
        formal <strong>bipartite graph</strong> that AIF specifies. In a fully
        AIF-compliant system, I-nodes never connect directly — every support and attack
        relationship passes through an intermediate S-node (scheme node) that carries
        the reasoning pattern. Our system stores scheme, warrant, and attack type as
        properties on the edge connecting two I-nodes.
      </p>

      <h4 style={{ color: '#f59e0b', fontSize: '0.8rem' }}>Why not the full bipartite graph?</h4>

      <p><strong>LLM extraction reliability.</strong> Claims are extracted from debate
        statements by a background AI call after each turn. Asking the LLM to produce
        bipartite JSON (I-node &rarr; S-node &rarr; I-node triples) significantly increases
        the structured-output complexity and error rate. The current flat format (I-node
        &rarr; I-node with typed edges) is validated at 40% word-overlap against the
        original statement text. Adding intermediate nodes would roughly triple the
        output surface for hallucination and parse failures, without improving the
        information captured.</p>

      <p><strong>No consumer requires it.</strong> The moderator's cross-respond selection,
        commitment tracking, synthesis argument maps, and harvest pipeline all work on
        the flat I-node + typed-edge model. S-node content (scheme, warrant, critical
        questions) is captured — it's just stored on the edge rather than as a separate
        node. Every query the system needs to answer ("what claims has Prometheus
        made?", "what attacks are unaddressed?", "which rebuts used COUNTEREXAMPLE?")
        is answerable from the current structure.</p>

      <p><strong>Visualization simplicity.</strong> Most argument visualization tools
        (Argdown, Kialo, Dialectica) hide S-nodes from users because the bipartite
        indirection makes graphs harder to read. Our diagnostics panel displays
        I-nodes directly with their attack/support relationships — adding
        intermediate S-nodes would double the visual elements without improving
        comprehension.</p>

      <p><strong>Extraction architecture.</strong> Claims are extracted by an independent
        "analyst" AI call, separate from the debater that produced the statement.
        This separation matters: the debater knows what it intended to argue, but
        self-assessment is biased (debaters overclaim the strength of their own
        attacks). The independent extractor provides a second opinion on relationship
        types. A bipartite graph would not change this architecture but would make
        the extractor's job harder.</p>

      <h4 style={{ color: '#f59e0b', fontSize: '0.8rem' }}>What we preserve from AIF</h4>
      <table style={{ fontSize: '0.75rem', borderCollapse: 'collapse', width: '100%', marginBottom: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={{ textAlign: 'left', padding: '4px 8px' }}>AIF Concept</th>
            <th style={{ textAlign: 'left', padding: '4px 8px' }}>How We Implement It</th>
          </tr>
        </thead>
        <tbody>
          <tr><td style={{ padding: '3px 8px' }}>I-nodes (claims)</td><td>AN-1, AN-2, ... in argument_network.nodes</td></tr>
          <tr><td style={{ padding: '3px 8px' }}>CA-nodes (conflict)</td><td>attack_type (rebut/undercut/undermine) on edges</td></tr>
          <tr><td style={{ padding: '3px 8px' }}>RA-nodes (inference)</td><td>warrant + scheme on support edges</td></tr>
          <tr><td style={{ padding: '3px 8px' }}>PA-nodes (preference)</td><td>Synthesis preferences (prevails, criterion, rationale)</td></tr>
          <tr><td style={{ padding: '3px 8px' }}>Schemes</td><td>COUNTEREXAMPLE, DISTINGUISH, etc. on edges</td></tr>
          <tr><td style={{ padding: '3px 8px' }}>Commitment stores</td><td>Per-debater asserted/conceded/challenged</td></tr>
          <tr><td style={{ padding: '3px 8px' }}>Locutions</td><td>Transcript entry types (statement, question, probing)</td></tr>
        </tbody>
      </table>

      <p>
        The guiding principle is <strong>vocabulary over formalism</strong>: use AIF's
        analytical distinctions to improve debate quality and transparency, but keep
        the data in simple JSON structures that LLMs can reliably produce and the UI
        can directly render. If external AIF tool interoperability becomes a
        requirement, a bipartite export layer can be added without changing the
        internal representation.
      </p>

      <h3 style={{ color: '#f59e0b' }}>Per-Entry Diagnostics</h3>
      <p>
        Click any transcript entry to see its internals: the full prompt sent to the AI,
        the raw response, which claims were extracted (with validation scores), the taxonomy
        context injected, and what commitments were active at that point.
      </p>
    </div>
  );
}

/** Highlight search matches within text. Uses DiagSearchContext if query not provided. */
function Highlight({ text, query: queryProp }: { text: string; query?: string }) {
  const ctxQuery = useContext(DiagSearchContext);
  const query = queryProp ?? ctxQuery;
  if (!query || !text) return <>{text}</>;
  const parts: { text: string; match: boolean }[] = [];
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let lastIdx = 0;
  let idx = lower.indexOf(q);
  while (idx >= 0) {
    if (idx > lastIdx) parts.push({ text: text.slice(lastIdx, idx), match: false });
    parts.push({ text: text.slice(idx, idx + q.length), match: true });
    lastIdx = idx + q.length;
    idx = lower.indexOf(q, lastIdx);
  }
  if (lastIdx < text.length) parts.push({ text: text.slice(lastIdx), match: false });
  return <>{parts.map((p, i) => p.match ? <mark key={i} style={{ background: '#f59e0b', color: '#000', borderRadius: 2, padding: '0 1px' }}>{p.text}</mark> : p.text)}</>;
}

function SearchBar({ query, setQuery, matchCount }: { query: string; setQuery: (q: string) => void; matchCount: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
      <input
        type="text"
        placeholder="Search diagnostics..."
        value={query}
        onChange={e => setQuery(e.target.value)}
        style={{
          flex: 1, padding: '4px 8px', fontSize: '0.75rem',
          background: 'var(--bg-primary)', color: 'var(--text-primary)',
          border: '1px solid var(--border)', borderRadius: 4,
        }}
      />
      {query && (
        <>
          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {matchCount} match{matchCount !== 1 ? 'es' : ''}
          </span>
          <button
            onClick={() => setQuery('')}
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.65rem' }}
          >
            Clear
          </button>
        </>
      )}
    </div>
  );
}

/** Count occurrences of query in text (case-insensitive) */
function countMatches(text: string, query: string): number {
  if (!query || !text) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let count = 0;
  let idx = t.indexOf(q);
  while (idx >= 0) {
    count++;
    idx = t.indexOf(q, idx + q.length);
  }
  return count;
}

function ResizablePre({ text, tall = false }: { text: string; tall?: boolean }) {
  return (
    <textarea
      readOnly
      value={text}
      style={{
        width: '100%',
        minHeight: tall ? 200 : 60,
        maxHeight: 800,
        resize: 'vertical',
        fontFamily: 'monospace',
        fontSize: tall ? '0.75rem' : '0.65rem',
        background: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        border: '1px solid var(--border)',
        borderRadius: 4,
        padding: '6px 8px',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    />
  );
}

/** Expandable I-node row — edges + warrants always visible, expand shows debater attribution + claim text */
function INodeRow({ node, attacks, supports, allNodes, isSource, computedStrength, statementId }: {
  node: ArgumentNetworkNode;
  attacks: ArgumentNetworkEdge[];
  supports: ArgumentNetworkEdge[];
  allNodes: ArgumentNetworkNode[];
  isSource: boolean;
  computedStrength?: number;
  statementId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const responded = attacks.length > 0 || supports.length > 0;
  const hasChildren = attacks.length > 0 || supports.length > 0;

  return (
    <div style={{ margin: '6px 0', paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
        {hasChildren ? (
          <button
            onClick={() => setExpanded(!expanded)}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, fontSize: '0.7rem', lineHeight: 1, marginTop: 2, flexShrink: 0 }}
          >
            {expanded ? '\u25BC' : '\u25B6'}
          </button>
        ) : (
          <span style={{ width: 10, flexShrink: 0 }} />
        )}
        <div style={{ flex: 1 }}>
          <AifBadge type="I-node" />
          <strong style={{ color: 'var(--accent)' }}>{node.id}</strong>
          {statementId && (
            <span
              title={`Source statement ${statementId}`}
              style={{
                marginLeft: 5, padding: '1px 5px', borderRadius: 8,
                background: 'rgba(249,115,22,0.12)', color: '#f97316',
                fontSize: '0.6rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
              }}
            >{statementId}</span>
          )}
          <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>({speakerLabel(node.speaker)})</span>
          {!responded && !isSource && <span style={{ color: '#f59e0b', fontSize: '0.65rem', marginLeft: 6 }}>[unaddressed]</span>}
          {(() => {
            const base = node.base_strength ?? 0.5;
            const computed = computedStrength ?? node.computed_strength ?? base;
            const band = computed >= 0.8 ? 'Strong' : computed >= 0.5 ? 'Moderate' : computed >= 0.3 ? 'Weak' : 'Very Weak';
            const bandColor = computed >= 0.8 ? '#22c55e' : computed >= 0.5 ? '#3b82f6' : computed >= 0.3 ? '#f59e0b' : '#ef4444';
            const delta = computed - base;
            return (
              <span style={{ marginLeft: 6, fontSize: '0.55rem', fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: `${bandColor}22`, color: bandColor, opacity: 0.3 + computed * 0.7 }} title={`Strength: ${computed.toFixed(2)} (base: ${base.toFixed(2)}, delta: ${delta >= 0 ? '+' : ''}${delta.toFixed(2)})`}>
                {band} {computed.toFixed(2)}
                {Math.abs(delta) > 0.01 && <span style={{ color: delta > 0 ? '#22c55e' : '#ef4444', marginLeft: 3 }}>{delta > 0 ? '+' : ''}{delta.toFixed(2)}</span>}
              </span>
            );
          })()}
          {hasChildren && <span style={{ color: 'var(--text-muted)', fontSize: '0.6rem', marginLeft: 6 }}>{attacks.length + supports.length} edge{attacks.length + supports.length !== 1 ? 's' : ''}</span>}
        </div>
      </div>
      <div style={{ paddingLeft: 18, marginTop: 2 }}><Highlight text={node.text} /></div>

      {/* Edges — ALWAYS visible (badge + source ID + type + scheme + warrant) */}
      {hasChildren && (
        <div style={{ paddingLeft: 18, marginTop: 4 }}>
          {attacks.map(a => {
            const sourceNode = allNodes.find(n => n.id === a.source);
            return (
              <div key={a.id} style={{ marginTop: 4, fontSize: '0.7rem', paddingLeft: 8, borderLeft: '2px solid rgba(239,68,68,0.3)' }}>
                <div>
                  <AifBadge type="CA-node" />
                  {'\u2190'} {a.source} <strong>{a.attack_type}</strong>{a.scheme ? <span style={{ color: 'var(--text-muted)' }}> via {a.scheme}</span> : ''}
                </div>
                {a.warrant && <div style={{ paddingLeft: 8, color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 2 }}>Warrant: <Highlight text={a.warrant} /></div>}
                {/* Expanded: show debater attribution + full claim text */}
                {expanded && sourceNode && (
                  <div style={{ paddingLeft: 8, marginTop: 3, padding: '4px 8px', background: 'rgba(239,68,68,0.05)', borderRadius: 3 }}>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Debater:</span> <strong style={{ fontSize: '0.7rem' }}>{speakerLabel(sourceNode.speaker)}</strong>
                    <div style={{ fontSize: '0.7rem', marginTop: 2 }}><Highlight text={sourceNode.text} /></div>
                  </div>
                )}
              </div>
            );
          })}
          {supports.map(s => {
            const sourceNode = allNodes.find(n => n.id === s.source);
            return (
              <div key={s.id} style={{ marginTop: 4, fontSize: '0.7rem', paddingLeft: 8, borderLeft: '2px solid rgba(34,197,94,0.3)' }}>
                <div>
                  <AifBadge type="RA-node" />
                  {'\u2190'} {s.source} <strong>supports</strong>
                </div>
                {s.warrant && <div style={{ paddingLeft: 8, color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 2 }}>Warrant: {s.warrant}</div>}
                {/* Expanded: show debater attribution + full claim text */}
                {expanded && sourceNode && (
                  <div style={{ paddingLeft: 8, marginTop: 3, padding: '4px 8px', background: 'rgba(34,197,94,0.05)', borderRadius: 3 }}>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Debater:</span> <strong style={{ fontSize: '0.7rem' }}>{speakerLabel(sourceNode.speaker)}</strong>
                    <div style={{ fontSize: '0.7rem', marginTop: 2 }}><Highlight text={sourceNode.text} /></div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function DiagnosticsWindow({ initialData }: { initialData?: Record<string, unknown> } = {}) {
  const [debate, setDebate] = useState<DebateSession | null>(() => {
    // If opened with initial data (e.g. from CLI file viewer), use it immediately
    if (initialData) {
      const d = initialData as { debate?: DebateSession; selectedEntry?: string };
      return (d.debate as DebateSession) ?? (initialData as unknown as DebateSession);
    }
    return null;
  });
  const [selectedEntry, setSelectedEntry] = useState<string | null>(() => {
    if (initialData) {
      const d = initialData as { selectedEntry?: string };
      return d.selectedEntry ?? null;
    }
    return null;
  });
  const [localOverride, setLocalOverride] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  type EntryTab = 'tax-refs' | 'tax-context' | 'prompt' | 'response' | 'details' | 'claims' | 'brief' | 'plan' | 'draft' | 'cite';
  const [entryTab, setEntryTab] = useState<EntryTab>('details');
  type OverviewTab = 'extraction' | 'argument-network' | 'commitments' | 'transcript' | 'convergence';
  const [overviewTab, setOverviewTab] = useState<OverviewTab>('argument-network');
  const [taxNodeMap, setTaxNodeMap] = useState<Map<string, Record<string, unknown>>>(new Map());
  const [selectedTaxRefId, setSelectedTaxRefId] = useState<string | null>(null);
  // Reset the tax-ref detail panel whenever the selected transcript entry changes
  useEffect(() => { setSelectedTaxRefId(null); }, [selectedEntry]);

  // Load POV/situations taxonomy files once so we can resolve taxonomy_refs by id
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const files = await Promise.all([
          api.loadTaxonomyFile('accelerationist').catch(() => null),
          api.loadTaxonomyFile('safetyist').catch(() => null),
          api.loadTaxonomyFile('skeptic').catch(() => null),
          api.loadTaxonomyFile('situations').catch(() => null),
        ]);
        if (cancelled) return;
        const m = new Map<string, Record<string, unknown>>();
        for (const f of files) {
          const nodes = (f as { nodes?: Record<string, unknown>[] } | null)?.nodes;
          if (!Array.isArray(nodes)) continue;
          for (const n of nodes) {
            const id = (n as { id?: string }).id;
            if (typeof id === 'string') m.set(id, n);
          }
        }
        setTaxNodeMap(m);
      } catch {
        // non-fatal — table still renders without detail panel lookup
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Apply theme — the diagnostics popout doesn't go through MainApp which normally sets data-theme
  useEffect(() => {
    const root = document.documentElement;
    if (!root.getAttribute('data-theme')) {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    }
  }, []);

  useEffect(() => {
    const unsub = api.onDiagnosticsStateUpdate((state) => {
      const s = state as { debate: DebateSession | null; selectedEntry: string | null };
      setDebate(s.debate);
      // Only sync selectedEntry from main window if the user hasn't locally navigated
      if (!localOverride) {
        setSelectedEntry(s.selectedEntry);
      }
    });
    return unsub;
  }, [localOverride]);

  const entry = selectedEntry ? debate?.transcript.find(e => e.id === selectedEntry) : null;
  const diag: EntryDiagnostics | undefined = selectedEntry ? debate?.diagnostics?.entries[selectedEntry] : undefined;
  const turnValTrail: TurnValidationTrail | undefined = selectedEntry ? debate?.turn_validations?.[selectedEntry] : undefined;
  const meta = entry?.metadata as Record<string, unknown> | undefined;

  // For system entries without diagnostics, proxy the moderator_trace from
  // the next debater entry so the moderator deliberation is visible.
  const proxiedModeratorTrace = useMemo(() => {
    if (!entry || entry.speaker !== 'system' || meta?.moderator_trace) return null;
    if (!debate?.transcript) return null;
    const idx = debate.transcript.findIndex(e => e.id === entry.id);
    if (idx < 0) return null;
    for (let i = idx + 1; i < debate.transcript.length; i++) {
      const next = debate.transcript[i];
      const nextMeta = next.metadata as Record<string, unknown> | undefined;
      if (nextMeta?.moderator_trace) return nextMeta.moderator_trace as Record<string, unknown>;
      if (next.type === 'statement' || next.type === 'opening') break;
    }
    return null;
  }, [entry, debate?.transcript, meta]);
  const an = debate?.argument_network;
  const commitments = debate?.commitments;
  const sq = searchQuery.trim();

  // Compute total match count across all visible text
  const matchCount = useMemo(() => {
    if (!sq || !debate) return 0;
    let count = 0;
    // AN nodes
    if (an) {
      for (const n of an.nodes) count += countMatches(n.text, sq) + countMatches(n.speaker, sq);
      for (const e of an.edges) count += countMatches(e.warrant || '', sq);
    }
    // Transcript entries
    for (const e of debate.transcript) count += countMatches(e.content, sq);
    // Selected entry diagnostics
    if (diag) {
      count += countMatches(diag.prompt || '', sq);
      count += countMatches(diag.raw_response || '', sq);
      count += countMatches(diag.taxonomy_context || '', sq);
      count += countMatches(diag.commitment_context || '', sq);
      if (diag.extracted_claims) {
        for (const c of diag.extracted_claims.accepted) count += countMatches(c.text, sq);
        for (const c of diag.extracted_claims.rejected) count += countMatches(c.text, sq);
      }
    }
    return count;
  }, [sq, debate, an, diag]);

  // Keyboard navigation: Left/Right = tabs, Up/Down/P/N = prev/next statement
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        if (entry) {
          const ENTRY_TABS: EntryTab[] = ['details', 'brief', 'plan', 'draft', 'cite', 'claims', 'tax-refs', 'tax-context', 'prompt', 'response'];
          const idx = ENTRY_TABS.indexOf(entryTab);
          const next = idx + dir;
          if (next >= 0 && next < ENTRY_TABS.length) setEntryTab(ENTRY_TABS[next]);
        } else if (debate) {
          const OVERVIEW_TABS: OverviewTab[] = ['argument-network', 'commitments', 'transcript', 'extraction', 'convergence'];
          const visible = OVERVIEW_TABS.filter(id => {
            if (id === 'argument-network') return !!(an && an.nodes.length > 0);
            if (id === 'commitments') return !!(commitments && Object.keys(commitments).length > 0);
            return true;
          });
          const idx = visible.indexOf(overviewTab);
          const next = idx + dir;
          if (next >= 0 && next < visible.length) setOverviewTab(visible[next]);
        }
        return;
      }

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' ||
          e.key === 'p' || e.key === 'P' || e.key === 'n' || e.key === 'N') {
        if (!debate) return;
        e.preventDefault();
        const dir = (e.key === 'ArrowDown' || e.key === 'n' || e.key === 'N') ? 1 : -1;
        if (!entry) {
          if (dir === 1 && debate.transcript.length > 0) {
            setSelectedEntry(debate.transcript[0].id);
            setLocalOverride(true);
          }
          return;
        }
        const curIdx = debate.transcript.findIndex(t => t.id === entry.id);
        const nextIdx = curIdx + dir;
        if (nextIdx >= 0 && nextIdx < debate.transcript.length) {
          setSelectedEntry(debate.transcript[nextIdx].id);
          setLocalOverride(true);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [debate, entry, entryTab, overviewTab, an, commitments]);

  return (
    <DiagSearchContext.Provider value={sq}>
    <div style={{ padding: 12, height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <h2 style={{ margin: 0, fontSize: '1rem', color: '#f59e0b', whiteSpace: 'nowrap' }}>Debate Diagnostics</h2>
        {debate && !showHelp && <SearchBar query={searchQuery} setQuery={setSearchQuery} matchCount={matchCount} />}
        {(!debate || showHelp) && <div style={{ flex: 1 }} />}
        <button
          onClick={async () => {
            await api.openPovProgressionWindow();
            // Re-broadcast current state so the new popout receives it
            setTimeout(() => api.sendDiagnosticsState({ debate, selectedEntry }), 1000);
          }}
          title="Show how each POV's taxonomy context and citations evolve across turns"
          style={{ background: 'none', color: '#8b5cf6', border: '1px solid #8b5cf6', borderRadius: 4, padding: '2px 10px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}
        >
          POV Progression
        </button>
        <button
          onClick={() => setShowHelp(!showHelp)}
          style={{ background: showHelp ? '#f59e0b' : 'none', color: showHelp ? '#000' : '#f59e0b', border: '1px solid #f59e0b', borderRadius: 4, padding: '2px 10px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}
        >
          {showHelp ? 'Close Help' : 'Help'}
        </button>
      </div>
      {showHelp && <HelpContent />}
      {!debate && !showHelp && <p style={{ color: 'var(--text-muted)' }}>Waiting for debate data from main window...</p>}

      {debate && !selectedEntry && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0 0 8px' }}>
            Click a transcript entry in the main window to inspect it here. Showing overview.
          </p>

          {(() => {
            const hasAn = !!(an && an.nodes.length > 0);
            const hasCommitments = !!(commitments && Object.keys(commitments).length > 0);
            const plateau = debate.extraction_summary?.plateau_detected === true;
            const tabs: { id: OverviewTab; label: string; badge?: string; visible: boolean }[] = [
              { id: 'argument-network', label: 'Argument Network', visible: hasAn },
              { id: 'commitments', label: 'Commitments', visible: hasCommitments },
              { id: 'transcript', label: `Transcript (${debate.transcript.length})`, visible: true },
              { id: 'extraction', label: 'Extraction', badge: plateau ? '⚠' : undefined, visible: true },
              { id: 'convergence', label: `Convergence (${debate.convergence_signals?.length ?? 0})`, visible: !!(debate.convergence_signals && debate.convergence_signals.length > 0) },
            ];
            const activeVisible = tabs.find(t => t.id === overviewTab)?.visible;
            const effectiveTab: OverviewTab = activeVisible ? overviewTab : 'transcript';
            return (
              <div style={{
                display: 'flex', gap: 4, marginBottom: 8,
                borderBottom: '1px solid var(--border)', paddingBottom: 6, flexWrap: 'wrap',
              }}>
                {tabs.filter(t => t.visible).map(t => (
                  <button
                    key={t.id}
                    onClick={() => setOverviewTab(t.id)}
                    style={{
                      padding: '4px 12px', fontSize: '0.75rem', fontWeight: 600,
                      borderRadius: 4, cursor: 'pointer',
                      border: '1px solid ' + (t.id === effectiveTab ? '#f59e0b' : 'var(--border)'),
                      background: t.id === effectiveTab ? '#f59e0b' : 'transparent',
                      color: t.id === effectiveTab ? '#000' : 'var(--text-primary)',
                    }}
                  >
                    {t.label}{t.badge ? ` ${t.badge}` : ''}
                  </button>
                ))}
              </div>
            );
          })()}

          {/* Extraction Timeline — diagnoses AN-plateau failures */}
          {overviewTab === 'extraction' && (
            <ExtractionTimelinePanel debate={debate} />
          )}

          {/* Convergence Signals — per-turn diagnostic signals */}
          {overviewTab === 'convergence' && (
            <ConvergenceSignalsPanel debate={debate} />
          )}

          {/* Argument Network with inline Moderator Deliberations */}
          {overviewTab === 'argument-network' && an && an.nodes.length > 0 && (() => {
            const caCount = an.edges.filter(e => e.type === 'attacks').length;
            const raCount = an.edges.filter(e => e.type === 'supports').length;
            // Statement-ID map — matches S{round} from the main transcript view.
            const stmtIdByEntry = new Map<string, string>();
            debate.transcript.forEach((e, i) => stmtIdByEntry.set(e.id, `S${i + 1}`));

            // Compute QBAF strengths from edges
            const qbafNodes: QbafNode[] = an.nodes.map(n => ({ id: n.id, base_strength: n.base_strength ?? 0.5 }));
            const qbafEdges: QbafEdge[] = an.edges.map(e => ({
              source: e.source, target: e.target,
              type: e.type as 'attacks' | 'supports',
              weight: e.weight ?? 1.0,
              attack_type: e.attack_type,
            }));
            const qbafResult = computeQbafStrengths(qbafNodes, qbafEdges);
            const strengthMap = qbafResult.strengths;

            // Build moderator trace lookup: entry ID → trace
            const modTraceByEntryId = new Map<string, {
              selected: string; focus_point: string; addressing?: string;
              excluded_last_speaker?: string | null;
              selection_reason?: string;
              recent_scheme?: string | null;
              convergence_score?: number | null; convergence_triggered?: boolean;
              candidates?: { debater: string; computed_strength: number | null; rank: number }[];
              argument_network_snapshot?: { total_claims: number; total_edges: number; unaddressed_claims: number } | null;
            }>();
            debate.transcript.forEach(e => {
              const meta = e.metadata as Record<string, unknown> | undefined;
              if (meta?.moderator_trace) {
                modTraceByEntryId.set(e.id, meta.moderator_trace as any);
              }
            });

            // Group AN nodes by source_entry_id to interleave with moderator traces
            const entryGroups: { entryId: string; nodes: typeof an.nodes; trace: ReturnType<typeof modTraceByEntryId.get> }[] = [];
            const seenEntries = new Set<string>();
            for (const n of an.nodes) {
              const eid = n.source_entry_id;
              if (!seenEntries.has(eid)) {
                seenEntries.add(eid);
                entryGroups.push({
                  entryId: eid,
                  nodes: an.nodes.filter(x => x.source_entry_id === eid),
                  trace: modTraceByEntryId.get(eid),
                });
              }
            }

            // Also show moderator traces for entries that produced no AN nodes
            debate.transcript.forEach(e => {
              const meta = e.metadata as Record<string, unknown> | undefined;
              if (meta?.moderator_trace && !seenEntries.has(e.id)) {
                entryGroups.push({ entryId: e.id, nodes: [], trace: meta.moderator_trace as any });
              }
            });

            const modCount = [...modTraceByEntryId.values()].length;

            return (
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6 }}>
                  {an.nodes.length} I-nodes · {caCount} CA · {raCount} RA{modCount > 0 ? ` · ${modCount} moderator decisions` : ''}
                </div>
                {entryGroups.map(({ entryId, nodes: groupNodes, trace }) => (
                  <div key={entryId}>
                    {/* Moderator deliberation banner */}
                    {trace && (
                      <div style={{
                        margin: '8px 0 4px', padding: '6px 10px', borderRadius: 6,
                        background: 'rgba(249,115,22,0.08)', borderLeft: '3px solid #f97316',
                        fontSize: '0.65rem',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 700, color: '#f97316', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Moderator</span>
                          <span style={{ fontWeight: 600 }}>→ {speakerLabel(trace.selected)}</span>
                          {trace.selection_reason && (
                            <span style={{ padding: '1px 5px', borderRadius: 3, background: 'rgba(249,115,22,0.15)', color: '#f97316', fontSize: '0.55rem', fontWeight: 600 }}>
                              {trace.selection_reason.replace(/_/g, ' ')}
                            </span>
                          )}
                          {trace.recent_scheme && (
                            <span style={{ padding: '1px 5px', borderRadius: 3, background: 'rgba(99,102,241,0.15)', color: '#6366f1', fontSize: '0.55rem', fontWeight: 600 }}>
                              {trace.recent_scheme}
                            </span>
                          )}
                          {trace.convergence_score != null && (
                            <span style={{ color: 'var(--text-muted)' }}>
                              conv: {(trace.convergence_score * 100).toFixed(0)}%
                              {trace.convergence_triggered && <span style={{ color: '#22c55e', marginLeft: 3, fontWeight: 700 }}>triggered</span>}
                            </span>
                          )}
                        </div>
                        <div style={{ marginTop: 3, color: 'var(--text-muted)' }}>
                          <strong>Focus:</strong> <Highlight text={trace.focus_point} />
                        </div>
                        {trace.candidates && trace.candidates.length > 0 && (
                          <div style={{ marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {trace.candidates.map((c, i) => (
                              <span key={i} style={{
                                fontSize: '0.55rem',
                                opacity: c.debater === trace.selected ? 1 : 0.6,
                                fontWeight: c.debater === trace.selected ? 700 : 400,
                              }}>
                                #{c.rank} {speakerLabel(c.debater)}
                                {c.computed_strength != null && ` (${c.computed_strength.toFixed(2)})`}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {/* AN nodes from this entry */}
                    {groupNodes.map(n => {
                      const attacks = an.edges.filter(e => e.target === n.id && e.type === 'attacks');
                      const supports = an.edges.filter(e => e.target === n.id && e.type === 'supports');
                      const isSource = an.edges.some(e => e.source === n.id);
                      return (
                        <INodeRow
                          key={n.id}
                          node={n}
                          attacks={attacks}
                          supports={supports}
                          allNodes={an.nodes}
                          isSource={isSource}
                          computedStrength={strengthMap.get(n.id)}
                          statementId={stmtIdByEntry.get(n.source_entry_id)}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Commitments */}
          {overviewTab === 'commitments' && commitments && Object.keys(commitments).length > 0 && (
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              {Object.entries(commitments).map(([pov, store]) => (
                <div key={pov} style={{ margin: '4px 0' }}>
                  <strong>{speakerLabel(pov)}</strong>: Asserted {store.asserted.length} | Conceded {store.conceded.length} | Challenged {store.challenged.length}
                </div>
              ))}
            </div>
          )}

          {/* Transcript list for selection */}
          {overviewTab === 'transcript' && (
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              {debate.transcript.map((e, i) => {
              const stmtId = `S${i + 1}`;
              return (
                <div
                  key={e.id}
                  onClick={() => { setSelectedEntry(e.id); setLocalOverride(true); }}
                  style={{ padding: '3px 6px', cursor: 'pointer', borderRadius: 4, margin: '2px 0', background: 'var(--bg-primary)', fontSize: '0.7rem', display: 'flex', alignItems: 'baseline', gap: 6 }}
                >
                  <span
                    title={`Statement ${stmtId}`}
                    style={{
                      padding: '1px 6px', borderRadius: 8,
                      background: 'rgba(249,115,22,0.12)', color: '#f97316',
                      fontSize: '0.6rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                      flexShrink: 0,
                    }}
                  >{stmtId}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong>{speakerLabel(e.speaker)}</strong> [{e.type}] <Highlight text={e.content.slice(0, 80)} />...
                  </span>
                </div>
              );
            })}
            </div>
          )}
        </div>
      )}

      {entry && (() => {
        const entryIdx = debate!.transcript.findIndex(e => e.id === entry.id);
        const totalEntries = debate!.transcript.length;
        const stmtId = entryIdx >= 0 ? `S${entryIdx + 1}` : '';
        const goToIdx = (i: number) => {
          if (i < 0 || i >= totalEntries) return;
          setSelectedEntry(debate!.transcript[i].id);
          setLocalOverride(true);
        };
        const navBtnStyle = (disabled: boolean): React.CSSProperties => ({
          padding: '2px 8px', fontSize: '0.7rem', fontWeight: 600,
          borderRadius: 4, border: '1px solid var(--border)',
          background: disabled ? 'transparent' : 'rgba(249,115,22,0.1)',
          color: disabled ? 'var(--text-muted)' : '#f97316',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
        });
        return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
            <button
              onClick={() => { setSelectedEntry(null); setLocalOverride(true); }}
              style={{ fontSize: '0.7rem', cursor: 'pointer', background: 'none', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px', color: 'var(--text-primary)' }}
            >
              Overview
            </button>
            <span style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 4px' }} />
            {stmtId && (
              <span
                title={`Statement ${stmtId}`}
                style={{
                  padding: '1px 7px', borderRadius: 10,
                  background: 'rgba(249,115,22,0.12)', color: '#f97316',
                  fontSize: '0.7rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                }}
              >{stmtId}</span>
            )}
            <strong style={{ fontSize: '0.85rem' }}>{speakerLabel(entry.speaker)}</strong>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{entry.type}</span>
            {!diag && !proxiedModeratorTrace && <span style={{ color: '#f59e0b', fontSize: '0.65rem' }}>(no diagnostic capture — turn was generated before diagnostics was always-on)</span>}
            <span style={{ flex: 1 }} />
            <button
              onClick={() => goToIdx(entryIdx - 1)}
              disabled={entryIdx <= 0}
              title="Previous statement"
              style={navBtnStyle(entryIdx <= 0)}
            >◀ Prev</button>
            <button
              onClick={() => goToIdx(entryIdx + 1)}
              disabled={entryIdx >= totalEntries - 1}
              title="Next statement"
              style={navBtnStyle(entryIdx >= totalEntries - 1)}
            >Next ▶</button>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>
              {entryIdx + 1} / {totalEntries}
            </span>
          </div>

          {/* ── Proxied moderator trace for system entries ── */}
          {proxiedModeratorTrace && (() => {
            const t = proxiedModeratorTrace as {
              selected?: string; focus_point?: string; selection_reason?: string;
              excluded_last_speaker?: string | null; recent_scheme?: string | null;
              convergence_score?: number | null; convergence_triggered?: boolean;
              candidates?: { debater: string; computed_strength: number | null; rank: number }[];
              argument_network_snapshot?: { total_claims: number; total_edges: number; unaddressed_claims: number } | null;
              commitment_snapshot?: Record<string, { asserted: number; conceded: number; challenged: number }>;
            };
            return (
              <div style={{
                margin: '0 0 10px', padding: '8px 12px', borderRadius: 6,
                background: 'rgba(249,115,22,0.08)', borderLeft: '3px solid #f97316',
                fontSize: '0.72rem',
              }}>
                <div style={{ fontWeight: 700, color: '#f97316', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                  Moderator Deliberation
                </div>
                {t.selected && (
                  <div style={{ marginBottom: 3 }}>
                    <strong>Selected:</strong> {t.selected}
                    {t.selection_reason && <span style={{ marginLeft: 6, padding: '1px 5px', borderRadius: 3, background: 'rgba(249,115,22,0.15)', color: '#f97316', fontSize: '0.6rem', fontWeight: 600 }}>{t.selection_reason.replace(/_/g, ' ')}</span>}
                    {t.excluded_last_speaker && <span style={{ marginLeft: 6, color: 'var(--text-muted)', fontSize: '0.65rem' }}>(excluded last speaker: {t.excluded_last_speaker})</span>}
                  </div>
                )}
                {t.focus_point && <div style={{ marginBottom: 3 }}><strong>Focus:</strong> {t.focus_point}</div>}
                {t.candidates && t.candidates.length > 0 && (
                  <div style={{ marginBottom: 3 }}>
                    <strong>Candidates:</strong>{' '}
                    {t.candidates.map((c, i) => (
                      <span key={i} style={{ marginRight: 8, fontWeight: c.debater === t.selected ? 700 : 400, opacity: c.debater === t.selected ? 1 : 0.7 }}>
                        #{c.rank} {c.debater}{c.computed_strength != null ? ` (${c.computed_strength.toFixed(2)})` : ''}
                      </span>
                    ))}
                  </div>
                )}
                {t.convergence_score != null && (
                  <div style={{ marginBottom: 3 }}>
                    <strong>Convergence:</strong> {(t.convergence_score * 100).toFixed(0)}%
                    {t.convergence_triggered && <span style={{ color: '#22c55e', marginLeft: 4, fontWeight: 700 }}>triggered</span>}
                  </div>
                )}
                {t.recent_scheme && <div style={{ marginBottom: 3 }}><strong>Recent scheme:</strong> {t.recent_scheme}</div>}
                {t.argument_network_snapshot && (
                  <div style={{ marginBottom: 3 }}>
                    <strong>AN snapshot:</strong> {t.argument_network_snapshot.total_claims} claims, {t.argument_network_snapshot.total_edges} edges, {t.argument_network_snapshot.unaddressed_claims} unaddressed
                  </div>
                )}
                {t.commitment_snapshot && (
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 4 }}>
                    {Object.entries(t.commitment_snapshot).map(([name, c]) => (
                      <span key={name} style={{ marginRight: 10 }}>{name}: {c.asserted}A {c.conceded}C {c.challenged}Ch</span>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── Tabbed view: Taxonomy Refs | Taxonomy Context | Full Prompt | Raw Response ── */}
          {(() => {
            const taxRefCount = entry.taxonomy_refs?.length ?? 0;
            const taxContext = diag?.taxonomy_context ?? '';
            const prompt = diag?.prompt ?? '';
            const response = diag?.raw_response ?? '';
            const hasClaims = !!(
              diag?.extracted_claims ||
              (meta?.my_claims && (meta.my_claims as unknown[]).length > 0)
            );
            const hasDetails = !!(
              (meta?.key_assumptions && (meta.key_assumptions as unknown[]).length > 0) ||
              (meta?.policy_refs as string[])?.length || (entry.policy_refs?.length ?? 0) > 0 ||
              diag?.model ||
              diag?.commitment_context ||
              diag?.edge_tensions ||
              diag?.argument_network_context ||
              (meta?.move_types && (meta.move_types as unknown[]).length > 0)
            );
            const claimsCopy = [
              ...(diag?.extracted_claims ? [...diag.extracted_claims.accepted.map(c => `✓ ${c.id} (${c.overlap_pct}%): ${c.text}`), ...diag.extracted_claims.rejected.map(c => `✗ (${c.overlap_pct}%): ${c.text} — ${c.reason}`)] : []),
              ...((meta?.my_claims as { claim: string; targets: string[] }[])?.map((c, i) => `${i + 1}. ${c.claim}${c.targets?.length > 0 ? ` → ${c.targets.join(', ')}` : ''}`) ?? []),
            ].join('\n');
            const stages = diag?.stage_diagnostics;
            const briefStage = stages?.find(s => s.stage === 'brief');
            const planStage = stages?.find(s => s.stage === 'plan');
            const draftStage = stages?.find(s => s.stage === 'draft');
            const citeStage = stages?.find(s => s.stage === 'cite');

            const tabs: { id: EntryTab; label: string; count?: number; has: boolean; copy: string }[] = [
              { id: 'details', label: 'Details', has: hasDetails, copy: '' },
              { id: 'brief', label: 'Brief', has: !!briefStage, copy: JSON.stringify(briefStage?.work_product, null, 2) ?? '' },
              { id: 'plan', label: 'Plan', has: !!planStage, copy: JSON.stringify(planStage?.work_product, null, 2) ?? '' },
              { id: 'draft', label: 'Draft', has: !!draftStage, copy: JSON.stringify(draftStage?.work_product, null, 2) ?? '' },
              { id: 'cite', label: 'Cite', has: !!citeStage, copy: JSON.stringify(citeStage?.work_product, null, 2) ?? '' },
              { id: 'claims', label: 'Claims', has: hasClaims, copy: claimsCopy },
              { id: 'tax-refs', label: 'Taxonomy Refs', count: taxRefCount, has: taxRefCount > 0, copy: entry.taxonomy_refs?.map(r => `${r.node_id}: ${r.relevance}`).join('\n') ?? '' },
              { id: 'tax-context', label: 'Taxonomy Context', has: taxContext.length > 0, copy: taxContext },
              { id: 'prompt', label: 'Full Prompt Sent to AI', has: prompt.length > 0, copy: prompt },
              { id: 'response', label: 'Raw AI Response', has: response.length > 0, copy: response },
            ];
            // If the current tab has no data, auto-select the first tab that does.
            const activeTab = tabs.find(t => t.id === entryTab)?.has
              ? entryTab
              : (tabs.find(t => t.has)?.id ?? 'details');
            const active = tabs.find(t => t.id === activeTab)!;
            const handleCopy = () => { if (active.copy) navigator.clipboard?.writeText(active.copy).catch(() => {}); };

            const textAreaStyle: React.CSSProperties = {
              width: '100%',
              flex: 1,
              height: '100%',
              minHeight: 300,
              resize: 'none',
              fontFamily: 'monospace',
              fontSize: '0.78rem',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              borderTopLeftRadius: 0,
              borderTopRightRadius: 0,
              borderBottomLeftRadius: 6,
              borderBottomRightRadius: 6,
              padding: '10px 12px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              boxSizing: 'border-box',
            };

            const tabBtnStyle = (t: typeof tabs[0]): React.CSSProperties => ({
              padding: '6px 12px',
              fontSize: '0.75rem',
              fontWeight: 600,
              border: '1px solid var(--border)',
              borderBottom: t.id === activeTab ? '1px solid var(--bg-primary)' : '1px solid var(--border)',
              background: t.id === activeTab ? 'var(--bg-primary)' : 'transparent',
              color: t.has ? (t.id === activeTab ? '#f97316' : 'var(--text-primary)') : 'var(--text-muted)',
              cursor: t.has ? 'pointer' : 'not-allowed',
              opacity: t.has ? 1 : 0.5,
              borderRadius: '6px 6px 0 0',
              marginRight: 2,
              marginBottom: -1,
              position: 'relative',
              zIndex: t.id === activeTab ? 2 : 1,
            });

            return (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', margin: '8px 0 0', minHeight: 0 }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', borderBottom: '1px solid var(--border)' }}>
                  {tabs.map(t => (
                    <button
                      key={t.id}
                      onClick={() => t.has && setEntryTab(t.id)}
                      disabled={!t.has}
                      style={tabBtnStyle(t)}
                      title={t.has ? t.label : `${t.label} (no data)`}
                    >
                      {t.label}
                      {t.count != null && <span style={{ marginLeft: 4, color: 'var(--text-muted)', fontWeight: 400 }}>({t.count})</span>}
                    </button>
                  ))}
                  <div style={{ flex: 1 }} />
                  {active.has && active.id !== 'tax-refs' && (
                    <button
                      onClick={handleCopy}
                      style={{ fontSize: '0.65rem', padding: '2px 8px', border: '1px solid var(--border)', borderRadius: 4, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', marginBottom: 4 }}
                      title="Copy tab content"
                    >Copy</button>
                  )}
                </div>
                <div style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0,
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border)',
                  borderTop: 'none',
                  borderRadius: '0 6px 6px 6px',
                  padding: activeTab === 'tax-refs' ? '8px 10px' : 0,
                }}>
                  {activeTab === 'tax-refs' && (
                    taxRefCount > 0 ? (
                      <div style={{ flex: 1, minHeight: 200, overflowY: 'auto', padding: '8px 10px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', tableLayout: 'fixed' }}>
                          <colgroup>
                            <col style={{ width: '180px' }} />
                            <col />
                          </colgroup>
                          <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                              <th style={{ padding: '4px 6px', fontWeight: 600, color: 'var(--text-muted)' }}>Id</th>
                              <th style={{ padding: '4px 6px', fontWeight: 600, color: 'var(--text-muted)' }}>Relevance</th>
                            </tr>
                          </thead>
                          <tbody>
                            {entry.taxonomy_refs!.map((r, i) => {
                              const isSelected = selectedTaxRefId === r.node_id;
                              return (
                                <tr
                                  key={i}
                                  style={{
                                    borderBottom: '1px solid var(--border)',
                                    background: isSelected ? 'rgba(245, 158, 11, 0.08)' : 'transparent',
                                  }}
                                >
                                  <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>
                                    <button
                                      onClick={() => setSelectedTaxRefId(isSelected ? null : r.node_id)}
                                      style={{
                                        background: 'none',
                                        border: 'none',
                                        padding: 0,
                                        cursor: 'pointer',
                                        color: 'var(--accent)',
                                        fontWeight: isSelected ? 700 : 600,
                                        textDecoration: 'underline',
                                        fontFamily: 'inherit',
                                        fontSize: 'inherit',
                                        textAlign: 'left',
                                      }}
                                      title="Show POV details"
                                    >{r.node_id}</button>
                                  </td>
                                  <td style={{ padding: '4px 6px', verticalAlign: 'top', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                                    {r.relevance}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        {selectedTaxRefId && (() => {
                          const node = taxNodeMap.get(selectedTaxRefId) as TaxRefNode | undefined;
                          const povOfId = selectedTaxRefId.startsWith('acc-') ? 'accelerationist'
                            : selectedTaxRefId.startsWith('saf-') ? 'safetyist'
                            : selectedTaxRefId.startsWith('skp-') ? 'skeptic'
                            : selectedTaxRefId.startsWith('sit-') ? 'situations' : '';
                          return (
                            <TaxonomyRefDetail
                              nodeId={selectedTaxRefId}
                              node={node}
                              pov={povOfId}
                              onClose={() => setSelectedTaxRefId(null)}
                            />
                          );
                        })()}
                      </div>
                    ) : (
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', padding: '8px 10px' }}>No taxonomy refs for this entry.</div>
                    )
                  )}
                  {activeTab === 'tax-context' && (
                    taxContext ? (
                      <textarea readOnly value={taxContext} style={textAreaStyle} />
                    ) : (
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', padding: '12px' }}>No taxonomy context captured for this entry.</div>
                    )
                  )}
                  {activeTab === 'prompt' && (
                    prompt ? (
                      <textarea readOnly value={prompt} style={textAreaStyle} />
                    ) : (
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', padding: '12px' }}>No prompt captured for this entry.</div>
                    )
                  )}
                  {activeTab === 'response' && (
                    response ? (
                      <textarea readOnly value={response} style={textAreaStyle} />
                    ) : (
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', padding: '12px' }}>No raw response captured for this entry.</div>
                    )
                  )}
                  {activeTab === 'details' && (
                    <div style={{ padding: '8px 10px', flex: 1, minHeight: 200, overflowY: 'auto' }}>
                      {meta?.move_types && (
                        <Section title={`Dialectical Moves — ${(meta.move_types as (string | MoveAnnotation)[]).map(m => getMoveName(m)).join(', ')}`} defaultOpen copyText={`Moves: ${(meta.move_types as (string | MoveAnnotation)[]).map(m => getMoveName(m)).join(', ')}${meta.disagreement_type ? `\nType: ${meta.disagreement_type}` : ''}`}>
                          {(meta.move_types as (string | MoveAnnotation)[]).map((m, i) => {
                            const name = getMoveName(m);
                            const ann = typeof m === 'object' ? m as MoveAnnotation : null;
                            return (
                              <div key={i} style={{ margin: '4px 0', paddingLeft: 8, borderLeft: '2px solid rgba(59,130,246,0.3)' }}>
                                <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 3, background: 'rgba(59,130,246,0.2)', color: '#3b82f6', fontSize: '0.7rem', fontWeight: 600 }}>{name}</span>
                                {ann?.target && <span style={{ marginLeft: 6, fontSize: '0.65rem', color: 'var(--text-muted)' }}>→ {ann.target}</span>}
                                {ann?.detail && <div style={{ fontSize: '0.7rem', color: 'var(--text-primary)', marginTop: 2 }}>{ann.detail}</div>}
                              </div>
                            );
                          })}
                          {meta.disagreement_type && <div style={{ marginTop: 4 }}>Type: <strong>{meta.disagreement_type as string}</strong></div>}
                        </Section>
                      )}

                      {turnValTrail && (
                        <Section
                          title={`Turn Validation — ${turnValTrail.final.outcome} (score ${turnValTrail.final.score.toFixed(2)}, ${turnValTrail.attempts.length} attempt${turnValTrail.attempts.length === 1 ? '' : 's'})`}
                          defaultOpen
                        >
                          <TurnValidationSection trail={turnValTrail} />
                        </Section>
                      )}

                      {diag?.model && (
                        <Section title={`Model & Timing — ${diag.model} (${diag.response_time_ms ? (diag.response_time_ms / 1000).toFixed(1) + 's' : '?'})`} defaultOpen copyText={`Model: ${diag.model}\nResponse: ${diag.response_time_ms ? (diag.response_time_ms / 1000).toFixed(1) + 's' : '?'}`}>
                          <div>Model: {diag.model}</div>
                          {diag.response_time_ms && <div>Response: {(diag.response_time_ms / 1000).toFixed(1)}s</div>}
                        </Section>
                      )}

                      {diag?.commitment_context && (
                        <Section title="Commitments Injected" defaultOpen copyText={diag.commitment_context}>
                          <ResizablePre tall text={diag.commitment_context} />
                        </Section>
                      )}

                      {(diag as Record<string, unknown>)?.edges_used && ((diag as Record<string, unknown>).edges_used as { source: string; target: string; type: string; confidence: number }[]).length > 0 && (
                        <Section title={`Edges Used (${((diag as Record<string, unknown>).edges_used as unknown[]).length})`} defaultOpen copyText={((diag as Record<string, unknown>).edges_used as { source: string; target: string; type: string; confidence: number }[]).map(e => `${e.source} ${e.type} ${e.target} (${e.confidence.toFixed(2)})`).join('\n')}>
                          {((diag as Record<string, unknown>).edges_used as { source: string; target: string; type: string; confidence: number }[]).map((e, i) => (
                            <div key={i} style={{ margin: '2px 0', paddingLeft: 8, borderLeft: '2px solid var(--border)', fontSize: '0.7rem' }}>
                              <span style={{ color: 'var(--text-muted)' }}>{e.source}</span>
                              {' '}<strong>{e.type}</strong>{' '}
                              <span style={{ color: 'var(--text-muted)' }}>{e.target}</span>
                              <span style={{ marginLeft: 8, opacity: 0.6 }}>({(e.confidence * 100).toFixed(0)}%)</span>
                            </div>
                          ))}
                        </Section>
                      )}

                      {meta?.key_assumptions && (meta.key_assumptions as { assumption: string; if_wrong: string }[]).length > 0 && (
                        <Section title={`Key Assumptions (${(meta.key_assumptions as unknown[]).length})`} defaultOpen copyText={(meta.key_assumptions as { assumption: string; if_wrong: string }[]).map(a => `Assumes: ${a.assumption}\nIf wrong: ${a.if_wrong}`).join('\n\n')}>
                          {(meta.key_assumptions as { assumption: string; if_wrong: string }[]).map((a, i) => (
                            <div key={i} style={{ margin: '4px 0', paddingLeft: 8, borderLeft: '2px solid var(--border)' }}>
                              <div><strong>Assumes:</strong> {a.assumption}</div>
                              <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>If wrong: {a.if_wrong}</div>
                            </div>
                          ))}
                        </Section>
                      )}

                      {((meta?.policy_refs as string[])?.length > 0 || (entry.policy_refs?.length ?? 0) > 0) && (
                        <Section title={`Policy Refs (${((meta?.policy_refs as string[]) || entry.policy_refs || []).length})`} defaultOpen copyText={((meta?.policy_refs as string[]) || entry.policy_refs || []).join(', ')}>
                          {((meta?.policy_refs as string[]) || entry.policy_refs || []).map((p, i) => (
                            <span key={i} style={{ display: 'inline-block', margin: '2px 4px 2px 0', padding: '1px 6px', borderRadius: 3, background: 'rgba(139,92,246,0.15)', color: '#8b5cf6', fontSize: '0.65rem', fontWeight: 600 }}>{p}</span>
                          ))}
                        </Section>
                      )}

                      {diag?.edge_tensions && (
                        <Section title="Edge Tensions" defaultOpen copyText={diag.edge_tensions}>
                          <ResizablePre tall text={diag.edge_tensions} />
                        </Section>
                      )}

                      {diag?.argument_network_context && (
                        <Section title="Argument Network Context" defaultOpen copyText={diag.argument_network_context}>
                          <ResizablePre tall text={diag.argument_network_context} />
                        </Section>
                      )}
                    </div>
                  )}
                  {activeTab === 'brief' && briefStage && (
                    <div style={{ padding: '8px 10px', flex: 1, minHeight: 200, overflowY: 'auto' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        <span style={{ padding: '1px 6px', borderRadius: 3, background: 'rgba(59,130,246,0.2)', color: '#3b82f6', fontWeight: 600 }}>BRIEF</span>
                        <span>{briefStage.model}</span>
                        <span>temp={briefStage.temperature}</span>
                        <span>{(briefStage.response_time_ms / 1000).toFixed(1)}s</span>
                      </div>
                      {!!(briefStage.work_product as Record<string, unknown>).situation_assessment && (
                        <div style={{ padding: 8, margin: '6px 0', borderLeft: '3px solid rgba(59,130,246,0.4)', background: 'rgba(59,130,246,0.05)', fontSize: '0.78rem' }}>
                          {String((briefStage.work_product as Record<string, unknown>).situation_assessment)}
                        </div>
                      )}
                      {Array.isArray((briefStage.work_product as Record<string, unknown>).key_claims_to_address) && (
                        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Key Claims to Address</summary>
                          <ul style={{ fontSize: '0.72rem', margin: '4px 0', paddingLeft: 16 }}>
                            {((briefStage.work_product as Record<string, unknown>).key_claims_to_address as { claim: string; speaker: string; an_id?: string }[]).map((c, i) => (
                              <li key={i}><strong>{c.speaker}</strong>{c.an_id ? ` (${c.an_id})` : ''}: {c.claim}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                      {Array.isArray((briefStage.work_product as Record<string, unknown>).relevant_taxonomy_nodes) && (
                        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Relevant Taxonomy Nodes</summary>
                          <table style={{ width: '100%', fontSize: '0.7rem', borderCollapse: 'collapse' }}>
                            <tbody>
                              {((briefStage.work_product as Record<string, unknown>).relevant_taxonomy_nodes as { node_id: string; why: string }[]).map((n, i) => (
                                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                                  <td style={{ padding: '3px 6px', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{n.node_id}</td>
                                  <td style={{ padding: '3px 6px' }}>{n.why}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </details>
                      )}
                      {Array.isArray((briefStage.work_product as Record<string, unknown>).edge_tensions) && ((briefStage.work_product as Record<string, unknown>).edge_tensions as { edge: string; relevance: string }[]).length > 0 && (
                        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Edge Tensions</summary>
                          <ul style={{ fontSize: '0.72rem', margin: '4px 0', paddingLeft: 16 }}>
                            {((briefStage.work_product as Record<string, unknown>).edge_tensions as { edge: string; relevance: string }[]).map((t, i) => (
                              <li key={i}><strong>{t.edge}</strong>: {t.relevance}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                      {!!(briefStage.work_product as Record<string, unknown>).phase_considerations && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 6, fontStyle: 'italic' }}>
                          {String((briefStage.work_product as Record<string, unknown>).phase_considerations)}
                        </div>
                      )}
                      <details style={{ marginTop: 8 }}><summary style={{ cursor: 'pointer', fontSize: '0.65rem', color: 'var(--text-muted)' }}>Raw Prompt</summary>
                        <pre style={{ fontSize: '0.65rem', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{briefStage.prompt}</pre>
                      </details>
                      <details><summary style={{ cursor: 'pointer', fontSize: '0.65rem', color: 'var(--text-muted)' }}>Raw Response</summary>
                        <pre style={{ fontSize: '0.65rem', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{briefStage.raw_response}</pre>
                      </details>
                    </div>
                  )}
                  {activeTab === 'plan' && planStage && (
                    <div style={{ padding: '8px 10px', flex: 1, minHeight: 200, overflowY: 'auto' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        <span style={{ padding: '1px 6px', borderRadius: 3, background: 'rgba(168,85,247,0.2)', color: '#a855f7', fontWeight: 600 }}>PLAN</span>
                        <span>{planStage.model}</span>
                        <span>temp={planStage.temperature}</span>
                        <span>{(planStage.response_time_ms / 1000).toFixed(1)}s</span>
                      </div>
                      {!!(planStage.work_product as Record<string, unknown>).strategic_goal && (
                        <div style={{ padding: 8, margin: '6px 0', borderLeft: '3px solid rgba(168,85,247,0.4)', background: 'rgba(168,85,247,0.05)', fontSize: '0.78rem', fontWeight: 600 }}>
                          {String((planStage.work_product as Record<string, unknown>).strategic_goal)}
                        </div>
                      )}
                      {Array.isArray((planStage.work_product as Record<string, unknown>).planned_moves) && (
                        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Planned Moves</summary>
                          {((planStage.work_product as Record<string, unknown>).planned_moves as { move: string; target?: string; detail: string }[]).map((m, i) => (
                            <div key={i} style={{ margin: '4px 0', paddingLeft: 8, borderLeft: '2px solid rgba(168,85,247,0.3)' }}>
                              <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 3, background: 'rgba(168,85,247,0.2)', color: '#a855f7', fontSize: '0.7rem', fontWeight: 600 }}>{m.move}</span>
                              {m.target && <span style={{ marginLeft: 6, fontSize: '0.65rem', color: 'var(--text-muted)' }}>{'\u2192'} {m.target}</span>}
                              {m.detail && <div style={{ fontSize: '0.7rem', color: 'var(--text-primary)', marginTop: 2 }}>{m.detail}</div>}
                            </div>
                          ))}
                        </details>
                      )}
                      {!!(planStage.work_product as Record<string, unknown>).argument_sketch && (
                        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Argument Sketch</summary>
                          <div style={{ fontSize: '0.72rem', padding: 6, background: 'rgba(128,128,128,0.05)', borderRadius: 4 }}>
                            {String((planStage.work_product as Record<string, unknown>).argument_sketch)}
                          </div>
                        </details>
                      )}
                      {Array.isArray((planStage.work_product as Record<string, unknown>).anticipated_responses) && ((planStage.work_product as Record<string, unknown>).anticipated_responses as string[]).length > 0 && (
                        <details><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Anticipated Responses</summary>
                          <ul style={{ fontSize: '0.72rem', margin: '4px 0', paddingLeft: 16 }}>
                            {((planStage.work_product as Record<string, unknown>).anticipated_responses as string[]).map((r, i) => (
                              <li key={i}>{r}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                      <details style={{ marginTop: 8 }}><summary style={{ cursor: 'pointer', fontSize: '0.65rem', color: 'var(--text-muted)' }}>Raw Prompt</summary>
                        <pre style={{ fontSize: '0.65rem', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{planStage.prompt}</pre>
                      </details>
                      <details><summary style={{ cursor: 'pointer', fontSize: '0.65rem', color: 'var(--text-muted)' }}>Raw Response</summary>
                        <pre style={{ fontSize: '0.65rem', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{planStage.raw_response}</pre>
                      </details>
                    </div>
                  )}
                  {activeTab === 'draft' && draftStage && (
                    <div style={{ padding: '8px 10px', flex: 1, minHeight: 200, overflowY: 'auto' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        <span style={{ padding: '1px 6px', borderRadius: 3, background: 'rgba(34,197,94,0.2)', color: '#22c55e', fontWeight: 600 }}>DRAFT</span>
                        <span>{draftStage.model}</span>
                        <span>temp={draftStage.temperature}</span>
                        <span>{(draftStage.response_time_ms / 1000).toFixed(1)}s</span>
                      </div>
                      {!!(draftStage.work_product as Record<string, unknown>).statement && (
                        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Statement</summary>
                          <div style={{ fontSize: '0.75rem', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                            {String((draftStage.work_product as Record<string, unknown>).statement)}
                          </div>
                        </details>
                      )}
                      {Array.isArray((draftStage.work_product as Record<string, unknown>).claim_sketches) && (
                        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Claim Sketches</summary>
                          <ul style={{ fontSize: '0.72rem', margin: '4px 0', paddingLeft: 16 }}>
                            {((draftStage.work_product as Record<string, unknown>).claim_sketches as { claim: string; targets: string[] }[]).map((c, i) => (
                              <li key={i}>{c.claim}{c.targets?.length > 0 ? ` \u2192 ${c.targets.join(', ')}` : ''}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                      {Array.isArray((draftStage.work_product as Record<string, unknown>).key_assumptions) && (
                        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Key Assumptions</summary>
                          {((draftStage.work_product as Record<string, unknown>).key_assumptions as { assumption: string; if_wrong: string }[]).map((a, i) => (
                            <div key={i} style={{ fontSize: '0.72rem', margin: '4px 0', paddingLeft: 8, borderLeft: '2px solid rgba(34,197,94,0.3)' }}>
                              <div><strong>Assumption:</strong> {a.assumption}</div>
                              <div style={{ color: 'var(--text-muted)' }}><strong>If wrong:</strong> {a.if_wrong}</div>
                            </div>
                          ))}
                        </details>
                      )}
                      {!!(draftStage.work_product as Record<string, unknown>).disagreement_type && (
                        <div style={{ fontSize: '0.72rem', marginTop: 6 }}>
                          <strong>Disagreement type:</strong> {String((draftStage.work_product as Record<string, unknown>).disagreement_type)}
                        </div>
                      )}
                      <details style={{ marginTop: 8 }}><summary style={{ cursor: 'pointer', fontSize: '0.65rem', color: 'var(--text-muted)' }}>Raw Prompt</summary>
                        <pre style={{ fontSize: '0.65rem', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{draftStage.prompt}</pre>
                      </details>
                      <details><summary style={{ cursor: 'pointer', fontSize: '0.65rem', color: 'var(--text-muted)' }}>Raw Response</summary>
                        <pre style={{ fontSize: '0.65rem', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{draftStage.raw_response}</pre>
                      </details>
                    </div>
                  )}
                  {activeTab === 'cite' && citeStage && (
                    <div style={{ padding: '8px 10px', flex: 1, minHeight: 200, overflowY: 'auto' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        <span style={{ padding: '1px 6px', borderRadius: 3, background: 'rgba(251,146,60,0.2)', color: '#fb923c', fontWeight: 600 }}>CITE</span>
                        <span>{citeStage.model}</span>
                        <span>temp={citeStage.temperature}</span>
                        <span>{(citeStage.response_time_ms / 1000).toFixed(1)}s</span>
                        {typeof (citeStage.work_product as Record<string, unknown>).grounding_confidence === 'number' && (
                          <span style={{ padding: '1px 6px', borderRadius: 3, background: (citeStage.work_product as Record<string, unknown>).grounding_confidence as number >= 0.7 ? 'rgba(34,197,94,0.2)' : 'rgba(251,146,60,0.2)', fontSize: '0.65rem' }}>
                            confidence: {((citeStage.work_product as Record<string, unknown>).grounding_confidence as number).toFixed(2)}
                          </span>
                        )}
                      </div>
                      {Array.isArray((citeStage.work_product as Record<string, unknown>).taxonomy_refs) && (
                        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Taxonomy References</summary>
                          <table style={{ width: '100%', fontSize: '0.7rem', borderCollapse: 'collapse' }}>
                            <tbody>
                              {((citeStage.work_product as Record<string, unknown>).taxonomy_refs as { node_id: string; relevance: string }[]).map((r, i) => (
                                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                                  <td style={{ padding: '3px 6px', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{r.node_id}</td>
                                  <td style={{ padding: '3px 6px' }}>{r.relevance}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </details>
                      )}
                      {Array.isArray((citeStage.work_product as Record<string, unknown>).move_annotations) && (
                        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Move Annotations</summary>
                          {((citeStage.work_product as Record<string, unknown>).move_annotations as { move: string; target?: string; detail: string }[]).map((m, i) => (
                            <div key={i} style={{ margin: '4px 0', paddingLeft: 8, borderLeft: '2px solid rgba(251,146,60,0.3)' }}>
                              <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 3, background: 'rgba(251,146,60,0.2)', color: '#fb923c', fontSize: '0.7rem', fontWeight: 600 }}>{m.move}</span>
                              {m.target && <span style={{ marginLeft: 6, fontSize: '0.65rem', color: 'var(--text-muted)' }}>{'\u2192'} {m.target}</span>}
                              {m.detail && <div style={{ fontSize: '0.7rem', color: 'var(--text-primary)', marginTop: 2 }}>{m.detail}</div>}
                            </div>
                          ))}
                        </details>
                      )}
                      {Array.isArray((citeStage.work_product as Record<string, unknown>).policy_refs) && ((citeStage.work_product as Record<string, unknown>).policy_refs as string[]).length > 0 && (
                        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Policy References</summary>
                          <ul style={{ fontSize: '0.72rem', margin: '4px 0', paddingLeft: 16 }}>
                            {((citeStage.work_product as Record<string, unknown>).policy_refs as string[]).map((p, i) => (
                              <li key={i} style={{ fontFamily: 'monospace' }}>{p}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                      <details style={{ marginTop: 8 }}><summary style={{ cursor: 'pointer', fontSize: '0.65rem', color: 'var(--text-muted)' }}>Raw Prompt</summary>
                        <pre style={{ fontSize: '0.65rem', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{citeStage.prompt}</pre>
                      </details>
                      <details><summary style={{ cursor: 'pointer', fontSize: '0.65rem', color: 'var(--text-muted)' }}>Raw Response</summary>
                        <pre style={{ fontSize: '0.65rem', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{citeStage.raw_response}</pre>
                      </details>
                    </div>
                  )}
                  {activeTab === 'claims' && (
                    <div style={{ padding: '8px 10px', flex: 1, minHeight: 200, overflowY: 'auto' }}>
                      {meta?.my_claims && (meta.my_claims as { claim: string; targets: string[] }[]).length > 0 && (
                        <Section title={`Claim Sketches (${(meta.my_claims as unknown[]).length})`} copyText={(meta.my_claims as { claim: string; targets: string[] }[]).map((c, i) => `${i + 1}. ${c.claim}${c.targets?.length > 0 ? ` → ${c.targets.join(', ')}` : ''}`).join('\n')}>
                          {(meta.my_claims as { claim: string; targets: string[] }[]).map((c, i) => (
                            <div key={i} style={{ margin: '3px 0', fontSize: '0.7rem' }}>
                              <span style={{ color: '#3b82f6' }}>{i + 1}.</span> <Highlight text={c.claim} />
                              {c.targets?.length > 0 && <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>→ {c.targets.join(', ')}</span>}
                            </div>
                          ))}
                        </Section>
                      )}

                      {diag?.extracted_claims && (
                        <Section title={`Extracted Claims (${diag.extracted_claims.accepted.length} accepted, ${diag.extracted_claims.rejected.length} rejected)`} defaultOpen copyText={[...diag.extracted_claims.accepted.map(c => `✓ ${c.id} (${c.overlap_pct}%): ${c.text}`), ...diag.extracted_claims.rejected.map(c => `✗ (${c.overlap_pct}%): ${c.text} — ${c.reason}`)].join('\n')}>
                          {diag.extracted_claims.accepted.map((c, i) => {
                            const outEdges = an?.edges.filter(e => e.source === c.id) ?? [];
                            const edgeSummary = outEdges.map(edge => {
                              const label = edge.type === 'attacks'
                                ? (edge.attack_type ? `attacks(${edge.attack_type})` : 'attacks')
                                : 'supports';
                              return `${label} ${edge.target}`;
                            }).join(', ');
                            return (
                              <details key={i} style={{ margin: '4px 0' }}>
                                <summary style={{ cursor: 'pointer' }}>
                                  <span style={{ color: '#22c55e' }}>✓ {c.id}</span> <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>{c.overlap_pct}%</span> <Highlight text={c.text} />
                                  {outEdges.length > 0 && (
                                    <span style={{ fontSize: '0.6rem', marginLeft: 6, color: 'var(--text-muted)' }}>
                                      [{edgeSummary}]
                                    </span>
                                  )}
                                </summary>
                                {outEdges.length > 0 && (
                                  <div style={{ paddingLeft: 20, marginTop: 4, marginBottom: 4 }}>
                                    {outEdges.map((edge, ei) => {
                                      const targetNode = an?.nodes.find(n => n.id === edge.target);
                                      const edgeLabel = edge.type === 'attacks'
                                        ? (edge.attack_type ? `attacks (${edge.attack_type})` : 'attacks')
                                        : 'supports';
                                      return (
                                        <div key={ei} style={{ fontSize: '0.65rem', margin: '3px 0', paddingLeft: 10, borderLeft: `2px solid ${edge.type === 'attacks' ? '#ef4444' : '#22c55e'}` }}>
                                          <div>
                                            <span style={{ color: edge.type === 'attacks' ? '#ef4444' : '#22c55e', fontWeight: 600 }}>{edgeLabel}</span>
                                            {edge.argumentation_scheme && <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>[{edge.argumentation_scheme}]</span>}
                                          </div>
                                          {targetNode && (
                                            <div style={{ color: 'var(--text-muted)', marginTop: 1 }}>
                                              <span style={{ fontWeight: 600 }}>{targetNode.id}</span> ({POVER_INFO[targetNode.speaker as keyof typeof POVER_INFO]?.label ?? targetNode.speaker}): {targetNode.text}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </details>
                            );
                          })}
                          {diag.extracted_claims.rejected.map((c, i) => (
                            <div key={i} style={{ margin: '3px 0' }}>
                              <span style={{ color: '#ef4444' }}>✗</span> <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>{c.overlap_pct}%</span> <Highlight text={c.text} />
                              <div style={{ color: '#f59e0b', fontSize: '0.65rem', paddingLeft: 16 }}>{c.reason}</div>
                            </div>
                          ))}
                        </Section>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

        </div>
        );
      })()}
    </div>
    </DiagSearchContext.Provider>
  );
}
