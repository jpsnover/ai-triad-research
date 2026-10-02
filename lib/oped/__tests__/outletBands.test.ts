import { describe, it, expect } from 'vitest';
import { resolveOutletBand, OUTLET_BANDS } from '../outletBands.js';
import { ActionableError } from '../../debate/errors.js';

describe('resolveOutletBand', () => {
  it('returns TechPolicyPress band when outlet is undefined (house default)', () => {
    const band = resolveOutletBand(undefined);
    expect(band).toBe(OUTLET_BANDS['TechPolicyPress']);
    expect(band.words).toBe(1500);
  });

  it('throws ActionableError for an unrecognised outlet string', () => {
    expect(() => resolveOutletBand('UnknownOutlet')).toThrow(ActionableError);
    try {
      resolveOutletBand('UnknownOutlet');
    } catch (err) {
      expect(err).toBeInstanceOf(ActionableError);
      const ae = err as ActionableError;
      expect(ae.problem).toContain('"UnknownOutlet"');
      expect(ae.problem).toContain('WashingtonPost');
    }
  });

  it('returns the matching band for a known outlet', () => {
    const band = resolveOutletBand('WashingtonPost');
    expect(band).toBe(OUTLET_BANDS['WashingtonPost']);
    expect(band.words).toBe(800);
  });
});
