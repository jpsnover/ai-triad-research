// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * KIND registry — sole tool-vocabulary site for UsageHierarchy (spec §4, t/2561).
 * Adding a new tool = adding one row here + emitting view.dwell with subject_id.
 * No component changes required.
 */

export interface KindDef {
  /** Short tag shown on the row. */
  tag: string;
  /** Column header when this kind appears as a child row. Derived from actual child kind, not parent. */
  columnHeader: string;
  /** Count-metric unit in the summary card (e.g. "Nodes"). Empty = metric hidden. */
  countUnit: string;
  /** Show a monospaced ID chip next to the label. */
  showIdChip: boolean;
}

export const KIND_REGISTRY: Record<string, KindDef> = {
  root:         { tag: 'All usage',           columnHeader: 'Section',        countUnit: 'Items',          showIdChip: false },
  section:      { tag: 'App section',          columnHeader: '',               countUnit: '',               showIdChip: false },
  camp:         { tag: 'POV camp',             columnHeader: 'Camp',           countUnit: '',               showIdChip: false },
  category:     { tag: 'BDI category',         columnHeader: 'Category',       countUnit: '',               showIdChip: false },
  node:         { tag: 'Taxonomy node',        columnHeader: 'Node',           countUnit: 'Nodes',          showIdChip: true  },
  conversation: { tag: 'Chat conversation',    columnHeader: 'Conversation',   countUnit: 'Conversations',  showIdChip: false },
  chain:        { tag: 'Lineage chain',        columnHeader: 'Lineage chain',  countUnit: '',               showIdChip: false },
  source:       { tag: 'Lineage source',       columnHeader: 'Source',         countUnit: 'Sources',        showIdChip: true  },
  situation:    { tag: 'Situation',            columnHeader: 'Situation',      countUnit: '',               showIdChip: false },
  perspective:  { tag: 'Camp perspective',     columnHeader: 'Perspective',    countUnit: 'Perspectives',   showIdChip: false },
};

/** Returns the KindDef for kind, falling back to root so unknown kinds always render. */
export function getKind(kind: string): KindDef {
  return KIND_REGISTRY[kind] ?? KIND_REGISTRY['root'];
}

const SECTION_IDS = new Set(['taxonomy', 'chat', 'lineage', 'situations', 'debate-engine', 'summaries']);
const CAMP_IDS    = new Set(['acc', 'saf', 'skp', 'cc']);
const CAT_SUFFIXES = new Set(['bel', 'des', 'int']);

/**
 * Infer the KIND of a tree node from its ID, per the instrumentation spec (§2.1 of
 * usage-analytics-instrumentation.md). Used by UsageHierarchy to label rows without
 * requiring each node to carry an explicit type field.
 */
export function inferKind(id: string): string {
  if (id === 'root') return 'root';
  if (SECTION_IDS.has(id)) return 'section';
  if (CAMP_IDS.has(id)) return 'camp';
  if (id.startsWith('src-')) return 'source';
  if (id.startsWith('sit-')) return 'situation';
  if (id.startsWith('conv-') || id.startsWith('chat-')) return 'conversation';
  if (id.startsWith('chain-') || id.startsWith('lin-')) return 'chain';
  const parts = id.split('-');
  if (parts.length === 2 && CAMP_IDS.has(parts[0]) && CAT_SUFFIXES.has(parts[1])) return 'category';
  if (parts.length >= 3 && CAMP_IDS.has(parts[0])) return 'node';
  return 'root';
}

const SECTION_LABELS: Record<string, string> = {
  taxonomy:      'Taxonomy',
  chat:          'Chat',
  lineage:       'Intellectual Lineage',
  situations:    'Situations',
  'debate-engine': 'Debate Engine',
  summaries:     'Summaries',
};

const CAMP_LABELS: Record<string, string> = {
  acc: 'Accelerationist',
  saf: 'Safetyist',
  skp: 'Skeptic',
  cc:  'Cross-Cutting',
};

const CAT_LABELS: Record<string, string> = {
  bel: 'Beliefs',
  des: 'Desires',
  int: 'Intentions',
};

/** Human-readable display label for a node ID. */
export function labelForId(id: string): string {
  if (SECTION_LABELS[id]) return SECTION_LABELS[id];
  if (CAMP_LABELS[id]) return CAMP_LABELS[id];
  const parts = id.split('-');
  if (parts.length === 2 && CAT_LABELS[parts[1]]) return CAT_LABELS[parts[1]];
  return id;
}
