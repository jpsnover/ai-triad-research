// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/** Ask the model to distil a debate topic into a concise title. */
export function generateDebateTitlePrompt(topic: string): string {
  return (
    'Generate a concise title (under 60 characters) for a debate about the following topic. ' +
    'Return only the title — no quotes, no punctuation at the end, no explanation.\n\n' +
    `Topic: ${topic}`
  );
}
