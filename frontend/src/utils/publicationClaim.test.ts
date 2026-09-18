import { describe, it, expect } from 'vitest';
import { publicationClaim, publicationScore, authorCount, computeScore } from './scoring';

// Mirror of backend/src/services/publicationClaim.test.ts — the port must make
// the same 2.1 claim decisions as the engine (owner decisions 2026-09-15).

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

  it('scores an all-VNRVJIET paper only for the author who claims it', () => {
    const mine = { indexed: 'SCOPUS', allAuthorsFromCampus: true, claimedBySelf: true };
    expect(publicationScore('journal', mine).score).toBe(15);
    expect(publicationScore('journal', { ...mine, claimedBySelf: false })).toEqual({ score: 0, reason: 'Claimed by another co-author' });
  });

  it('needs the claim answered before an all-VNRVJIET paper scores', () => {
    expect(publicationScore('journal', { indexed: 'WOS', allAuthorsFromCampus: true }).reason).toBe('Choose who claims this paper');
    expect(publicationScore('journal', { indexed: 'WOS', allAuthorsFromCampus: true, claimedBySelf: null }).score).toBe(0);
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
