// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Standardized actionable error for humans and AI agents.
 * Every error must state: goal, problem, location, and next steps.
 */
export class ActionableError extends Error {
  public readonly goal: string;
  public readonly problem: string;
  public readonly location: string;
  public readonly nextSteps: string[];
  public readonly innerError?: Error;

  constructor(opts: {
    goal: string;
    problem: string;
    location: string;
    nextSteps: string[];
    innerError?: unknown;
  }) {
    const inner = opts.innerError instanceof Error ? opts.innerError : undefined;
    const innerMsg = inner ? `\n  Inner error: ${inner.message}` : '';
    const steps = opts.nextSteps.map((s, i) => `  ${i + 1}. ${s}`).join('\n');

    const message = [
      '',
      `  Goal:     ${opts.goal}`,
      `  Error:    ${opts.problem}${innerMsg}`,
      `  Location: ${opts.location}`,
      `  Resolve:`,
      steps,
    ].join('\n');

    super(message);
    this.name = 'ActionableError';
    this.goal = opts.goal;
    this.problem = opts.problem;
    this.location = opts.location;
    this.nextSteps = opts.nextSteps;
    this.innerError = inner;

    // Maintain prototype chain for instanceof checks
    Object.setPrototypeOf(this, ActionableError.prototype);
  }
}

/**
 * Extract a message from an unknown caught value.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return String(err);
}

/**
 * Execute an async action with retry and optional fallback.
 * On final failure, throws an ActionableError with full diagnostics.
 */
export async function withRecovery<T>(opts: {
  goal: string;
  location: string;
  action: () => Promise<T>;
  fallback?: () => Promise<T>;
  maxRetries?: number;
  retryDelayMs?: number;
  isRetryable?: (err: unknown) => boolean;
  nextSteps: string[];
}): Promise<T> {
  const {
    goal,
    location,
    action,
    fallback,
    maxRetries = 0,
    retryDelayMs = 2000,
    isRetryable = () => true,
    nextSteps,
  } = opts;

  let lastError: unknown;
  const totalAttempts = maxRetries + 1;

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    try {
      return await action();
    } catch (err) {
      lastError = err;
      if (attempt < totalAttempts && isRetryable(err)) {
        process.stderr.write(
          `[retry] ${goal} — attempt ${attempt}/${totalAttempts} failed (${errorMessage(err).slice(0, 100)}), waiting ${retryDelayMs}ms...\n`
        );
        await new Promise((r) => setTimeout(r, retryDelayMs));
      }
    }
  }

  // Primary exhausted — try fallback
  if (fallback) {
    try {
      process.stderr.write(`[fallback] ${goal} — primary failed, trying fallback...\n`);
      return await fallback();
    } catch (err) {
      lastError = err;
    }
  }

  // Everything failed — throw actionable error
  throw new ActionableError({
    goal,
    problem: errorMessage(lastError),
    location,
    nextSteps,
    innerError: lastError,
  });
}
