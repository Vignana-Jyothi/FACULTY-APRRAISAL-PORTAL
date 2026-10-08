import { describe, it, expect } from 'vitest';
import { publicationClaim, publicationScore, authorCount, computeScore } from './scoring';

// Mirror of backend/src/services/publicationClaim.test.ts — the port must make
// the same 2.1 claim decisions as the engine (owner decisions 2026-09-15,
// revised 2026-10-08: the claim is identification only and does not gate marks).

describe('2.1 authorship claim (frontend port)', () => {
  it('scores nothing while the campus question is unanswered', () => {
    expect(publicationScore('journal', { indexed: 'WOS' }).score).toBe(0);
    expect(publicationClaim({ allAuthorsFromCampus: null }).reason).toMatch(/Answer "are all authors from VNRVJIET\?"/);
  });

  it('scores normally when some co-authors are from other institutions', () => {
    expect(publicationScore('journal', { indexed: 'WOS', allAuthorsFromCampus: false }).score).toBe(15);
    expect(publicationScore('conference', { indexed: 'SCOPUS', allAuthorsFromCampus: false }).score).toBe(10);
    expect(publicationScore('chapter', { indexed: 'ICI', allAuthorsFromCampus: false }).score).toBe(10);
  });

  it('scores an all-VNRVJIET paper the same whoever claims it', () => {
    const mine = { indexed: 'SCOPUS', allAuthorsFromCampus: true, claimedBySelf: true };
    expect(publicationScore('journal', mine).score).toBe(15);
    expect(publicationScore('journal', { ...mine, claimedBySelf: false }).score).toBe(15);
  });

  it('scores an all-VNRVJIET paper even with the claim unanswered (claim does not gate the score)', () => {
    expect(publicationScore('journal', { indexed: 'WOS', allAuthorsFromCampus: true }).score).toBe(15);
    expect(publicationScore('journal', { indexed: 'WOS', allAuthorsFromCampus: true, claimedBySelf: null }).score).toBe(15);
  });

  it('carries into the category total', () => {
    const s = computeScore({
      cat2Journals: [
        { indexed: 'WOS', allAuthorsFromCampus: false },
        { indexed: 'WOS' },
        { indexed: 'WOS', allAuthorsFromCampus: true, claimedBySelf: true },
      ],
    });
    expect(s.cat2.publications).toBe(30);
  });

  it('counts authors from the list, falling back to the legacy text', () => {
    expect(authorCount({ authorList: ['A', '  ', 'B'], authors: 'ignored' })).toBe(2);
    expect(authorCount({ authorList: [], authors: 'A, B and C' })).toBe(3);
  });
});
