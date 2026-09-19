import { describe, it, expect } from 'vitest';
import { csvSafe } from './csvSafe';

describe('csvSafe (spreadsheet formula injection)', () => {
  it('prefixes every formula-starting character with a quote', () => {
    for (const lead of ['=', '+', '-', '@', '\t', '\r']) {
      expect(csvSafe(`${lead}HYPERLINK("x")`)).toBe(`'${lead}HYPERLINK("x")`);
    }
  });

  it('leaves ordinary text, numbers and blanks alone', () => {
    expect(csvSafe('Dr. A. Rao')).toBe('Dr. A. Rao');
    expect(csvSafe('Assistant Professor')).toBe('Assistant Professor');
    expect(csvSafe('')).toBe('');
    expect(csvSafe(41)).toBe(41);
    expect(csvSafe(null)).toBe(null);
  });
});
