// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// GATE-PROOF INJECTION (t/2252) — remove after CI confirms red. Do NOT merge.
import { bandColorScale } from '../../lib/bandColor'
export const _gateProof = bandColorScale

export const TOAST_DURATION_SUCCESS = 5000;
// Errors persist longer than info/feedback so users have time to read them (accessibility).
export const TOAST_DURATION_ERROR = 5000;
export const TOAST_DURATION_INFO = 3000;
export const TOAST_DURATION_FEEDBACK = 3000;
