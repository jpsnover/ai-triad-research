// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Pure validation for the create-oped-set payload, extracted from opedHandlers so it
// can be unit-tested without the electron coupling of the IPC handler (t/2910).
// Root cause it guards against: a create needs a *source* — a topic OR a web-page URL
// (FromUrl mode sends an empty topic) — plus at least one voice. The inline guard once
// checked topic only, which rejected every FromUrl create (t/2908 regression).

import { ActionableError } from '../../../../lib/debate/errors.js';

export interface CreateOpEdValidationInput {
  topic?: string;
  url?: string;
  voices?: readonly unknown[];
}

/**
 * Validate a create-oped-set payload. Returns an {@link ActionableError} to throw when
 * invalid, or `null` when the payload is acceptable. Valid iff a non-blank source
 * (topic or url) is present AND at least one voice is selected.
 */
export function validateCreateOpEdPayload(input: CreateOpEdValidationInput): ActionableError | null {
  const { topic, url, voices } = input;
  if ((!topic?.trim() && !url?.trim()) || !voices?.length) {
    return new ActionableError({
      goal: 'Create op-ed set',
      problem: 'a topic or a web-page URL, and at least one voice, are required',
      location: 'opedHandlers create-oped-set',
      nextSteps: ['Provide a topic or a web-page URL', 'Select at least one voice'],
    });
  }
  return null;
}
