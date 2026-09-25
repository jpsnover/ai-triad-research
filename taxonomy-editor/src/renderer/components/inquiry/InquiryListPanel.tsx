// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// My / Community split for the "list" screen of Ask a Question (t/3678). The tab switcher
// itself lives in InquiryTab.tsx (persistent Ask/My/Community strip); this component is a pure
// content switch so the tab UI isn't duplicated in two places.

import { InquiryHistoryTable } from './InquiryHistoryTable';
import { InquiryCommunityList } from './InquiryCommunityList';

export function InquiryListPanel({ listView }: { listView: 'my' | 'community' }) {
  return listView === 'my' ? <InquiryHistoryTable /> : <InquiryCommunityList />;
}
