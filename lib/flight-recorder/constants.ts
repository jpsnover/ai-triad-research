// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/** Ring buffer capacity for primary recorders (renderer process, debate CLI). */
export const RECORDER_CAPACITY_DEFAULT = 5000;

/** Ring buffer capacity for secondary recorders (ElectronMain process). */
export const RECORDER_CAPACITY_SECONDARY = 2000;
