// THROWAWAY — t/1800 gate-integrity proof. Deliberately fails to confirm the
// decoupled Test gate now hard-fails CI (previously the audit step masked it).
// This PR is opened only to observe CI go red at the Test step, then closed
// UNMERGED. Do not merge; do not keep.
import { describe, it, expect } from 'vitest';

describe('t/1800 deliberately-broken test (throwaway proof)', () => {
  it('fails on purpose to prove the Test gate fires', () => {
    expect(1).toBe(2);
  });
});
