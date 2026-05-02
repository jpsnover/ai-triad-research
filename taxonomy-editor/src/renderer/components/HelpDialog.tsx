// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { api } from '@bridge';

declare const __APP_VERSION__: string;
declare const __BUILD_DATE__: string;

const DOCS = [
  { title: 'Architecture Overview', path: 'docs/architecture-overview.md',
    desc: 'Two-repo split, Electron apps, AI backends, and data model' },
  { title: 'Debate Engine Design', path: 'docs/debate-engine-design.md',
    desc: 'Three-agent BDI debate system, QBAF scoring, and moderator' },
  { title: 'Theory of Success', path: 'docs/theory-of-success.md',
    desc: 'What success looks like for debate, step-by-step execution, weaknesses' },
] as const;

const REPO_URL = 'https://github.com/jpsnover/ai-triad-research';

function getRuntime(): string {
  const target = import.meta.env.VITE_TARGET;
  if (target === 'web') return 'Container';
  if (typeof window !== 'undefined' && (window as any).electronAPI) return 'Electron';
  return 'Browser';
}

interface HelpDialogProps {
  onClose: () => void;
}

export function HelpDialog({ onClose }: HelpDialogProps) {
  const buildDate = new Date(__BUILD_DATE__);
  const formattedDate = buildDate.toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
  }) + ' ' + buildDate.toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit',
  });

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog help-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Taxonomy Editor Help</h3>

        <div className="help-section">
          <h4>Overview</h4>
          <p>
            This editor manages the AI Triad taxonomy across three perspectives
            (Accelerationist, Safetyist, Skeptic), situations shared
            across perspectives, and documented conflicts between positions.
          </p>
        </div>

        <div className="help-section">
          <h4>Keyboard Shortcuts</h4>
          <table className="help-shortcuts">
            <tbody>
              <tr><td className="help-key">Ctrl + F</td><td>Open / close search</td></tr>
              <tr><td className="help-key">Ctrl + S</td><td>Save changes</td></tr>
              <tr><td className="help-key">Ctrl + =</td><td>Zoom in</td></tr>
              <tr><td className="help-key">Ctrl + -</td><td>Zoom out</td></tr>
              <tr><td className="help-key">Ctrl + 0</td><td>Reset zoom</td></tr>
              <tr><td className="help-key">Arrow Up/Down</td><td>Navigate items in list</td></tr>
              <tr><td className="help-key">Enter</td><td>Next search result</td></tr>
              <tr><td className="help-key">Shift + Enter</td><td>Previous search result</td></tr>
              <tr><td className="help-key">Escape</td><td>Close search / dialogs</td></tr>
            </tbody>
          </table>
        </div>

        <div className="help-section">
          <h4>Tabs</h4>
          <p>
            <strong>Accelerationist / Safetyist / Skeptic</strong> - Each perspective
            has nodes organized into three BDI categories: Desires, Intentions, and Beliefs.
          </p>
          <p>
            <strong>Situations</strong> - Concepts that span all three perspectives.
            Each node includes how each perspective interprets the concept.
          </p>
          <p>
            <strong>Conflicts</strong> - Documented disagreements between perspectives,
            with source instances and analyst notes.
          </p>
        </div>

        <div className="help-section">
          <h4>Features</h4>
          <p><strong>Pin</strong> - Pin any item to compare it side-by-side with the active item.</p>
          <p><strong>Search</strong> - Full-text search with raw, wildcard, and regex modes. Scope by POV and/or category.</p>
          <p><strong>Resize</strong> - Drag the border between the list and detail panels to resize.</p>
        </div>

        <div className="help-section">
          <h4>Methods and Algorithms</h4>
          <p>
            The system uses a <strong>neural-symbolic architecture</strong>: LLMs generate
            content while symbolic components provide structure, verification, and explanation.
          </p>
          <ul style={{ fontSize: '0.85em', lineHeight: 1.6 }}>
            <li><strong>QBAF</strong> — Quantitative Bipolar Argumentation Frameworks with DF-QuAD gradual semantics and BDI-aware base score calibration.
              {' '}<a href="#" onClick={(e) => { e.preventDefault(); api.openExternal('https://aaai.org/papers/8-12874-discontinuity-free-decision-support-with-quantitative-argumentation-debates/'); }} style={{ color: 'var(--accent)', fontSize: '0.85em' }}>Rago et al. (2016)</a>
              {' '}Built on: <a href="#" onClick={(e) => { e.preventDefault(); api.openExternal('https://www.sciencedirect.com/science/article/pii/000437029400041X'); }} style={{ color: 'var(--accent)', fontSize: '0.85em' }}>Dung (1995)</a>
            </li>
            <li><strong>BDI Framework</strong> — Belief-Desire-Intention agent characterization separating empirical claims, normative commitments, and strategic reasoning.
              {' '}<a href="#" onClick={(e) => { e.preventDefault(); api.openExternal('https://cdn.aaai.org/ICMAS/1995/ICMAS95-042.pdf'); }} style={{ color: 'var(--accent)', fontSize: '0.85em' }}>Rao & Georgeff (1995)</a>;
              {' '}<a href="#" onClick={(e) => { e.preventDefault(); api.openExternal('https://press.uchicago.edu/ucp/books/book/distributed/I/bo3629095.html'); }} style={{ color: 'var(--accent)', fontSize: '0.85em' }}>Bratman (1987)</a>
            </li>
            <li><strong>AIF</strong> — Argument Interchange Format vocabulary for typed attack/support relationships and scheme classification.
              {' '}<a href="#" onClick={(e) => { e.preventDefault(); api.openExternal('https://dl.acm.org/doi/10.1017/S0269888906001044'); }} style={{ color: 'var(--accent)', fontSize: '0.85em' }}>Chesñevar et al. (2006)</a>
            </li>
            <li><strong>FIRE</strong> — Confidence-gated Iterative Extraction replacing single-shot claim extraction with per-claim verification.
              {' '}<a href="#" onClick={(e) => { e.preventDefault(); api.openExternal('https://arxiv.org/abs/2411.00784'); }} style={{ color: 'var(--accent)', fontSize: '0.85em' }}>arXiv:2411.00784</a>
            </li>
            <li><strong>4-Stage Pipeline</strong> — Each debate turn: BRIEF → PLAN → DRAFT → CITE with per-stage temperatures</li>
            <li><strong>Adaptive Staging</strong> — Seven convergence diagnostics trigger phase transitions (thesis-antithesis → exploration → synthesis)</li>
            <li><strong>13-Scheme Taxonomy</strong> — Derived from Walton's argumentation schemes with scheme-specific critical questions.
              {' '}<a href="#" onClick={(e) => { e.preventDefault(); api.openExternal('https://www.cambridge.org/core/books/argumentation-schemes/9AE7E4E6ABDE690565442B2BD516A8B6'); }} style={{ color: 'var(--accent)', fontSize: '0.85em' }}>Walton, Reed & Macagno (2008)</a>
            </li>
            <li><strong>14-Move Moderator</strong> — Six intervention families governed by pragma-dialectical theory; LLM recommends, engine validates against deterministic constraints.
              {' '}<a href="#" onClick={(e) => { e.preventDefault(); api.openExternal('https://www.cambridge.org/us/catalogue/catalogue.asp?isbn=9780521537728'); }} style={{ color: 'var(--accent)', fontSize: '0.85em' }}>van Eemeren & Grootendorst (2004)</a>
            </li>
            <li><strong>Dialectic Traces</strong> — BFS traversal of the argument network producing human-readable narrative chains</li>
          </ul>
          <p>
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); api.openExternal(`${REPO_URL}/blob/main/docs/academic-paper-draft.md`); }}
              style={{ color: 'var(--accent)', textDecoration: 'underline', cursor: 'pointer' }}
            >
              <strong>Full Methodology Paper</strong>
            </a>
            {' — '}Complete technical paper with algorithms, evaluation, and theoretical grounding
          </p>
        </div>

        <div className="help-section">
          <h4>Documentation</h4>
          {DOCS.map((doc) => (
            <p key={doc.path}>
              <a
                href="#"
                onClick={(e) => { e.preventDefault(); api.openExternal(`${REPO_URL}/blob/main/${doc.path}`); }}
                style={{ color: 'var(--accent)', textDecoration: 'underline', cursor: 'pointer' }}
              >
                <strong>{doc.title}</strong>
              </a>
              {' — '}{doc.desc}
            </p>
          ))}
        </div>

        <div className="help-section help-about">
          <h4>About</h4>
          <table className="help-shortcuts">
            <tbody>
              <tr><td className="help-key">Version</td><td>{__APP_VERSION__}</td></tr>
              <tr><td className="help-key">Built</td><td>{formattedDate}</td></tr>
              <tr><td className="help-key">Runtime</td><td>{getRuntime()}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="dialog-actions">
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
