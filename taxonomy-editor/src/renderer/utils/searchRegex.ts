// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Re-export shared buildSearchRegex — handles raw/wildcard/regex modes.
// 'semantic' mode returns null from the shared function, letting the caller
// handle it with app-specific semantic search logic.
export { buildSearchRegex } from '../../../../lib/electron-shared/utils/searchRegex';
