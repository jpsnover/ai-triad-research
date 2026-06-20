// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Escape a string for safe embedding inside an inline <script> block — both as a
 * template-literal value and as a single-quoted string (t/714 M3).
 *
 * Critically, `<` is escaped to `<` so a `</script>` sequence in the data
 * can never terminate the script tag at the HTML-parser level (reflected XSS).
 * Backslash is escaped first so the escape sequences added afterward aren't
 * double-escaped. At runtime the JS engine decodes these back to the original
 * characters, so the parsed data is unchanged — only the HTML source is safe.
 */
export function escapeForInlineScript(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$')
    .replace(/'/g, "\\'")
    .replace(/</g, '\\u003c');
}
