// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/4052: the model-suggested Value Hierarchy justification for one proposal (display spec t/4052#9; SO e/278#2
// condition 4). Firm, uncertain and unsupported are shown at the same visual weight: a confident-looking
// justification anchors reviewers, and review is meant to be independent of the proposer.

import type { ValueBasis, ValueBasisShared, ValueBasisNearest, ValueBasisRun } from '@lib/schema/povTagProposals';
import type { SoulProvenance } from '@lib/debate/soulDocSchema';
import { resolvePoverInfo } from '@lib/debate/tagSoulRegistry';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import {
  resolveCitation, isContradictory, isPossiblyMisplaced, SHARED_KEY, type Citation, type ProvenanceState,
} from '../../utils/povTagValueBasis';
import './PovTagValueBasis.css';

/** The provenance of the skeptic souls this app bundles, keyed like `value_basis_run.soul_provenance`. A soul that
 *  can't be resolved is left undefined, which compares as `unknown` ("cannot verify"), never as a match. */
export function bundledSkepticSoulProvenance(): Record<string, SoulProvenance | undefined> {
  const out: Record<string, SoulProvenance | undefined> = {};
  const get = (key: string, resolve: () => SoulProvenance | undefined) => {
    try {
      out[key] = resolve();
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'pov-tag-value-basis', level: 'warn', message: `Bundled soul provenance unavailable for ${key}; the queue shows "cannot verify"`, error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      out[key] = undefined;
    }
  };
  get('critical', () => resolvePoverInfo('skeptic', { tag: 'critical', mode: 'scope' }).soulProvenance);
  get('institutional', () => resolvePoverInfo('skeptic', { tag: 'institutional', mode: 'scope' }).soulProvenance);
  get(SHARED_KEY, () => resolvePoverInfo('skeptic').soulProvenance);
  return out;
}

/** The queue-level note about whether the souls behind the justifications still match this app's. */
export function ProvenanceNote({ state }: { state: ProvenanceState }) {
  if (state === 'same') return null;
  return (
    <div className="ptp-note ptvb-provenance" role="status">
      {state === 'changed'
        ? 'Soul doc changed since justification: a cited Value Hierarchy may now read differently. The text shown is the wording that was cited.'
        : 'Cannot verify the soul docs behind these justifications. The text shown is the wording that was cited.'}
    </div>
  );
}

function CitationChip({ c, uncertain }: { c: Citation; uncertain: boolean }) {
  if (!c.ok) return <span className="ptvb-cite ptvb-error" role="alert">VH {c.index}: not in the cited snapshot</span>;
  return (
    <span className="ptvb-cite" title={c.text}>
      <strong>VH {c.index}</strong> · {c.title}
      {uncertain && <span className="ptvb-marker"> (one of two runs)</span>}
    </span>
  );
}

/** One justification line: a tag's (or the shared ground's) citations, or the unsupported warning, then `why`. */
function BasisLine({ label, entry, run, snapshotKey }: {
  label: string;
  entry: Pick<ValueBasis, 'vh_index' | 'vh_index_uncertain' | 'unsupported' | 'why'>;
  run: ValueBasisRun | undefined;
  snapshotKey: string;
}) {
  const body = isContradictory(entry)
    ? <span className="ptvb-cite ptvb-error" role="alert">Inconsistent justification (marked unsupported but cites elements)</span>
    : entry.unsupported
      ? <span className="ptvb-cite ptvb-unsupported" role="alert">No Value Hierarchy element supports this tag</span>
      : <>
          {(entry.vh_index ?? []).map(i => <CitationChip key={`f${i}`} c={resolveCitation(run, snapshotKey, i)} uncertain={false} />)}
          {entry.vh_index_uncertain.map(i => <CitationChip key={`u${i}`} c={resolveCitation(run, snapshotKey, i)} uncertain />)}
        </>;
  return (
    <div className="ptvb-line">
      <div className="ptp-row"><span className="ptp-key">{label}</span>{body}</div>
      {entry.why && <p className="ptvb-why">{entry.why}</p>}
    </div>
  );
}

function NearestLine({ nearest, run, tagLabel }: { nearest: ValueBasisNearest; run: ValueBasisRun | undefined; tagLabel: (id: string) => string }) {
  const c = nearest.tag && nearest.vh_index !== null ? resolveCitation(run, nearest.tag, nearest.vh_index) : null;
  return (
    <div className="ptvb-line">
      <div className="ptp-row">
        <span className="ptp-key">Nearest</span>
        {nearest.tag ? <><span className="pov-tag-chip">{tagLabel(nearest.tag)}</span>{c && <CitationChip c={c} uncertain={false} />}</> : <span className="ptp-none">none</span>}
        {!nearest.agree && <span className="ptvb-marker">(runs disagree)</span>}
      </div>
      {nearest.why && <p className="ptvb-why">{nearest.why}</p>}
    </div>
  );
}

/** The justification block for one proposal. */
export function ValueBasisBlock({ p, run, tagLabel }: {
  p: { proposed: string[]; value_basis?: ValueBasis[]; value_basis_shared?: ValueBasisShared; value_basis_nearest?: ValueBasisNearest };
  run: ValueBasisRun | undefined;
  tagLabel: (id: string) => string;
}) {
  const hasBasis = (p.value_basis?.length ?? 0) > 0 || p.value_basis_shared || p.value_basis_nearest;
  return (
    <section className="ptvb" aria-label="Model-suggested justification">
      <div className="ptvb-head">Model-suggested justification</div>
      {!hasBasis ? <span className="ptp-none">No justification yet</span> : (
        <>
          {isPossiblyMisplaced(p) && <div className="ptvb-cite ptvb-unsupported" role="alert">Possibly misplaced in Skeptic</div>}
          {(p.value_basis ?? []).map(v => <BasisLine key={v.tag} label={tagLabel(v.tag)} entry={v} run={run} snapshotKey={v.tag} />)}
          {p.value_basis_shared && <BasisLine label="Shared ground" entry={p.value_basis_shared} run={run} snapshotKey={SHARED_KEY} />}
          {p.value_basis_nearest && <NearestLine nearest={p.value_basis_nearest} run={run} tagLabel={tagLabel} />}
        </>
      )}
    </section>
  );
}
