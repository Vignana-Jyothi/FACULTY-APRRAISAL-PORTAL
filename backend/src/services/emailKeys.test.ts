import { describe, it, expect } from 'vitest';
import { proofRejectedKey, holdClearedKey, unlockedKey, finalApprovedKey, feedbackIssuedKey } from './emailKeys';

// Each key must repeat for a repeat of the same event (so a double-click or a
// retried request mails once) and change for the next genuine occurrence (so a
// legitimate second mail still goes out). A Date.now() suffix failed the first
// half; a constant key would fail the second.

const T1 = new Date('2026-09-13T10:00:00.000Z');
const T2 = new Date('2026-09-20T10:00:00.000Z');

describe('email dedupe keys', () => {
  it('proof rejected: same proof file → same key; a replaced file → new key', () => {
    expect(proofRejectedKey('pv1', 'https://x/a.pdf')).toBe(proofRejectedKey('pv1', 'https://x/a.pdf'));
    expect(proofRejectedKey('pv1', 'https://x/a.pdf')).not.toBe(proofRejectedKey('pv1', 'https://x/b.pdf'));
  });

  it('proof rejected: each HoD gets their own key, distinct from the faculty\'s', () => {
    const fac = proofRejectedKey('pv1', 'u');
    const h1 = proofRejectedKey('pv1', 'u', 'hod1');
    const h2 = proofRejectedKey('pv1', 'u', 'hod2');
    expect(new Set([fac, h1, h2]).size).toBe(3);
    expect(h1).toBe(proofRejectedKey('pv1', 'u', 'hod1'));
  });

  it('hold cleared: same hold → same key; a later hold → new key', () => {
    expect(holdClearedKey('s1', T1)).toBe(holdClearedKey('s1', new Date(T1)));
    expect(holdClearedKey('s1', T1)).not.toBe(holdClearedKey('s1', T2));
  });

  it('unlocked: same submission state → same key; after a resubmit → new key', () => {
    expect(unlockedKey('s1', T1)).toBe(unlockedKey('s1', T1.toISOString()));
    expect(unlockedKey('s1', T1)).not.toBe(unlockedKey('s1', T2));
    expect(unlockedKey('s1', null)).toBe(unlockedKey('s1', undefined));
  });

  it('final approved: same HoD review → same key; a fresh review → new key', () => {
    expect(finalApprovedKey('s1', T1)).toBe(finalApprovedKey('s1', T1));
    expect(finalApprovedKey('s1', T1)).not.toBe(finalApprovedKey('s1', T2));
  });

  it('feedback issued: same text → same key; edited text → new key; blanks are stable', () => {
    const a = feedbackIssuedKey('f1', ['Strong', 'Improve X', null]);
    expect(a).toBe(feedbackIssuedKey('f1', ['Strong', 'Improve X', undefined]));
    expect(a).not.toBe(feedbackIssuedKey('f1', ['Strong', 'Improve Y', null]));
    // Field boundaries count: moving text between fields is a different issue.
    expect(feedbackIssuedKey('f1', ['ab', 'c'])).not.toBe(feedbackIssuedKey('f1', ['a', 'bc']));
  });

  it('keys are scoped to their subject', () => {
    expect(holdClearedKey('s1', T1)).not.toBe(holdClearedKey('s2', T1));
    expect(feedbackIssuedKey('f1', ['x'])).not.toBe(feedbackIssuedKey('f2', ['x']));
  });
});
