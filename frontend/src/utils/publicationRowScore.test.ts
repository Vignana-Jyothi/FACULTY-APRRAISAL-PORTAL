import { describe, it, expect } from 'vitest';
import { publicationRowScore, INDEX_LABEL, countAuthors, computeScore } from './scoring';

// Same table as backend/src/services/publicationRowScore.test.ts — keep them equal.
const CASES: Array<[kind: 'journal' | 'conference' | 'chapter', indexed: any, score: number]> = [
  ['journal', 'WOS', 15], ['journal', 'SCOPUS', 15],
  ['journal', 'ESCI', 0], ['journal', 'ICI', 0], ['journal', 'NONE', 0], ['journal', undefined, 0],
  ['conference', 'WOS', 10], ['conference', 'SCOPUS', 10], ['conference', 'ESCI', 10], ['conference', 'ICI', 10], ['conference', 'NONE', 0],
  ['chapter', 'SCOPUS', 10], ['chapter', 'ESCI', 10], ['chapter', 'NONE', 0], ['chapter', null, 0],
];

describe('2.1 publicationRowScore (frontend port)', () => {
  for (const [kind, indexed, score] of CASES) {
    it(`${kind} indexed ${indexed} -> ${score}`, () => expect(publicationRowScore(kind, indexed)).toBe(score));
  }

  it('A + B + C share one cap of 60', () => {
    // Co-authors from other institutions, so only the index rule decides
    // (the 2.1 claim rule has its own suite, publicationClaim.test.ts).
    const OUTSIDE = { allAuthorsFromCampus: false };
    const s = computeScore({
      cat2Journals: [{ indexed: 'WOS', ...OUTSIDE }, { indexed: 'SCOPUS', ...OUTSIDE }, { indexed: 'ESCI', ...OUTSIDE }],
      cat2Conferences: [{ indexed: 'SCOPUS', ...OUTSIDE }],
      cat2ConfBookChapters: [{ indexed: 'ICI', ...OUTSIDE }],
    });
    expect(s.cat2.publications).toBe(50); // 15 + 15 + 0 + 10 + 10
    expect(computeScore({ cat2Journals: Array.from({ length: 5 }, () => ({ indexed: 'WOS' as const, ...OUTSIDE })) }).cat2.publications).toBe(60);
  });

  it('labels SCI / SCIE journals under the stored WOS value', () => {
    expect(INDEX_LABEL.WOS).toBe('SCI / SCIE / WoS');
    expect(INDEX_LABEL.NONE).toBe('Not indexed');
  });

  it('counts the names in an author list', () => {
    expect(countAuthors('A. Rao, B. Devi and C. Kumar')).toBe(3);
    expect(countAuthors('Rao; Devi & Kumar')).toBe(3);
    expect(countAuthors('')).toBe(0);
    expect(countAuthors(null)).toBe(0);
  });
});
