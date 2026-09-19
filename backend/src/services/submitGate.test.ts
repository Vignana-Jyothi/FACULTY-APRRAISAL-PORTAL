import { describe, it, expect } from 'vitest';
import { dayAfterInIndia } from './submitGate';

describe('dayAfterInIndia (submit opens after the whole last day of Q4)', () => {
  it('opens at 00:00 IST the day after a date-only end date', () => {
    // 28 May 2027 stored as midnight UTC -> opens 29 May 00:00 IST = 28 May 18:30 UTC.
    expect(dayAfterInIndia(new Date('2027-05-28T00:00:00Z')).toISOString()).toBe('2027-05-28T18:30:00.000Z');
  });

  it('is not open at any moment of the last day, in India', () => {
    const opens = dayAfterInIndia(new Date('2027-05-28T00:00:00Z')).getTime();
    expect(new Date('2027-05-28T18:29:59Z').getTime()).toBeLessThan(opens); // 23:59:59 IST on the 28th
  });

  it('crosses month and year boundaries', () => {
    expect(dayAfterInIndia(new Date('2027-06-30T00:00:00Z')).toISOString()).toBe('2027-06-30T18:30:00.000Z');
    expect(dayAfterInIndia(new Date('2026-12-31T00:00:00Z')).toISOString()).toBe('2026-12-31T18:30:00.000Z');
  });
});
