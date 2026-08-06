// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Pure module — no React, no side effects at import time.
// Drives preset card state, change-count badge (Screen A), and rail dots (Screen B).

export type BuiltInPresetId = 'quick' | 'deep' | 'socratic';
export type DialecticalStyle = 'adversarial' | 'deliberative' | 'integrative';

export interface PresetSettings {
  protocolId: string;
  dialecticalStyle: DialecticalStyle;
  confrontationRounds: number;
  argumentationRounds: number;
  concludingRounds: number;
  stepMode: boolean;
  modelTier: 'basic' | 'advanced';
}

export interface BuiltInPreset {
  id: BuiltInPresetId;
  label: string;
  summary: string;
  estimatedMinutes: number;
  isBuiltIn: true;
  settings: PresetSettings;
}

export interface UserPreset {
  id: string;
  label: string;
  summary: string;
  isBuiltIn: false;
  parentPresetId: BuiltInPresetId;
  settings: PresetSettings;
}

export type Preset = BuiltInPreset | UserPreset;

// PM-confirmed values (t/2198#4):
//   Quick take  — Structured / Adversarial  / 2-2-1 / basic
//   Deep dive   — Structured / Deliberative / 3-4-2 / advanced
//   Socratic    — Socratic   / Integrative  / 2-4-2 / step-by-step / basic
export const BUILT_IN_PRESETS: readonly BuiltInPreset[] = [
  {
    id: 'quick',
    label: 'Quick take',
    summary: '2+2 rounds · basic model',
    estimatedMinutes: 8,
    isBuiltIn: true,
    settings: {
      protocolId: 'structured',
      dialecticalStyle: 'adversarial',
      confrontationRounds: 2,
      argumentationRounds: 2,
      concludingRounds: 1,
      stepMode: false,
      modelTier: 'basic',
    },
  },
  {
    id: 'deep',
    label: 'Deep dive',
    summary: '3+4 rounds · frontier model',
    estimatedMinutes: 20,
    isBuiltIn: true,
    settings: {
      protocolId: 'structured',
      dialecticalStyle: 'deliberative',
      confrontationRounds: 3,
      argumentationRounds: 4,
      concludingRounds: 2,
      stepMode: false,
      modelTier: 'advanced',
    },
  },
  {
    id: 'socratic',
    label: 'Socratic',
    summary: 'Step-by-step · 2+4 rounds · basic model',
    estimatedMinutes: 20,
    isBuiltIn: true,
    settings: {
      protocolId: 'socratic',
      dialecticalStyle: 'integrative',
      confrontationRounds: 2,
      argumentationRounds: 4,
      concludingRounds: 2,
      stepMode: true,
      modelTier: 'basic',
    },
  },
] as const;

export const DEFAULT_PRESET_ID: BuiltInPresetId = 'quick';

// Fields the diff utility tracks — drives change-count badge + Screen B rail dots.
const TRACKED_FIELDS = [
  'protocolId',
  'dialecticalStyle',
  'confrontationRounds',
  'argumentationRounds',
  'concludingRounds',
  'stepMode',
  'modelTier',
] as const satisfies ReadonlyArray<keyof PresetSettings>;

export function settingsDiffFromPreset(
  current: PresetSettings,
  presetId: BuiltInPresetId,
): number {
  const preset = BUILT_IN_PRESETS.find(p => p.id === presetId);
  if (!preset) return 0;
  let diff = 0;
  for (const field of TRACKED_FIELDS) {
    if (current[field] !== preset.settings[field]) diff++;
  }
  return diff;
}

export function isCustom(
  current: PresetSettings,
  activePreset: BuiltInPresetId,
): boolean {
  return settingsDiffFromPreset(current, activePreset) > 0;
}

// ── User preset persistence ───────────────────────────────────────────────────

const USER_PRESETS_KEY = 'taxonomy-editor-user-presets';

export function loadUserPresets(): UserPreset[] {
  try {
    const raw = localStorage.getItem(USER_PRESETS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isUserPresetShape);
  } catch { /* telemetry — silent by design */ return []; }
}

export function saveUserPresets(presets: UserPreset[]): void {
  try {
    localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(presets));
  } catch { /* telemetry — silent by design */ }
}

export function addUserPreset(preset: UserPreset): void {
  const existing = loadUserPresets();
  saveUserPresets([...existing.filter(p => p.id !== preset.id), preset]);
}

export function removeUserPreset(id: string): void {
  saveUserPresets(loadUserPresets().filter(p => p.id !== id));
}

function isUserPresetShape(v: unknown): v is UserPreset {
  if (typeof v !== 'object' || v === null) return false;
  const u = v as Record<string, unknown>;
  return (
    typeof u['id'] === 'string' &&
    typeof u['label'] === 'string' &&
    u['isBuiltIn'] === false &&
    typeof u['parentPresetId'] === 'string' &&
    typeof u['settings'] === 'object' &&
    u['settings'] !== null
  );
}
