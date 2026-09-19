import { describe, it, expect } from 'vitest';
import { isoWeek } from './reminders';

describe('isoWeek (weekly draft-reminder dedupe)', () => {
  it('gives every day of one Monday-Sunday week the same key', () => {
    const days = ['2026-09-14', '2026-09-15', '2026-09-17', '2026-09-20'].map((d) => isoWeek(new Date(`${d}T09:00:00Z`)));
    expect(new Set(days).size).toBe(1);
    expect(days[0]).toBe('2026-W38');
  });

  it('moves to a new key on the next Monday', () => {
    expect(isoWeek(new Date('2026-09-21T09:00:00Z'))).toBe('2026-W39');
  });

  it('puts the first days of January in the right ISO year', () => {
    expect(isoWeek(new Date('2027-01-01T09:00:00Z'))).toBe('2026-W53');
    expect(isoWeek(new Date('2027-01-04T09:00:00Z'))).toBe('2027-W01');
  });
});
