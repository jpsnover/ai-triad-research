// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useState } from 'react';
import { useInquiryStore } from '../../hooks/useInquiryStore';
import { InquiryAskPanel } from './InquiryAskPanel';
import { InquiryRunningPanel } from './InquiryRunningPanel';
import { InquiryAnswerPanel } from './InquiryAnswerPanel';
import { InquiryListPanel } from './InquiryListPanel';
import './InquiryTab.css';

export function InquiryTab() {
  const screen = useInquiryStore((s) => s.screen());
  const stopPolling = useInquiryStore((s) => s._stopPolling);
  const reset = useInquiryStore((s) => s.reset);
  const openList = useInquiryStore((s) => s.openList);
  // t/3678: "My" must be reachable without first visiting the Ask screen, so this strip is
  // persistent across all four screens rather than a button embedded in InquiryAskPanel.
  const [listView, setListView] = useState<'my' | 'community'>('my');

  // Poll-loop bounds (TL t/3583#4 point 3): unmount cleanup so navigating away from this tab
  // doesn't leave a dangling setTimeout chain polling forever.
  useEffect(() => stopPolling, [stopPolling]);

  const goMy = () => { setListView('my'); openList(); };
  const goCommunity = () => { setListView('community'); openList(); };
  // Guard: reset() abandons an in-flight poll with no confirmation, and there is no existing
  // "cancel this run" affordance elsewhere in the UI — disable rather than let a stray click on
  // the persistent strip silently drop a Deep-fidelity run that may have taken tens of minutes.
  const askDisabled = screen === 'running';

  return (
    <div className="inquiry-tab">
      <div className="inquiry-top-tabs">
        <button className={`inquiry-top-tab${screen !== 'list' ? ' active' : ''}`} onClick={reset} disabled={askDisabled}>Ask</button>
        <button className={`inquiry-top-tab${screen === 'list' && listView === 'my' ? ' active' : ''}`} onClick={goMy}>My</button>
        <button className={`inquiry-top-tab${screen === 'list' && listView === 'community' ? ' active' : ''}`} onClick={goCommunity}>Community</button>
      </div>
      {screen === 'ask' && <InquiryAskPanel />}
      {screen === 'running' && <InquiryRunningPanel />}
      {screen === 'answer' && <InquiryAnswerPanel />}
      {screen === 'list' && <InquiryListPanel listView={listView} />}
    </div>
  );
}
