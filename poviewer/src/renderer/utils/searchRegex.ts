// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Re-export shared buildSearchRegex — handles raw/wildcard/regex modes.
// poviewer's SearchMode is defined in types/types.ts (raw | wildcard | regex),
// all of which are core modes, so the shared function handles them directly.
export { buildSearchRegex } from '../../../../lib/electron-shared/utils/searchRegex';
