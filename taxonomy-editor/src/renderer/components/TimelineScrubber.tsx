// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Debate timeline scrubber (CG-3).
 * Step through debate turns to see the argument network + convergence evolve.
 * Highlights new nodes and strength changes at each turn.
 */

import { useState, useMemo, useCallback } from 'react';
import { useDebateStore } from '../hooks/useDebateStore';
import { POVER_INFO } from '../types/debate';
import type { ArgumentNetworkNode, ArgumentNetworkEdge } from '../types/debate';
import { ArgumentGraph, GraphNodeDetailPanel } from './ArgumentGraph';

interface TimelineScrubberProps {
  nodes: ArgumentNetworkNode[];
  edges: ArgumentNetworkEdge[];
}

export function TimelineScrubber({ nodes, edges }: TimelineScrubberProps) {
  const activeDebate = useDebateStore(s => s.activeDebate);
  const maxTurn = useMemo(() => Math.max(0, ...nodes.map(n => n.turn_number)), [nodes]);
  const [currentTurn, setCurrentTurn] = useState(maxTurn);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  // Compute stats at current turn
  const currentNodes = useMemo(
    () => nodes.filter(n => n.turn_number <= currentTurn),
    [nodes, currentTurn]
  );
  const currentEdges = useMemo(
    () => {
      const ids = new Set(currentNodes.map(n => n.id));
      return edges.filter(e => ids.has(e.source) && ids.has(e.target));
    },
    [currentNodes, edges]
  );
  const newAtTurn = useMemo(
    () => nodes.filter(n => n.turn_number === currentTurn),
    [nodes, currentTurn]
  );

  // Convergence score at this turn (from tracker history)
  const convergenceAtTurn = useMemo(() => {
    const tracker = activeDebate?.convergence_tracker;
    if (!tracker?.issues?.[0]?.history) return null;
    const hist = tracker.issues[0].history;
    const entry = hist.find(h => h.turn === currentTurn) ?? hist[hist.length - 1];
    return entry?.value ?? null;
  }, [activeDebate, currentTurn]);

  // Turn speaker label
  const turnSpeaker = useMemo(() => {
    const entry = activeDebate?.transcript.find(
      (e, i) => (e.type === 'statement' || e.type === 'opening') &&
        nodes.some(n => n.source_entry_id === e.id && n.turn_number === currentTurn)
    );
    if (!entry) return null;
    return POVER_INFO[entry.speaker as keyof typeof POVER_INFO]?.label ?? entry.speaker;
  }, [activeDebate, nodes, currentTurn]);

  // Playback
  const handlePlay = useCallback(() => {
    if (playing) { setPlaying(false); return; }
    setPlaying(true);
    setCurrentTurn(0);
    let turn = 0;
    const interval = setInterval(() => {
      turn++;
      if (turn > maxTurn) {
        clearInterval(interval);
        setPlaying(false);
        return;
      }
      setCurrentTurn(turn);
    }, 1200);
    // Cleanup if component unmounts
    return () => clearInterval(interval);
  }, [playing, maxTurn]);

  const selectedNode = selectedNodeId ? currentNodes.find(n => n.id === selectedNodeId) : null;

  if (maxTurn === 0) {
    return <div className="ts-empty">No argument network turns to display</div>;
  }

  return (
    <div className="ts-container">
      {/* Controls */}
      <div className="ts-controls">
        <button className="btn btn-sm btn-ghost" onClick={() => setCurrentTurn(0)} disabled={currentTurn === 0}>
          &#9664;&#9664;
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => setCurrentTurn(Math.max(0, currentTurn - 1))} disabled={currentTurn === 0}>
          &#9664;
        </button>
        <button className="btn btn-sm" onClick={handlePlay}>
          {playing ? '&#9646;&#9646;' : '&#9654;'}
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => setCurrentTurn(Math.min(maxTurn, currentTurn + 1))} disabled={currentTurn >= maxTurn}>
          &#9654;
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => setCurrentTurn(maxTurn)} disabled={currentTurn >= maxTurn}>
          &#9654;&#9654;
        </button>

        <input
          type="range"
          className="ts-slider"
          min={0}
          max={maxTurn}
          value={currentTurn}
          onChange={e => setCurrentTurn(Number(e.target.value))}
        />

        <span className="ts-turn-label">
          Turn {currentTurn}/{maxTurn}
          {turnSpeaker && <span className="ts-speaker"> — {turnSpeaker}</span>}
        </span>
      </div>

      {/* Stats bar */}
      <div className="ts-stats">
        <span className="ts-stat">{currentNodes.length} nodes</span>
        <span className="ts-stat">{currentEdges.length} edges</span>
        {newAtTurn.length > 0 && <span className="ts-stat ts-stat-new">+{newAtTurn.length} new</span>}
        {convergenceAtTurn != null && <span className="ts-stat">convergence: {(convergenceAtTurn * 100).toFixed(0)}%</span>}
      </div>

      {/* Graph */}
      <ArgumentGraph
        nodes={nodes}
        edges={edges}
        selectedNodeId={selectedNodeId}
        onSelectNode={setSelectedNodeId}
        turnFilter={currentTurn}
      />

      {/* Detail panel */}
      {selectedNode && (
        <GraphNodeDetailPanel
          node={selectedNode}
          edges={currentEdges}
          allNodes={currentNodes}
          onClose={() => setSelectedNodeId(null)}
        />
      )}
    </div>
  );
}
