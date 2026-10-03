import { describe, it, expect } from 'vitest';
import { validateOutletsData, loadOutletsData } from '../loadOutlets.js';
import { ActionableError } from '../../debate/errors.js';
import type { OutletsData } from '../outletsSsot.js';

describe('validateOutletsData', () => {
  it('passes for the live SSOT data', () => {
    const data = loadOutletsData();
    expect(() => validateOutletsData(data)).not.toThrow();
  });

  it('throws ActionableError when outlets_count mismatches actual key count', () => {
    const data = loadOutletsData();
    const bad = { ...data, __meta__: { ...data.__meta__, outlets_count: 999 } } as OutletsData;
    expect(() => validateOutletsData(bad)).toThrow(ActionableError);
    try {
      validateOutletsData(bad);
    } catch (err) {
      const ae = err as ActionableError;
      expect(ae.problem).toContain('outlets_count');
      expect(ae.location).toContain('lib/oped/loadOutlets.ts');
    }
  });
});

describe('loadOutletsData', () => {
  it('returns defaultOutlet key that exists in outlets', () => {
    const data = loadOutletsData();
    expect(data.outlets[data.defaultOutlet]).toBeDefined();
  });

  it('returns all 9 outlets', () => {
    const data = loadOutletsData();
    expect(Object.keys(data.outlets)).toHaveLength(9);
  });

  it('styleDefaults.readability matches grade-10 targets', () => {
    const { styleDefaults } = loadOutletsData();
    expect(styleDefaults.readability.fkMax).toBe(11);
    expect(styleDefaults.readability.maxSentWords).toBe(30);
    expect(styleDefaults.readability.maxParaWords).toBe(90);
  });

  it('styleDefaults has all 6 prose fields populated', () => {
    const { styleDefaults } = loadOutletsData();
    expect(styleDefaults.audience).toBeTruthy();
    expect(styleDefaults.readingLevel).toBeTruthy();
    expect(styleDefaults.sentenceMechanics).toBeTruthy();
    expect(styleDefaults.paragraphMechanics).toBeTruthy();
    expect(styleDefaults.jargonGuidance).toBeTruthy();
    expect(styleDefaults.bodyFormat).toBeTruthy();
  });
});
