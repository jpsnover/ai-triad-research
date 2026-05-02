// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Re-export shared buildSearchRegex — handles raw/wildcard/regex modes.
// 'similar' mode returns null from the shared function, letting the caller
// handle it with app-specific similarity logic.
export { buildSearchRegex } from '../../../../lib/electron-shared/utils/searchRegex';
export type SearchMode = 'raw' | 'wildcard' | 'regex' | 'similar';
