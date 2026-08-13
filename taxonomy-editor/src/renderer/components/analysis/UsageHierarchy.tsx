// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * UsageHierarchy — hierarchical analytics navigation (spec §0-§8, t/2561).
 * Two independent axes: WHAT (drill-down breadcrumb + tree) × WHO (scope bar user→session).
 * Changing scope never resets the drill path; changing drill path never resets scope.
 *
 * Data contract: useAnalytics hook (t/2560#1). Import currently sourced from
 * _useAnalyticsStub.ts (in-scope stub); swap to ../../hooks/useAnalytics when t/2560 lands.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { fmtDuration, fmtNumber, relativeTime } from './engagementTree';
import { getKind, inferKind, labelForId } from './kindRegistry';
import {
  useAnalytics,
  type DateRange, type AnalyticsScope, type SessionRow,
  type SubjectBreakdownRow, type AsyncState, type EngagementResult,
  type SubjectGroupBy, type UseAnalyticsResult,
} from './_useAnalyticsStub';
import './UsageHierarchy.css';

// ── Types ─────────────────────────────────────────────────────────────────────

import type { TreeNode } from './engagementTree';

interface ScopeUserRow { user: string; engagedMs: number; sessions?: number }

// ── Helpers ───────────────────────────────────────────────────────────────────

function walkPath(root: TreeNode, path: string[]): TreeNode | null {
  let node: TreeNode = root;
  for (const key of path) {
    if (!node.children?.[key]) return null;
    node = node.children[key];
  }
  return node;
}

function isLeafNode(node: TreeNode): boolean {
  return !node.children || Object.keys(node.children).length === 0;
}

// ── Section 1: Scope bar (WHO axis) ──────────────────────────────────────────

interface ScopeBarProps {
  scopeUser: string | null; scopeSession: string | null;
  users: ScopeUserRow[]; sessions: SessionRow[];
  onSetUser: (u: string) => void; onClearUser: () => void;
  onSetSession: (sid: string) => void; onClearSession: () => void;
}

function ScopeBar({ scopeUser, scopeSession, users, sessions, onSetUser, onClearUser, onSetSession, onClearSession }: ScopeBarProps) {
  const [userOpen, setUserOpen] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const barRef = useRef<HTMLDivElement>(null);
  const userBtnRef = useRef<HTMLButtonElement>(null);
  const sessionBtnRef = useRef<HTMLButtonElement>(null);

  const anyOpen = userOpen || sessionOpen;

  useEffect(() => {
    if (!anyOpen) return;
    const onDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setUserOpen(false); setSessionOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setUserOpen(false); setSessionOpen(false);
        userBtnRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [anyOpen]);

  const filteredUsers = useMemo(() => {
    const q = filter.toLowerCase();
    return q ? users.filter(u => u.user.toLowerCase().includes(q)) : users;
  }, [users, filter]);

  const toggleUser = () => { setUserOpen(o => !o); setSessionOpen(false); };
  const toggleSession = () => { setSessionOpen(o => !o); setUserOpen(false); };

  return (
    <div className="uh-scope-bar" ref={barRef} role="group" aria-label="Scope filter">
      {!scopeUser ? (
        <button ref={userBtnRef} className="uh-scope-pill" onClick={toggleUser} aria-expanded={userOpen} aria-haspopup="listbox">
          Everyone ▾
        </button>
      ) : (
        <span className="uh-scope-pill uh-scope-pill--active">
          {scopeUser}
          <button className="uh-pill-clear" onClick={onClearUser} aria-label={`Clear user: ${scopeUser}`}>✕</button>
        </span>
      )}

      {scopeUser && (
        !scopeSession ? (
          <button ref={sessionBtnRef} className="uh-scope-pill" onClick={toggleSession} aria-expanded={sessionOpen} aria-haspopup="listbox">
            All sessions ▾
          </button>
        ) : (
          <span className="uh-scope-pill uh-scope-pill--active">
            {relativeTime(scopeSession)}
            <button className="uh-pill-clear" onClick={onClearSession} aria-label="Clear session scope">✕</button>
          </span>
        )
      )}

      {userOpen && (
        <div className="uh-picker" role="listbox" aria-label="Pick a user">
          <input className="uh-picker-filter" placeholder="Filter users…" aria-label="Filter users"
            value={filter} onChange={e => setFilter(e.target.value)} autoFocus />
          {filteredUsers.length === 0 && <div className="uh-picker-empty">No users found.</div>}
          {filteredUsers.map(u => (
            <button key={u.user} role="option" className="uh-picker-row"
              onClick={() => { onSetUser(u.user); setUserOpen(false); setFilter(''); }}>
              <span className="uh-picker-name">{u.user}</span>
              <span className="uh-picker-meta">{fmtDuration(u.engagedMs)}{u.sessions != null ? ` · ${u.sessions} sessions` : ''}</span>
            </button>
          ))}
        </div>
      )}

      {sessionOpen && sessions.length > 0 && (
        <div className="uh-picker" role="listbox" aria-label="Pick a session">
          {sessions.map(s => (
            <button key={s.id} role="option" className="uh-picker-row"
              onClick={() => { onSetSession(s.id); setSessionOpen(false); }}>
              <span className="uh-picker-name">{relativeTime(s.startTime)}</span>
              <span className="uh-picker-meta">{fmtDuration(s.engagedMs)} · {s.nodeCount} nodes</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Section 2: Breadcrumb (WHAT axis) ────────────────────────────────────────

function BreadcrumbNav({ drillPath, onNavigate }: { drillPath: string[]; onNavigate: (idx: number) => void }) {
  return (
    <nav className="uh-breadcrumb" aria-label="Drill-down path">
      <button className="uh-breadcrumb-seg" onClick={() => onNavigate(0)}>Total</button>
      {drillPath.map((seg, i) => (
        <span key={seg} className="uh-breadcrumb-item">
          <span className="uh-breadcrumb-sep" aria-hidden="true">›</span>
          <button className="uh-breadcrumb-seg" onClick={() => onNavigate(i + 1)}>
            {labelForId(seg)}
          </button>
        </span>
      ))}
    </nav>
  );
}

// ── Section 3: Summary card ───────────────────────────────────────────────────

function SummaryCard({ node, scope }: { node: TreeNode; scope: AnalyticsScope }) {
  const childCount = Object.keys(node.children ?? {}).length;
  const kind = inferKind(node.id);
  const { countUnit } = getKind(kind);
  const showUsers = scope.kind !== 'session' && node.uniqueUsers != null;

  return (
    <div className="uh-summary-card" aria-label="Subtree aggregate">
      <div className="uh-summary-metric">
        <div className="uh-summary-value">{fmtDuration(node.engagedMs)}</div>
        <div className="uh-summary-label">Engaged</div>
      </div>
      <div className="uh-summary-metric">
        <div className="uh-summary-value">{fmtNumber(node.visits)}</div>
        <div className="uh-summary-label">Visits</div>
      </div>
      {countUnit && (
        <div className="uh-summary-metric">
          <div className="uh-summary-value">{fmtNumber(childCount)}</div>
          <div className="uh-summary-label">{countUnit}</div>
        </div>
      )}
      {showUsers && (
        <div className="uh-summary-metric">
          <div className="uh-summary-value">{fmtNumber(node.uniqueUsers!)}</div>
          <div className="uh-summary-label">Users</div>
        </div>
      )}
    </div>
  );
}

// ── Section 4: Drill table ────────────────────────────────────────────────────

function DrillRow({ nodeKey, node, parentEngagedMs, onDrill }: {
  nodeKey: string; node: TreeNode; parentEngagedMs: number; onDrill: (key: string) => void;
}) {
  const pct = parentEngagedMs > 0 ? Math.min(100, (node.engagedMs / parentEngagedMs) * 100) : 0;
  const { showIdChip } = getKind(inferKind(nodeKey));
  const label = labelForId(nodeKey);
  const handleActivate = () => onDrill(nodeKey);

  return (
    <div className="uh-drill-row" role="button" tabIndex={0}
      onClick={handleActivate}
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && handleActivate()}
      aria-label={`Drill into ${label}`}
    >
      <span className="uh-drill-label">
        {label}
        {showIdChip && <code className="uh-id-chip">{nodeKey}</code>}
      </span>
      <span className="uh-drill-num">{fmtDuration(node.engagedMs)}</span>
      <span className="uh-drill-num">{fmtNumber(node.visits)}</span>
      <span className="uh-drill-bar-col" aria-label={`${pct.toFixed(0)}% of parent`}>
        <span className="uh-drill-pct">{pct.toFixed(0)}%</span>
        <span className="uh-bar-track">
          {/* eslint-disable-next-line local/no-inline-style -- dynamic: bar width from data */}
          <span className="uh-bar-fill" style={{ width: `${pct}%` }} />
        </span>
      </span>
    </div>
  );
}

function DrillTable({ children, parentEngagedMs, onDrill }: {
  children: [string, TreeNode][]; parentEngagedMs: number; onDrill: (key: string) => void;
}) {
  const sorted = useMemo(() => [...children].sort((a, b) => b[1].engagedMs - a[1].engagedMs), [children]);
  if (sorted.length === 0) return <div className="uh-drill-empty">No children in this subtree for this scope.</div>;

  const firstKind = sorted[0] ? inferKind(sorted[0][0]) : 'root';
  const colHeader = getKind(firstKind).columnHeader || 'Item';

  return (
    <div className="uh-drill-table" role="grid" aria-label="Breakdown table">
      <div className="uh-drill-header" role="row">
        <span role="columnheader">{colHeader}</span>
        <span role="columnheader">Engaged</span>
        <span role="columnheader">Visits</span>
        <span role="columnheader">Share</span>
      </div>
      {sorted.map(([key, node]) => (
        <DrillRow key={key} nodeKey={key} node={node} parentEngagedMs={parentEngagedMs} onDrill={onDrill} />
      ))}
    </div>
  );
}

// ── Section 5: Leaf cross-axis panel ─────────────────────────────────────────

interface LeafPanelProps {
  subjectId: string; scope: AnalyticsScope;
  subject: AsyncState<SubjectBreakdownRow[]>;
  onSetUser: (u: string) => void; onSetSession: (sid: string) => void;
}

function LeafPanel({ subjectId, scope, subject, onSetUser, onSetSession }: LeafPanelProps) {
  const kindLabel = getKind(inferKind(subjectId)).tag.toLowerCase();

  if (subject.loading) return <div className="uh-leaf-loading">Loading breakdown…</div>;
  if (subject.error) return <div className="uh-leaf-error">Failed to load breakdown.</div>;

  if (scope.kind === 'session') {
    const engagedMs = subject.data?.[0]?.engagedMs ?? 0;
    return (
      <div className="uh-leaf-session-summary">
        In this session, {fmtDuration(engagedMs)} spent on this {kindLabel}.
      </div>
    );
  }

  if (!subject.data || subject.isEmpty) {
    return <div className="uh-leaf-empty">No engagement on this {kindLabel} yet.</div>;
  }

  const isUserScope = scope.kind === 'user';
  const prompt = isUserScope
    ? `${scope.user} on this ${kindLabel}, by session — click to narrow further.`
    : `Who engaged with this ${kindLabel}? Click a user to scope the whole view.`;

  return (
    <div className="uh-leaf-panel">
      <div className="uh-leaf-prompt">{prompt}</div>
      {subject.data.map(row => {
        const activate = () => isUserScope ? onSetSession(row.key) : onSetUser(row.key);
        return (
          <div key={row.key} className="uh-leaf-row" role="button" tabIndex={0}
            onClick={activate}
            onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && activate()}
            aria-label={`Scope to ${row.key}`}
          >
            <span className="uh-leaf-key">{row.key}</span>
            <span className="uh-leaf-num">{fmtDuration(row.engagedMs)}</span>
            <span className="uh-leaf-num">{fmtNumber(row.visits)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Section 6: Tree view ──────────────────────────────────────────────────────

function TreeBranch({ node, path, depth, totalEngagedMs, onDrill }: {
  node: TreeNode; path: string[]; depth: number;
  totalEngagedMs: number; onDrill: (path: string[]) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const children = Object.entries(node.children ?? {})
    .filter(([, child]) => child.engagedMs > 0)
    .sort((a, b) => b[1].engagedMs - a[1].engagedMs);
  const hasChildren = children.length > 0;
  const pct = totalEngagedMs > 0 ? Math.min(100, (node.engagedMs / totalEngagedMs) * 100) : 0;
  const label = labelForId(node.id);

  return (
    <div className="uh-tree-branch">
      <div
        className="uh-tree-row"
        /* eslint-disable-next-line local/no-inline-style -- dynamic: indent depth from data */
        style={{ paddingLeft: `${depth * 16}px` }}
      >
        <button className="uh-tree-toggle" onClick={() => hasChildren && setExpanded(e => !e)}
          aria-expanded={hasChildren ? expanded : undefined}
          aria-label={hasChildren ? `${expanded ? 'Collapse' : 'Expand'} ${label}` : label}
          disabled={!hasChildren}
        >
          {hasChildren ? (expanded ? '▾' : '▸') : '•'}
        </button>
        <span className="uh-tree-label" role="button" tabIndex={0}
          onClick={() => onDrill(path)}
          onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onDrill(path)}
        >
          {label}
        </span>
        <span className="uh-tree-num">{fmtDuration(node.engagedMs)}</span>
        <span className="uh-tree-bar-col" aria-label={`${pct.toFixed(0)}% of total`}>
          <span className="uh-bar-track">
            {/* eslint-disable-next-line local/no-inline-style -- dynamic: bar width from data */}
            <span className="uh-bar-fill" style={{ width: `${pct}%` }} />
          </span>
          <span className="uh-tree-pct">{pct.toFixed(0)}%</span>
        </span>
      </div>
      {expanded && children.map(([key, child]) => (
        <TreeBranch key={key} node={child} path={[...path, key]}
          depth={depth + 1} totalEngagedMs={totalEngagedMs} onDrill={onDrill} />
      ))}
    </div>
  );
}

function TreeView({ root, totalEngagedMs, onDrill }: {
  root: TreeNode; totalEngagedMs: number; onDrill: (path: string[]) => void;
}) {
  return (
    <div className="uh-tree" role="tree" aria-label="Usage hierarchy tree">
      <TreeBranch node={root} path={[]} depth={0} totalEngagedMs={totalEngagedMs} onDrill={onDrill} />
    </div>
  );
}

// ── Section 7: Loading / empty states ────────────────────────────────────────

function SkeletonState() {
  return (
    <div className="uh-skeleton" aria-busy="true" aria-label="Loading hierarchy">
      <div className="uh-skeleton-card" />
      {[0, 1, 2, 3].map(i => <div key={i} className="uh-skeleton-row" />)}
    </div>
  );
}

function EmptyState({ underScope }: { underScope: boolean }) {
  return (
    <div className="uh-empty">
      <div className="uh-empty-title">
        {underScope ? 'No activity in this branch for the selected scope.' : 'No analytics data available.'}
      </div>
      <div className="uh-empty-sub">
        {underScope
          ? 'The branch is valid — try a wider scope or a different branch.'
          : 'Engagement will appear as users interact with the app.'}
      </div>
    </div>
  );
}

// ── Section 8: Body (extracted to keep main component under complexity limit) ─

interface BodyProps {
  engagement: AsyncState<EngagementResult>;
  currentNode: TreeNode | null;
  drillPath: string[];
  viewMode: 'drill' | 'tree';
  scope: AnalyticsScope;
  subject: AsyncState<SubjectBreakdownRow[]>;
  onDrill: (key: string) => void;
  onTreeDrill: (path: string[]) => void;
  onSetUser: (u: string) => void;
  onSetSession: (sid: string) => void;
}

function HierarchyBody({ engagement, currentNode, drillPath, viewMode, scope, subject, onDrill, onTreeDrill, onSetUser, onSetSession }: BodyProps) {
  if (engagement.loading) return <SkeletonState />;
  if (engagement.error) return <div className="uh-error">Failed to load: {engagement.error}</div>;
  if (!engagement.data) return null;

  const root = engagement.data.aggregate;
  const underScope = engagement.isEmpty && scope.kind !== 'all';

  if (engagement.isEmpty) return <EmptyState underScope={underScope} />;
  if (!currentNode) return <div className="uh-error">Navigation path not found — try navigating up.</div>;

  const isLeaf = isLeafNode(currentNode);
  const children = Object.entries(currentNode.children ?? {}) as [string, TreeNode][];

  if (viewMode === 'tree') {
    return (
      <>
        <SummaryCard node={currentNode} scope={scope} />
        <TreeView root={currentNode} totalEngagedMs={root.engagedMs} onDrill={onTreeDrill} />
      </>
    );
  }

  return (
    <>
      <SummaryCard node={currentNode} scope={scope} />
      {isLeaf ? (
        <LeafPanel subjectId={currentNode.id} scope={scope} subject={subject}
          onSetUser={onSetUser} onSetSession={onSetSession} />
      ) : (
        <DrillTable children={children} parentEngagedMs={currentNode.engagedMs} onDrill={onDrill} />
      )}
    </>
  );
}

// ── Section 9: Main export ────────────────────────────────────────────────────

export function UsageHierarchy({ range }: { range: DateRange }) {
  // WHAT axis — drill path (array of node ID keys from root)
  const [drillPath, setDrillPath] = useState<string[]>([]);
  // WHO axis — scope filter (fully independent of WHAT; see TL ruling t/2561#2)
  const [scopeUser, setScopeUser] = useState<string | null>(null);
  const [scopeSession, setScopeSession] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'drill' | 'tree'>('drill');

  const scope = useMemo<AnalyticsScope>(() => {
    if (scopeSession && scopeUser) return { kind: 'session', session: scopeSession };
    if (scopeUser) return { kind: 'user', user: scopeUser };
    return { kind: 'all' };
  }, [scopeUser, scopeSession]);

  const { engagement, sessions, subject, loadSubjectBreakdown }: UseAnalyticsResult =
    useAnalytics({ range, scope });

  // Navigate to the node addressed by drillPath; null if path resolves nothing
  const currentNode = useMemo(() => {
    if (!engagement.data) return null;
    return walkPath(engagement.data.aggregate, drillPath);
  }, [engagement.data, drillPath]);

  const isLeaf = currentNode != null && isLeafNode(currentNode);

  // Handlers — axis independence is the invariant: scope handlers never touch drillPath, drill never touches scope
  const handleDrill = useCallback((key: string) => setDrillPath(p => [...p, key]), []);
  const handleBreadcrumb = useCallback((idx: number) => setDrillPath(p => p.slice(0, idx)), []);
  const handleTreeDrill = useCallback((path: string[]) => setDrillPath(path), []);
  const handleSetUser = useCallback((u: string) => { setScopeUser(u); setScopeSession(null); }, []);
  const handleClearUser = useCallback(() => { setScopeUser(null); setScopeSession(null); }, []);
  const handleSetSession = useCallback((sid: string) => setScopeSession(sid), []);
  const handleClearSession = useCallback(() => setScopeSession(null), []);

  // Load subject WHO breakdown whenever we land on a leaf (spec §6)
  useEffect(() => {
    if (!isLeaf || !currentNode) return;
    const groupBy: SubjectGroupBy = scope.kind === 'all' ? 'user' : 'session';
    loadSubjectBreakdown(currentNode.id, groupBy);
  }, [isLeaf, currentNode?.id, scope.kind, loadSubjectBreakdown]);

  const users = (engagement.data?.users ?? []) as { user: string; engagedMs: number; sessions?: number }[];
  const sessionRows = sessions.data ?? [];

  return (
    <div className="uh-root">
      <ScopeBar
        scopeUser={scopeUser} scopeSession={scopeSession}
        users={users} sessions={sessionRows}
        onSetUser={handleSetUser} onClearUser={handleClearUser}
        onSetSession={handleSetSession} onClearSession={handleClearSession}
      />
      <div className="uh-nav-row">
        <BreadcrumbNav drillPath={drillPath} onNavigate={handleBreadcrumb} />
        <div className="uh-toolbar">
          <button
            className={`uh-view-toggle${viewMode === 'drill' ? ' uh-view-toggle--active' : ''}`}
            onClick={() => setViewMode('drill')}
            aria-pressed={viewMode === 'drill'}
          >
            Drill-down
          </button>
          <button
            className={`uh-view-toggle${viewMode === 'tree' ? ' uh-view-toggle--active' : ''}`}
            onClick={() => setViewMode('tree')}
            aria-pressed={viewMode === 'tree'}
          >
            Tree
          </button>
        </div>
      </div>
      <HierarchyBody
        engagement={engagement} currentNode={currentNode} drillPath={drillPath}
        viewMode={viewMode} scope={scope} subject={subject}
        onDrill={handleDrill} onTreeDrill={handleTreeDrill}
        onSetUser={handleSetUser} onSetSession={handleSetSession}
      />
    </div>
  );
}
