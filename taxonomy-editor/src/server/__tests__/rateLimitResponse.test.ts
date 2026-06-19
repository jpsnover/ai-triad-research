import { describe, it, expect } from 'vitest';
import { rateLimitResponseBody } from '../rateLimitResponse';

const NOW = 1_000_000_000_000;

describe('rateLimitResponseBody (t/685)', () => {
  it('always uses the rate_limited error code', () => {
    expect(rateLimitResponseBody(NOW + 60_000, NOW).error).toBe('rate_limited');
  });

  it('computes retryAfter as ceil(seconds until reset)', () => {
    expect(rateLimitResponseBody(NOW + 90_000, NOW).retryAfter).toBe(90);
    expect(rateLimitResponseBody(NOW + 1_500, NOW).retryAfter).toBe(2); // ceil(1.5s)
  });

  it('falls back to 60s when reset time is in the past, zero, or non-finite', () => {
    expect(rateLimitResponseBody(NOW - 5_000, NOW).retryAfter).toBe(60);
    expect(rateLimitResponseBody(0, NOW).retryAfter).toBe(60);
    expect(rateLimitResponseBody(NaN, NOW).retryAfter).toBe(60);
  });

  it('renders a singular minute for <= 60s', () => {
    expect(rateLimitResponseBody(NOW + 30_000, NOW).message).toMatch(/1 minute\b/);
    expect(rateLimitResponseBody(NOW + 30_000, NOW).message).not.toMatch(/minutes/);
  });

  it('renders plural minutes and rounds up', () => {
    // 130s → ceil(130/60) = 3 minutes
    expect(rateLimitResponseBody(NOW + 130_000, NOW).message).toMatch(/3 minutes/);
  });
});
