// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect } from 'react';
import { useInquiryStore } from '../../hooks/useInquiryStore';
import { InquiryAskPanel } from './InquiryAskPanel';
import { InquiryRunningPanel } from './InquiryRunningPanel';
import { InquiryAnswerPanel } from './InquiryAnswerPanel';
import './InquiryTab.css';

export function InquiryTab() {
  const screen = useInquiryStore((s) => s.screen());
  const stopPolling = useInquiryStore((s) => s._stopPolling);

  // Poll-loop bounds (TL t/3583#4 point 3): unmount cleanup so navigating away from this tab
  // doesn't leave a dangling setTimeout chain polling forever.
  useEffect(() => stopPolling, [stopPolling]);

  return (
    <div className="inquiry-tab">
      {screen === 'ask' && <InquiryAskPanel />}
      {screen === 'running' && <InquiryRunningPanel />}
      {screen === 'answer' && <InquiryAnswerPanel />}
    </div>
  );
}
