// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useInquiryStore } from '../../hooks/useInquiryStore';
import { CAMP_LABELS, trustVerdictLabel, isZeroResult } from './inquiryDisplay';
import './InquiryTab.css';

export function InquiryAnswerPanel() {
  const { status, result, error, terminationReason, reset } = useInquiryStore();

  if (status === 'failed') {
    return (
      <div className="inquiry-answer">
        <span className="inquiry-eyebrow">Answer</span>
        <div className="inquiry-banner inquiry-banner-failed">
          <span className="inquiry-bi">FAILED</span>
          <p>{error ?? 'The inquiry failed before producing a result.'}</p>
        </div>
        <div className="inquiry-rawrow">
          <button className="inquiry-ghost" onClick={reset}>Ask another question</button>
        </div>
      </div>
    );
  }

  if (!result) return null; // shouldn't happen once terminal per useInquiryStore.screen()

  // ADR-001 graceful-empty: "found nothing" and "never looked" arrive identically — this needs
  // its own designed treatment, not a blank/near-blank answer page (TL t/3583#4 point 2).
  if (isZeroResult(result)) {
    return (
      <div className="inquiry-answer">
        <span className="inquiry-eyebrow">Answer</span>
        <h2 className="inquiry-ansq">{result.request.question}</h2>
        <div className="inquiry-banner inquiry-banner-zero">
          <span className="inquiry-bi">NO RESULT</span>
          <p>This run completed without producing camp verdicts, convergences, or evidence — not a
            zero score, an empty answer. Try again, or check the raw run for what happened.</p>
        </div>
        <div className="inquiry-rawrow">
          <button className="inquiry-ghost" onClick={reset}>Ask another question</button>
        </div>
      </div>
    );
  }

  const isTruncated = status === 'done_truncated';

  return (
    <div className="inquiry-answer">
      <span className="inquiry-eyebrow">Answer</span>
      <h2 className="inquiry-ansq">{result.request.question}</h2>
      <div className="inquiry-prov mono">
        <span>debaters <b>{result.derivation.models.debaters}</b></span>
        <span>evaluator <b>{result.derivation.models.evaluator}</b></span>
        <span><b>{result.derivation.rounds}</b> rounds</span>
        {result.derivation.callsUsed !== undefined && <span><b>{result.derivation.callsUsed}</b> of <b>{result.derivation.callBudget}</b> calls</span>}
      </div>

      {/* Gated on the terminal STATUS, not terminationReason — terminationReason is set on every
       *  completed debate ('unknown' is a valid member, TL t/3599), so gating on its presence would
       *  fire on every run (TL t/3583#4 point 1). */}
      {isTruncated && (
        <div className="inquiry-banner inquiry-banner-truncated">
          <span className="inquiry-bi">TRUNCATED</span>
          <p>This run hit its <b>{result.derivation.callBudget}-call budget</b>{terminationReason ? ` (${terminationReason})` : ''} and
            was cut off, rather than stopping at a decision point. The substance below still stands, but
            metrics marked <b>incomplete</b> measure how far the debate got — a budget wall leaves them
            unreadable, not merely low.</p>
        </div>
      )}

      {result.campVerdicts.length > 0 && (
        <div className="inquiry-sect">
          <span className="inquiry-eyebrow">How each camp draws the line</span>
          <div className="inquiry-camps">
            {result.campVerdicts.map((cv) => (
              <div className={`inquiry-camp inquiry-camp-${cv.camp}`} key={cv.camp}>
                <div className="inquiry-who">{CAMP_LABELS[cv.camp]}</div>
                <p>{cv.verdict}</p>
                {cv.nodes.length > 0 && (
                  <div className="inquiry-nodes mono">{cv.nodes.map((n) => n.label).join(' · ')}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {result.convergences.map((conv, i) => (
        <div className="inquiry-conv" key={i}>
          <span className="inquiry-eyebrow">Where they converged</span>
          <p>{conv.claim}</p>
          {conv.nodes.length > 0 && <div className="inquiry-nodes mono">{conv.nodes.map((n) => n.label).join(' · ')}</div>}
        </div>
      ))}

      {result.evidenceLayers.length > 0 && (
        <div className="inquiry-sect">
          <span className="inquiry-eyebrow">The layered answer the debate produced</span>
          <div className="inquiry-layers">
            {result.evidenceLayers.map((layer, i) => (
              <div className="inquiry-layer" key={i}>
                <span className="inquiry-ln">L{i + 1}</span>
                <div>
                  <h5>{layer.title}</h5>
                  <p>{layer.role} — {layer.solves}</p>
                  {layer.sources.length > 0 && <div className="inquiry-src mono">{layer.sources.join(' · ')}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.unresolvedGaps.length > 0 && (
        <div className="inquiry-sect">
          <span className="inquiry-eyebrow">Unresolved</span>
          <ul className="inquiry-gaps">
            {result.unresolvedGaps.map((g, i) => <li key={i}>{g.description} <span className="inquiry-faint">({g.confidence})</span></li>)}
          </ul>
        </div>
      )}

      {result.calibration.length > 0 && (
        <div className="inquiry-sect">
          <span className="inquiry-eyebrow">Calibration — every badge generated from the run</span>
          <div className="inquiry-metrics">
            {result.calibration.map((entry, i) => (
              <div className="inquiry-metric" data-t={entry.trust.verdict === 'censored' ? 'bad' : 'ok'} key={i}>
                <div className="inquiry-mt">
                  <span className="inquiry-mn mono">{entry.metric}</span>
                  <span className={`inquiry-pill ${entry.trust.verdict === 'censored' ? 'bad' : 'ok'}`}>{trustVerdictLabel(entry.trust.verdict)}</span>
                </div>
                <div className="inquiry-mv mono">{entry.displayValue ?? entry.value}</div>
                {/* Renders TrustState.reason verbatim, never re-derives whether a metric is
                 *  trustworthy (TL t/3583#1/#2). */}
                <div className="inquiry-mr">{entry.trust.reason}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="inquiry-caveat"><b>One run, not a finding.</b> {result.singleRunCaveat}</div>

      <div className="inquiry-rawrow">
        <button className="inquiry-ghost" onClick={reset}>Ask another question</button>
      </div>
    </div>
  );
}
