// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { LucideIcon } from 'lucide-react';
import {
  Search, LayoutGrid, MessageSquare, MessageCircle,
  Crosshair, TriangleAlert, CirclePlus, BookText,
  CircleCheck, GitFork, Link, Layers, BarChart3, ShieldAlert,
  BookOpen, LineChart, Terminal, FileText, CircleHelp, Star,
  RefreshCw, Settings, Building2, Boxes,
} from 'lucide-react';

export type NavAction =
  | { type: 'switchTab'; target: string }
  | { type: 'togglePanel'; target: string }
  | { type: 'custom'; id: string };

export type NavTier = 'primary' | 'secondary' | 'system';
export type NavGroup = 'browse' | 'analysis' | 'tools';

export interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  tier: NavTier;
  group?: NavGroup;
  action: NavAction;
  gate?: { flag?: string; adminOnly?: boolean };
}

export const NAV_ITEMS: readonly NavItem[] = [
  // ── Primary tier ──
  { id: 'search', label: 'Search', icon: Search, tier: 'primary', action: { type: 'togglePanel', target: 'search' } },
  { id: 'taxonomy', label: 'Taxonomy', icon: LayoutGrid, tier: 'primary', action: { type: 'custom', id: 'taxonomy' } },
  { id: 'debate', label: 'Debate', icon: MessageSquare, tier: 'primary', action: { type: 'switchTab', target: 'debate' } },
  { id: 'chat', label: 'Chat', icon: MessageCircle, tier: 'primary', action: { type: 'custom', id: 'chat' } },

  // ── Secondary tier — browse group ──
  { id: 'situations', label: 'Situations', icon: Crosshair, tier: 'secondary', group: 'browse', action: { type: 'switchTab', target: 'situations' } },
  { id: 'conflicts', label: 'Conflicts', icon: TriangleAlert, tier: 'secondary', group: 'browse', action: { type: 'switchTab', target: 'conflicts' } },
  { id: 'cruxes', label: 'Cruxes', icon: CirclePlus, tier: 'secondary', group: 'browse', action: { type: 'switchTab', target: 'cruxes' } },
  { id: 'summaries', label: 'Summaries', icon: BookText, tier: 'secondary', group: 'browse', action: { type: 'switchTab', target: 'summaries' }, gate: { flag: 'env-electron-summaries' } },
  { id: 'validation', label: 'Validation', icon: CircleCheck, tier: 'secondary', group: 'browse', action: { type: 'switchTab', target: 'validation' } },
  { id: 'entities', label: 'Entities', icon: Boxes, tier: 'secondary', group: 'browse', action: { type: 'togglePanel', target: 'entities' } },

  // ── Secondary tier — analysis group ──
  { id: 'lineage', label: 'Intellectual Lineage', icon: GitFork, tier: 'secondary', group: 'analysis', action: { type: 'togglePanel', target: 'lineage' } },
  { id: 'edges', label: 'Edge Browser', icon: Link, tier: 'secondary', group: 'analysis', action: { type: 'togglePanel', target: 'edges' } },
  { id: 'policyAlignment', label: 'Policy Alignment', icon: Layers, tier: 'secondary', group: 'analysis', action: { type: 'togglePanel', target: 'policyAlignment' } },
  { id: 'policyDashboard', label: 'Policy Dashboard', icon: BarChart3, tier: 'secondary', group: 'analysis', action: { type: 'togglePanel', target: 'policyDashboard' } },
  { id: 'fallacy', label: 'Possible Fallacies', icon: ShieldAlert, tier: 'secondary', group: 'analysis', action: { type: 'togglePanel', target: 'fallacy' } },
  { id: 'vocabulary', label: 'Vocabulary', icon: BookOpen, tier: 'secondary', group: 'analysis', action: { type: 'togglePanel', target: 'vocabulary' } },
  { id: 'calibration', label: 'Calibration', icon: LineChart, tier: 'secondary', group: 'analysis', action: { type: 'togglePanel', target: 'calibration' } },

  // ── Secondary tier — tools group ──
  { id: 'organizations', label: 'Organizations', icon: Building2, tier: 'secondary', group: 'tools', action: { type: 'switchTab', target: 'organizations' } },
  { id: 'console', label: 'Console', icon: Terminal, tier: 'secondary', group: 'tools', action: { type: 'togglePanel', target: 'console' }, gate: { adminOnly: true } },
  { id: 'prompts', label: 'Prompts', icon: FileText, tier: 'secondary', group: 'tools', action: { type: 'togglePanel', target: 'prompts' } },

  // ── System tier ──
  { id: 'feedback', label: 'Feedback', icon: Star, tier: 'system', action: { type: 'custom', id: 'feedback' } },
  { id: 'help', label: 'Help', icon: CircleHelp, tier: 'system', action: { type: 'custom', id: 'help' } },
  { id: 'reload', label: 'Reload', icon: RefreshCw, tier: 'system', action: { type: 'custom', id: 'reload' } },
  { id: 'settings', label: 'Settings', icon: Settings, tier: 'system', action: { type: 'custom', id: 'settings' } },
];

export interface NavVisibilityContext {
  flags: Record<string, boolean>;
  isAdmin: boolean;
}

export function getVisibleNavItems(
  items: readonly NavItem[],
  ctx: NavVisibilityContext,
): NavItem[] {
  return items.filter(item => {
    if (!item.gate) return true;
    if (item.gate.adminOnly && !ctx.isAdmin) return false;
    if (item.gate.flag && !ctx.flags[item.gate.flag]) return false;
    return true;
  });
}

export function getItemsByTier(items: readonly NavItem[], tier: NavTier): NavItem[] {
  return items.filter(i => i.tier === tier);
}

export function getSecondaryByGroup(items: readonly NavItem[]): { group: NavGroup; items: NavItem[] }[] {
  const secondary = items.filter(i => i.tier === 'secondary');
  const groups: NavGroup[] = ['browse', 'analysis', 'tools'];
  return groups
    .map(g => ({ group: g, items: secondary.filter(i => i.group === g) }))
    .filter(g => g.items.length > 0);
}
